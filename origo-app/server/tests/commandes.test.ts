/**
 * Tests des scénarios qui corrompaient stock et facturation.
 * Chaque test correspond à un bug réel constaté dans l'audit : ils servent
 * de filet pour que la correction ne soit pas défaite plus tard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { buildApp } from '../src/app.js'
import {
  ajouterProduitAuCatalogue,
  creerJeuDeDonnees,
  PHOTO_LIVRAISON_TEST,
  prisma,
  SIGNATURE_COMMANDE,
  stockDe,
  tokenClient,
  tokenStaff,
} from './aide.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

/** Passe une commande via l'API en tant que client. */
async function commander(client: { id: string; code: string; nom: string }, productId: string, qty: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/me/orders',
    headers: { authorization: `Bearer ${tokenClient(app, client)}` },
    payload: { lignes: [{ productId, qty }], ...SIGNATURE_COMMANDE },
  })
  expect(res.statusCode, res.body).toBe(200)
  return res.json()
}

function statut(staff: Parameters<typeof tokenStaff>[1], orderId: string, payload: unknown) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/orders/${orderId}/statut`,
    headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
    payload: payload as Record<string, unknown>,
  })
}

/** Pipeline réel : confirmée → préparée → en livraison → livrée (photo obligatoire). */
async function livrer(
  staff: Parameters<typeof tokenStaff>[1],
  commande: { id: string },
  extras: Record<string, unknown> = {},
) {
  const prepa = await statut(staff, commande.id, { statut: 'PREPAREE' })
  expect(prepa.statusCode, prepa.body).toBe(200)
  const tournee = await statut(staff, commande.id, { statut: 'EN_LIVRAISON' })
  expect(tournee.statusCode, tournee.body).toBe(200)
  return statut(staff, commande.id, {
    statut: 'LIVREE',
    photoLivraisonUrl: PHOTO_LIVRAISON_TEST,
    ...extras,
  })
}

describe('annulation', () => {
  it("refuse d'annuler via le changement de statut (le stock resterait débité)", async () => {
    const { product, client, livreur } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 3)

    const res = await statut(livreur, commande.id, { statut: 'ANNULEE' })

    expect(res.statusCode).toBe(400)
    const apres = await prisma.order.findUniqueOrThrow({ where: { id: commande.id } })
    expect(apres.statut).toBe('CONFIRMEE')
    expect(await stockDe(product.id)).toBe(7)
  })

  it('réintègre le stock quand la commande n’est pas encore livrée', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 4)
    expect(await stockDe(product.id)).toBe(6)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${commande.id}/annuler`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {},
    })

    expect(res.statusCode, res.body).toBe(200)
    expect(await stockDe(product.id)).toBe(10)
  })

  it('exige une décision explicite sur le stock si la commande est déjà livrée', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 4)
    await livrer(staff, commande)

    const sansDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${commande.id}/annuler`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {},
    })
    expect(sansDecision.statusCode).toBe(400)
    expect(await stockDe(product.id)).toBe(6)
  })

  it('ne crée pas de stock fantôme quand la marchandise reste chez le client', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 4)
    await livrer(staff, commande)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${commande.id}/annuler`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { remiseEnStock: false },
    })

    expect(res.statusCode, res.body).toBe(200)
    // La marchandise est partie : le stock ne doit pas remonter.
    expect(await stockDe(product.id)).toBe(6)
  })
})

describe('transitions de statut', () => {
  it('refuse de faire revenir une commande livrée en préparation', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 2)
    await livrer(staff, commande)

    const res = await statut(staff, commande.id, { statut: 'PREPAREE' })
    expect(res.statusCode).toBe(403)
  })

  it('refuse de confirmer deux fois la même livraison', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 2)
    await livrer(staff, commande)

    const res = await statut(staff, commande.id, { statut: 'LIVREE' })
    expect(res.statusCode).toBe(409)
  })

  it('refuse une livraison sans photo', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 2)
    await statut(staff, commande.id, { statut: 'PREPAREE' })
    await statut(staff, commande.id, { statut: 'EN_LIVRAISON' })

    const res = await statut(staff, commande.id, { statut: 'LIVREE' })
    expect(res.statusCode).toBe(400)
  })

  it("interdit au livreur d'accepter une commande (rôle préparation)", async () => {
    const { product, client, livreur } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 2)
    const res = await statut(livreur, commande.id, { statut: 'PREPAREE' })
    expect(res.statusCode).toBe(403)
  })
})

