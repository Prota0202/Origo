import { prisma } from '../db.js'

export class StockInsuffisantError extends Error {
  constructor(
    public readonly productId: number,
    public readonly disponible: number,
    public readonly demande: number
  ) {
    super(
      `Stock insuffisant pour le produit ${productId} : ${disponible} carton(s) disponible(s), ${demande} demandé(s)`
    )
    this.name = 'StockInsuffisantError'
  }
}

interface LigneAValider {
  productId: number
  quantiteCartons: number
  prixUnitaireApplique: number
}

/**
 * Valide une commande client de façon 100% sûre vis-à-vis des accès concurrents.
 *
 * Le scénario à bloquer : deux restaurants commandent au même instant les 5
 * derniers cartons d'un produit. Sans précaution, les deux requêtes peuvent
 * lire "5 disponibles" AVANT que l'une des deux n'ait enregistré sa commande
 * (bug classique dit "TOCTOU" : time-of-check-time-of-use) — les deux
 * commandes seraient acceptées et le stock deviendrait négatif.
 *
 * La parade : à l'intérieur d'une transaction, on verrouille explicitement
 * la ligne du produit avec `SELECT ... FOR UPDATE`. Toute autre transaction
 * qui tente de lire/verrouiller ce même produit doit attendre que la nôtre
 * soit terminée (COMMIT ou ROLLBACK) — il devient donc impossible que deux
 * commandes se basent sur la même lecture de stock périmée.
 */
export async function validerCommande(params: { clientId: number; lignes: LigneAValider[] }) {
  if (params.lignes.length === 0) {
    throw new Error('La commande ne contient aucune ligne')
  }

  return prisma.$transaction(async (tx) => {
    // On verrouille les produits dans un ordre stable (par id croissant) pour
    // éviter les interblocages (deadlocks) si deux commandes contiennent les
    // mêmes produits mais dans un ordre différent.
    const lignesTriees = [...params.lignes].sort((a, b) => a.productId - b.productId)

    for (const ligne of lignesTriees) {
      const verrou = await tx.$queryRaw<{ stockPhysique: number }[]>`
        SELECT "stockPhysique" FROM "Product" WHERE id = ${ligne.productId} FOR UPDATE
      `
      if (verrou.length === 0) {
        throw new Error(`Produit ${ligne.productId} introuvable`)
      }
      const { stockPhysique } = verrou[0]

      const reserve = await tx.orderItem.aggregate({
        _sum: { quantiteCartons: true },
        where: {
          productId: ligne.productId,
          order: { statut: { in: ['EN_ATTENTE', 'EN_COURS_DE_PREPARATION'] } },
        },
      })
      const disponible = stockPhysique - (reserve._sum.quantiteCartons ?? 0)

      if (ligne.quantiteCartons > disponible) {
        // Lever une exception dans un $transaction déclenche un ROLLBACK complet :
        // aucune ligne de la commande n'est créée, même partiellement.
        throw new StockInsuffisantError(ligne.productId, disponible, ligne.quantiteCartons)
      }
    }

    const cartonsTotal = lignesTriees.reduce((s, l) => s + l.quantiteCartons, 0)
    const totalHT = lignesTriees.reduce((s, l) => s + l.quantiteCartons * l.prixUnitaireApplique, 0)

    const commande = await tx.order.create({
      data: {
        numero: 'EN_ATTENTE_NUMERO', // remplacé juste après par un numéro basé sur l'id
        clientId: params.clientId,
        statut: 'EN_ATTENTE',
        cartonsTotal,
        totalHT,
        items: {
          create: lignesTriees.map((l) => ({
            productId: l.productId,
            quantiteCartons: l.quantiteCartons,
            prixUnitaireApplique: l.prixUnitaireApplique,
          })),
        },
      },
    })

    return tx.order.update({
      where: { id: commande.id },
      data: { numero: `CMD-${String(commande.id).padStart(4, '0')}` },
      include: { items: true },
    })
  })
}
