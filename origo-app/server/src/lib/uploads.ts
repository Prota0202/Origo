import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { ValidationError } from './errors.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Fichiers hors DB — demain on pourra pointer ce dossier vers S3/R2 sans changer l’API */
export const UPLOAD_DIR = resolve(__dirname, '../../uploads')

const MAX_BYTES = 2.5 * 1024 * 1024

export function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

function extFromMime(mime: string) {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'jpg'
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
    return value
  }

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value)
  if (!match) throw new ValidationError('Format image invalide')

  const buf = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (buf.length > MAX_BYTES) {
    throw new ValidationError('Image trop lourde (max 2,5 Mo après compression)')
  }

  ensureUploadDir()
  const name = `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}.${extFromMime(match[1])}`
  await writeFile(join(UPLOAD_DIR, name), buf)
  return `/uploads/${name}`
}

/** Pour les listes JSON : ne jamais renvoyer d’anciens base64 (hasPhoto = true si besoin). */
export function photoForList(url: string | null | undefined) {
  if (!url) return { url: null as string | null, hasPhoto: false }
  if (url.startsWith('data:')) return { url: null, hasPhoto: true }
  return { url, hasPhoto: true }
}

export async function registerUploadsStatic(app: FastifyInstance) {
  ensureUploadDir()
  app.get('/uploads/:file', async (req, reply) => {
    const { file } = req.params as { file: string }
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
      return reply.code(400).send({ error: 'INVALID_PATH' })
    }
    const full = join(UPLOAD_DIR, file)
    if (!existsSync(full)) return reply.code(404).send({ error: 'NOT_FOUND' })
    const ext = extname(file).toLowerCase()
    const type =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg'
    reply.header('Cache-Control', 'public, max-age=86400')
    return reply.type(type).send(createReadStream(full))
  })
}
