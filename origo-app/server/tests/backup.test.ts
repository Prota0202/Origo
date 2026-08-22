import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { etatBackup } from '../src/lib/backup.js'

function dossierMarqueurs() {
  const dir = join(tmpdir(), `origo-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('etatBackup', () => {
  it('reste silencieux si le dossier n’est pas configuré', () => {
    expect(etatBackup('')).toEqual({ statut: 'inconnu', offsite: { statut: 'absent' } })
  })

  it('signale un échec plus récent que le dernier OK', () => {
    const dir = dossierMarqueurs()
    try {
      writeFileSync(join(dir, 'origo.last_ok'), '2026-08-14T00:00:00Z')
      writeFileSync(join(dir, 'origo.last_fail'), '2026-08-16T00:00:00Z')
      expect(etatBackup(dir).statut).toBe('echec')
      expect(etatBackup(dir).offsite.statut).toBe('absent')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('signale un retard si le dernier OK a plus de 48 h', () => {
    const dir = dossierMarqueurs()
    try {
      writeFileSync(join(dir, 'origo.last_ok'), '2026-08-01T00:00:00Z')
      const dansTroisJours = Date.now() + 3 * 24 * 3600 * 1000
      expect(etatBackup(dir, dansTroisJours).statut).toBe('en_retard')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('signale une copie hors VPS à jour', () => {
    const dir = dossierMarqueurs()
    try {
      writeFileSync(join(dir, 'origo.last_ok'), '2026-08-20T00:00:00Z')
      writeFileSync(join(dir, 'origo.last_offsite'), '2026-08-20T12:00:00Z')
      const etat = etatBackup(dir, Date.now())
      expect(etat.offsite.statut).toBe('ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('signale une copie hors VPS trop vieille', () => {
    const dir = dossierMarqueurs()
    try {
      writeFileSync(join(dir, 'origo.last_ok'), '2026-08-20T00:00:00Z')
      const stamp = join(dir, 'origo.last_offsite')
      writeFileSync(stamp, '2026-08-01T00:00:00Z')
      const ilYAdeuxJours = Date.now() / 1000 - 48 * 3600
      utimesSync(stamp, ilYAdeuxJours, ilYAdeuxJours)
      expect(etatBackup(dir).offsite.statut).toBe('en_retard')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
