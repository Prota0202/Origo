/**
 * Prélèvements SEPA : le 15 et le dernier jour du mois (Europe/Bruxelles).
 *
 * Un mandat Stripe (IBAN) est requis. Sans STRIPE_SECRET_KEY, rien n'est
 * débité — les commandes restent dues. Les prélèvements portent sur les
 * commandes livrées non payées ; le SEPA Stripe est asynchrone (souvent 2–5 j).
 */
import type { FastifyBaseLogger } from 'fastify'
import { env } from '../config/env.js'
import { toNum } from './money.js'
import { prisma } from './prisma.js'
import { clePeriode, estJourPrelevement } from './sepa-calendrier.js'
import { creerPaiementSepa } from './stripe.js'

const STATUTS_LIVRES = ['LIVREE', 'LIVREE_PARTIELLEMENT'] as const
const INTERVALLE_MS = 30 * 60 * 1000

let minuteur: NodeJS.Timeout | undefined

export async function lancerPrelevementsSepa(opts: { forcer?: boolean; maintenant?: Date } = {}) {
  const maintenant = opts.maintenant ?? new Date()
  if (!env.stripe.actif) {
    return { ok: false, raison: 'stripe_inactif', preleves: 0 }
  }
  if (!opts.forcer && !estJourPrelevement(maintenant)) {
    return { ok: true, raison: 'pas_le_jour', preleves: 0 }
  }

  const periode = clePeriode(maintenant)
  const clients = await prisma.client.findMany({
    where: {
      actif: true,
      modePaiement: 'sepa',
      stripeSepaPaymentMethodId: { not: null },
      stripeCustomerId: { not: null },
    },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeSepaPaymentMethodId: true,
    },
  })

  let preleves = 0
  const erreurs: { clientId: string; message: string }[] = []

  for (const client of clients) {
    try {
      const fait = await preleverClient(client, periode)
      if (fait) preleves += 1
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 400) : String(e)
      erreurs.push({ clientId: client.id, message })
    }
  }

  return { ok: erreurs.length === 0, raison: 'ok', periode, preleves, erreurs }
}

async function preleverClient(
  client: { id: string; stripeCustomerId: string | null; stripeSepaPaymentMethodId: string | null },
  periode: string,
) {
  const existant = await prisma.prelevementSepa.findUnique({
    where: { clientId_periodeCle: { clientId: client.id, periodeCle: periode } },
  })
  if (existant && (existant.statut === 'paye' || existant.statut === 'envoye')) {
    return false
  }

  const commandes = await prisma.order.findMany({
    where: {
      clientId: client.id,
      payee: false,
      statut: { in: [...STATUTS_LIVRES] },
      OR: [
        { prelevementSepaId: null },
        { prelevementSepa: { statut: 'echec' } },
        ...(existant ? [{ prelevementSepaId: existant.id }] : []),
      ],
    },
    select: { id: true, totalHT: true, numero: true },
  })
  if (commandes.length === 0) return false

  const montantCents = commandes.reduce((s, o) => {
    return s + Math.round(toNum(o.totalHT) * (1 + env.company.tvaRate) * 100)
  }, 0)
  if (montantCents <= 0) return false

  const row =
    existant ??
    (await prisma.prelevementSepa.create({
      data: {
        clientId: client.id,
        periodeCle: periode,
        montantCents,
        statut: 'attente',
        commandes: { connect: commandes.map((c) => ({ id: c.id })) },
      },
    }).catch(async (e: { code?: string }) => {
      if (e.code !== 'P2002') throw e
      return prisma.prelevementSepa.findUniqueOrThrow({
        where: { clientId_periodeCle: { clientId: client.id, periodeCle: periode } },
      })
    }))

  if (row.statut === 'paye' || row.statut === 'envoye') return false

  if (existant) {
    await prisma.order.updateMany({
      where: { id: { in: commandes.map((c) => c.id) } },
      data: { prelevementSepaId: row.id },
    })
    await prisma.prelevementSepa.update({
      where: { id: row.id },
      data: { montantCents, statut: 'attente', erreur: null },
    })
  }

  if (!client.stripeCustomerId || !client.stripeSepaPaymentMethodId) return false

  const pi = await creerPaiementSepa({
    customerId: client.stripeCustomerId,
    paymentMethodId: client.stripeSepaPaymentMethodId,
    montantCents,
    metadata: {
      kind: 'sepa_prelevement',
      prelevementId: row.id,
      clientId: client.id,
      periode,
    },
  })

  const payeToutDeSuite = pi.status === 'succeeded'
  await prisma.prelevementSepa.update({
    where: { id: row.id },
    data: {
      stripePaymentIntentId: pi.id,
      statut: payeToutDeSuite ? 'paye' : 'envoye',
    },
  })
  if (payeToutDeSuite) {
    await prisma.order.updateMany({
      where: { prelevementSepaId: row.id },
      data: { payee: true },
    })
  }
  return true
}

export async function marquerPrelevementPaye(prelevementId: string) {
  await prisma.prelevementSepa.updateMany({
    where: { id: prelevementId },
    data: { statut: 'paye', erreur: null },
  })
  await prisma.order.updateMany({
    where: { prelevementSepaId: prelevementId },
    data: { payee: true },
  })
}

export async function marquerPrelevementPayeParIntent(paymentIntentId: string) {
  const row = await prisma.prelevementSepa.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
  })
  if (row) await marquerPrelevementPaye(row.id)
}

export async function marquerPrelevementEchec(paymentIntentId: string, erreur: string) {
  await prisma.prelevementSepa.updateMany({
    where: { stripePaymentIntentId: paymentIntentId },
    data: { statut: 'echec', erreur: erreur.slice(0, 500) },
  })
}

export function demarrerPrelevementsSepa(log: FastifyBaseLogger) {
  if (env.nodeEnv === 'test') return
  const tick = () => {
    void lancerPrelevementsSepa()
      .then((r) => {
        if (r.preleves > 0) log.info(r, 'SEPA : prélèvements lancés')
        if (r.erreurs?.length) log.error(r, 'SEPA : certains prélèvements ont échoué')
      })
      .catch((err) => log.error({ err }, 'SEPA : job prélèvement'))
  }
  tick()
  minuteur = setInterval(tick, INTERVALLE_MS)
  minuteur.unref()
}

export function arreterPrelevementsSepa() {
  if (minuteur) clearInterval(minuteur)
  minuteur = undefined
}
