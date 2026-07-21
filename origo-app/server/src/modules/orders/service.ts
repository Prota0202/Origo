import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { tarifLigne, round2 } from '../../lib/pricing.js'
import { mapOrder } from '../../lib/mappers.js'
import { persistImageField } from '../../lib/uploads.js'
import { toNum } from '../../lib/money.js'

const orderInclude = {
  items: true,
  client: { select: { nom: true } },
  retours: { include: { lignes: true } },
} satisfies Prisma.OrderInclude

async function nextNumero(tx: Prisma.TransactionClient) {
  const seq = await tx.sequence.upsert({
    where: { nom: 'order' },
    create: { nom: 'order', valeur: 1 },
    update: { valeur: { increment: 1 } },
  })
  return `CMD-${String(seq.valeur).padStart(4, '0')}`
}

export async function creerCommande(clientId: string, lignes: { productId: string; qty: number }[]) {
  if (!lignes.length) throw new ValidationError('Panier vide')

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      include: { catalogue: true, paliers: true },
    })

    const cartons = lignes.reduce((s, l) => s + l.qty, 0)
    if (cartons < client.minCartons) {
      throw new ValidationError(`Minimum ${client.minCartons} cartons requis`)
    }

    const catalogIds = new Set(client.catalogue.filter((c) => c.visible).map((c) => c.productId))
    type ItemData = {
      productId: string
      nomSnapshot: string
      quantiteCartons: number
      prixUnitaire: number
      stockApres: number
    }
    const itemsData: ItemData[] = []
    let totalHT = 0

    for (const ligne of lignes) {
      if (!catalogIds.has(ligne.productId)) {
        throw new ValidationError('Produit hors catalogue client')
      }
      if (ligne.qty <= 0) throw new ValidationError('Quantité invalide')

      // Verrou ligne Postgres (FOR UPDATE) — évite double vente de stock
      const locked = await tx.$queryRaw<
        { id: string; nom: string; stock: number; actif: boolean; prixCarton: unknown; remiseSeuil: number | null; remisePourcent: unknown }[]
      >`SELECT id, nom, stock, actif, "prixCarton", "remiseSeuil", "remisePourcent"
        FROM "Product" WHERE id = ${ligne.productId} FOR UPDATE`
      const product = locked[0]
      if (!product?.actif) throw new NotFoundError(`Produit ${ligne.productId} introuvable`)
      if (product.stock < ligne.qty) {
        throw new ConflictError(`Stock insuffisant pour « ${product.nom} »`, {
          productId: product.id,
          disponible: product.stock,
          demande: ligne.qty,
        })
      }

      const entry = client.catalogue.find((c) => c.productId === product.id)
      const prixBase = toNum(entry?.prixNegocie ?? product.prixCarton)
      const paliers = client.paliers
        .filter((p) => p.productId === product.id)
        .map((p) => ({ seuil: p.seuil, prix: toNum(p.prix) }))

      const tarif = tarifLigne({
        prixBase,
        qty: ligne.qty,
        paliers,
        remiseSeuil: product.remiseSeuil,
        remisePourcent: product.remisePourcent != null ? toNum(product.remisePourcent) : null,
      })

      const suffixe = tarif.palierSeuil
        ? ` (palier −${tarif.remisePct} % dès ${tarif.palierSeuil} cartons)`
        : tarif.remisePct > 0
          ? ` (remise −${tarif.remisePct} %)`
          : ''

      const stockApres = product.stock - ligne.qty
      itemsData.push({
        productId: product.id,
        nomSnapshot: `${product.nom}${suffixe}`,
        quantiteCartons: ligne.qty,
        prixUnitaire: tarif.puFinal,
        stockApres,
      })
      totalHT = round2(totalHT + tarif.total)

      await tx.product.update({
        where: { id: product.id },
        data: { stock: stockApres },
      })
    }

    const numero = await nextNumero(tx)
    const livraison = new Date()
    livraison.setDate(livraison.getDate() + 2)

    const order = await tx.order.create({
      data: {
        numero,
        clientId,
        cartonsTotal: cartons,
        totalHT,
        dateLivraisonPrevue: livraison,
        items: {
          create: itemsData.map(({ stockApres: _s, ...item }) => item),
        },
      },
      include: orderInclude,
    })

    for (const item of itemsData) {
      await tx.stockMouvement.create({
        data: {
          productId: item.productId,
          type: 'SORTIE_COMMANDE',
          quantite: -item.quantiteCartons,
          stockApres: item.stockApres,
          orderId: order.id,
        },
      })
    }

    return mapOrder(order)
  })
}

export async function listerCommandesClient(clientId: string) {
  const orders = await prisma.order.findMany({
    where: { clientId },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  })
  return orders.map(mapOrder)
}

