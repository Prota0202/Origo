/**
 * Traduction ORIGO → Odoo, testable sans Odoo, plus la route admin.
 * La boucle complète contre un vrai Odoo : ODOO_SYNC_TEST=1 (jamais le .env
 * de production — voir vitest.config.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import {
  descriptionVente,
  normaliserTvaBelge,
  valeursPartenaireOdoo,
  valeursProduitOdoo,
} from '../src/lib/odoo/mapping.js'
import { creerJeuDeDonnees, PHOTO_LIVRAISON_TEST, prisma, tokenStaff } from './aide.js'

describe('traduction des fiches ORIGO', () => {
  it('rappelle qu’une unité Odoo est un carton, pas une pièce', () => {
    expect(descriptionVente({ description: 'Bol kraft', unitesParCarton: 300 })).toBe(
      'Bol kraft\n1 unité Odoo = 1 carton ORIGO (300 pièces).',
    )
  })

  it('n’écrit un n° TVA que s’il est belge', () => {
    expect(normaliserTvaBelge(null)).toBeNull()
    expect(normaliserTvaBelge('')).toBeNull()
    expect(normaliserTvaBelge('à venir en septembre')).toBeNull()
    expect(normaliserTvaBelge('FR123')).toBeNull()
    expect(normaliserTvaBelge('BE 0123.456.749')).toBe('BE0123456749')
    expect(normaliserTvaBelge('0123456749')).toBe('BE0123456749')
  })

  it('pose un produit stockable en biens, au prix carton', () => {
    const v = valeursProduitOdoo({
      nom: 'Bol kraft 750 ml',
      sku: 'bol-kraft-750',
      description: 'Bol carton',
      unitesParCarton: 300,
      prixCarton: 58,
      actif: true,
    })
    expect(v.type).toBe('consu')
    expect(v.is_storable).toBe(true)
    expect(v.list_price).toBe(58)
    expect(v.default_code).toBe('bol-kraft-750')
  })

  it('ne met pas vat sur un partenaire sans n° TVA', () => {
    const v = valeursPartenaireOdoo({
      nom: 'Resto Test',
      code: 'CLI001',
      email: null,
      telephone: null,
      adresse: null,
      ville: 'Bruxelles',
      numeroTva: null,
      minCartons: 5,
      actif: true,
    })
    expect(v.vat).toBeUndefined()
    expect(v.is_company).toBe(true)
    expect(v.ref).toBe('CLI001')
    expect(v.city).toBe('Bruxelles')
  })

  it('crée le devis et ses lignes en un seul payload, sans remise Odoo', async () => {
    const { valeursDevisOdoo } = await import('../src/lib/odoo/mapping.js')
    const v = valeursDevisOdoo({
      partenaireId: 9,
      tarifId: 3,
      numero: 'CMD-0042',
      dateLivraisonPrevue: new Date('2026-08-22T17:28:38.808Z'),
      lignes: [{ varianteId: 15, quantite: 10, prixUnitaire: 20.9, nom: 'Bol (palier)' }],
    })
    expect(v.client_order_ref).toBe('CMD-0042')
    expect(v.origin).toBe('ORIGO CMD-0042')
    expect(v.pricelist_id).toBe(3)
    expect(v.commitment_date).toBe('2026-08-22 17:28:38')
    const lignes = v.order_line as [number, number, { discount: number; price_unit: number; product_id: number }][]
    expect(lignes).toHaveLength(1)
    expect(lignes[0][0]).toBe(0)
    expect(lignes[0][2].discount).toBe(0)
    expect(lignes[0][2].price_unit).toBe(20.9)
    expect(lignes[0][2].product_id).toBe(15)
  })
})

describe('routes admin Odoo', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('refuse un client restaurant', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/odoo',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ typ: 'client', sub: client.id, code: client.code, nom: client.nom })}`,
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('renvoie l’état à la direction, même sans Odoo configuré', async () => {
    const { staff } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/odoo',
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
    })
    expect(res.statusCode).toBe(200)
    const corps = res.json()
    expect(corps).toHaveProperty('actif')
    expect(corps).toHaveProperty('sonde')
    expect(corps.commandes).toEqual({ attente: expect.any(Number), erreurs: expect.any(Number) })
  })

  it('refuse la synchro si Odoo n’est pas configuré', async () => {
    if (process.env.ODOO_URL) return
    const { staff } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/odoo/synchroniser',
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { inclureStock: false },
    })
    expect(res.statusCode).toBe(503)
  })
})

const labo = process.env.ODOO_SYNC_TEST === '1' && Boolean(process.env.ODOO_URL)

describe.skipIf(!labo)('poussée réelle vers Odoo', () => {
  it('crée un produit et un partenaire, puis les archive', async () => {
    const { synchroniserProduit, synchroniserClient } = await import('../src/lib/odoo/sync.js')
    const odoo = await import('../src/lib/odoo/rpc.js')
    const { product, client } = await creerJeuDeDonnees({ stock: 4, prixCarton: 22 })

    await prisma.catalogEntry.updateMany({
      where: { clientId: client.id, productId: product.id },
      data: { prixNegocie: 18 },
    })

    await synchroniserProduit(product.id)
    await synchroniserClient(client.id)

    const p = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    const c = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    expect(p.odooId).toBeTruthy()
    expect(p.odooVarianteId).toBeTruthy()
    expect(c.odooId).toBeTruthy()
    expect(c.odooTarifId).toBeTruthy()

    const [tmpl] = await odoo.lire('product.template', [p.odooId], ['default_code', 'list_price'])
    expect(tmpl.default_code).toBe(p.sku)
    expect(tmpl.list_price).toBe(22)

    const [partenaire] = await odoo.lire('res.partner', [c.odooId], ['ref', 'vat'])
    expect(partenaire.ref).toBe(c.code)
    expect(partenaire.vat).toBeFalsy()

    await odoo.ecrire('product.template', [p.odooId], { active: false })
    await odoo.ecrire('res.partner', [c.odooId], { active: false })
  }, 60_000)

  it('pousse un sale.order depuis une commande ORIGO, puis l’annule', async () => {
    const { synchroniserProduit, synchroniserClient } = await import('../src/lib/odoo/sync.js')
    const { synchroniserCommande } = await import('../src/lib/odoo/ventes.js')
    const { creerCommande } = await import('../src/modules/orders/service.js')
    const odoo = await import('../src/lib/odoo/rpc.js')
    const { product, client } = await creerJeuDeDonnees({ stock: 8, prixCarton: 12, minCartons: 1 })

    await synchroniserProduit(product.id)
    await synchroniserClient(client.id)

    const commande = await creerCommande(
      client.id,
      [{ productId: product.id, qty: 2 }],
      { nom: 'Labo Odoo', acceptationCgv: true, image: PHOTO_LIVRAISON_TEST },
    )
    await synchroniserCommande(commande.id)

    const row = await prisma.order.findUniqueOrThrow({ where: { id: commande.id } })
    expect(row.odooId).toBeTruthy()
    expect(row.odooSyncStatut).toBe('ok')
    expect(row.odooNom).toBeTruthy()

    const [devis] = await odoo.lire('sale.order', [row.odooId!], ['client_order_ref', 'state', 'amount_untaxed'])
    expect(devis.client_order_ref).toBe(commande.numero)
    expect(devis.state).toBe('sale')
    expect(Number(devis.amount_untaxed)).toBe(34)

    await odoo.executerKw('sale.order', 'action_cancel', [[row.odooId]])
    const p = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    const c = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    await odoo.ecrire('product.template', [p.odooId!], { active: false })
    await odoo.ecrire('res.partner', [c.odooId!], { active: false })
  }, 90_000)
})

afterAll(async () => {
  await prisma.$disconnect()
})
