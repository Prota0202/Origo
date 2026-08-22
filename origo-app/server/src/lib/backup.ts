import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../config/env.js'

/** Un dump quotidien absent depuis 48 h = le job a probablement cessé. */
const RETARD_MS = 48 * 3600 * 1000
/** Copie hors VPS (Mac / disque distant) trop vieille = le pull a cessé. */
const RETARD_OFFSITE_MS = 36 * 3600 * 1000

export type EtatOffsite =
  | { statut: 'absent' }
  | { statut: 'ok'; dernier: string; ageMs: number }
  | { statut: 'en_retard'; dernier: string; ageMs: number }

export type EtatBackup =
  | { statut: 'inconnu'; offsite: EtatOffsite }
  | { statut: 'ok'; dernierOk: string; ageMs: number; offsite: EtatOffsite }
  | { statut: 'echec'; dernierEchec: string; dernierOk?: string; offsite: EtatOffsite }
  | { statut: 'en_retard'; dernierOk: string; ageMs: number; offsite: EtatOffsite }

function lire(chemin: string) {
  try {
    return readFileSync(chemin, 'utf8').trim()
  } catch {
    return ''
  }
}

function etatOffsite(dir: string, maintenant: number): EtatOffsite {
  const p = join(dir, 'origo.last_offsite')
  if (!existsSync(p)) return { statut: 'absent' }
  let mtime = 0
  try {
    mtime = statSync(p).mtimeMs
  } catch {
    return { statut: 'absent' }
  }
  const dernier = lire(p) || new Date(mtime).toISOString()
  const ageMs = Math.max(0, maintenant - mtime)
  if (ageMs > RETARD_OFFSITE_MS) return { statut: 'en_retard', dernier, ageMs }
  return { statut: 'ok', dernier, ageMs }
}

/**
 * Lit les marqueurs écrits par `pg-backup-loop.sh` et `pull-backups.sh`.
 * Ne jette jamais : un dossier manquant ne doit pas faire tomber `/ready`.
 */
export function etatBackup(dir = env.backupStatusDir, maintenant = Date.now()): EtatBackup {
  const offsite: EtatOffsite = dir ? etatOffsite(dir, maintenant) : { statut: 'absent' }
  if (!dir) return { statut: 'inconnu', offsite }

  const okPath = join(dir, 'origo.last_ok')
  const failPath = join(dir, 'origo.last_fail')
  const ok = existsSync(okPath)
  const fail = existsSync(failPath)
  if (!ok && !fail) return { statut: 'inconnu', offsite }

  const mtime = (p: string) => {
    try {
      return statSync(p).mtimeMs
    } catch {
      return 0
    }
  }

  if (fail && (!ok || mtime(failPath) > mtime(okPath))) {
    return {
      statut: 'echec',
      dernierEchec: lire(failPath) || new Date(mtime(failPath)).toISOString(),
      ...(ok && { dernierOk: lire(okPath) }),
      offsite,
    }
  }

  if (ok) {
    const ageMs = Math.max(0, maintenant - mtime(okPath))
    const dernierOk = lire(okPath) || new Date(mtime(okPath)).toISOString()
    if (ageMs > RETARD_MS) return { statut: 'en_retard', dernierOk, ageMs, offsite }
    return { statut: 'ok', dernierOk, ageMs, offsite }
  }

  return { statut: 'inconnu', offsite }
}
