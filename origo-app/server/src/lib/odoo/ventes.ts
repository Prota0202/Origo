/**
 * Commande ORIGO → vente Odoo (`sale.order` + livraison).
 *
 * ORIGO reste la source de vérité pour le resto (stock PWA, totaux). Odoo
 * reçoit un miroir : devis confirmé, picking validé à la livraison, facture
 * brouillon à la livraison. Pas de Peppol tant que le n° TVA ORIGO manque.
 *
 * Un échec Odoo n'empêche pas de prendre la commande. La file
 * `pousserOdooEnArrierePlan` sérialise les écritures ; `client_order_ref`
 * évite un doublon si un timeout a déjà créé le devis.
 */
import type { Order, OrderItem, Product, StatutCommande } from '@prisma/client'
import { env } from '../../config/env.js'
import { toNum } from '../money.js'
import { prisma } from '../prisma.js'
import {
  idMany2one,
  origineCommandeOdoo,
  referenceCommandeOdoo,
  valeursDevisOdoo,
} from './mapping.js'
import { CHAMPS, MODELES } from './modeles.js'
import { chercherLire, creer, ecrire, executerKw, lire } from './rpc.js'
import { augmenterStockSiBesoin, pousserOdooEnArrierePlan, synchroniserClient, synchroniserProduit } from './sync.js'
import { creerFactureBrouillonOdoo } from './documents.js'
import { TEXTE_PAIEMENT_SEPA } from '../frais-livraison.js'

const STATUTS_LIVRES: StatutCommande[] = ['LIVREE', 'LIVREE_PARTIELLEMENT']

type CommandeComplete = Order & {
  items: (OrderItem & { product: Product })[]
  client: { odooId: number | null; odooTarifId: number | null }
  retours: { lignes: { productId: string; quantite: number; remisEnStock: boolean }[] }[]
}

function odooVentesActives() {
  return env.odoo.actif && env.nodeEnv !== 'test'
}

export function apresMutationCommande(orderId: string) {
  if (!odooVentesActives()) return
  pousserOdooEnArrierePlan(() => synchroniserCommande(orderId))
}

export async function rattraperCommandesOdoo() {
  if (!env.odoo.actif || env.nodeEnv === 'test') return
  const enRetard = await prisma.order.findMany({
    where: { odooSyncStatut: { in: ['attente', 'erreur'] } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })
  for (const { id } of enRetard) {
    try {
      await synchroniserCommande(id)
    } catch {
      // marquerErreur déjà fait dans synchroniserCommande
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
}

export async function synchroniserCommande(orderId: string) {
  if (!env.odoo.actif) return

  const order = await charger(orderId)
  if (!order) return

  try {
    if (order.statut === 'ANNULEE') {
      await annulerChezOdoo(order)
      await marquer(order.id, { odooId: order.odooId, statut: 'ok' })
      return
    }

    const devisId = await upsertDevis(order)
    if (STATUTS_LIVRES.includes(order.statut)) {
      await validerLivraisons(devisId, order)
      await retournerSiBesoin(devisId, order)
      if (!order.odooFactureId) {
        const factureId = await creerFactureBrouillonOdoo(devisId)
        if (factureId) {
          await prisma.order.update({ where: { id: order.id }, data: { odooFactureId: factureId } })
        }
      }
    }
    await marquer(order.id, { odooId: devisId, statut: 'ok' })
  } catch (e) {
    await marquer(order.id, {
      odooId: order.odooId,
      statut: 'erreur',
      erreur: e instanceof Error ? e.message.slice(0, 500) : String(e),
    })
    throw e
  }
}

async function charger(orderId: string): Promise<CommandeComplete | null> {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: true } },
      client: { select: { odooId: true, odooTarifId: true } },
      retours: { include: { lignes: true } },
    },
  })
}

async function assurerLiens(order: CommandeComplete) {
  if (!order.client.odooId) {
    await synchroniserClient(order.clientId)
  }
  for (const item of order.items) {
    if (!item.product.odooVarianteId) {
      await synchroniserProduit(item.productId)
    }
  }
  const relue = await charger(order.id)
  if (!relue) throw new Error(`Commande ${order.numero} disparue pendant la sync Odoo`)
  if (!relue.client.odooId) {
    throw new Error(`Client sans partenaire Odoo (${order.numero})`)
  }
  const sansVariante = relue.items.find((i) => !i.product.odooVarianteId)
  if (sansVariante) {
    throw new Error(`Produit « ${sansVariante.product.sku} » sans variante Odoo`)
  }
  return relue as CommandeComplete & {
    client: { odooId: number; odooTarifId: number | null }
    items: (OrderItem & { product: Product & { odooVarianteId: number } })[]
  }
}

