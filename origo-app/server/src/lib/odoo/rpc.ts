/**
 * Transport JSON-RPC vers Odoo.
 *
 * Seul point du code qui parle réellement à Odoo. Tout le reste passe par
 * `executerKw`, ce qui permet de traiter au même endroit les trois façons dont
 * cette liaison peut mal tourner : Odoo injoignable, clé API révoquée, conflit
 * de sérialisation Postgres.
 */
import { env } from '../../config/env.js'
import { AppError } from '../errors.js'

/** Odoo est joignable mais refuse : erreur métier, inutile de réessayer. */
export class OdooErreur extends AppError {
  constructor(
    message: string,
    readonly nomOdoo: string,
    details?: unknown,
  ) {
    super(502, message, 'ODOO', details)
    this.name = 'OdooErreur'
  }
}

/** Odoo n'a pas répondu, ou pas à temps. L'état de l'écriture est inconnu. */
export class OdooIndisponible extends AppError {
  constructor(message: string) {
    super(503, message, 'ODOO_INDISPONIBLE')
    this.name = 'OdooIndisponible'
  }
}

/** La clé API ne fonctionne plus : révoquée, expirée, ou base renommée. */
export class OdooAuthErreur extends AppError {
  constructor(message = "Odoo refuse l'authentification (clé API révoquée ou expirée ?)") {
    super(502, message, 'ODOO_AUTH')
    this.name = 'OdooAuthErreur'
  }
}

function verifierActif() {
  if (!env.odoo.actif) {
    throw new OdooIndisponible("Intégration Odoo non configurée (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY)")
  }
}

type ReponseRpc = {
  result?: unknown
  error?: { message?: string; data?: { name?: string; message?: string; debug?: string } }
}

/**
 * Un conflit de sérialisation signifie que Postgres a annulé **toute** la
 * transaction Odoo : rien n'a été écrit, donc réessayer ne duplique rien.
 * C'est le seul cas où une écriture peut être relancée sans risque.
 */
function estConflitSerialisation(nom: string, message: string) {
  return (
    nom.includes('SerializationFailure') ||
    nom.includes('TransactionRollbackError') ||
    nom.includes('OperationalError') ||
    /could not serialize access|deadlock detected|concurrent update/i.test(message)
  )
}

