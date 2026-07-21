export const JOUR = 24 * 60 * 60 * 1000

export const slug = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `id-${Date.now()}`

export const STATUT_API = {
  Préparée: 'PREPAREE',
  'En livraison': 'EN_LIVRAISON',
  Livrée: 'LIVREE',
  'Livrée partiellement': 'LIVREE_PARTIELLEMENT',
  Annulée: 'ANNULEE',
  Confirmée: 'CONFIRMEE',
}

export const formatRestant = (ms) => {
  const min = Math.max(0, Math.ceil(ms / 60000))
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60 ? min % 60 + ' min' : ''}`.trim()
  return `${min} min`
}

export const CLASSE_STATUT = {
  Confirmée: 'statut-confirmee',
  Préparée: 'statut-preparee',
  'En livraison': 'statut-enlivraison',
  Livrée: 'statut-livree',
  'Livrée partiellement': 'statut-partielle',
  Annulée: 'statut-annulee',
}
