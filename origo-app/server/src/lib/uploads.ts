import { createReadStream, closeSync, existsSync, mkdirSync, openSync, readSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { ValidationError } from './errors.js'
import { env } from '../config/env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Fichiers hors DB — demain on pourra pointer ce dossier vers S3/R2 sans changer l’API */
export const UPLOAD_DIR = resolve(__dirname, '../../uploads')

const MAX_BYTES = 2.5 * 1024 * 1024

/**
 * Les photos de livraison montrent les locaux d’un client identifié : ce sont des
 * données personnelles, elles ne peuvent pas être servies à qui devine l’URL.
 *
 * Un `<img src>` ne peut pas porter d’en-tête `Authorization`, donc l’autorisation
 * voyage dans l’URL : l’API ne renvoie une URL signée qu’aux requêtes qui avaient
 * déjà le droit de voir la ressource. Même modèle que les URLs présignées S3/R2,
 * vers lesquelles ce dossier doit migrer.
 *
 * Clé dérivée du secret JWT, pas le secret lui-même : une signature d’image ne doit
 * jamais pouvoir servir de brique à la forge d’un jeton de session.
 */
const CLE_SIGNATURE = createHmac('sha256', env.jwtSecret).update('origo:uploads:v1').digest()

/**
 * Expiration quantifiée à l’heure : deux réponses de l’API dans la même heure
 * produisent des URLs identiques, donc le navigateur réutilise son cache au lieu de
 * retélécharger toutes les photos du catalogue à chaque rafraîchissement.
 */
const PAS_QUANTIFICATION_S = 3600

function signature(fichier: string, expiration: number) {
  return createHmac('sha256', CLE_SIGNATURE)
    .update(`${fichier}\n${expiration}`)
    .digest('base64url')
}

function nomDeFichierValide(fichier: string) {
  return /^[A-Za-z0-9._-]+$/.test(fichier) && !fichier.includes('..')
}

/** `/uploads/x.jpg` → `/uploads/x.jpg?e=…&s=…`. Toute autre forme est renvoyée intacte. */
export function signerUrlUpload(url: string, maintenant = Date.now()): string {
  if (!url.startsWith('/uploads/')) return url
  const fichier = url.slice('/uploads/'.length)
  if (!nomDeFichierValide(fichier)) return url

  const nowS = Math.floor(maintenant / 1000)
  const expiration =
    (Math.floor(nowS / PAS_QUANTIFICATION_S) + 1) * PAS_QUANTIFICATION_S + env.uploadsUrlTtlS
  return `/uploads/${fichier}?e=${expiration}&s=${signature(fichier, expiration)}`
}

/** Secondes restantes si la signature est valide, `null` sinon. */
export function verifierSignatureUpload(
  fichier: string,
  e: string | undefined,
  s: string | undefined,
  maintenant = Date.now(),
): number | null {
  if (!e || !s) return null
  const expiration = Number(e)
  if (!Number.isInteger(expiration)) return null

  const restant = expiration - Math.floor(maintenant / 1000)
  if (restant <= 0) return null

  const attendue = Buffer.from(signature(fichier, expiration))
  const fournie = Buffer.from(s)
  // La comparaison doit être à temps constant : sinon la durée de la réponse
  // permet de reconstruire la signature octet par octet.
  if (attendue.length !== fournie.length || !timingSafeEqual(attendue, fournie)) return null
  return restant
}

export function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

/** JPEG / PNG / GIF / WebP d’après les octets, pas d’après le MIME déclaré par le client. */
export function detecterTypeImage(buf: Buffer): 'jpeg' | 'png' | 'gif' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png'
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'gif'
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp'
  }
  return null
}

function mimeDepuisType(t: 'jpeg' | 'png' | 'gif' | 'webp') {
  if (t === 'png') return 'image/png'
  if (t === 'webp') return 'image/webp'
  if (t === 'gif') return 'image/gif'
  return 'image/jpeg'
}

