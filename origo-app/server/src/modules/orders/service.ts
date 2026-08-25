import type { Prisma, StatutCommande, TypeMouvementStock } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { tarifLigne, round2 } from '../../lib/pricing.js'
import { mapOrder, STATUT_UI } from '../../lib/mappers.js'
import { persistImageField, supprimerFichierUpload } from '../../lib/uploads.js'
import { toNum } from '../../lib/money.js'
import { apresMutationCommande } from '../../lib/odoo/ventes.js'
import { fraisLivraisonHT } from '../../lib/frais-livraison.js'
import { notifierSmsStatut } from '../../lib/sms.js'
import { sessionPaiementStripe } from '../../lib/stripe.js'

const orderInclude = {
  items: true,
  client: { select: { nom: true, ville: true, adresse: true, telephone: true, email: true, numeroTva: true } },
  retours: { include: { lignes: true } },
} satisfies Prisma.OrderInclude

type Statut = StatutCommande

/**
 * Transitions autorisées. Sans ce garde-fou, on pouvait repasser une commande
 * livrée en préparation puis la « relivrer » : chaque passage réintégrait à
 * nouveau les manquants au stock et rabotait le total facturé.
 *
 * Une commande livrée ne peut que revenir à CONFIRMEE (réouverture contrôlée,
 * qui annule les effets de la livraison — voir rouvrirLivraison).
 * ANNULEE ne s'obtient jamais ici : l'annulation passe par annulerCommande,
 * qui seule sait quoi faire du stock.
 */
const TRANSITIONS: Record<Statut, Statut[]> = {
  CONFIRMEE: ['PREPAREE'],
  PREPAREE: ['CONFIRMEE', 'EN_LIVRAISON'],
  EN_LIVRAISON: ['CONFIRMEE', 'PREPAREE', 'LIVREE', 'LIVREE_PARTIELLEMENT'],
  LIVREE: ['CONFIRMEE'],
  LIVREE_PARTIELLEMENT: ['CONFIRMEE'],
  ANNULEE: [],
}

function assertTransition(actuel: Statut, cible: Statut) {
  if (actuel === cible) {
    throw new ConflictError(`Commande déjà « ${STATUT_UI[actuel]} »`)
  }
  if (!TRANSITIONS[actuel].includes(cible)) {
    throw new ForbiddenError(
      `Transition impossible : « ${STATUT_UI[actuel]} » → « ${STATUT_UI[cible]} »`,
    )
  }
}

type ProduitVerrouille = {
  id: string
  nom: string
  stock: number
  actif: boolean
  prixCarton: unknown
  remiseSeuil: number | null
  remisePourcent: unknown
}

/**
 * Verrou ligne Postgres. Obligatoire avant toute lecture de stock suivie
 * d'une écriture : sans lui, deux requêtes concurrentes lisent la même
 * valeur et la seconde écrase la première (dernier carton vendu deux fois).
 */
async function verrouillerProduit(tx: Prisma.TransactionClient, productId: string) {
  const rows = await tx.$queryRaw<ProduitVerrouille[]>`
    SELECT id, nom, stock, actif, "prixCarton", "remiseSeuil", "remisePourcent"
    FROM "Product" WHERE id = ${productId} FOR UPDATE`
  const product = rows[0]
  if (!product) throw new NotFoundError(`Produit ${productId} introuvable`)
  return product
}

/**
 * Mouvement de stock atomique.
 *
 * Le nouveau stock est calculé par Postgres depuis la valeur courante de la
 * ligne (`stock = stock + delta`), et la condition `>= 0` fait partie du même
 * ordre SQL. Deux requêtes concurrentes ne peuvent donc plus lire la même
 * valeur puis s'écraser l'une l'autre : c'est vrai quel que soit le niveau
 * d'isolation et sans dépendre de l'ordre des verrous pris en amont.
 *
 * Zéro ligne modifiée = stock insuffisant, jamais un stock négatif silencieux.
 */
