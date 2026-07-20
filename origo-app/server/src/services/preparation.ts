import { prisma } from '../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { verifierEtNotifierSeuil } from './alertes.js'

type Tx = Prisma.TransactionClient

/**
 * Le préparateur coche une ligne de sa checklist.
 * IMPORTANT : le stock physique ne bouge pas ici — cocher ne fait que
 * suivre la progression. Le stock physique n'est décrémenté qu'au moment
 * où la DERNIÈRE ligne de la commande est cochée (voir finaliserPreparation).
 */
export async function cocherLigne(orderItemId: number, preparateurId: number) {
  return prisma.$transaction(async (tx) => {
    const ligne = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { coche: true, cocheLe: new Date(), cochePar: preparateurId },
    })

    // Bascule la commande en "EN_COURS_DE_PREPARATION" dès la première coche.
    // La condition `statut: 'EN_ATTENTE'` rend l'opération idempotente et sûre :
    // si la commande est déjà EN_COURS_DE_PREPARATION (ou plus loin dans le
    // cycle), 0 ligne est affectée et son statut n'est jamais écrasé.
    await tx.order.updateMany({
      where: { id: ligne.orderId, statut: 'EN_ATTENTE' },
      data: { statut: 'EN_COURS_DE_PREPARATION' },
    })

    const restantes = await tx.orderItem.count({
      where: { orderId: ligne.orderId, coche: false },
    })

    if (restantes === 0) {
      await finaliserPreparation(ligne.orderId, preparateurId, tx)
    }

    return { ligne, commandeExpediee: restantes === 0 }
  })
}

/**
 * Le déclencheur "sortie d'entrepôt" : appelé uniquement quand toutes les
 * lignes d'une commande sont cochées. C'est ICI, et seulement ici, que le
 * stock_physique réel diminue — puisque c'est le moment où les cartons
 * quittent physiquement l'entrepôt.
 *
 * Statut -> EXPEDIEE.
 */
export async function finaliserPreparation(orderId: number, preparateurId: number, tx: Tx = prisma) {
  const items = await tx.orderItem.findMany({ where: { orderId } })

  for (const item of items) {
    const produit = await tx.product.update({
      where: { id: item.productId },
      data: { stockPhysique: { decrement: item.quantiteCartons } },
    })

    // Filet de sécurité : ne devrait jamais se produire si validerCommande()
    // a fait son travail, mais on refuse explicitement toute incohérence
    // plutôt que de laisser un stock négatif silencieux.
    if (produit.stockPhysique < 0) {
      throw new Error(
        `Incohérence de stock détectée pour le produit ${item.productId} : passerait à ${produit.stockPhysique}`
      )
    }

    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        type: 'SORTIE_COMMANDE',
        quantite: -item.quantiteCartons,
        orderId,
        stockApres: produit.stockPhysique,
        createdPar: preparateurId,
      },
    })

    await verifierEtNotifierSeuil(produit, tx as Prisma.TransactionClient)
  }

  await tx.order.update({
    where: { id: orderId },
    data: { statut: 'EXPEDIEE', expedieeLe: new Date() },
  })
}
