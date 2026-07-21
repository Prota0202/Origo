export type TarifResult = {
  pu: number
  remisePct: number
  puFinal: number
  total: number
  palierSeuil?: number
}

function pourcentagePalier(pu: number, prixPalier: number) {
  return pu > 0 ? Math.round((1 - prixPalier / pu) * 100) : 0
}

/** Tarif d'une ligne — même logique que l'ancien front */
export function tarifLigne(input: {
  prixBase: number
  qty: number
  paliers?: { seuil: number; prix: number }[]
  remiseSeuil?: number | null
  remisePourcent?: number | null
}): TarifResult {
  const { prixBase: pu, qty, paliers, remiseSeuil, remisePourcent } = input
  const palier = paliers
    ?.filter((p) => qty >= p.seuil)
    .sort((a, b) => b.seuil - a.seuil)[0]

  if (palier) {
    return {
      pu,
      remisePct: pourcentagePalier(pu, palier.prix),
      puFinal: palier.prix,
      total: round2(palier.prix * qty),
      palierSeuil: palier.seuil,
    }
  }

  const remisePct =
    remiseSeuil != null && remisePourcent != null && qty >= remiseSeuil ? remisePourcent : 0
  const puFinal = round2(pu * (1 - remisePct / 100))
  return { pu, remisePct, puFinal, total: round2(puFinal * qty) }
}

export function round2(n: number) {
  return Math.round(n * 100) / 100
}
