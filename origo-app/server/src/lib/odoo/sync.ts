/**
 * Catalogue ORIGO → Odoo, et stock dans les deux sens.
 *
 * ORIGO reste la source de vérité pour le resto. Les ventes partent en
 * arrière-plan (`ventes.ts`) : un échec Odoo ne bloque jamais le panier.
 *
 * Stock :
 * - ORIGO → Odoo : inventaire saisi dans Produits (`apresAjustementStock`).
 *   Pas dans « Envoyer le catalogue », et pas après une commande : le picking
 *   Odoo baisse déjà le on-hand à la livraison.
 * - Odoo → ORIGO : `tirerStocksDepuisOdoo` (bouton + sonde). On ne recopie
 *   pas le on-hand tel quel : l'app a déjà décrémenté les commandes ouvertes
 *   que Odoo n'a pas encore sorties.
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

export type RapportPullStock = {
  debut: string
  fin: string
  lus: number
  alignes: number
  inchanges: number
  produitsCrees: number
  produitsLies: number
  desactives: number
  erreurs: { cible: string; message: string }[]
}

type Journal = Pick<FastifyBaseLogger, 'error' | 'warn' | 'info'>

let journal: Journal | undefined
let file: Promise<void> = Promise.resolve()
let syncEnCours: Promise<RapportSync> | null = null
let dernierRapport: RapportSync | null = null
let dernierPull: RapportPullStock | null = null

function enfiler<T>(travail: () => Promise<T>): Promise<T> {
  const execution = file.then(travail, travail)
  file = execution.then(
    () => undefined,
    () => undefined,
  )
  return execution
}

export function brancherJournalOdoo(log: Journal) {
  journal = log
}

export function dernierSyncOdoo() {
  return dernierRapport
}

export function dernierPullStockOdoo() {
  return dernierPull
}

/**
 * Enfile un travail Odoo. Les écritures de listes de prix ne se parallélisent
 * pas : deux `write` concurrentes sur la même pricelist se marchent dessus.
 */
