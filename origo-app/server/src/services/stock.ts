import { prisma } from '../db.js'

/**
 * Stock disponible = stock physique − stock réservé.
 * Le stock réservé est la somme des cartons des commandes qui ont été
 * validées par un client mais qui ne sont pas encore sorties de l'entrepôt
 * (statuts EN_ATTENTE et EN_COURS_DE_PREPARATION).
 *
 * Cette valeur n'est JAMAIS stockée en base : elle est toujours recalculée,
 * pour ne jamais pouvoir diverger de la réalité.
 */
export async function calculerStockDisponible(productId: number) {
  const produit = await prisma.product.findUniqueOrThrow({ where: { id: productId } })

  const reserve = await prisma.orderItem.aggregate({
    _sum: { quantiteCartons: true },
    where: {
      productId,
      order: { statut: { in: ['EN_ATTENTE', 'EN_COURS_DE_PREPARATION'] } },
    },
  })

  const stockReserve = reserve._sum.quantiteCartons ?? 0

  return {
    productId,
    stockPhysique: produit.stockPhysique,
    stockReserve,
    stockDisponible: produit.stockPhysique - stockReserve,
    seuilAlerte: produit.seuilAlerte,
  }
}

/**
 * Version "batch" pour un dashboard ou un catalogue entier : une seule requête
 * groupée au lieu d'une requête par produit.
 */
export async function calculerStockDisponibleTousProduits() {
  const [produits, reserves] = await Promise.all([
    prisma.product.findMany({ where: { actif: true } }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantiteCartons: true },
      where: { order: { statut: { in: ['EN_ATTENTE', 'EN_COURS_DE_PREPARATION'] } } },
    }),
  ])

  const reserveParProduit = new Map(reserves.map((r) => [r.productId, r._sum.quantiteCartons ?? 0]))

  return produits.map((p) => {
    const stockReserve = reserveParProduit.get(p.id) ?? 0
    return {
      ...p,
      stockReserve,
      stockDisponible: p.stockPhysique - stockReserve,
    }
  })
}