function estErreurAuth(nom: string, message: string) {
  return nom.includes('AccessDenied') || /access denied|invalid credentials|expired/i.test(message)
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Odoo Online rate-limite : un appel toutes les 400 ms, et 45 s de pause après un 429. */
const ESPACE_MS = 400
const PAUSE_429_MS = 45_000
let dernierAppelMs = 0
let pauseJusquaMs = 0

async function avantAppelReseau() {
  const pause = pauseJusquaMs - Date.now()
  if (pause > 0) await attendre(pause)
  const delta = Date.now() - dernierAppelMs
  if (delta < ESPACE_MS) await attendre(ESPACE_MS - delta)
  dernierAppelMs = Date.now()
}

async function appelBrut(service: string, method: string, args: unknown[]): Promise<unknown> {
  await avantAppelReseau()
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), env.odoo.timeoutMs)

  let reponse: Response
  try {
    reponse = await fetch(`${env.odoo.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
      signal: controleur.signal,
    })
  } catch (e) {
    const cause = e instanceof Error && e.name === 'AbortError' ? `délai de ${env.odoo.timeoutMs} ms dépassé` : (e as Error).message
    throw new OdooIndisponible(`Odoo injoignable : ${cause}`)
  } finally {
    clearTimeout(minuteur)
  }

  if (reponse.status === 429) {
    pauseJusquaMs = Date.now() + PAUSE_429_MS
    throw new OdooIndisponible('Odoo a répondu HTTP 429')
  }
  if (!reponse.ok) {
    throw new OdooIndisponible(`Odoo a répondu HTTP ${reponse.status}`)
  }

  const corps = (await reponse.json().catch(() => null)) as ReponseRpc | null
  if (!corps) throw new OdooIndisponible('Réponse Odoo illisible')

  if (corps.error) {
    const nom = corps.error.data?.name ?? ''
    const message = corps.error.data?.message ?? corps.error.message ?? 'erreur Odoo inconnue'
    if (estErreurAuth(nom, message)) throw new OdooAuthErreur(message)
    if (estConflitSerialisation(nom, message)) {
      // Signalé comme indisponibilité passagère pour que la boucle réessaie.
      throw new OdooIndisponible(`Conflit de transaction Odoo : ${message}`)
    }
    throw new OdooErreur(message, nom, corps.error.data?.debug)
  }

  return corps.result
}

let uidEnCache: number | null = null

async function authentifier(forcer = false): Promise<number> {
  verifierActif()
  if (uidEnCache !== null && !forcer) return uidEnCache

  const uid = await appelBrut('common', 'authenticate', [
    env.odoo.db,
    env.odoo.user,
    env.odoo.apiKey,
    {},
  ])
  if (typeof uid !== 'number' || uid === 0) {
    throw new OdooAuthErreur(`Odoo refuse « ${env.odoo.user} » sur la base « ${env.odoo.db} »`)
  }
  uidEnCache = uid
  return uid
}

/** À appeler quand la configuration change (tests, rotation de clé). */
export function oublierSession() {
  uidEnCache = null
}

/**
 * Appelle une méthode d'un modèle Odoo.
 *
 * `relançableSurTimeout` : à ne mettre à `true` que pour des lectures. Sur une
 * écriture, un délai dépassé laisse l'état indéterminé — la transaction Odoo a
 * peut-être abouti — et réessayer créerait un doublon de commande ou de facture.
 */
export async function executerKw<T = unknown>(
  modele: string,
  methode: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
  options: { relancableSurTimeout?: boolean } = {},
): Promise<T> {
  verifierActif()
  const maxBase = Math.max(1, env.odoo.tentatives)
  let maxTentatives = maxBase
  let derniere: unknown

  for (let tentative = 1; tentative <= maxTentatives; tentative++) {
    try {
      const uid = await authentifier()
      return (await appelBrut('object', 'execute_kw', [
        env.odoo.db,
        uid,
        env.odoo.apiKey,
        modele,
        methode,
        args,
        kwargs,
      ])) as T
    } catch (e) {
      derniere = e

      if (e instanceof OdooAuthErreur && tentative === 1) {
        oublierSession()
        try {
          await authentifier(true)
          continue
        } catch {
          throw e
        }
      }

      const est429 = e instanceof OdooIndisponible && /HTTP 429/.test(e.message)
      const estTimeout = e instanceof OdooIndisponible && /délai|injoignable/.test(e.message)
      const relancable =
        est429 ||
        (e instanceof OdooIndisponible && (!estTimeout || options.relancableSurTimeout === true))

      if (est429) maxTentatives = Math.max(maxTentatives, 5)
      if (!relancable || tentative >= maxTentatives) throw e

      if (est429) {
        // pauseJusquaMs est déjà posé : avantAppelReseau attend les 45 s.
        continue
      }

      await attendre(2 ** (tentative - 1) * 100 + Math.random() * 100)
    }
  }

  throw derniere
}

export const chercherLire = <T = Record<string, unknown>>(
  modele: string,
  domaine: unknown[],
  champs: string[],
  kwargs: Record<string, unknown> = {},
) =>
  executerKw<T[]>(modele, 'search_read', [domaine, champs], kwargs, { relancableSurTimeout: true })

export const lire = <T = Record<string, unknown>>(modele: string, ids: number[], champs: string[]) =>
  executerKw<T[]>(modele, 'read', [ids, champs], {}, { relancableSurTimeout: true })

export const creer = (modele: string, valeurs: Record<string, unknown>) =>
  executerKw<number>(modele, 'create', [valeurs])

export const ecrire = (modele: string, ids: number[], valeurs: Record<string, unknown>) =>
  executerKw<boolean>(modele, 'write', [ids, valeurs])

export const supprimer = (modele: string, ids: number[]) =>
  executerKw<boolean>(modele, 'unlink', [ids])

/**
 * Sonde de liaison : à appeler au démarrage puis périodiquement.
 *
 * Une clé API peut être révoquée à la main, ou la base renommée. Sans cette
 * sonde on l'apprend par un restaurant qui ne peut plus commander.
 */
export async function verifierLiaison(): Promise<
  { ok: true; version: string; uid: number } | { ok: false; raison: string }
> {
  if (!env.odoo.actif) return { ok: false, raison: 'intégration non configurée' }
  try {
    oublierSession()
    const uid = await authentifier(true)
    const version = (await appelBrut('common', 'version', [])) as { server_version?: string }
    return { ok: true, version: version.server_version ?? 'inconnue', uid }
  } catch (e) {
    return { ok: false, raison: e instanceof Error ? e.message : String(e) }
  }
}
