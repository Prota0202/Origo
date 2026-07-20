import { prisma } from '../db.js'
import type { Prisma, Product } from '../../generated/prisma/client.js'

type Tx = Prisma.TransactionClient

/**
 * Appelée après CHAQUE décrément du stock_physique (sortie d'entrepôt).
 * Ne notifie qu'au moment où le stock franchit le seuil vers le bas
 * (front montant) : on ne veut pas re-spammer l'admin à chaque commande
 * suivante tant que le stock reste sous le seuil.
 */
export async function verifierEtNotifierSeuil(produit: Product, tx: Tx) {
  if (produit.stockPhysique > produit.seuilAlerte) return

  const alerteNonLueExistante = await tx.notification.findFirst({
    where: { productId: produit.id, lue: false, type: { in: ['STOCK_BAS', 'RUPTURE'] } },
  })
  if (alerteNonLueExistante) return // déjà notifié, on évite le doublon

  await tx.notification.create({
    data: {
      productId: produit.id,
      type: produit.stockPhysique === 0 ? 'RUPTURE' : 'STOCK_BAS',
      message:
        produit.stockPhysique === 0
          ? `${produit.nom} : rupture de stock`
          : `${produit.nom} : ${produit.stockPhysique} carton(s) restant(s) (seuil ${produit.seuilAlerte})`,
    },
  })
}

/**
 * Vue temps réel pour le dashboard admin : tous les produits dont le stock
 * DISPONIBLE (physique - réservé) est sous le seuil d'alerte, triés du plus
 * critique au moins critique.
 */
export async function listerAlertesStock() {
  const [produits, reserves] = await Promise.all([
    prisma.product.findMany({ where: { actif: true } }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantiteCartons: true },
      where: { order: { statut: { in: ['EN_ATTENTE', 'EN_COURS_DE_PREPARATION'] } } },
    }),
  ])

  const reserveParProduit = new Map(reserves.map((r) => [r.productId, r._sum.quantiteCartons ?? 0]))

  return produits
    .map((p) => ({ ...p, stockDisponible: p.stockPhysique - (reserveParProduit.get(p.id) ?? 0) }))
    .filter((p) => p.stockDisponible <= p.seuilAlerte)
    .sort((a, b) => a.stockDisponible - b.stockDisponible)
}

export const listerNotificationsNonLues = () =>
  prisma.notification.findMany({
    where: { lue: false },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
  })

export const marquerNotificationLue = (id: number) =>
  prisma.notification.update({ where: { id }, data: { lue: true } })