export async function listerToutesCommandes() {
  const orders = await prisma.order.findMany({
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  })
  return orders.map(mapOrder)
}

function assertModifiable(createdAt: Date, statut: string) {
  if (statut !== 'CONFIRMEE') {
    throw new ForbiddenError('Cette commande ne peut plus être modifiée')
  }
  if (Date.now() - createdAt.getTime() > env.delaiModificationMs) {
    throw new ForbiddenError('Délai de modification dépassé (1 h)')
  }
}

export async function annulerCommande(orderId: string, clientId: string | null, admin = false) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    if (clientId && order.clientId !== clientId) throw new ForbiddenError()
    if (!admin) assertModifiable(order.createdAt, order.statut)
    if (order.statut === 'ANNULEE') throw new ConflictError('Déjà annulée')
    if (!admin && order.statut !== 'CONFIRMEE') {
      throw new ForbiddenError('Annulation impossible à ce stade')
    }

    for (const item of order.items) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
      const stockApres = product.stock + item.quantiteCartons
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: stockApres },
      })
      await tx.stockMouvement.create({
        data: {
          productId: item.productId,
          type: 'RETOUR',
          quantite: item.quantiteCartons,
          stockApres,
          orderId: order.id,
          note: 'Annulation commande',
        },
      })
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        statut: 'ANNULEE',
        annuleeLe: new Date(),
        motifAnnulation: admin ? 'Annulée par ORIGO' : 'Annulée par le client',
      },
      include: orderInclude,
    })
    return mapOrder(updated)
  })
}

export async function modifierCommande(
  orderId: string,
  clientId: string,
  lignes: { productId: string; qty: number }[],
  opts: { admin?: boolean } = {},
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, client: { include: { catalogue: true, paliers: true } } },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    if (order.clientId !== clientId) throw new ForbiddenError()
    if (!opts.admin) assertModifiable(order.createdAt, order.statut)
    if (order.statut === 'ANNULEE') throw new ConflictError('Commande annulée')

    // Restituer stock ancien
    for (const item of order.items) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: product.stock + item.quantiteCartons },
      })
    }

    await tx.orderItem.deleteMany({ where: { orderId } })

    const client = order.client
    const catalogIds = new Set(client.catalogue.filter((c) => c.visible).map((c) => c.productId))
    const cartons = lignes.reduce((s, l) => s + l.qty, 0)
    if (cartons < client.minCartons) {
      throw new ValidationError(`Minimum ${client.minCartons} cartons requis`)
    }

    let totalHT = 0
    const itemsData = []

    for (const ligne of lignes) {
      if (!catalogIds.has(ligne.productId) || ligne.qty <= 0) {
        throw new ValidationError('Ligne invalide')
      }
      const product = await tx.product.findUniqueOrThrow({ where: { id: ligne.productId } })
      if (product.stock < ligne.qty) {
        throw new ConflictError(`Stock insuffisant pour « ${product.nom} »`)
      }

      const entry = client.catalogue.find((c) => c.productId === product.id)
      const prixBase = toNum(entry?.prixNegocie ?? product.prixCarton)
      const paliers = client.paliers
        .filter((p) => p.productId === product.id)
        .map((p) => ({ seuil: p.seuil, prix: toNum(p.prix) }))
      const tarif = tarifLigne({
        prixBase,
        qty: ligne.qty,
        paliers,
        remiseSeuil: product.remiseSeuil,
        remisePourcent: product.remisePourcent != null ? toNum(product.remisePourcent) : null,
      })

      itemsData.push({
        productId: product.id,
        nomSnapshot: product.nom,
        quantiteCartons: ligne.qty,
        prixUnitaire: tarif.puFinal,
      })
      totalHT = round2(totalHT + tarif.total)

      await tx.product.update({
        where: { id: product.id },
        data: { stock: product.stock - ligne.qty },
      })
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        cartonsTotal: cartons,
        totalHT,
        modifieeLe: new Date(),
        items: { create: itemsData },
      },
      include: orderInclude,
    })
    return mapOrder(updated)
  })
}