async function upsertDevis(order: CommandeComplete): Promise<number> {
  const complete = await assurerLiens(order)
  const lignes = complete.items.flatMap((i) => {
    const varianteId = i.product.odooVarianteId
    if (varianteId == null) return []
    return [
      {
        varianteId,
        quantite: i.quantiteCommandee ?? i.quantiteCartons,
        prixUnitaire: toNum(i.prixUnitaire),
        nom: i.nomSnapshot,
      },
    ]
  })
  if (lignes.length !== complete.items.length) {
    throw new Error(`Produit sans variante Odoo sur ${complete.numero}`)
  }
  const frais = toNum(complete.fraisLivraisonHT)
  if (frais > 0) {
    lignes.push({
      varianteId: await variantePortOdoo(),
      quantite: 1,
      prixUnitaire: frais,
      nom: 'Frais de livraison',
    })
  }
  const valeurs = valeursDevisOdoo({
    partenaireId: complete.client.odooId as number,
    tarifId: complete.client.odooTarifId,
    numero: complete.numero,
    dateLivraisonPrevue: complete.dateLivraisonPrevue,
    lignes,
  })
  const signature = complete.signatureNom?.trim()
  valeurs.note = [
    signature ? `Signé dans ORIGO par ${signature}.` : null,
    complete.signatureImageUrl ? 'Trait manuscrit capturé dans l’application (preuve jointe au bon ORIGO).' : null,
    complete.cgvAccepteesLe
      ? `Conditions acceptées le ${complete.cgvAccepteesLe.toISOString().slice(0, 10)}.`
      : null,
    TEXTE_PAIEMENT_SEPA,
  ]
    .filter(Boolean)
    .join('\n')

  let devisId = complete.odooId ?? (await trouverDevis(complete.numero))

  if (!devisId) {
    devisId = await creer(MODELES.devis, valeurs)
  } else {
    const [existant] = await lire<{ state: string }>(MODELES.devis, [devisId], [CHAMPS.devis.etat])
    const etat = existant?.state ?? 'cancel'
    if (etat === 'cancel') {
      await executerKw(MODELES.devis, 'action_draft', [[devisId]])
    }
    if (etat === 'sale' || etat === 'done') {
      if (complete.statut === 'CONFIRMEE') {
        await executerKw(MODELES.devis, 'action_cancel', [[devisId]])
        await executerKw(MODELES.devis, 'action_draft', [[devisId]])
      } else {
        const [info] = await lire<{ name: string }>(MODELES.devis, [devisId], ['name'])
        await prisma.order.update({
          where: { id: complete.id },
          data: { odooId: devisId, ...(info?.name ? { odooNom: info.name } : {}) },
        })
        return devisId
      }
    }
    await ecrire(MODELES.devis, [devisId], {
      ...valeurs,
      order_line: [[5, 0, 0], ...(valeurs.order_line as unknown[])],
    })
  }

  await prisma.order.update({ where: { id: complete.id }, data: { odooId: devisId } })

  const [apres] = await lire<{ state: string; name: string }>(MODELES.devis, [devisId], [
    CHAMPS.devis.etat,
    'name',
  ])
  if (apres?.state === 'draft' || apres?.state === 'sent') {
    await executerKw(MODELES.devis, 'action_confirm', [[devisId]])
  }
  const [info] = await lire<{ name: string }>(MODELES.devis, [devisId], ['name'])
  if (info?.name) {
    await prisma.order.update({ where: { id: complete.id }, data: { odooNom: info.name } })
  }
  return devisId
}

const SKU_PORT = 'ORIGO-PORT'
let cacheVariantePort: number | null = null