async function bougerStock(
  tx: Prisma.TransactionClient,
  params: {
    productId: string
    delta: number
    type: TypeMouvementStock
    orderId?: string
    note?: string
  },
) {
  const rows = await tx.$queryRaw<{ stock: number }[]>`
    UPDATE "Product" SET stock = stock + ${params.delta}
    WHERE id = ${params.productId} AND stock + ${params.delta} >= 0
    RETURNING stock`

  if (rows.length === 0) {
    const existe = await tx.product.findUnique({
      where: { id: params.productId },
      select: { nom: true, stock: true },
    })
    if (!existe) throw new NotFoundError(`Produit ${params.productId} introuvable`)
    throw new ConflictError(`Stock insuffisant pour « ${existe.nom} »`, {
      productId: params.productId,
      disponible: existe.stock,
      demande: -params.delta,
    })
  }

  const stockApres = rows[0].stock
  await tx.stockMouvement.create({
    data: {
      productId: params.productId,
      type: params.type,
      quantite: params.delta,
      stockApres,
      orderId: params.orderId,
      note: params.note,
    },
  })
  return stockApres
}

/** Libellé figé dans la commande : conserve la remise obtenue ce jour-là. */
function libelleLigne(nom: string, tarif: { palierSeuil?: number; remisePct: number }) {
  if (tarif.palierSeuil) {
    return `${nom} (palier −${tarif.remisePct} % dès ${tarif.palierSeuil} cartons)`
  }
  return tarif.remisePct > 0 ? `${nom} (remise −${tarif.remisePct} %)` : nom
}

/** Le port est figé à la commande : un manquant à la livraison ne le recalcule pas. */
async function totauxDepuisLignes(
  tx: Prisma.TransactionClient,
  orderId: string,
  fraisFiges: number,
) {
  const items = await tx.orderItem.findMany({ where: { orderId } })
  const articles = round2(items.reduce((s, i) => s + i.quantiteCartons * toNum(i.prixUnitaire), 0))
  return {
    cartonsTotal: items.reduce((s, i) => s + i.quantiteCartons, 0),
    totalHT: round2(articles + round2(fraisFiges)),
  }
}

async function nextNumero(tx: Prisma.TransactionClient) {
  const seq = await tx.sequence.upsert({
    where: { nom: 'order' },
    create: { nom: 'order', valeur: 1 },
    update: { valeur: { increment: 1 } },
  })
  return `CMD-${String(seq.valeur).padStart(4, '0')}`
}