export async function changerStatut(
  orderId: string,
  statut: 'PREPAREE' | 'EN_LIVRAISON' | 'LIVREE' | 'LIVREE_PARTIELLEMENT' | 'ANNULEE' | 'CONFIRMEE',
  opts?: {
    livreParId?: string
    photoLivraisonUrl?: string
    noteLivraison?: string
    /** Confirmation livraison : qty réellement livrée par ligne */
    lignesLivrees?: { itemId: string; qtyLivree: number }[]
  },
) {
  const photoLivraisonUrl =
    opts?.photoLivraisonUrl !== undefined
      ? await persistImageField(opts.photoLivraisonUrl, `livraison-${orderId}`)
      : undefined

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    })
    if (!order) throw new NotFoundError('Commande introuvable')

    if (opts?.lignesLivrees?.length && (statut === 'LIVREE' || statut === 'LIVREE_PARTIELLEMENT')) {
      for (const l of opts.lignesLivrees) {
        const item = order.items.find((i) => i.id === l.itemId)
        if (!item) throw new ValidationError('Ligne de livraison inconnue')
        const qtyLivree = Math.max(0, Math.min(l.qtyLivree, item.quantiteCartons))
        const manquant = item.quantiteCartons - qtyLivree

        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            quantiteCartons: qtyLivree,
            livree: qtyLivree > 0,
            nomSnapshot:
              qtyLivree < item.quantiteCartons && qtyLivree > 0
                ? `${item.nomSnapshot.replace(/ \(cmd \d+\)$/, '')} (cmd ${item.quantiteCartons})`
                : item.nomSnapshot,
          },
        })

        if (manquant > 0) {
          const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
          const stockApres = product.stock + manquant
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: stockApres },
          })
          await tx.stockMouvement.create({
            data: {
              productId: item.productId,
              type: 'RETOUR',
              quantite: manquant,
              stockApres,
              orderId,
              note: 'Non livré — réintégré au stock',
            },
          })
        }
      }

      const items = await tx.orderItem.findMany({ where: { orderId } })
      const cartonsTotal = items.reduce((s, i) => s + i.quantiteCartons, 0)
      const totalHT = round2(items.reduce((s, i) => s + i.quantiteCartons * toNum(i.prixUnitaire), 0))
      await tx.order.update({
        where: { id: orderId },
        data: { cartonsTotal, totalHT },
      })
    } else if (opts?.lignesLivrees?.length) {
      for (const l of opts.lignesLivrees) {
        await tx.orderItem.update({
          where: { id: l.itemId },
          data: { livree: l.qtyLivree > 0 },
        })
      }
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        statut,
        ...(opts?.livreParId && { livreParId: opts.livreParId }),
        ...(photoLivraisonUrl !== undefined && { photoLivraisonUrl }),
        ...(opts?.noteLivraison !== undefined && { noteLivraison: opts.noteLivraison }),
        ...((statut === 'LIVREE' || statut === 'LIVREE_PARTIELLEMENT') && { livreeLe: new Date() }),
      },
      include: orderInclude,
    })
    return mapOrder(updated)
  })
}

export async function setPayee(orderId: string, payee: boolean) {
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { payee },
    include: orderInclude,
  })
  return mapOrder(updated)
}

/** Retour post-livraison : lignes remises en stock + ajustement quantités facturées */
export async function enregistrerRetour(
  orderId: string,
  motif: string,
  lignes: { productId: string; qty: number; remisEnStock: boolean }[],
) {
  if (!lignes.length) throw new ValidationError('Aucune ligne de retour')

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, retours: { include: { lignes: true } } },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    if (order.statut !== 'LIVREE' && order.statut !== 'LIVREE_PARTIELLEMENT') {
      throw new ForbiddenError('Retours possibles uniquement après livraison')
    }

    for (const ligne of lignes) {
      if (ligne.qty <= 0) throw new ValidationError('Quantité de retour invalide')
      const item = order.items.find((i) => i.productId === ligne.productId)
      if (!item) throw new ValidationError('Produit absent de la commande')
      if (ligne.qty > item.quantiteCartons) {
        throw new ValidationError(`Retour trop élevé pour « ${item.nomSnapshot} »`)
      }
    }

    await tx.retourCommande.create({
      data: {
        orderId,
        motif,
        lignes: {
          create: lignes.map((l) => ({
            productId: l.productId,
            quantite: l.qty,
            remisEnStock: l.remisEnStock,
          })),
        },
      },
    })

    for (const ligne of lignes) {
      const item = order.items.find((i) => i.productId === ligne.productId)!
      const newQty = item.quantiteCartons - ligne.qty
      await tx.orderItem.update({
        where: { id: item.id },
        data: { quantiteCartons: newQty },
      })

      if (ligne.remisEnStock) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: ligne.productId } })
        const stockApres = product.stock + ligne.qty
        await tx.product.update({
          where: { id: ligne.productId },
          data: { stock: stockApres },
        })
        await tx.stockMouvement.create({
          data: {
            productId: ligne.productId,
            type: 'RETOUR',
            quantite: ligne.qty,
            stockApres,
            orderId,
            note: motif,
          },
        })
      }
    }

    const items = await tx.orderItem.findMany({ where: { orderId } })
    const cartonsTotal = items.reduce((s, i) => s + i.quantiteCartons, 0)
    const totalHT = round2(items.reduce((s, i) => s + i.quantiteCartons * toNum(i.prixUnitaire), 0))

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { cartonsTotal, totalHT },
      include: orderInclude,
    })
    return mapOrder(updated)
  })
}
