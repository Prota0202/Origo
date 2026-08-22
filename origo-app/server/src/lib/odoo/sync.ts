/**
 * Poussée ORIGO → Odoo (produits, partenaires, tarifs fixes).
 *
 * ORIGO reste la source de vérité pour le resto. Les ventes partent en
 * arrière-plan (`ventes.ts`) : un échec Odoo ne bloque jamais le panier.
 * L'instantané `stock.quant` n'est pas dans « Envoyer le catalogue » : ça
 * écraserait les sorties déjà validées dans Odoo. Un inventaire saisi dans
 * Produits (quantité changée) est poussé à part via `apresAjustementStock`.
 */
import type { FastifyBaseLogger } from 'fastify'
import type { Client, Product } from '@prisma/client'
import { env } from '../../config/env.js'
import { ConflictError } from '../errors.js'
import { toNum } from '../money.js'
import { prisma } from '../prisma.js'
import { idMany2one, valeursPartenaireOdoo, valeursProduitOdoo } from './mapping.js'
import { CHAMPS, MODELES } from './modeles.js'
import { chercherLire, creer, ecrire, executerKw, lire, OdooIndisponible } from './rpc.js'
import { assurerTarifClient, synchroniserReglesProduit, verifierPrerequisTarifs } from './tarifs.js'

export type RapportSync = {
  debut: string
  fin: string
  produits: { crees: number; misAJour: number }
  clients: { crees: number; misAJour: number }
  tarifs: number
  stock?: { poses: number }
  erreurs: { cible: string; message: string }[]
}

type Journal = Pick<FastifyBaseLogger, 'error' | 'warn' | 'info'>

let journal: Journal | undefined
let file: Promise<void> = Promise.resolve()
let syncEnCours: Promise<RapportSync> | null = null
let dernierRapport: RapportSync | null = null

export function brancherJournalOdoo(log: Journal) {
  journal = log
}

export function dernierSyncOdoo() {
  return dernierRapport
}

/**
 * Enfile un travail Odoo. Les écritures de listes de prix ne se parallélisent
 * pas : deux `write` concurrentes sur la même pricelist se marchent dessus.
 */
export function pousserOdooEnArrierePlan(travail: () => Promise<void>) {
  if (!env.odoo.actif) return
  file = file.then(async () => {
    try {
      await travail()
    } catch (e) {
      journal?.error({ err: e }, 'Sync Odoo en arrière-plan échouée — ORIGO n’est pas bloqué')
    }
  })
}

export function apresMutationProduit(productId: string, opts: { alignerStock?: boolean } = {}) {
  pousserOdooEnArrierePlan(async () => {
    await synchroniserProduit(productId)
    if (opts.alignerStock) await alignerStockOdoo(productId)
    await resynchroniserTarifsDuProduit(productId)
  })
}

/** Inventaire saisi dans ORIGO → on-hand Odoo. Pas les livraisons (elles bougent déjà le picking). */
export function apresAjustementStock(productId: string) {
  pousserOdooEnArrierePlan(() => alignerStockOdoo(productId))
}

export function apresMutationClient(clientId: string) {
  pousserOdooEnArrierePlan(() => synchroniserClient(clientId))
}

export async function synchroniserTout(opts: { inclureStock?: boolean } = {}): Promise<RapportSync> {
  if (!env.odoo.actif) {
    throw new OdooIndisponible('Intégration Odoo non configurée')
  }
  if (syncEnCours) {
    throw new ConflictError('Une synchronisation Odoo est déjà en cours')
  }

  const travail = executerSynchronisation(opts)
  syncEnCours = travail
  try {
    const rapport = await travail
    dernierRapport = rapport
    return rapport
  } finally {
    syncEnCours = null
  }
}

