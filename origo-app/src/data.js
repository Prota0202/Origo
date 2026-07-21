// Helpers métier partagés (tarifs, format). Les données vivent dans l'API / Postgres.

export const prixPour = (client, produit) => client?.prix?.[produit.id] ?? produit.prixCarton

export const pourcentagePalier = (pu, prixPalier) =>
  pu > 0 ? Math.round((1 - prixPalier / pu) * 100) : 0

export const formatPourcentage = (pct) => (pct >= 0 ? `−${pct} %` : `+${Math.abs(pct)} %`)

export function tarifLigne(client, produit, qty) {
  const pu = prixPour(client, produit)
  const paliers = client?.paliers?.[produit.id]
  const palier = paliers?.filter((p) => qty >= p.seuil).sort((a, b) => b.seuil - a.seuil)[0]
  if (palier) {
    return {
      pu,
      remisePct: pourcentagePalier(pu, palier.prix),
      puFinal: palier.prix,
      total: palier.prix * qty,
      palierSeuil: palier.seuil,
    }
  }
  const remisePct = produit.remise && qty >= produit.remise.seuil ? produit.remise.pourcent : 0
  const puFinal = Math.round(pu * (1 - remisePct / 100) * 100) / 100
  return { pu, remisePct, puFinal, total: puFinal * qty }
}

/** Fenêtre pendant laquelle un client peut modifier / annuler seul sa commande */
export const DELAI_MODIFICATION_MS = 60 * 60 * 1000

export const euros = (n) =>
  Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