export async function creerCommande(
  clientId: string,
  lignes: { productId: string; qty: number }[],
  signature: { nom: string; acceptationCgv: boolean; image: string },
) {
  if (!lignes.length) throw new ValidationError('Panier vide')
  if (!signature.acceptationCgv) {
    throw new ValidationError('Il faut accepter les conditions et signer le bon de commande')
  }
  const nomSigne = signature.nom.trim()
  if (nomSigne.length < 2) {
    throw new ValidationError('Indiquez votre nom pour signer le bon de commande')
  }
  // Fichier avant la transaction : Postgres ne doit pas garder un JPEG en base.
  const signatureImageUrl = await persistImageField(signature.image, 'sig')
  if (!signatureImageUrl) {
    throw new ValidationError('Signez le bon de commande avant de valider')
  }

  let mapped: ReturnType<typeof mapOrder>
  try {
    mapped = await prisma.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      include: { catalogue: true, paliers: true },
    })
    if (env.stripe.actif && client.modePaiement === 'sepa' && !client.stripeSepaPaymentMethodId) {
      throw new ValidationError('Signez le mandat SEPA (IBAN) avant de commander')
    }

    const cartons = lignes.reduce((s, l) => s + l.qty, 0)

    const catalogIds = new Set(client.catalogue.filter((c) => c.visible).map((c) => c.productId))
    type ItemData = {
      productId: string
      nomSnapshot: string
      quantiteCartons: number
      prixUnitaire: number
    }
    const itemsData: ItemData[] = []
    const sorties: { productId: string; qty: number }[] = []
    let totalHT = 0

    for (const ligne of lignes) {
      if (!catalogIds.has(ligne.productId)) {
        throw new ValidationError('Produit hors catalogue client')
      }
      if (ligne.qty <= 0) throw new ValidationError('Quantité invalide')

      const product = await verrouillerProduit(tx, ligne.productId)
      if (!product.actif) throw new NotFoundError(`Produit ${ligne.productId} introuvable`)
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

      itemsData.push({
        productId: product.id,
        nomSnapshot: libelleLigne(product.nom, tarif),
        quantiteCartons: ligne.qty,
        prixUnitaire: tarif.puFinal,
      })
      totalHT = round2(totalHT + tarif.total)
      sorties.push({ productId: product.id, qty: ligne.qty })
    }

    const numero = await nextNumero(tx)
    const livraison = new Date()
    livraison.setDate(livraison.getDate() + 2)
    const frais = fraisLivraisonHT(totalHT)
    const totalAvecPort = round2(totalHT + frais)

    const order = await tx.order.create({
      data: {
        numero,
        clientId,
        cartonsTotal: cartons,
        totalHT: totalAvecPort,
        fraisLivraisonHT: frais,
        cgvAccepteesLe: new Date(),
        signatureNom: nomSigne,
        signatureImageUrl,
        dateLivraisonPrevue: livraison,
        odooSyncStatut: 'attente',
        items: {
          create: itemsData.map((item) => ({
            ...item,
            quantiteCommandee: item.quantiteCartons,
          })),
        },
      },
      include: orderInclude,
    })

    // Décrément atomique : c'est lui, et pas la vérification ci-dessus,
    // qui garantit qu'on ne vend pas deux fois le même carton.
    for (const sortie of sorties) {
      await bougerStock(tx, {
        productId: sortie.productId,
        delta: -sortie.qty,
        type: 'SORTIE_COMMANDE',
        orderId: order.id,
      })
    }

    return mapOrder(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }))
    })
  } catch (err) {
    supprimerFichierUpload(signatureImageUrl)
    throw err
  }
  apresMutationCommande(mapped.id)
  void notifierSmsStatut(mapped.id, 'CONFIRMEE')
  const paiementUrl = await sessionPaiementStripe(mapped.id)
  return paiementUrl ? { ...mapped, paiementUrl } : mapped
}

/** File d’attente staff + historique récent. Pas toute la table. */
const LIMITE_LISTE_OUVERTES = 400
const LIMITE_LISTE_CLIENT = 80
const FENETRE_HISTO_MS = 90 * 24 * 3600 * 1000

export async function listerCommandesClient(clientId: string) {
  const orders = await prisma.order.findMany({
    where: { clientId },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
    take: LIMITE_LISTE_CLIENT,
  })
  return orders.map(mapOrder)
}

