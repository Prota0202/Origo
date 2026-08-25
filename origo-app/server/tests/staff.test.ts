import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { tvaAffichable } from '../src/lib/societe.js'
import { creerJeuDeDonnees, prisma, tokenStaff } from './aide.js'

describe('n° TVA placeholder', () => {
  it('n’affiche jamais BE0000000000 sur un document', () => {
    expect(tvaAffichable('')).toBe('')
    expect(tvaAffichable('BE0000000000')).toBe('')
    expect(tvaAffichable('BE 0123.456.749')).toBe('BE 0123.456.749')
  })
})

describe('comptes staff et fiche société', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  it('permet à la direction de créer un livreur', async () => {
    const { staff } = await creerJeuDeDonnees({ stock: 1 })
    const suffixe = Math.random().toString(36).slice(2, 8).toUpperCase()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/staff',
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {
        code: `LIV${suffixe}`,
        nom: 'Livreur test',
        role: 'livreur',
        motDePasse: 'motdepasse-test',
      },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().role).toBe('livreur')
  })

  it('refuse de retirer le dernier compte direction', async () => {
    const { staff } = await creerJeuDeDonnees({ stock: 1 })
    await prisma.staff.updateMany({
      where: { role: 'DIRECTION', id: { not: staff.id } },
      data: { actif: false },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/${staff.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { actif: false },
    })
    expect(res.statusCode).toBe(409)
  })

  it('masque le placeholder TVA sur GET /company', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/company' })
    expect(res.statusCode).toBe(200)
    expect(res.json().vat).not.toBe('BE0000000000')
    expect(res.json().factureLegale).toBe(Boolean(res.json().vat))
    expect(res.json().mdpMinCaracteres).toBe(8)
  })
})