async function executerSynchronisation(opts: { inclureStock?: boolean }): Promise<RapportSync> {
  const debut = new Date().toISOString()
  const erreurs: RapportSync['erreurs'] = []
  const produits = { crees: 0, misAJour: 0 }
  const clients = { crees: 0, misAJour: 0 }
  let tarifs = 0
  let stockPoses = 0

  const prerequis = await verifierPrerequisTarifs()
  if (!prerequis.ok) {
    return {
      debut,
      fin: new Date().toISOString(),
      produits,
      clients,
      tarifs: 0,
      erreurs: prerequis.problemes.map((message) => ({ cible: 'prerequis', message })),
    }
  }

  const ctx = await contexteOdoo()

  const tousProduits = await prisma.product.findMany()
  for (const p of tousProduits) {
    try {
      const avant = p.odooId
      await upsertProduit(p, ctx)
      if (avant) produits.misAJour += 1
      else produits.crees += 1
    } catch (e) {
      erreurs.push({ cible: `produit ${p.sku}`, message: messageErreur(e) })
    }
  }

  const tousClients = await prisma.client.findMany({
    include: { catalogue: true, paliers: true },
  })
  for (const c of tousClients) {
    try {
      const avant = c.odooId
      await upsertClientEtTarif(c, ctx)
      if (avant) clients.misAJour += 1
      else clients.crees += 1
      tarifs += 1
    } catch (e) {
      erreurs.push({ cible: `client ${c.code}`, message: messageErreur(e) })
    }
  }

  if (opts.inclureStock === true) {
    const relus = await prisma.product.findMany({
      where: { odooVarianteId: { not: null } },
    })
    for (const p of relus) {
      if (p.odooVarianteId == null) continue
      try {
        await poserStock(p.odooVarianteId, p.stock, ctx.emplacementId)
        stockPoses += 1
      } catch (e) {
        erreurs.push({ cible: `stock ${p.sku}`, message: messageErreur(e) })
      }
    }
  }

  return {
    debut,
    fin: new Date().toISOString(),
    produits,
    clients,
    tarifs,
    stock: opts.inclureStock === true ? { poses: stockPoses } : undefined,
    erreurs,
  }
}

export async function synchroniserProduit(productId: string) {
  if (!env.odoo.actif) return
  const p = await prisma.product.findUnique({ where: { id: productId } })
  if (!p) return
  const ctx = await contexteOdoo()
  await upsertProduit(p, ctx)
}

export async function alignerStockOdoo(productId: string) {
  if (!env.odoo.actif) return
  let p = await prisma.product.findUnique({ where: { id: productId } })
  if (!p) return
  const ctx = await contexteOdoo()
  if (!p.odooVarianteId) {
    await upsertProduit(p, ctx)
    p = await prisma.product.findUnique({ where: { id: productId } })
    if (!p) return
  }
  if (p.odooVarianteId == null) return
  await poserStock(p.odooVarianteId, p.stock, ctx.emplacementId)
}

export async function synchroniserClient(clientId: string) {
  if (!env.odoo.actif) return
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    include: { catalogue: true, paliers: true },
  })
  if (!c) return
  const ctx = await contexteOdoo()
  await upsertClientEtTarif(c, ctx)
}

type Contexte = {
  deviseId: number
  paysId: number
  emplacementId: number
  categories: Map<string, number>
}

let ctxCache: { valeur: Contexte; expire: number } | null = null

async function contexteOdoo(): Promise<Contexte> {
  if (ctxCache && ctxCache.expire > Date.now()) return ctxCache.valeur

  const [devises, pays, emplacements] = await Promise.all([
    chercherLire<{ id: number }>(MODELES.devise, [['name', '=', 'EUR']], ['id'], {
      limit: 1,
      context: { active_test: false },
    }),
    chercherLire<{ id: number }>(MODELES.pays, [['code', '=', 'BE']], ['id'], { limit: 1 }),
    chercherLire<{ id: number; complete_name: string }>(
      MODELES.emplacement,
      [['usage', '=', 'internal']],
      ['id', 'complete_name'],
    ),
  ])

  const deviseId = devises[0]?.id
  const paysId = pays[0]?.id
  if (!deviseId) throw new Error('Devise EUR introuvable dans Odoo')
  if (!paysId) throw new Error('Pays Belgique (BE) introuvable dans Odoo')

  const stock =
    emplacements.find((e) => /WH\/Stock$/i.test(e.complete_name)) ?? emplacements[0]
  if (!stock) throw new Error('Aucun emplacement de stock interne dans Odoo')

  const valeur: Contexte = {
    deviseId,
    paysId,
    emplacementId: stock.id,
    categories: new Map(),
  }
  ctxCache = { valeur, expire: Date.now() + 10 * 60 * 1000 }
  return valeur
}