export async function listerToutesCommandes() {
  const depuis = new Date(Date.now() - FENETRE_HISTO_MS)
  const [ouvertes, recentes] = await Promise.all([
    prisma.order.findMany({
      where: { statut: { in: ['CONFIRMEE', 'PREPAREE', 'EN_LIVRAISON'] } },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: LIMITE_LISTE_OUVERTES,
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: depuis } },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
  ])
  const parId = new Map<string, (typeof ouvertes)[0]>()
  for (const o of [...ouvertes, ...recentes]) parId.set(o.id, o)
  return [...parId.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(mapOrder)
}

function assertModifiable(createdAt: Date, statut: string) {
  if (statut !== 'CONFIRMEE') {
    throw new ForbiddenError('Cette commande ne peut plus être modifiée')
  }
  if (Date.now() - createdAt.getTime() > env.delaiModificationMs) {
    throw new ForbiddenError('Délai de modification dépassé (1 h)')
  }
}

const STATUTS_LIVRES: Statut[] = ['LIVREE', 'LIVREE_PARTIELLEMENT']

/**
 * @param remiseEnStock décision explicite pour une commande déjà livrée :
 *   la marchandise est-elle physiquement revenue ? Avant, on réintégrait
 *   toujours, ce qui créait du stock fantôme sur les commandes livrées.
 */
export async function annulerCommande(
  orderId: string,
  clientId: string | null,
  admin = false,
  remiseEnStock?: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    if (clientId && order.clientId !== clientId) throw new NotFoundError('Commande introuvable')
    if (!admin) assertModifiable(order.createdAt, order.statut)
    if (order.statut === 'ANNULEE') throw new ConflictError('Déjà annulée')
    if (!admin && order.statut !== 'CONFIRMEE') {
      throw new ForbiddenError('Annulation impossible à ce stade')
    }

    const dejaLivree = STATUTS_LIVRES.includes(order.statut)
    if (dejaLivree && remiseEnStock === undefined) {
      throw new ValidationError(
        'Commande déjà livrée : préciser si la marchandise est revenue en stock (remiseEnStock)',
      )
    }
    // Non livrée : la marchandise n'a jamais quitté l'entrepôt, la
    // réintégration est toujours correcte.
    const restituer = dejaLivree ? remiseEnStock === true : true

    if (restituer) {
      for (const item of order.items) {
        await bougerStock(tx, {
          productId: item.productId,
          delta: item.quantiteCartons,
          type: 'RETOUR',
          orderId: order.id,
          note: dejaLivree ? 'Annulation après livraison — marchandise revenue' : 'Annulation commande',
        })
      }
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
  }).then((mapped) => {
    apresMutationCommande(mapped.id)
    void notifierSmsStatut(mapped.id, 'ANNULEE')
    return mapped
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
    if (order.clientId !== clientId) throw new NotFoundError('Commande introuvable')
    if (!opts.admin) assertModifiable(order.createdAt, order.statut)
    if (order.statut === 'ANNULEE') throw new ConflictError('Commande annulée')
    // Même pour la direction : au-delà de CONFIRMEE, la marchandise est
    // préparée ou partie et les prix seraient recalculés au tarif du jour,
    // ce qui réécrirait le montant d'une commande déjà facturée.
    // Pour corriger après coup, passer par un retour.
    if (order.statut !== 'CONFIRMEE') {
      throw new ForbiddenError(
        `Commande « ${STATUT_UI[order.statut]} » : utiliser un retour plutôt qu'une modification`,
      )
    }

    // Restituer le stock des anciennes lignes avant de recréer les nouvelles
    for (const item of order.items) {
      await bougerStock(tx, {
        productId: item.productId,
        delta: item.quantiteCartons,
        type: 'AJUSTEMENT',
        orderId,
        note: 'Modification commande — ancienne ligne annulée',
      })
    }

    await tx.orderItem.deleteMany({ where: { orderId } })

    const client = order.client
    const catalogIds = new Set(client.catalogue.filter((c) => c.visible).map((c) => c.productId))
    const cartons = lignes.reduce((s, l) => s + l.qty, 0)

    let totalHT = 0
    const itemsData = []

    for (const ligne of lignes) {
      if (!catalogIds.has(ligne.productId) || ligne.qty <= 0) {
        throw new ValidationError('Ligne invalide')
      }
      const product = await verrouillerProduit(tx, ligne.productId)
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

      itemsData.push({
        productId: product.id,
        nomSnapshot: libelleLigne(product.nom, tarif),
        quantiteCartons: ligne.qty,
        quantiteCommandee: ligne.qty,
        prixUnitaire: tarif.puFinal,
      })
      totalHT = round2(totalHT + tarif.total)

      await bougerStock(tx, {
        productId: product.id,
        delta: -ligne.qty,
        type: 'SORTIE_COMMANDE',
        orderId,
        note: 'Modification commande — nouvelle ligne',
      })
    }

    const frais = fraisLivraisonHT(totalHT)
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        cartonsTotal: cartons,
        totalHT: round2(totalHT + frais),
        fraisLivraisonHT: frais,
        modifieeLe: new Date(),
        items: { create: itemsData },
      },
      include: orderInclude,
    })
    return mapOrder(updated)
  }).then((mapped) => {
    apresMutationCommande(mapped.id)
    return mapped
  })
}

