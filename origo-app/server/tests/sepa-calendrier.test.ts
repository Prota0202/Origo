import { describe, expect, it } from 'vitest'
import {
  dateBruxelles,
  dernierJourDuMois,
  estJourPrelevement,
  estJourPrelevementClient,
  jourSemaineBruxelles,
  libelleCalendrierSepa,
  normaliserCalendrierSepa,
} from '../src/lib/sepa-calendrier.js'

describe('calendrier SEPA Bruxelles', () => {
  it('prélève le 15 par défaut', () => {
    expect(estJourPrelevement(new Date('2026-08-15T10:00:00+02:00'))).toBe(true)
  })

  it('prélève le dernier jour du mois par défaut', () => {
    expect(estJourPrelevement(new Date('2026-08-31T12:00:00+02:00'))).toBe(true)
    expect(dernierJourDuMois(2026, 8)).toBe(31)
  })

  it('ne prélève pas un jour ordinaire par défaut', () => {
    expect(estJourPrelevement(new Date('2026-08-20T20:00:00+02:00'))).toBe(false)
  })

  it('utilise le calendrier de Bruxelles, pas UTC', () => {
    expect(dateBruxelles(new Date('2026-08-14T22:30:00Z'))).toBe('2026-08-15')
    expect(estJourPrelevement(new Date('2026-08-14T22:30:00Z'))).toBe(true)
  })

  it('accepte deux jours du mois choisis', () => {
    const cal = { type: 'jours_mois' as const, jours: [1, 20] }
    expect(estJourPrelevementClient(cal, new Date('2026-09-01T10:00:00+02:00'))).toBe(true)
    expect(estJourPrelevementClient(cal, new Date('2026-09-20T10:00:00+02:00'))).toBe(true)
    expect(estJourPrelevementClient(cal, new Date('2026-09-15T10:00:00+02:00'))).toBe(false)
  })

  it('prélève un jour de semaine', () => {
    expect(jourSemaineBruxelles('2026-09-07')).toBe(1)
    const cal = { type: 'hebdo' as const, jour: 1 }
    expect(estJourPrelevementClient(cal, new Date('2026-09-07T09:00:00+02:00'))).toBe(true)
    expect(estJourPrelevementClient(cal, new Date('2026-09-08T09:00:00+02:00'))).toBe(false)
  })

  it('prélève tous les 21 jours depuis une date', () => {
    const cal = { type: 'intervalle' as const, jours: 21, depuis: '2026-09-06' }
    expect(estJourPrelevementClient(cal, new Date('2026-09-06T12:00:00+02:00'))).toBe(true)
    expect(estJourPrelevementClient(cal, new Date('2026-09-27T12:00:00+02:00'))).toBe(true)
    expect(estJourPrelevementClient(cal, new Date('2026-09-13T12:00:00+02:00'))).toBe(false)
  })

  it('normalise un JSON invalide vers le défaut', () => {
    expect(normaliserCalendrierSepa(null).type).toBe('jours_mois')
    expect(libelleCalendrierSepa({ type: 'hebdo', jour: 3 })).toBe('chaque mercredi')
  })
})