async function categorieId(nom: string, ctx: Contexte): Promise<number | undefined> {
  const cle = nom.trim()
  if (!cle) return undefined
  const deja = ctx.categories.get(cle)
  if (deja) return deja

  const existantes = await chercherLire<{ id: number }>(
    MODELES.produitCategorie,
    [['name', '=', cle]],
    ['id'],
    { limit: 1 },
  )
  const id = existantes[0]?.id ?? (await creer(MODELES.produitCategorie, { name: cle }))
  ctx.categories.set(cle, id)
  return id
}

async function upsertProduit(p: Product, ctx: Contexte) {
  const valeurs: Record<string, unknown> = {
    ...valeursProduitOdoo({
      nom: p.nom,
      sku: p.sku,
      description: p.description,
      unitesParCarton: p.unitesParCarton,
      prixCarton: toNum(p.prixCarton),
      actif: p.actif,
    }),
  }
  const cat = await categorieId(p.categorie, ctx)
  if (cat) valeurs.categ_id = cat

  let templateId = p.odooId
  if (!templateId) {
    const existants = await chercherLire<{ id: number }>(
      MODELES.produitModele,
      [[CHAMPS.produit.reference, '=', p.sku]],
      ['id'],
      { limit: 1, context: { active_test: false } },
    )
    templateId = existants[0]?.id
  }

  if (templateId) {
    await ecrire(MODELES.produitModele, [templateId], valeurs)
  } else {
    templateId = await creer(MODELES.produitModele, valeurs)
  }

  const [tmpl] = await lire(MODELES.produitModele, [templateId], [CHAMPS.produit.variante])
  const variante = idMany2one(tmpl?.[CHAMPS.produit.variante])
  if (!variante) throw new Error(`Variante Odoo introuvable pour ${p.sku}`)

  if (p.odooId !== templateId || p.odooVarianteId !== variante) {
    await prisma.product.update({
      where: { id: p.id },
      data: { odooId: templateId, odooVarianteId: variante },
    })
  }
}

type ClientAvecGrille = Client & {
  catalogue: { productId: string; prixNegocie: unknown; visible: boolean }[]
  paliers: { productId: string; seuil: number; prix: unknown }[]
}

async function upsertClientEtTarif(c: ClientAvecGrille, ctx: Contexte) {
  const valeurs = valeursPartenaireOdoo(
    {
      nom: c.nom,
      code: c.code,
      email: c.email,
      telephone: c.telephone,
      adresse: c.adresse,
      ville: c.ville,
      numeroTva: c.numeroTva,
      minCartons: c.minCartons,
      actif: c.actif,
    },
    ctx.paysId,
  )

  let partenaireId = c.odooId
  if (!partenaireId) {
    const existants = await chercherLire<{ id: number }>(
      MODELES.partenaire,
      [[CHAMPS.partenaire.reference, '=', c.code]],
      ['id'],
      { limit: 1, context: { active_test: false } },
    )
    partenaireId = existants[0]?.id
  }

  if (partenaireId) {
    await ecrire(MODELES.partenaire, [partenaireId], valeurs)
  } else {
    partenaireId = await creer(MODELES.partenaire, valeurs)
  }

  const tarifId = await assurerTarifClient({
    partenaireId,
    nom: `ORIGO · ${c.nom}`,
    deviseId: ctx.deviseId,
  })

  if (c.odooId !== partenaireId || c.odooTarifId !== tarifId) {
    await prisma.client.update({
      where: { id: c.id },
      data: { odooId: partenaireId, odooTarifId: tarifId },
    })
  }

  await synchroniserTarifComplet(c, tarifId)
}

