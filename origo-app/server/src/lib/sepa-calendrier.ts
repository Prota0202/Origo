/** Jours de prélèvement SEPA : le 15 et le dernier jour du mois, heure de Bruxelles. */

export function dateBruxelles(now: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function dernierJourDuMois(annee: number, mois1a12: number) {
  return new Date(Date.UTC(annee, mois1a12, 0)).getUTCDate()
}

export function estJourPrelevement(now: Date) {
  const iso = dateBruxelles(now)
  const [annee, mois, jour] = iso.split('-').map(Number)
  return jour === 15 || jour === dernierJourDuMois(annee, mois)
}

export function clePeriode(now: Date) {
  return dateBruxelles(now)
}
