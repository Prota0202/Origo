import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { creerJeuDeDonnees, prisma, tokenClient, tokenStaff } from './aide.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

describe('PATCH /api/v1/me/mot-de-passe', () => {
  it('refuse un nouveau mot de passe trop court', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/mot-de-passe',
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
      payload: { actuel: 'motdepasse-test', nouveau: '1234' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuse le mot de passe actuel faux', async () => {
    const { staff } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/mot-de-passe',
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { actuel: 'mauvais', nouveau: 'nouveau-secret' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('met à jour le mot de passe d’un restaurant', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/mot-de-passe',
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
      payload: { actuel: 'motdepasse-test', nouveau: 'nouveau-secret' },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().token).toBeTruthy()
    expect(res.json().user.mdpAChanger).toBe(false)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { code: client.code, motDePasse: 'nouveau-secret' },
    })
    expect(login.statusCode, login.body).toBe(200)
  })

  it('refuse un mot de passe de démo', async () => {
    const { client } = await creerJeuDeDonnees({ stock: 1 })
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/mot-de-passe',
      headers: { authorization: `Bearer ${tokenClient(app, client)}` },
      payload: { actuel: 'motdepasse-test', nouveau: 'admin2026' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('bloque le reste de l’API tant que le mot de passe n’est pas changé', async () => {
    const { client, product } = await creerJeuDeDonnees({ stock: 5 })
    await prisma.client.update({ where: { id: client.id }, data: { mdpAChanger: true } })
    const token = app.jwt.sign({
      typ: 'client',
      sub: client.id,
      code: client.code,
      nom: client.nom,
      mdpAChanger: true,
    })

    const commande = await app.inject({
      method: 'POST',
      url: '/api/v1/me/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: { lignes: [{ productId: product.id, qty: 1 }] },
    })
    expect(commande.statusCode).toBe(403)
    expect(commande.json().error).toBe('MDP_A_CHANGER')

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.statusCode).toBe(200)
  })
})