export function pousserOdooEnArrierePlan(travail: () => Promise<void>) {
  if (!env.odoo.actif) return
  void enfiler(async () => {
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

/** Archive le modèle Odoo. On n’efface pas : l’historique de vente doit rester. */
export function archiverProduitOdoo(odooId: number) {
  pousserOdooEnArrierePlan(async () => {
    await ecrire(MODELES.produitModele, [odooId], { [CHAMPS.produit.actif]: false })
  })
}

export function archiverPartenaireOdoo(odooId: number) {
  pousserOdooEnArrierePlan(async () => {
    await ecrire(MODELES.partenaire, [odooId], { [CHAMPS.partenaire.actif]: false })
  })
}

/**
 * Stock vendable ORIGO à partir du on-hand Odoo.
 *
 * L'app décrémente dès la commande ; Odoo ne sort qu'au picking. Recopier
 * le on-hand tel quel re-créditerait des cartons déjà vendus.
 *
 * - Odoo ≥ physique app (stock + réservées) : entrée / inventaire chez Odoo.
 * - sinon : picking déjà sorti, ou inventaire à la baisse → on prend Odoo.
 */
export function stockCibleDepuisOdoo(odooOnHand: number, stockOrigo: number, reservees: number) {
  const odoo = entierStock(odooOnHand)
  const stock = entierStock(stockOrigo)
  const reserve = entierStock(reservees)
  const physiqueOrigo = stock + reserve
  if (odoo >= physiqueOrigo) return odoo - reserve
  return odoo
}

function entierStock(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n))
}

export async function tirerStocksDepuisOdoo(
  opts: { ignorerSiRecent?: boolean; importerProduits?: boolean } = {},
): Promise<RapportPullStock> {
  if (!env.odoo.actif) {
    throw new OdooIndisponible('Intégration Odoo non configurée')
  }
  if (opts.ignorerSiRecent && dernierPull && !opts.importerProduits) {
    const age = Date.now() - Date.parse(dernierPull.fin)
    if (Number.isFinite(age) && age < 2 * 60 * 1000) return dernierPull
  }
  const rapport = await enfiler(() =>
    executerPullStock({ importerProduits: opts.importerProduits === true }),
  )
  dernierPull = rapport
  return rapport
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

async function executerPullStock(
  opts: { importerProduits?: boolean } = {},
): Promise<RapportPullStock> {
  const debut = new Date().toISOString()
  const erreurs: RapportPullStock['erreurs'] = []
  let produitsCrees = 0
  let produitsLies = 0

  if (opts.importerProduits) {
    const importes = await importerProduitsDepuisOdoo()
    produitsCrees = importes.crees
    produitsLies = importes.lies
    erreurs.push(...importes.erreurs)
  }

  const ctx = await contexteOdoo()
  const desactives = await desactiverSiArchiveChezOdoo()

  const produits = await prisma.product.findMany({
    where: { odooVarianteId: { not: null }, actif: true },
    select: { id: true, sku: true, stock: true, odooVarianteId: true },
  })

  if (produits.length === 0) {
    return {
      debut,
      fin: new Date().toISOString(),
      lus: 0,
      alignes: 0,
      inchanges: 0,
      produitsCrees,
      produitsLies,
      desactives,
      erreurs,
    }
  }

  const odooParVariante = new Map<number, number>()
  for (const paquet of parPaquets(
    produits.map((p) => p.odooVarianteId as number),
    80,
  )) {
    const quants = await chercherLire<{
      product_id: number | [number, string]
      quantity: number
    }>(
      MODELES.stockDisponible,
      [
        [CHAMPS.stock.produit, 'in', paquet],
        [CHAMPS.stock.emplacement, '=', ctx.emplacementId],
      ],
      [CHAMPS.stock.produit, CHAMPS.stock.quantite],
    )
    for (const q of quants) {
      const varianteId = idMany2one(q.product_id)
      if (varianteId == null) continue
      odooParVariante.set(
        varianteId,
        (odooParVariante.get(varianteId) ?? 0) + entierStock(Number(q.quantity)),
      )
    }
  }

  const reserves = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      productId: { in: produits.map((p) => p.id) },
      order: { statut: { in: ['CONFIRMEE', 'PREPAREE', 'EN_LIVRAISON'] } },
    },
    _sum: { quantiteCartons: true },
  })
  const reserveesParProduit = new Map(
    reserves.map((r) => [r.productId, r._sum.quantiteCartons ?? 0]),
  )

  let alignes = 0
  let inchanges = 0
  for (const p of produits) {
    if (p.odooVarianteId == null) continue
    const cible = stockCibleDepuisOdoo(
      odooParVariante.get(p.odooVarianteId) ?? 0,
      p.stock,
      reserveesParProduit.get(p.id) ?? 0,
    )
    if (cible === p.stock) {
      inchanges += 1
      continue
    }
    const delta = cible - p.stock
    try {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id: p.id }, data: { stock: cible } })
        await tx.stockMouvement.create({
          data: {
            productId: p.id,
            type: 'AJUSTEMENT',
            quantite: delta,
            stockApres: cible,
            note: 'Aligné depuis Odoo',
          },
        })
      })
      alignes += 1
    } catch (e) {
      erreurs.push({ cible: `stock ${p.sku}`, message: messageErreur(e) })
    }
  }

  journal?.info(
    {
      lus: produits.length,
      alignes,
      inchanges,
      produitsCrees,
      produitsLies,
      desactives,
      erreurs: erreurs.length,
    },
    'Odoo : stocks tirés vers ORIGO',
  )

  return {
    debut,
    fin: new Date().toISOString(),
    lus: produits.length,
    alignes,
    inchanges,
    produitsCrees,
    produitsLies,
    desactives,
    erreurs,
  }
}

/** Odoo archivé ou effacé → on retire le produit du catalogue ORIGO (sans casser l’historique). */
async function desactiverSiArchiveChezOdoo() {
  const lies = await prisma.product.findMany({
    where: { odooId: { not: null }, actif: true },
    select: { id: true, odooId: true },
  })
  if (lies.length === 0) return 0

  const actifsChezOdoo = new Set<number>()
  for (const paquet of parPaquets(
    lies.map((p) => p.odooId as number),
    80,
  )) {
    const modeles = await chercherLire<{ id: number; active: boolean }>(
      MODELES.produitModele,
      [['id', 'in', paquet]],
      ['id', CHAMPS.produit.actif],
      { context: { active_test: false } },
    )
    for (const m of modeles) {
      if (m.active) actifsChezOdoo.add(m.id)
    }
  }

  let desactives = 0
  for (const p of lies) {
    if (p.odooId == null || actifsChezOdoo.has(p.odooId)) continue
    await prisma.product.update({ where: { id: p.id }, data: { actif: false } })
    desactives += 1
  }
  return desactives
}