/**
 * Réouverture d'une commande livrée : annule les effets de la livraison.
 * La livraison a pu réduire les quantités facturées et réintégrer les
 * manquants au stock ; sans ce retour arrière, la commande repartait en
 * préparation avec des quantités et un total faux, et le stock gonflait
 * à chaque cycle.
 */
async function rouvrirLivraison(
  tx: Prisma.TransactionClient,
  order: { id: string; items: { id: string; productId: string; quantiteCartons: number; quantiteCommandee: number | null }[] },
  aDesRetours: boolean,
) {
  if (aDesRetours) {
    throw new ConflictError(
      'Un retour a déjà été enregistré sur cette commande : elle ne peut plus être rouverte',
    )
  }

  for (const item of order.items) {
    const commandee = item.quantiteCommandee ?? item.quantiteCartons
    const manquant = commandee - item.quantiteCartons
    if (manquant > 0) {
      // Ce manquant avait été rendu au stock à la livraison : on le ressort.
      await bougerStock(tx, {
        productId: item.productId,
        delta: -manquant,
        type: 'SORTIE_COMMANDE',
        orderId: order.id,
        note: 'Réouverture commande — manquant re-sorti du stock',
      })
    }

    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        quantiteCartons: commandee,
        livree: null,
        coche: false,
        cocheLe: null,
      },
    })
  }
}

export async function changerStatut(
  orderId: string,
  statut: 'PREPAREE' | 'EN_LIVRAISON' | 'LIVREE' | 'LIVREE_PARTIELLEMENT' | 'CONFIRMEE',
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

  let anciennePhoto: string | null = null
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, retours: { select: { id: true } } },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    anciennePhoto = order.photoLivraisonUrl

    assertTransition(order.statut, statut)

    const estLivraison = statut === 'LIVREE' || statut === 'LIVREE_PARTIELLEMENT'
    const estReouverture = statut === 'CONFIRMEE' && STATUTS_LIVRES.includes(order.statut)

    if (estLivraison) {
      const photo = photoLivraisonUrl ?? order.photoLivraisonUrl
      if (!photo) {
        throw new ValidationError('Une photo de livraison est obligatoire')
      }
    }

    if (estReouverture) {
      await rouvrirLivraison(tx, order, order.retours.length > 0)
    } else if (opts?.lignesLivrees?.length && estLivraison) {
      for (const l of opts.lignesLivrees) {
        const item = order.items.find((i) => i.id === l.itemId)
        if (!item) throw new ValidationError('Ligne de livraison inconnue')
        const commandee = item.quantiteCommandee ?? item.quantiteCartons
        const qtyLivree = Math.max(0, Math.min(l.qtyLivree, commandee))
        const manquant = commandee - qtyLivree

        await tx.orderItem.update({
          where: { id: item.id },
          data: { quantiteCartons: qtyLivree, livree: qtyLivree > 0 },
        })

        if (manquant > 0) {
          await bougerStock(tx, {
            productId: item.productId,
            delta: manquant,
            type: 'RETOUR',
            orderId,
            note: 'Non livré — réintégré au stock',
          })
        }
      }
    } else if (opts?.lignesLivrees?.length) {
      for (const l of opts.lignesLivrees) {
        await tx.orderItem.update({
          where: { id: l.itemId },
          data: { livree: l.qtyLivree > 0 },
        })
      }
    }

    // Les quantités ont pu changer (livraison partielle ou réouverture) :
    // le total facturé est toujours recalculé depuis les lignes en base.
    if (estLivraison || estReouverture) {
      const totaux = await totauxDepuisLignes(tx, orderId, toNum(order.fraisLivraisonHT))
      await tx.order.update({
        where: { id: orderId },
        data: totaux,
      })
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        statut,
        ...(opts?.livreParId && { livreParId: opts.livreParId }),
        ...(photoLivraisonUrl !== undefined && { photoLivraisonUrl }),
        ...(opts?.noteLivraison !== undefined && { noteLivraison: opts.noteLivraison }),
        ...(estLivraison && { livreeLe: new Date() }),
        ...(estReouverture && { livreeLe: null }),
      },
      include: orderInclude,
    })
    return mapOrder(updated)
  })
  if (
    photoLivraisonUrl !== undefined &&
    anciennePhoto &&
    photoLivraisonUrl !== anciennePhoto
  ) {
    supprimerFichierUpload(anciennePhoto)
  }
  apresMutationCommande(updated.id)
  void notifierSmsStatut(updated.id, statut)
  return updated
}