async function variantePortOdoo(): Promise<number> {
  if (cacheVariantePort) return cacheVariantePort
  const existants = await chercherLire<Record<string, unknown>>(
    MODELES.produitModele,
    [[CHAMPS.produit.reference, '=', SKU_PORT]],
    ['id', CHAMPS.produit.variante],
    { limit: 1, context: { active_test: false } },
  )
  const deja = idMany2one(existants[0]?.[CHAMPS.produit.variante])
  if (deja) {
    cacheVariantePort = deja
    return deja
  }

  const templateId = await creer(MODELES.produitModele, {
    name: 'Frais de livraison',
    default_code: SKU_PORT,
    type: 'service',
    invoice_policy: 'order',
    list_price: 10,
    sale_ok: true,
  })
  const [tmpl] = await lire(MODELES.produitModele, [templateId], [CHAMPS.produit.variante])
  const variante = idMany2one(tmpl?.[CHAMPS.produit.variante])
  if (!variante) throw new Error('Produit frais de livraison Odoo sans variante')
  cacheVariantePort = variante
  return variante
}

async function trouverDevis(numero: string): Promise<number | null> {
  const ref = referenceCommandeOdoo(numero)
  const origine = origineCommandeOdoo(numero)
  const hits = await chercherLire<{ id: number; state: string }>(
    MODELES.devis,
    ['|', [CHAMPS.devis.referenceClient, '=', ref], [CHAMPS.devis.origine, '=', origine]],
    ['id', CHAMPS.devis.etat],
    { limit: 5, order: 'id desc' },
  )
  const vivant = hits.find((h) => h.state !== 'cancel')
  return vivant?.id ?? hits[0]?.id ?? null
}

async function annulerChezOdoo(order: CommandeComplete) {
  const devisId = order.odooId ?? (await trouverDevis(order.numero))
  if (!devisId) return

  if (order.livreeLe) {
    const restituee = await prisma.stockMouvement.findFirst({
      where: { orderId: order.id, type: 'RETOUR', note: { contains: 'Annulation après livraison' } },
      select: { id: true },
    })
    if (restituee) {
      await validerLivraisons(devisId, order)
      await retournerTout(devisId, order)
    }
    return
  }

  const [existant] = await lire<{ state: string }>(MODELES.devis, [devisId], [CHAMPS.devis.etat])
  if (!existant || existant.state === 'cancel' || existant.state === 'done') return
  await executerKw(MODELES.devis, 'action_cancel', [[devisId]])
}

async function retournerTout(devisId: number, order: CommandeComplete) {
  const synthetique: CommandeComplete = {
    ...order,
    retours: [
      {
        lignes: order.items.map((i) => ({
          productId: i.productId,
          quantite: i.quantiteCartons,
          remisEnStock: true,
        })),
      },
    ],
  }
  await retournerSiBesoin(devisId, synthetique)
}

async function idsLivraisons(devisId: number): Promise<number[]> {
  const [devis] = await lire<Record<string, unknown>>(MODELES.devis, [devisId], [CHAMPS.devis.livraisons])
  const brut = devis?.[CHAMPS.devis.livraisons]
  if (Array.isArray(brut) && brut.every((x) => typeof x === 'number')) return brut
  const pickings = await chercherLire<{ id: number }>(
    MODELES.livraison,
    [[CHAMPS.livraison.vente, '=', devisId], [CHAMPS.livraison.type, '=', 'outgoing']],
    ['id'],
  )
  return pickings.map((p) => p.id)
}

async function validerLivraisons(devisId: number, order: CommandeComplete) {
  const pickingIds = await idsLivraisons(devisId)
  const qtyParVariante = new Map<number, number>()
  for (const item of order.items) {
    if (item.product.odooVarianteId == null) continue
    qtyParVariante.set(
      item.product.odooVarianteId,
      (qtyParVariante.get(item.product.odooVarianteId) ?? 0) + item.quantiteCartons,
    )
  }

  for (const pickingId of pickingIds) {
    const [picking] = await lire<{ state: string }>(MODELES.livraison, [pickingId], [CHAMPS.livraison.etat])
    if (!picking || picking.state === 'done' || picking.state === 'cancel') continue

    await executerKw(MODELES.livraison, 'action_assign', [[pickingId]]).catch(() => undefined)

    const mouvements = await chercherLire<Record<string, unknown>>(
      MODELES.mouvement,
      [[CHAMPS.mouvement.livraison, '=', pickingId]],
      ['id', CHAMPS.mouvement.produit, CHAMPS.mouvement.demandee],
    )
    for (const mv of mouvements) {
      const variante = idMany2one(mv[CHAMPS.mouvement.produit])
      if (variante == null || typeof mv.id !== 'number') continue
      const demandee = Number(mv[CHAMPS.mouvement.demandee] ?? 0)
      const livree = qtyParVariante.get(variante) ?? 0
      const faite = Math.max(0, Math.min(livree, demandee))
      if (faite > 0) await augmenterStockSiBesoin(variante, faite)
      await ecrire(MODELES.mouvement, [mv.id], {
        [CHAMPS.mouvement.faite]: faite,
      })
    }

    await validerPicking(pickingId)
  }
}

