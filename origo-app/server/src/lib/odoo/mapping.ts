/**
 * Traduction des fiches ORIGO en valeurs Odoo, sans aucun appel réseau.
 *
 * 1 unité Odoo = 1 carton ORIGO. Le nombre de pièces par carton n'existe pas
 * dans Odoo : on le met dans la description de vente, sinon un devis affiche
 * « 3 unités » et le restaurant croit commander 3 bols.
 *
 * TVA : on n'écrit un `vat` que s'il ressemble à un numéro belge. Un champ
 * vide ou un brouillon (« à venir ») ferait refuser toute la fiche partenaire.
 * Le n° d'ORIGO arrive début septembre — jusque-là, on n'écrit rien.
 */

export function descriptionVente(p: { description: string; unitesParCarton: number }) {
  const carton = `1 unité Odoo = 1 carton ORIGO (${p.unitesParCarton} pièces).`
  const texte = p.description.trim()
  return texte ? `${texte}\n${carton}` : carton
}

/**
 * Accepte BE + 10 chiffres, avec ou sans espaces / points.
 * Refuse tout le reste (placeholder, n° français, texte libre).
 */
export function normaliserTvaBelge(brut: string | null | undefined): string | null {
  if (!brut) return null
  const compact = brut.replace(/[\s.\-]/g, '').toUpperCase()
  const chiffres = compact.startsWith('BE') ? compact.slice(2) : compact
  if (!/^\d{10}$/.test(chiffres)) return null
  return `BE${chiffres}`
}

export function valeursProduitOdoo(p: {
  nom: string
  sku: string
  description: string
  unitesParCarton: number
  prixCarton: number
  actif: boolean
}) {
  return {
    name: p.nom,
    default_code: p.sku,
    list_price: p.prixCarton,
    type: 'consu' as const,
    is_storable: true,
    description_sale: descriptionVente(p),
    active: p.actif,
  }
}

export function valeursPartenaireOdoo(
  c: {
    nom: string
    code: string
    email: string | null
    telephone: string | null
    adresse: string | null
    ville: string | null
    numeroTva: string | null
    minCartons: number
    actif: boolean
  },
  paysId?: number,
) {
  const valeurs: Record<string, unknown> = {
    name: c.nom,
    is_company: true,
    ref: c.code,
    email: c.email || false,
    phone: c.telephone || false,
    street: c.adresse || false,
    city: c.ville || false,
    comment: `ORIGO · code ${c.code} · minimum ${c.minCartons} cartons.`,
    active: c.actif,
  }
  if (paysId) valeurs.country_id = paysId
  const tva = normaliserTvaBelge(c.numeroTva)
  if (tva) valeurs.vat = tva
  return valeurs
}

/** Référence unique côté Odoo : sert d'idempotence si un timeout a déjà créé le devis. */
export function referenceCommandeOdoo(numero: string) {
  return numero.trim()
}

export function origineCommandeOdoo(numero: string) {
  return `ORIGO ${numero.trim()}`
}

/** Odoo 19 attend `YYYY-MM-DD HH:MM:SS`, pas l’ISO `…T…Z`. */
export function dateHeureOdoo(d: Date) {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Un seul `create` imbriqué : Odoo refuse les méthodes privées, et créer le
 * devis puis les lignes en deux appels laisse un devis orphelin si le second
 * échoue (ODOO.md § 9).
 *
 * `price_unit` est le prix ORIGO déjà calculé (`tarifLigne`). `discount` est
 * forcé à 0 : une remise Odoo se réappliquerait sur le catalogue, pas sur le
 * négocié.
 */
export function valeursDevisOdoo(params: {
  partenaireId: number
  tarifId?: number | null
  numero: string
  dateLivraisonPrevue?: Date | null
  lignes: { varianteId: number; quantite: number; prixUnitaire: number; nom: string }[]
}) {
  const valeurs: Record<string, unknown> = {
    partner_id: params.partenaireId,
    client_order_ref: referenceCommandeOdoo(params.numero),
    origin: origineCommandeOdoo(params.numero),
    order_line: params.lignes.map((l) => [
      0,
      0,
      {
        product_id: l.varianteId,
        product_uom_qty: l.quantite,
        price_unit: l.prixUnitaire,
        discount: 0,
        name: l.nom,
      },
    ]),
  }
  if (params.tarifId) valeurs.pricelist_id = params.tarifId
  if (params.dateLivraisonPrevue) {
    valeurs.commitment_date = dateHeureOdoo(params.dateLivraisonPrevue)
  }
  return valeurs
}

export function idMany2one(valeur: unknown): number | null {
  if (typeof valeur === 'number') return valeur
  if (Array.isArray(valeur) && typeof valeur[0] === 'number') return valeur[0]
  return null
}
