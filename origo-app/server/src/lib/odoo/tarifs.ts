/**
 * Traduction de la grille tarifaire d'ORIGO en règles de liste de prix Odoo.
 *
 * Règle cardinale : **ORIGO ne délègue aucun calcul de prix à Odoo.** Il écrit
 * uniquement des prix fixes, aux quantités de rupture de sa propre grille.
 *
 * Ce n'est pas de la prudence gratuite. Mesuré sur le labo (voir ODOO.md § 4) :
 * transposer une remise catalogue en règle `percentage` fait calculer Odoo sur le
 * prix catalogue au lieu du prix négocié du client — 22 € devenaient 28,50 € au
 * lieu de 20,90 €, sans le moindre message d'erreur, sur une facture légale.
 */
import { tarifLigne } from '../pricing.js'
import { CHAMPS, MODELES, REFERENCES } from './modeles.js'
import { chercherLire, creer, ecrire, executerKw, lire } from './rpc.js'

export type GrilleProduit = {
  /** Prix négocié du client s'il existe, sinon prix catalogue. */
  prixBase: number
  paliers?: { seuil: number; prix: number }[]
  remiseSeuil?: number | null
  remisePourcent?: number | null
}

export type RegleTarif = {
  /** `min_quantity` Odoo : 0 signifie « sans minimum ». */
  quantiteMini: number
  prixFixe: number
}

/**
 * `tarifLigne` est une fonction en escalier de la quantité : sa valeur ne change
 * qu'aux seuils. Évaluer la fonction à chaque seuil suffit donc à la reproduire
 * exactement, quel que soit l'enchevêtrement des paliers et de la remise.
 *
 * Vérifié sur 24 points de quantité par `odoo-lab/verifier-prix.mjs`.
 */
export function reglesDepuisGrille(grille: GrilleProduit): RegleTarif[] {
  const ruptures = new Set<number>([0])
  for (const p of grille.paliers ?? []) {
    if (p.seuil > 0) ruptures.add(p.seuil)
  }
  if (grille.remiseSeuil != null && grille.remiseSeuil > 0) ruptures.add(grille.remiseSeuil)

  const regles = [...ruptures]
    .sort((a, b) => a - b)
    .map((quantiteMini) => ({
      quantiteMini,
      prixFixe: tarifLigne({
        prixBase: grille.prixBase,
        qty: quantiteMini,
        paliers: grille.paliers,
        remiseSeuil: grille.remiseSeuil,
        remisePourcent: grille.remisePourcent,
      }).puFinal,
    }))

  // Un palier au même prix que le précédent n'apporte rien et alourdit la liste
  // de prix, qu'Odoo relit à chaque ligne de devis.
  return regles.filter((r, i) => i === 0 || r.prixFixe !== regles[i - 1].prixFixe)
}

/**
 * Vérifie les deux réglages Odoo qui font se tromper les prix **en silence**.
 * À appeler avant toute synchronisation : sans eux, écrire des tarifs ne sert à
 * rien et personne ne s'en aperçoit avant la première facture.
 */
export async function verifierPrerequisTarifs(): Promise<
  { ok: true } | { ok: false; problemes: string[] }
> {
  const problemes: string[] = []

  const [module, nom] = REFERENCES.groupeTarifs
  const reference = await executerKw<[string, number]>(
    'ir.model.data',
    'check_object_reference',
    [module, nom],
    {},
    { relancableSurTimeout: true },
  )
  const groupe = await lire(MODELES.groupe, [reference[1]], [CHAMPS.groupe.membresTous])
  const membres = (groupe[0]?.[CHAMPS.groupe.membresTous] as number[] | undefined) ?? []
  if (membres.length === 0) {
    problemes.push(
      'Le groupe « Listes de prix » n’est activé pour personne : Odoo ignorera les prix par client et facturera le prix catalogue (Ventes → Configuration → Listes de prix).',
    )
  }

  const societes = await chercherLire<{ id: number; currency_id: [number, string] }>(
    MODELES.societe,
    [],
    ['currency_id'],
    { limit: 1 },
  )
  const devise = societes[0]?.currency_id?.[1]
  if (devise && devise !== 'EUR') {
    problemes.push(
      `La société est en ${devise} et non en EUR : les listes de prix créées hériteraient de cette devise.`,
    )
  }

  return problemes.length === 0 ? { ok: true } : { ok: false, problemes }
}

/**
 * Remplace les règles d'un produit dans la liste de prix d'un client.
 *
 * Remplacement et non fusion : les règles obsolètes doivent disparaître, sinon
 * un ancien palier supprimé côté ORIGO continuerait de s'appliquer chez Odoo.
 */
export async function synchroniserReglesProduit(params: {
  tarifId: number
  produitModeleId: number
  grille: GrilleProduit
}) {
  const { tarifId, produitModeleId, grille } = params

  const existantes = await chercherLire<{ id: number }>(
    MODELES.tarifRegle,
    [
      [CHAMPS.tarifRegle.tarif, '=', tarifId],
      [CHAMPS.tarifRegle.produitModele, '=', produitModeleId],
    ],
    ['id'],
  )

  const voulues = reglesDepuisGrille(grille)

  // Un seul appel : `write` avec des commandes x2many est atomique côté Odoo, là
  // où une suppression suivie de créations laisserait une fenêtre pendant
  // laquelle le client n'a plus de tarif du tout.
  await ecrire(MODELES.tarif, [tarifId], {
    item_ids: [
      ...existantes.map((r) => [2, r.id, 0] as const),
      ...voulues.map(
        (r) =>
          [
            0,
            0,
            {
              [CHAMPS.tarifRegle.portee]: '1_product',
              [CHAMPS.tarifRegle.produitModele]: produitModeleId,
              [CHAMPS.tarifRegle.quantiteMini]: r.quantiteMini,
              [CHAMPS.tarifRegle.modeCalcul]: 'fixed',
              [CHAMPS.tarifRegle.prixFixe]: r.prixFixe,
            },
          ] as const,
      ),
    ],
  })

  return voulues
}

/** Crée la liste de prix d'un client et la lui rattache si elle n'existe pas. */
export async function assurerTarifClient(params: {
  partenaireId: number
  nom: string
  deviseId: number
}) {
  const partenaire = await lire(MODELES.partenaire, [params.partenaireId], [CHAMPS.partenaire.tarif])
  const actuel = partenaire[0]?.[CHAMPS.partenaire.tarif] as [number, string] | false | undefined

  if (actuel && Array.isArray(actuel)) return actuel[0]

  const tarifId = await creer(MODELES.tarif, {
    name: params.nom,
    currency_id: params.deviseId,
  })
  await ecrire(MODELES.partenaire, [params.partenaireId], {
    [CHAMPS.partenaire.tarif]: tarifId,
  })

  // Relecture obligatoire : ce champ est calculé avec inverse et l'écriture est
  // ignorée sans erreur si le groupe « Listes de prix » est inactif.
  const relu = await lire(MODELES.partenaire, [params.partenaireId], [CHAMPS.partenaire.tarif])
  const confirme = relu[0]?.[CHAMPS.partenaire.tarif] as [number, string] | false | undefined
  if (!confirme || !Array.isArray(confirme) || confirme[0] !== tarifId) {
    throw new Error(
      "La liste de prix n'a pas pu être rattachée au client : le groupe « Listes de prix » est probablement inactif dans Odoo.",
    )
  }

  return tarifId
}
