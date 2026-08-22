import { afterAll, describe, expect, it } from 'vitest'
import { env } from '../src/config/env.js'
import { lancerPrelevementsSepa } from '../src/lib/sepa.js'
import { creerJeuDeDonnees, prisma } from './aide.js'

describe('lancerPrelevementsSepa', () => {
  afterAll(async () => {
    env.stripe.actif = false
    env.stripe.secretKey = ''
  })

  it('ne débite rien sans clé Stripe', async () => {
    env.stripe.actif = false
    const r = await lancerPrelevementsSepa({ forcer: true })
    expect(r.raison).toBe('stripe_inactif')
    expect(r.preleves).toBe(0)
  })

  it('crée un PaymentIntent pour les commandes livrées d’un client mandaté', async () => {
    const { client, product } = await creerJeuDeDonnees({ stock: 5 })
    await prisma.client.update({
      where: { id: client.id },
      data: {
        modePaiement: 'sepa',
        stripeCustomerId: `cus_${client.id.slice(0, 8)}`,
        stripeSepaPaymentMethodId: `pm_${client.id.slice(0, 8)}`,
        sepaIbanLast4: '1234',
        sepaMandatAccepteLe: new Date(),
      },
    })
    await prisma.order.create({
      data: {
        numero: `CMD-SEPA-${client.id.slice(0, 6)}`,
        clientId: client.id,
        statut: 'LIVREE',
        payee: false,
        cartonsTotal: 1,
        totalHT: 100,
        items: {
          create: [{ productId: product.id, nomSnapshot: 'x', quantiteCartons: 1, prixUnitaire: 100 }],
        },
      },
    })

    env.stripe.actif = true
    env.stripe.secretKey = 'sk_test_sepa'
    const orig = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'pi_test_sepa', status: 'processing' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch

    try {
      const r = await lancerPrelevementsSepa({ forcer: true })
      expect(r.preleves).toBe(1)
      const prelev = await prisma.prelevementSepa.findFirst({ where: { clientId: client.id } })
      expect(prelev?.statut).toBe('envoye')
      expect(prelev?.stripePaymentIntentId).toBe('pi_test_sepa')
    } finally {
      globalThis.fetch = orig
      env.stripe.actif = false
      env.stripe.secretKey = ''
    }
  })
})
