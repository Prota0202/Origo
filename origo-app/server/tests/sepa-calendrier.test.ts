import { describe, expect, it } from 'vitest'
import { dateBruxelles, dernierJourDuMois, estJourPrelevement } from '../src/lib/sepa-calendrier.js'

describe('calendrier SEPA Bruxelles', () => {
  it('prélève le 15', () => {
    expect(estJourPrelevement(new Date('2026-08-15T10:00:00+02:00'))).toBe(true)
  })

  it('prélève le dernier jour du mois', () => {
    expect(estJourPrelevement(new Date('2026-08-31T12:00:00+02:00'))).toBe(true)
    expect(dernierJourDuMois(2026, 8)).toBe(31)
  })

  it('ne prélève pas un jour ordinaire', () => {
    expect(estJourPrelevement(new Date('2026-08-20T20:00:00+02:00'))).toBe(false)
  })

  it('utilise le calendrier de Bruxelles, pas UTC', () => {
    // 15 août 00:30 Bruxelles = 14 août 22:30 UTC
    expect(dateBruxelles(new Date('2026-08-14T22:30:00Z'))).toBe('2026-08-15')
    expect(estJourPrelevement(new Date('2026-08-14T22:30:00Z'))).toBe(true)
  })
})
