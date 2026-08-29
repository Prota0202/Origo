/**
 * Surveillance de la liaison Odoo.
 *
 * Une clé API peut être révoquée à la main, expirer, ou la base être renommée.
 * Sans sonde, on l'apprend par un restaurant qui ne peut plus commander. On
 * vérifie donc au démarrage puis périodiquement, et on trace bruyamment.
 *
 * Volontairement sans effet sur la disponibilité d'ORIGO : Odoo indisponible
 * n'empêche pas de prendre des commandes. Les ventes en attente sont
 * rattrapées dès que la liaison revient.
 */
import type { FastifyBaseLogger } from 'fastify'
import { env } from '../../config/env.js'
import { verifierLiaison } from './rpc.js'
import { tirerStocksDepuisOdoo } from './sync.js'
import { rattraperCommandesOdoo } from './ventes.js'

type Etat =
  | { statut: 'desactive' }
  | { statut: 'ok'; version: string; verifieLe: string }
  | { statut: 'hs'; raison: string; verifieLe: string; depuis: string }

let etat: Etat = { statut: 'desactive' }
let minuteur: NodeJS.Timeout | undefined

export function etatOdoo(): Etat {
  return etat
}

async function verifier(log: FastifyBaseLogger) {
  const resultat = await verifierLiaison()
  const maintenant = new Date().toISOString()

  if (resultat.ok) {
    if (etat.statut === 'hs') {
      log.warn({ indisponibleDepuis: etat.depuis }, 'Odoo : liaison rétablie')
    } else {
      log.info({ version: resultat.version }, 'Odoo : liaison établie')
    }
    etat = { statut: 'ok', version: resultat.version, verifieLe: maintenant }
    void rattraperCommandesOdoo().catch((e) => {
      log.error({ err: e }, 'Odoo : rattrapage des ventes en attente échoué')
    })
    void tirerStocksDepuisOdoo({ ignorerSiRecent: true }).catch((e) => {
      log.error({ err: e }, 'Odoo : alignement des stocks vers ORIGO échoué')
    })
    return
  }

  // On conserve la date du premier échec : c'est elle qui dit si c'est un
  // hoquet réseau ou une clé morte depuis trois jours.
  const depuis = etat.statut === 'hs' ? etat.depuis : maintenant
  etat = { statut: 'hs', raison: resultat.raison, verifieLe: maintenant, depuis }
  log.error({ raison: resultat.raison, depuis }, 'Odoo : liaison INDISPONIBLE')
}

/** Intervalle entre deux contrôles (ms). 15 min : assez pour alerter le jour même. */
const INTERVALLE_MS = Number(process.env.ODOO_SONDE_INTERVALLE_MS ?? String(15 * 60 * 1000))

export function demarrerSondeOdoo(log: FastifyBaseLogger) {
  if (!env.odoo.actif) {
    log.info('Odoo : intégration non configurée, ORIGO fonctionne seul')
    etat = { statut: 'desactive' }
    return
  }

  void verifier(log)
  minuteur = setInterval(() => void verifier(log), INTERVALLE_MS)
  // Sans unref, le minuteur retient l'event loop et `app.close()` ne rend
  // jamais la main : le conteneur serait tué par SIGKILL au redéploiement.
  minuteur.unref()
}

export function arreterSondeOdoo() {
  if (minuteur) clearInterval(minuteur)
  minuteur = undefined
}
