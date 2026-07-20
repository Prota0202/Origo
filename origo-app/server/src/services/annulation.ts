import { prisma } from '../db.js'

/**
 * Annule une commande, avec deux comportements distincts selon son avancement :
 *
 * - Si elle est encore EN_ATTENTE / EN_COURS_DE_PREPARATION : le stock physique
 *   n'a jamais bougé (seule une RÉSERVATION existait). Il suffit de passer le
 *   statut à ANNULEE : elle sort alors automatiquement du calcul de
 *   `stockReserve`, et le stock disponible remonte instantanément — sans
 *   qu'aucune ligne de stock n'ait besoin d'être touchée.
 *
 * - Si elle est déjà EXPEDIEE : le stock physique avait été décrémenté à la
 *   sortie d'entrepôt. On doit le réinjecter explicitement (mouvement
 *   RETOUR_ANNULATION), en traçant chaque ligne dans le journal d'audit.
 */
export async function annulerCommande(orderId: number, motif: string, adminId: number) {
  return prisma.$transaction(async (tx) => {
    const commande = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    })

    if (commande.statut === 'ANNULEE') {
      throw new Error('Cette commande est déjà annulée')
    }

    if (commande.statut === 'EXPEDIEE') {
      for (const item of commande.items) {
        const produit = await tx.product.update({
          where: { id: item.productId },
          data: { stockPhysique: { increment: item.quantiteCartons } },
        })

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'RETOUR_ANNULATION',
            quantite: item.quantiteCartons,
            orderId,
            stockApres: produit.stockPhysique,
            createdPar: adminId,
          },
        })
      }
    }
    // Sinon (EN_ATTENTE / EN_COURS_DE_PREPARATION) : rien à réinjecter, voir
    // le commentaire ci-dessus.

    return tx.order.update({
      where: { id: orderId },
      data: { statut: 'ANNULEE', annuleeLe: new Date(), motifAnnulation: motif },
    })
  })
}

/**
 * Note métier importante : si la marchandise revient endommagée/invendable
 * (au lieu d'un simple retour "bon état"), ne pas utiliser cette fonction
 * telle quelle — enregistrer plutôt un mouvement AJUSTEMENT_INVENTAIRE
 * négatif séparé (perte), pour ne pas réinjecter par erreur du stock qui
 * n'est en réalité plus vendable.
 */