async function importerProduitsDepuisOdoo() {
  const erreurs: RapportPullStock['erreurs'] = []
  const existants = await prisma.product.findMany({
    select: { id: true, sku: true, odooId: true, odooVarianteId: true },
  })
  const parSku = new Map(existants.map((p) => [p.sku.toLowerCase(), p]))
  const idsOdoo = new Set(existants.map((p) => p.odooId).filter((id): id is number => id != null))

  const modeles = await chercherLire<{
    id: number
    name: string
    default_code: string | false
    list_price: number
    description_sale: string | false
    categ_id: [number, string] | false
    product_variant_id: [number, string] | false
  }>(
    MODELES.produitModele,
    [
      [CHAMPS.produit.reference, '!=', false],
      [CHAMPS.produit.actif, '=', true],
      [CHAMPS.produit.stockable, '=', true],
    ],
    [
      'id',
      CHAMPS.produit.nom,
      CHAMPS.produit.reference,
      CHAMPS.produit.prixCatalogue,
      CHAMPS.produit.descriptionVente,
      CHAMPS.produit.categorie,
      CHAMPS.produit.variante,
    ],
    { limit: 300, context: { active_test: true } },
  )

  let crees = 0
  let lies = 0
  for (const t of modeles) {
    const sku = String(t.default_code || '').trim()
    if (!sku) continue
    if (idsOdoo.has(t.id)) continue
    const variante = idMany2one(t.product_variant_id)
    if (variante == null) continue

    const deja = parSku.get(sku.toLowerCase())
    if (deja) {
      if (deja.odooId == null || deja.odooVarianteId == null) {
        try {
          await prisma.product.update({
            where: { id: deja.id },
            data: { odooId: t.id, odooVarianteId: variante },
          })
          deja.odooId = t.id
          deja.odooVarianteId = variante
          idsOdoo.add(t.id)
          lies += 1
        } catch (e) {
          erreurs.push({ cible: `lien ${sku}`, message: messageErreur(e) })
        }
      }
      continue
    }

    const categorie =
      (Array.isArray(t.categ_id) ? String(t.categ_id[1]) : '')
        .split('/')
        .pop()
        ?.trim() || 'Odoo'
    const texteBrut = texteOdoo(t.description_sale)
    const unitesParCarton = unitesDepuisDescriptionOdoo(texteBrut)
    const description = descriptionDepuisOdoo(texteBrut)
    const prix = Number(t.list_price)
    try {
      const cree = await prisma.product.create({
        data: {
          sku,
          nom: String(t.name || sku).trim() || sku,
          description,
          categorie,
          unitesParCarton,
          prixCarton: Number.isFinite(prix) && prix > 0 ? prix : 0,
          stock: 0,
          actif: false,
          odooId: t.id,
          odooVarianteId: variante,
        },
      })
      parSku.set(sku.toLowerCase(), {
        id: cree.id,
        sku: cree.sku,
        odooId: cree.odooId,
        odooVarianteId: cree.odooVarianteId,
      })
      idsOdoo.add(t.id)
      crees += 1
    } catch (e) {
      erreurs.push({ cible: `produit ${sku}`, message: messageErreur(e) })
    }
  }

  return { crees, lies, erreurs }
}

function texteOdoo(brut: string | false | null | undefined) {
  return String(brut || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function descriptionDepuisOdoo(texte: string) {
  return texte.replace(/1 unité Odoo = 1 carton ORIGO \(\d+ pièces\)\.?/gi, '').trim()
}

function unitesDepuisDescriptionOdoo(description: string) {
  const m = description.match(/1 carton ORIGO \((\d+) pièces\)/i)
  const n = m ? Number(m[1]) : 1
  return Number.isInteger(n) && n > 0 ? n : 1
}

function parPaquets<T>(items: T[], taille: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += taille) out.push(items.slice(i, i + taille))
  return out
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