export async function setPayee(orderId: string, payee: boolean) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { statut: true } })
  if (!order) throw new NotFoundError('Commande introuvable')
  if (payee && order.statut === 'ANNULEE') {
    throw new ConflictError('Une commande annulée ne peut pas être marquée payée')
  }
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

    /**
     * Agrégation par produit avant toute validation. Sans elle, deux lignes
     * portant le même produit étaient chacune comparées à la quantité
     * d'origine : on pouvait rendre au stock plus de cartons qu'il n'en avait
     * été livré, tout en ne déduisant qu'une seule des deux lignes du montant.
     */
    const parProduit = new Map<string, { qty: number; remisEnStock: boolean }>()
    for (const ligne of lignes) {
      if (ligne.qty <= 0) throw new ValidationError('Quantité de retour invalide')
      const cumul = parProduit.get(ligne.productId)
      parProduit.set(ligne.productId, {
        qty: (cumul?.qty ?? 0) + ligne.qty,
        // Dès qu'une ligne demande la remise en stock, on la fait une fois.
        remisEnStock: (cumul?.remisEnStock ?? false) || ligne.remisEnStock,
      })
    }

    for (const [productId, ligne] of parProduit) {
      const item = order.items.find((i) => i.productId === productId)
      if (!item) throw new ValidationError('Produit absent de la commande')
      if (ligne.qty > item.quantiteCartons) {
        throw new ValidationError(
          `Retour trop élevé pour « ${item.nomSnapshot} » : ${ligne.qty} demandés, ${item.quantiteCartons} facturés`,
        )
      }
    }

    await tx.retourCommande.create({
      data: {
        orderId,
        motif,
        lignes: {
          create: [...parProduit].map(([productId, l]) => ({
            productId,
            quantite: l.qty,
            remisEnStock: l.remisEnStock,
          })),
        },
      },
    })

    for (const [productId, ligne] of parProduit) {
      const item = order.items.find((i) => i.productId === productId)!
      await tx.orderItem.update({
        where: { id: item.id },
        data: { quantiteCartons: item.quantiteCartons - ligne.qty },
      })

      if (ligne.remisEnStock) {
        await bougerStock(tx, {
          productId,
          delta: ligne.qty,
          type: 'RETOUR',
          orderId,
          note: motif,
        })
      }
    }

    const totaux = await totauxDepuisLignes(tx, orderId, toNum(order.fraisLivraisonHT))

    const updated = await tx.order.update({
      where: { id: orderId },
      data: totaux,
      include: orderInclude,
    })
    return mapOrder(updated)
  }).then((mapped) => {
    apresMutationCommande(mapped.id)
    return mapped
  })
}