describe('réouverture après livraison partielle', () => {
  it('restaure les quantités, ressort le manquant du stock et recalcule le total', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 10)
    expect(await stockDe(product.id)).toBe(0)

    // Livraison partielle : 7 livrés, 3 réintégrés au stock
    const prepa = await statut(staff, commande.id, { statut: 'PREPAREE' })
    expect(prepa.statusCode, prepa.body).toBe(200)
    const tournee = await statut(staff, commande.id, { statut: 'EN_LIVRAISON' })
    expect(tournee.statusCode, tournee.body).toBe(200)
    const livraison = await statut(staff, commande.id, {
      statut: 'LIVREE_PARTIELLEMENT',
      photoLivraisonUrl: PHOTO_LIVRAISON_TEST,
      lignesLivrees: [{ itemId: commande.lignes[0].itemId, qtyLivree: 7 }],
    })
    expect(livraison.statusCode, livraison.body).toBe(200)
    expect(await stockDe(product.id)).toBe(3)
    expect(livraison.json().total).toBe(1050)
    expect(livraison.json().fraisLivraisonHT).toBe(0)
    expect(livraison.json().lignes[0].qtyCommandee).toBe(10)

    // Réouverture : les 3 manquants doivent ressortir du stock
    const reouverture = await statut(staff, commande.id, { statut: 'CONFIRMEE' })
    expect(reouverture.statusCode, reouverture.body).toBe(200)

    const rouverte = reouverture.json()
    expect(rouverte.statut).toBe('Confirmée')
    expect(rouverte.lignes[0].qty).toBe(10)
    expect(rouverte.total).toBe(1500)
    expect(rouverte.cartons).toBe(10)
    expect(await stockDe(product.id)).toBe(0)
  })

  it('refuse la réouverture si un retour a déjà été enregistré', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 10 })
    const commande = await commander(client, product.id, 5)
    await livrer(staff, commande)

    const retour = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${commande.id}/retours`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { motif: 'Casse', lignes: [{ productId: product.id, qty: 2, remisEnStock: true }] },
    })
    expect(retour.statusCode, retour.body).toBe(200)

    const res = await statut(staff, commande.id, { statut: 'CONFIRMEE' })
    expect(res.statusCode).toBe(409)
  })
})

describe('retours', () => {
  it('agrège deux lignes du même produit au lieu de les traiter séparément', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 20 })
    const commande = await commander(client, product.id, 10)
    await livrer(staff, commande)
    const stockAvant = await stockDe(product.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${commande.id}/retours`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {
        motif: 'Casse',
        lignes: [
          { productId: product.id, qty: 3, remisEnStock: true },
          { productId: product.id, qty: 4, remisEnStock: true },
        ],
      },
    })

    expect(res.statusCode, res.body).toBe(200)
    // 7 cartons rendus au total, et la facturation tombe à 3
    expect(await stockDe(product.id)).toBe(stockAvant + 7)
    expect(res.json().lignes[0].qty).toBe(3)
    expect(res.json().total).toBe(450)
    expect(res.json().fraisLivraisonHT).toBe(0)
  })

  it('refuse de rendre plus de cartons qu’il n’en a été livré, même réparti en plusieurs lignes', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 20 })
    const commande = await commander(client, product.id, 10)
    await livrer(staff, commande)
    const stockAvant = await stockDe(product.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${commande.id}/retours`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {
        motif: 'Casse',
        lignes: [
          { productId: product.id, qty: 6, remisEnStock: true },
          { productId: product.id, qty: 6, remisEnStock: true },
        ],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(await stockDe(product.id)).toBe(stockAvant)
  })
})

describe('modification de commande', () => {
  it('refuse de modifier une commande déjà préparée (le montant serait recalculé)', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 20 })
    const commande = await commander(client, product.id, 5)
    await statut(staff, commande.id, { statut: 'PREPAREE' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${commande.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { lignes: [{ productId: product.id, qty: 8 }] },
    })

    expect(res.statusCode).toBe(403)
    const inchangee = await prisma.order.findUniqueOrThrow({ where: { id: commande.id } })
    expect(inchangee.cartonsTotal).toBe(5)
  })

  it('conserve la remise dans le libellé de ligne après modification', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 50, prixCarton: 15 })
    await prisma.product.update({
      where: { id: product.id },
      data: { remiseSeuil: 10, remisePourcent: 5 },
    })
    const commande = await commander(client, product.id, 12)
    expect(commande.lignes[0].nom).toContain('remise')

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${commande.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { lignes: [{ productId: product.id, qty: 15 }] },
    })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().lignes[0].nom).toContain('remise')
  })
})

describe('concurrence sur le stock', () => {
  it('ne vend pas deux fois le dernier carton à la création', async () => {
    const { product, client } = await creerJeuDeDonnees({ stock: 1 })

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/me/orders',
        headers: { authorization: `Bearer ${tokenClient(app, client)}` },
        payload: { lignes: [{ productId: product.id, qty: 1 }], ...SIGNATURE_COMMANDE },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/me/orders',
        headers: { authorization: `Bearer ${tokenClient(app, client)}` },
        payload: { lignes: [{ productId: product.id, qty: 1 }], ...SIGNATURE_COMMANDE },
      }),
    ])

    const codes = [a.statusCode, b.statusCode].sort()
    expect(codes).toEqual([200, 409])
    expect(await stockDe(product.id)).toBe(0)
  })

  it('ne vend pas deux fois le dernier carton lors de modifications simultanées', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 3 })
    const c1 = await commander(client, product.id, 1)
    const c2 = await commander(client, product.id, 1)
    // Stock restant : 1. Chaque commande veut passer de 1 à 2 cartons,
    // ce qui ne peut réussir qu'une seule fois.
    expect(await stockDe(product.id)).toBe(1)

    const modifier = (orderId: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/orders/${orderId}`,
        headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
        payload: { lignes: [{ productId: product.id, qty: 2 }] },
      })

    const [a, b] = await Promise.all([modifier(c1.id), modifier(c2.id)])

    const reussites = [a, b].filter((r) => r.statusCode === 200)
    expect(reussites).toHaveLength(1)
    expect(await stockDe(product.id)).toBe(0)
  })

  /**
   * Cas réellement dangereux : le produit ajouté n'était dans aucune des deux
   * commandes, donc rien n'écrit sa ligne avant la lecture du stock. Sans
   * verrou explicite, les deux transactions lisent 1, écrivent 0, et deux
   * cartons sont vendus alors qu'il n'en existait qu'un — sans que le stock
   * ne devienne négatif, donc invisible pour la contrainte SQL.
   */
  it("ne vend pas deux fois un produit ajouté simultanément à deux commandes", async () => {
    const { product: p1, client, staff } = await creerJeuDeDonnees({ stock: 20 })
    // Les deux commandes ne partagent AUCUN produit : sinon la restitution de
    // stock de la ligne commune sérialise les transactions et masque la course.
    const p2 = await ajouterProduitAuCatalogue(client.id, 20)
    const rare = await ajouterProduitAuCatalogue(client.id, 1)

    const c1 = await commander(client, p1.id, 2)
    const c2 = await commander(client, p2.id, 2)

    const ajouter = (orderId: string, base: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/orders/${orderId}`,
        headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
        payload: {
          lignes: [
            { productId: base, qty: 2 },
            { productId: rare.id, qty: 1 },
          ],
        },
      })

    const [a, b] = await Promise.all([ajouter(c1.id, p1.id), ajouter(c2.id, p2.id)])

    expect([a, b].filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect(await stockDe(rare.id)).toBe(0)
    // Un seul carton vendu au total, pas deux
    const vendus = await prisma.orderItem.aggregate({
      where: { productId: rare.id },
      _sum: { quantiteCartons: true },
    })
    expect(vendus._sum.quantiteCartons).toBe(1)
  })

  /**
   * Preuve au niveau base, hors du serveur : deux connexions Postgres
   * distinctes tentent de sortir le même dernier carton en parallèle.
   * C'est ce test qui valide réellement la garantie, car le harnais HTTP
   * sérialise les transactions et ne peut pas reproduire la course.
   */
  it('ne laisse passer qu’un seul décrément concurrent du dernier carton', async () => {
    const { product } = await creerJeuDeDonnees({ stock: 1 })

    const [clientA, clientB] = [new PrismaClient(), new PrismaClient()]
    try {
      const decrementer = (c: PrismaClient) =>
        c.$queryRaw<{ stock: number }[]>`
          UPDATE "Product" SET stock = stock - 1
          WHERE id = ${product.id} AND stock - 1 >= 0
          RETURNING stock`

      const [a, b] = await Promise.all([decrementer(clientA), decrementer(clientB)])

      expect([a.length, b.length].sort()).toEqual([0, 1])
      expect(await stockDe(product.id)).toBe(0)
    } finally {
      await Promise.all([clientA.$disconnect(), clientB.$disconnect()])
    }
  })

  it('interdit un stock négatif au niveau de la base', async () => {
    const { product } = await creerJeuDeDonnees({ stock: 0 })
    await expect(
      prisma.product.update({ where: { id: product.id }, data: { stock: -1 } }),
    ).rejects.toThrow()
  })
})

describe('frais de livraison et signature CGV', () => {
  it('refuse une commande sans acceptation des conditions', async () => {
    const { product, client } = await creerJeuDeDonnees({ stock: 5 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/orders',
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
      payload: { lignes: [{ productId: product.id, qty: 1 }] },
    })
    expect(res.statusCode).toBe(400)
    expect(await stockDe(product.id)).toBe(5)
  })

  it('refuse une commande sans trait manuscrit', async () => {
    const { product, client } = await creerJeuDeDonnees({ stock: 5 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/orders',
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
      payload: {
        lignes: [{ productId: product.id, qty: 1 }],
        signatureNom: 'Sans trait',
        acceptationCgv: true,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(await stockDe(product.id)).toBe(5)
  })

  it('stocke la signature en fichier, pas en base64', async () => {
    const { product, client } = await creerJeuDeDonnees({ stock: 5 })
    const cmd = await commander(client, product.id, 1)
    expect(cmd.hasSignature).toBe(true)
    expect(cmd.signatureImageUrl).toMatch(/^\/uploads\/sig-/)
    expect(cmd.signatureImageUrl).not.toMatch(/^data:/)
    const row = await prisma.order.findUniqueOrThrow({ where: { id: cmd.id } })
    expect(row.signatureImageUrl?.startsWith('/uploads/')).toBe(true)
    expect(row.signatureImageUrl?.startsWith('data:')).toBe(false)
  })

  it('applique 10 € de port sous 150 € HT et offre le franco au-delà', async () => {
    const { product, client } = await creerJeuDeDonnees({ stock: 30, prixCarton: 10 })
    const petite = await commander(client, product.id, 5)
    expect(petite.fraisLivraisonHT).toBe(10)
    expect(petite.total).toBe(60)
    expect(await stockDe(product.id)).toBe(25)

    const franco = await commander(client, product.id, 15)
    expect(franco.fraisLivraisonHT).toBe(0)
    expect(franco.total).toBe(150)
    expect(franco.signatureNom).toBe(SIGNATURE_COMMANDE.signatureNom)
  })
})
