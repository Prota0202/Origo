import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { verifierSignatureStripe } from '../src/lib/stripe.js'
import { creerJeuDeDonnees, prisma } from './aide.js'

const SECRET = 'whsec_test_origo_hmac'

function signer(corps: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')
  return { header: `t=${t},v1=${v1}`, t }
}

let app: FastifyInstance
let secretAvant = ''

beforeAll(async () => {
  secretAvant = env.stripe.webhookSecret
  env.stripe.webhookSecret = SECRET
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  env.stripe.webhookSecret = secretAvant
  await app.close()
  await prisma.$disconnect()
})

describe('signature Stripe', () => {
  it('accepte un HMAC v1 dans la fenêtre de 5 min', () => {
    const corps = '{"ok":true}'
    const { header } = signer(corps)
    expect(verifierSignatureStripe(corps, header, SECRET)).toBe(true)
  })

  it('refuse une signature falsifiée', () => {
    const corps = '{"ok":true}'
    const { header } = signer(corps, 'autre-secret')
    expect(verifierSignatureStripe(corps, header, SECRET)).toBe(false)
  })
})

describe('POST /api/v1/stripe/webhook', () => {
  it('refuse le GET (pas de notice publique)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/stripe/webhook' })
    expect(res.statusCode).toBe(405)
    expect(res.json().methode).toBeUndefined()
  })

  it('marque la commande payée sans JWT', async () => {
    const { client, product } = await creerJeuDeDonnees({ stock: 5 })
    const order = await prisma.order.create({
      data: {
        numero: `CMD-WH-${randomUUID().slice(0, 8)}`,
        clientId: client.id,
        cartonsTotal: 1,
        totalHT: 10,
        payee: false,
        items: {
          create: [{ productId: product.id, nomSnapshot: 'x', quantiteCartons: 1, prixUnitaire: 10 }],
        },
      },
    })
    const corps = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${order.id}`,
          payment_status: 'paid',
          metadata: { orderId: order.id },
        },
      },
    })
    const { header } = signer(corps)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload: corps,
    })
    expect(res.statusCode, res.body).toBe(200)
    const relue = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(relue.payee).toBe(true)
    expect(relue.stripeSessionId).toBe(`cs_test_${order.id}`)
  })

  it('répond 400 si la signature manque', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: '{"type":"checkout.session.completed"}',
    })
    expect(res.statusCode).toBe(400)
  })
})
