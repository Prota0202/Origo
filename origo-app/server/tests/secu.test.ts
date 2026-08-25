import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { persistImageField } from '../src/lib/uploads.js'
import { incrementerSession } from '../src/lib/session.js'
import {
  SIGNATURE_COMMANDE,
  creerJeuDeDonnees,
  prisma,
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

describe('session cookie httpOnly', () => {
  it('pose un cookie au login et l’accepte sans Authorization', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { code: client.code, motDePasse: 'motdepasse-test' },
    })
    expect(login.statusCode, login.body).toBe(200)
    expect(login.json().token).toBeUndefined()
    const session = login.cookies.find((c) => c.name === 'origo_session')
    expect(session?.value).toBeTruthy()
    expect(session?.httpOnly).toBe(true)

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { origo_session: session!.value },
    })
    expect(me.statusCode, me.body).toBe(200)
    expect(me.json().id).toBe(client.id)

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { origo_session: session!.value },
    })
    expect(logout.statusCode).toBe(200)
  })

  it('accepte encore un Bearer (tests / outils)', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
    })
    expect(me.statusCode).toBe(200)
  })

  it('invalide l’ancien cookie après increment de session', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { code: client.code, motDePasse: 'motdepasse-test' },
    })
    const cookie = login.cookies.find((c) => c.name === 'origo_session')!.value
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { origo_session: cookie } }))
        .statusCode,
    ).toBe(200)

    await incrementerSession('client', client.id)

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { origo_session: cookie } }))
        .statusCode,
    ).toBe(401)
  })
})

describe('surfaces publiques', () => {
  it('GET /ready ne révèle ni Odoo ni backups', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, db: 'up' })
  })

  it('n’envoie pas le flatten Zod au client', async () => {
    const { staff } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { nom: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().details).toBeUndefined()
  })
})

describe('IDOR / catalogue', () => {
  it('répond 404 (pas 403) si un client vise la commande d’un autre', async () => {
    const a = await creerJeuDeDonnees({ stock: 5 })
    const b = await creerJeuDeDonnees({ stock: 5 })
    const creation = await app.inject({
      method: 'POST',
      url: '/api/v1/me/orders',
      headers: { authorization: `Bearer ${tokenClient(app, a.client)}` },
      payload: { lignes: [{ productId: a.product.id, qty: 1 }], ...SIGNATURE_COMMANDE },
    })
    expect(creation.statusCode, creation.body).toBe(200)
    const id = creation.json().id

    const paiement = await app.inject({
      method: 'GET',
      url: `/api/v1/me/orders/${id}/paiement`,
      headers: { authorization: `Bearer ${tokenClient(app, b.client)}` },
    })
    expect(paiement.statusCode).toBe(404)

    const doc = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${id}/document?type=bon`,
      headers: { authorization: `Bearer ${tokenClient(app, b.client)}` },
    })
    expect(doc.statusCode).toBe(404)
  })

  it('cache un produit inactif aux clients', async () => {
    const { product, client, staff } = await creerJeuDeDonnees({ stock: 1 })
    await prisma.product.update({ where: { id: product.id }, data: { actif: false } })

    const vuClient = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${product.id}`,
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
    })
    expect(vuClient.statusCode).toBe(404)

    const vuStaff = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${product.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
    })
    expect(vuStaff.statusCode).toBe(200)
  })
})

describe('uploads', () => {
  it('refuse une URL externe et un faux data URL', async () => {
    await expect(persistImageField('https://evil.example/x.png', 'x')).rejects.toThrow(/uploads/)
    await expect(
      persistImageField('data:image/png;base64,PGh0bWw+c2NyaXB0PC9odG1sPg==', 'x'),
    ).rejects.toThrow(/reconnu/)
  })
})