function typeDepuisFichier(full: string, ext: string): string {
  try {
    const fd = openSync(full, 'r')
    try {
      const buf = Buffer.alloc(12)
      const n = readSync(fd, buf, 0, 12, 0)
      const t = detecterTypeImage(buf.subarray(0, n))
      if (t) return mimeDepuisType(t)
    } finally {
      closeSync(fd)
    }
  } catch {
    /* repli extension */
  }
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

/**
 * data URL → fichier `/uploads/…` ; URL courte déjà OK → inchangée.
 * Évite de stocker des Mo de base64 dans Postgres.
 */
export async function persistImageField(
  value: string | null | undefined,
  prefix: string,
): Promise<string | null | undefined> {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (!value.startsWith('data:')) {
    if (value.length > 2048) throw new ValidationError('URL photo trop longue')
    // Le front réenvoie l’URL qu’il a reçue, donc signée. Stocker la signature en
    // base ferait pointer la photo vers une URL périmée dès l’expiration, et la
    // resignature produirait `?e=…&s=…?e=…&s=…`.
    // Uniquement chemins locaux : une URL https:// permettrait de faire charger
    // un domaine tiers par le navigateur des restaurants (tracking / XSS).
    if (value.startsWith('/uploads/')) return value.split('?')[0]
    throw new ValidationError('Photo : fichier local /uploads uniquement')
  }

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value)
  if (!match) throw new ValidationError('Format image invalide')

  const buf = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (buf.length > MAX_BYTES) {
    throw new ValidationError('Image trop lourde (max 2,5 Mo après compression)')
  }

  const type = detecterTypeImage(buf)
  if (!type) throw new ValidationError('Fichier image non reconnu')

  ensureUploadDir()
  const ext = type === 'jpeg' ? 'jpg' : type
  const name = `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`
  await writeFile(join(UPLOAD_DIR, name), buf)
  return `/uploads/${name}`
}

/**
 * Efface un fichier d'`/uploads` quand on le remplace ou qu'on le retire.
 * Sans ça, chaque nouvelle photo de produit ou de livraison laisse l'ancienne
 * sur le disque (droit à l'effacement, disque qui gonfle).
 */
export function supprimerFichierUpload(url: string | null | undefined) {
  if (!url) return
  const chemin = url.startsWith('/uploads/') ? url.split('?')[0] : url
  if (!chemin.startsWith('/uploads/')) return
  const fichier = chemin.slice('/uploads/'.length)
  if (!nomDeFichierValide(fichier)) return
  const full = join(UPLOAD_DIR, fichier)
  if (!existsSync(full)) return
  try {
    unlinkSync(full)
  } catch {
    // Fichier déjà parti ou volume en lecture seule : on n'échoue pas la requête métier.
  }
}

/**
 * Pour les listes JSON : ne jamais renvoyer d’anciens base64 (hasPhoto = true si besoin).
 * Point de passage unique de toutes les photos sortantes, donc unique endroit où signer.
 */
export function photoForList(url: string | null | undefined) {
  if (!url) return { url: null as string | null, hasPhoto: false }
  if (url.startsWith('data:')) return { url: null, hasPhoto: true }
  return { url: signerUrlUpload(url), hasPhoto: true }
}

export async function registerUploadsStatic(app: FastifyInstance) {
  ensureUploadDir()
  app.get('/uploads/:file', async (req, reply) => {
    const { file } = req.params as { file: string }
    if (!file || !nomDeFichierValide(file)) {
      return reply.code(400).send({ error: 'INVALID_PATH' })
    }

    const { e, s } = req.query as { e?: string; s?: string }
    const restant = verifierSignatureUpload(file, e, s)
    if (restant === null) {
      // Volontairement avant le test d’existence : répondre 404 sur un fichier
      // absent et 403 sur un fichier présent transformerait cette route en
      // oracle permettant d’énumérer les photos.
      return reply.code(403).send({ error: 'SIGNATURE_INVALIDE' })
    }

    const full = join(UPLOAD_DIR, file)
    if (!existsSync(full)) return reply.code(404).send({ error: 'NOT_FOUND' })
    const ext = extname(file).toLowerCase()
    const type = typeDepuisFichier(full, ext)
    // `private` : un cache partagé (proxy d’entreprise, CDN) ne doit pas garder une
    // photo de livraison. `max-age` borné par la validité de la signature, sinon le
    // navigateur servirait une image dont l’URL est déjà refusée par le serveur.
    reply.header('Cache-Control', `private, max-age=${restant}`)
    return reply.type(type).send(createReadStream(full))
  })
}
