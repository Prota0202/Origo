/** Calendrier de prélèvement SEPA, par restaurant, heure de Bruxelles. */

export type CalendrierSepa =
  | { type: 'jours_mois'; jours: number[] }
  | { type: 'hebdo'; jour: number }
  | { type: 'intervalle'; jours: number; depuis: string }

export const CALENDRIER_SEPA_DEFAUT: CalendrierSepa = { type: 'jours_mois', jours: [15, -1] }

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

/** @deprecated Préférer estJourPrelevementClient — conservé pour les tests du défaut. */
export function estJourPrelevement(now: Date) {
  return estJourPrelevementClient(CALENDRIER_SEPA_DEFAUT, now)
}

export function clePeriode(now: Date) {
  return dateBruxelles(now)
}

export function normaliserCalendrierSepa(brut: unknown): CalendrierSepa {
  if (!brut || typeof brut !== 'object') return CALENDRIER_SEPA_DEFAUT
  const o = brut as Record<string, unknown>
  if (o.type === 'hebdo') {
    const jour = Number(o.jour)
    if (jour >= 1 && jour <= 7) return { type: 'hebdo', jour }
  }
  if (o.type === 'intervalle') {
    const jours = Number(o.jours)
    const depuis = String(o.depuis ?? '')
    if (Number.isInteger(jours) && jours >= 1 && jours <= 366 && /^\d{4}-\d{2}-\d{2}$/.test(depuis)) {
      return { type: 'intervalle', jours, depuis }
    }
  }
  if (o.type === 'jours_mois' || Array.isArray(o.jours)) {
    const jours = (Array.isArray(o.jours) ? o.jours : [])
      .map((n) => Number(n))
      .filter((n) => n === -1 || (Number.isInteger(n) && n >= 1 && n <= 31))
    if (jours.length > 0) return { type: 'jours_mois', jours: [...new Set(jours)].sort((a, b) => a - b) }
  }
  return CALENDRIER_SEPA_DEFAUT
}

export function estJourPrelevementClient(brut: unknown, now: Date) {
  const cal = normaliserCalendrierSepa(brut)
  const iso = dateBruxelles(now)
  const [annee, mois, jour] = iso.split('-').map(Number)

  if (cal.type === 'jours_mois') {
    const dernier = dernierJourDuMois(annee, mois)
    return cal.jours.some((j) => (j === -1 ? jour === dernier : jour === j))
  }

  if (cal.type === 'hebdo') {
    return jourSemaineBruxelles(iso) === cal.jour
  }

  const ecart = joursEntre(cal.depuis, iso)
  return ecart >= 0 && ecart % cal.jours === 0
}

/** 1 = lundi … 7 = dimanche, calendrier de Bruxelles. */
export function jourSemaineBruxelles(isoYmd: string) {
  const [y, m, d] = isoYmd.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  return ((utc.getUTCDay() + 6) % 7) + 1
}

function joursEntre(debutIso: string, finIso: string) {
  const a = Date.parse(`${debutIso}T00:00:00Z`)
  const b = Date.parse(`${finIso}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return -1
  return Math.round((b - a) / 86_400_000)
}

const JOURS_FR = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

export function libelleCalendrierSepa(brut: unknown) {
  const cal = normaliserCalendrierSepa(brut)
  if (cal.type === 'hebdo') return `chaque ${JOURS_FR[cal.jour]}`
  if (cal.type === 'intervalle') {
    if (cal.jours === 7) return `toutes les semaines depuis le ${cal.depuis}`
    if (cal.jours === 14) return `toutes les 2 semaines depuis le ${cal.depuis}`
    if (cal.jours === 21) return `toutes les 3 semaines depuis le ${cal.depuis}`
    return `tous les ${cal.jours} jours depuis le ${cal.depuis}`
  }
  const parts = cal.jours.map((j) => (j === -1 ? 'fin de mois' : `le ${j}`))
  return parts.join(' et ')
}