async function validerPicking(pickingId: number) {
  const resultat = await executerKw<unknown>(
    MODELES.livraison,
    'button_validate',
    [[pickingId]],
    {
      context: {
        skip_backorder: true,
        cancel_backorder: true,
        picking_ids_not_to_backorder: [pickingId],
      },
    },
  )
  if (!resultat || resultat === true) return
  if (typeof resultat !== 'object') return
  const action = resultat as { res_model?: string; res_id?: number; context?: Record<string, unknown> }
  if (!action.res_model) return

  let wizardId = action.res_id
  if (!wizardId) {
    wizardId = await creer(action.res_model, { pick_ids: [[4, pickingId, 0]] })
  }
  if (action.res_model === 'stock.backorder.confirmation') {
    await executerKw(action.res_model, 'process_cancel_backorder', [[wizardId]]).catch(() =>
      executerKw(action.res_model!, 'process', [[wizardId]]),
    )
    return
  }
  if (action.res_model === 'stock.immediate.transfer') {
    await executerKw(action.res_model, 'process', [[wizardId]])
  }
}

async function retournerSiBesoin(devisId: number, order: CommandeComplete) {
  const aRemettre = new Map<string, number>()
  for (const retour of order.retours) {
    for (const ligne of retour.lignes) {
      if (!ligne.remisEnStock) continue
      aRemettre.set(ligne.productId, (aRemettre.get(ligne.productId) ?? 0) + ligne.quantite)
    }
  }
  if (aRemettre.size === 0) return

  const pickingIds = await idsLivraisons(devisId)
  const done = []
  for (const id of pickingIds) {
    const [p] = await lire<{ state: string }>(MODELES.livraison, [id], [CHAMPS.livraison.etat])
    if (p?.state === 'done') done.push(id)
  }
  const source = done[0]
  if (!source) return

  const wizardId = await creer(MODELES.retourWizard, { picking_id: source })
  const wizard = await lire<Record<string, unknown>>(MODELES.retourWizard, [wizardId], [
    'product_return_moves',
  ])
  const moveIds = wizard[0]?.product_return_moves
  if (Array.isArray(moveIds) && moveIds.every((x) => typeof x === 'number')) {
    const moves = await chercherLire<{ id: number; product_id: unknown; quantity: number }>(
      'stock.return.picking.line',
      [['id', 'in', moveIds]],
      ['id', 'product_id', 'quantity'],
    )
    for (const mv of moves) {
      const variante = idMany2one(mv.product_id)
      const item = order.items.find((i) => i.product.odooVarianteId === variante)
      const qty = item ? (aRemettre.get(item.productId) ?? 0) : 0
      await ecrire('stock.return.picking.line', [mv.id], { quantity: qty })
    }
  }
  const created = await executerKw<{ res_id?: number } | boolean>(
    MODELES.retourWizard,
    'action_create_returns',
    [[wizardId]],
  )
  const retourPicking =
    typeof created === 'object' && created && 'res_id' in created ? created.res_id : undefined
  if (typeof retourPicking === 'number') {
    await validerPicking(retourPicking)
  }
}

async function marquer(
  orderId: string,
  opts: { odooId?: number | null; statut: 'ok' | 'erreur' | 'attente'; erreur?: string },
) {
  await prisma.order.update({
    where: { id: orderId },
    data: {
      odooId: opts.odooId ?? undefined,
      odooSyncStatut: opts.statut,
      odooSyncErreur: opts.statut === 'erreur' ? (opts.erreur ?? 'erreur Odoo') : null,
      odooSyncLe: new Date(),
    },
  })
}

export async function statsVentesOdoo() {
  const [attente, erreurs] = await Promise.all([
    prisma.order.count({ where: { odooSyncStatut: 'attente' } }),
    prisma.order.count({ where: { odooSyncStatut: 'erreur' } }),
  ])
  return { attente, erreurs }
}