async function synchroniserTarifComplet(c: ClientAvecGrille, tarifId: number) {
  const visibles = c.catalogue.filter((e) => e.visible)
  const productIds = [...new Set(visibles.map((e) => e.productId))]
  const produits = await prisma.product.findMany({
    where: { id: { in: productIds } },
  })
  const parId = new Map(produits.map((p) => [p.id, p]))

  const idsVoulus = new Set(
    produits.filter((p) => p.odooId != null).map((p) => p.odooId as number),
  )

  const existantes = await chercherLire<{ id: number; product_tmpl_id: [number, string] | false }>(
    MODELES.tarifRegle,
    [[CHAMPS.tarifRegle.tarif, '=', tarifId]],
    ['id', CHAMPS.tarifRegle.produitModele],
  )
  const aRetirer = existantes.filter((r) => {
    const tmpl = idMany2one(r[CHAMPS.tarifRegle.produitModele])
    return tmpl != null && !idsVoulus.has(tmpl)
  })
  if (aRetirer.length > 0) {
    await ecrire(MODELES.tarif, [tarifId], {
      item_ids: aRetirer.map((r) => [2, r.id, 0]),
    })
  }

  const paliersParProduit = new Map<string, { seuil: number; prix: number }[]>()
  for (const palier of c.paliers) {
    const liste = paliersParProduit.get(palier.productId) ?? []
    liste.push({ seuil: palier.seuil, prix: toNum(palier.prix) })
    paliersParProduit.set(palier.productId, liste)
  }

  for (const entry of visibles) {
    const produit = parId.get(entry.productId)
    if (!produit?.odooId) continue
    await synchroniserReglesProduit({
      tarifId,
      produitModeleId: produit.odooId,
      grille: {
        prixBase: entry.prixNegocie != null ? toNum(entry.prixNegocie) : toNum(produit.prixCarton),
        paliers: paliersParProduit.get(produit.id),
        remiseSeuil: produit.remiseSeuil,
        remisePourcent: produit.remisePourcent != null ? toNum(produit.remisePourcent) : null,
      },
    })
  }
}

async function resynchroniserTarifsDuProduit(productId: string) {
  const entrees = await prisma.catalogEntry.findMany({
    where: { productId, visible: true },
    select: { clientId: true },
  })
  const vus = new Set<string>()
  for (const e of entrees) {
    if (vus.has(e.clientId)) continue
    vus.add(e.clientId)
    await synchroniserClient(e.clientId)
  }
}

/** Monte le quant Odoo si besoin pour qu'un picking puisse se valider. Ne descend jamais. */
export async function augmenterStockSiBesoin(varianteId: number, minimum: number) {
  if (minimum <= 0) return
  const ctx = await contexteOdoo()
  const quants = await chercherLire<{ id: number; quantity: number }>(
    MODELES.stockDisponible,
    [
      [CHAMPS.stock.produit, '=', varianteId],
      [CHAMPS.stock.emplacement, '=', ctx.emplacementId],
    ],
    ['id', CHAMPS.stock.quantite],
    { limit: 1 },
  )
  const actuel = Number(quants[0]?.quantity ?? 0)
  if (actuel >= minimum) return
  await poserStock(varianteId, minimum, ctx.emplacementId)
}

async function poserStock(varianteId: number, quantite: number, emplacementId: number) {
  const quants = await chercherLire<{ id: number; quantity: number }>(
    MODELES.stockDisponible,
    [
      [CHAMPS.stock.produit, '=', varianteId],
      [CHAMPS.stock.emplacement, '=', emplacementId],
    ],
    ['id', CHAMPS.stock.quantite],
    { limit: 1 },
  )

  if (quants[0] && Number(quants[0].quantity) === quantite) return

  const qid =
    quants[0]?.id ??
    (await creer(MODELES.stockDisponible, {
      [CHAMPS.stock.produit]: varianteId,
      [CHAMPS.stock.emplacement]: emplacementId,
    }))

  await ecrire(MODELES.stockDisponible, [qid], { [CHAMPS.stock.inventaire]: quantite })
  await executerKw(MODELES.stockDisponible, 'action_apply_inventory', [[qid]])
}

function messageErreur(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
