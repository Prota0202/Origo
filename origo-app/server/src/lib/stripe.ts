/**
 * Paiement carte (Stripe Checkout) et prélèvement SEPA (mandat + PaymentIntent).
 *
 * Le retour navigateur peut rater si l'onglet se ferme : le webhook est la
 * source de vérité pour `payee` et pour l'enregistrement du mandat.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from './errors.js'
import { prisma } from './prisma.js'
import { toNum } from './money.js'

const TOLERANCE_WEBHOOK_S = 300

async function appelStripe(path: string, params?: URLSearchParams, method: 'GET' | 'POST' = 'POST') {
  const url =
    method === 'GET' && params?.toString()
      ? `https://api.stripe.com/v1${path}?${params}`
      : `https://api.stripe.com/v1${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.stripe.secretKey}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? params : undefined,
    signal: AbortSignal.timeout(15000),
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string }
    id?: string
    url?: string
    status?: string
    payment_status?: string
  }
  if (!res.ok) {
    throw new AppError(502, json.error?.message ?? `Stripe HTTP ${res.status}`, 'STRIPE')
  }
  return json
}

export async function sessionPaiementStripe(orderId: string): Promise<string | null> {
  if (!env.stripe.actif) return null

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { client: { select: { modePaiement: true, email: true } } },
  })
  if (!order || order.client.modePaiement !== 'stripe') return null

  const ttc = Math.round(toNum(order.totalHT) * (1 + env.company.tvaRate) * 100)
  if (ttc <= 0) return null

  const body = new URLSearchParams({
    mode: 'payment',
    success_url: `${env.publicUrl}/?commande=${order.id}&paye=ok`,
    cancel_url: `${env.publicUrl}/?commande=${order.id}&paye=annule`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(ttc),
    'line_items[0][price_data][product_data][name]': `ORIGO ${order.numero}`,
    'metadata[orderId]': order.id,
    'payment_intent_data[metadata][orderId]': order.id,
  })
  if (order.client.email) body.set('customer_email', order.client.email)

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error(`[origo] Stripe Checkout HTTP ${res.status} ${detail.slice(0, 200)}`)
    return null
  }
  const session = (await res.json()) as { url?: string; id?: string }
  if (session.id) {
    await prisma.order.update({ where: { id: orderId }, data: { stripeSessionId: session.id } })
  }
  return session.url ?? null
}

export async function confirmerPaiementStripe(orderId: string) {
  if (!env.stripe.actif) return { payee: false }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { stripeSessionId: true, payee: true },
  })
  if (!order?.stripeSessionId) return { payee: order?.payee === true }
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${order.stripeSessionId}`, {
    headers: { Authorization: `Bearer ${env.stripe.secretKey}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return { payee: false }
  const session = (await res.json()) as { payment_status?: string }
  const payee = session.payment_status === 'paid'
  if (payee && !order.payee) {
    await prisma.order.update({ where: { id: orderId }, data: { payee: true } })
  }
  return { payee }
}

export async function sessionMandatSepa(clientId: string): Promise<string> {
  if (!env.stripe.actif) {
    throw new AppError(503, 'Stripe n’est pas configuré : le mandat SEPA ne peut pas être signé', 'STRIPE')
  }
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { id: true, nom: true, email: true, adresse: true, stripeCustomerId: true },
  })

  let customerId = client.stripeCustomerId
  if (!customerId) {
    const params = new URLSearchParams({
      name: client.nom,
      'metadata[origoClientId]': client.id,
    })
    if (client.email) params.set('email', client.email)
    const customer = await appelStripe('/customers', params)
    customerId = String(customer.id)
    await prisma.client.update({ where: { id: client.id }, data: { stripeCustomerId: customerId } })
  }

  const body = new URLSearchParams({
    mode: 'setup',
    currency: 'eur',
    customer: customerId,
    success_url: `${env.publicUrl}/?sepa=ok`,
    cancel_url: `${env.publicUrl}/?sepa=annule`,
    'payment_method_types[0]': 'sepa_debit',
    'payment_method_options[sepa_debit][mandate_options][interval]': 'sporadic',
    'metadata[kind]': 'sepa_mandat',
    'metadata[clientId]': client.id,
    'setup_intent_data[metadata][kind]': 'sepa_mandat',
    'setup_intent_data[metadata][clientId]': client.id,
  })
  const session = await appelStripe('/checkout/sessions', body)
  if (!session.url) throw new AppError(502, 'Stripe n’a pas renvoyé d’URL de mandat', 'STRIPE')
  return session.url
}

export async function creerPaiementSepa(opts: {
  customerId: string
  paymentMethodId: string
  montantCents: number
  metadata: Record<string, string>
}) {
  if (!env.stripe.actif) {
    throw new AppError(503, 'Stripe n’est pas configuré', 'STRIPE')
  }
  const body = new URLSearchParams({
    amount: String(opts.montantCents),
    currency: 'eur',
    customer: opts.customerId,
    payment_method: opts.paymentMethodId,
    'payment_method_types[0]': 'sepa_debit',
    confirm: 'true',
    off_session: 'true',
  })
  for (const [k, v] of Object.entries(opts.metadata)) {
    body.set(`metadata[${k}]`, v)
  }
  const pi = await appelStripe('/payment_intents', body)
  return { id: String(pi.id), status: String(pi.status ?? '') }
}

async function enregistrerMandatSepa(clientId: string, customerId: string | undefined, paymentMethodId: string, last4: string, mandatId?: string) {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      stripeSepaPaymentMethodId: paymentMethodId,
      sepaIbanLast4: last4 || null,
      sepaMandatId: mandatId || paymentMethodId,
      sepaMandatAccepteLe: new Date(),
    },
  })
}

type StripeObj = {
  id?: string
  object?: string
  mode?: string
  status?: string
  payment_status?: string
  customer?: string
  payment_method?: string | { id?: string; sepa_debit?: { last4?: string } }
  setup_intent?: string | { id?: string }
  last_payment_error?: { message?: string }
  metadata?: { orderId?: string; clientId?: string; kind?: string; prelevementId?: string }
}

async function traiterMandatCheckout(session: StripeObj) {
  const clientId = session.metadata?.clientId
  if (!clientId || session.metadata?.kind !== 'sepa_mandat') return
  const setupId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id
  if (!setupId) return
  const params = new URLSearchParams({ 'expand[]': 'payment_method' })
  const setup = (await appelStripe(`/setup_intents/${setupId}`, params, 'GET')) as StripeObj & {
    payment_method?: { id?: string; sepa_debit?: { last4?: string } }
    mandate?: string
  }
  const pm = setup.payment_method
  const pmId = typeof pm === 'string' ? pm : pm?.id
  if (!pmId) return
  const last4 = typeof pm === 'object' ? pm?.sepa_debit?.last4 ?? '' : ''
  await enregistrerMandatSepa(clientId, session.customer, pmId, last4, setup.mandate)
}

async function marquerPrelevementDepuisIntent(pi: StripeObj, ok: boolean) {
  const id = pi.metadata?.prelevementId
  const intentId = pi.id
  if (ok) {
    if (id) {
      await prisma.prelevementSepa.updateMany({ where: { id }, data: { statut: 'paye', erreur: null } })
      await prisma.order.updateMany({ where: { prelevementSepaId: id }, data: { payee: true } })
      return
    }
    if (intentId) {
      const row = await prisma.prelevementSepa.findUnique({
        where: { stripePaymentIntentId: intentId },
        select: { id: true },
      })
      if (row) {
        await prisma.prelevementSepa.update({ where: { id: row.id }, data: { statut: 'paye', erreur: null } })
        await prisma.order.updateMany({ where: { prelevementSepaId: row.id }, data: { payee: true } })
      }
    }
    return
  }
  const erreur = pi.last_payment_error?.message ?? 'Prélèvement SEPA refusé'
  if (id) {
    await prisma.prelevementSepa.updateMany({ where: { id }, data: { statut: 'echec', erreur: erreur.slice(0, 500) } })
    await prisma.order.updateMany({ where: { prelevementSepaId: id }, data: { prelevementSepaId: null } })
  } else if (intentId) {
    const row = await prisma.prelevementSepa.findUnique({
      where: { stripePaymentIntentId: intentId },
      select: { id: true },
    })
    await prisma.prelevementSepa.updateMany({
      where: { stripePaymentIntentId: intentId },
      data: { statut: 'echec', erreur: erreur.slice(0, 500) },
    })
    if (row) {
      await prisma.order.updateMany({ where: { prelevementSepaId: row.id }, data: { prelevementSepaId: null } })
    }
  }
}

export function verifierSignatureStripe(rawBody: string, header: string, secret: string, maintenantS = Date.now() / 1000) {
  if (!secret || !header) return false
  const champs = new Map<string, string[]>()
  for (const morceau of header.split(',')) {
    const i = morceau.indexOf('=')
    if (i < 0) continue
    const cle = morceau.slice(0, i).trim()
    const val = morceau.slice(i + 1).trim()
    const liste = champs.get(cle) ?? []
    liste.push(val)
    champs.set(cle, liste)
  }
  const t = Number(champs.get('t')?.[0])
  const signatures = champs.get('v1') ?? []
  if (!Number.isFinite(t) || signatures.length === 0) return false
  if (Math.abs(maintenantS - t) > TOLERANCE_WEBHOOK_S) return false

  const attendu = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(attendu, 'utf8')
  return signatures.some((sig) => {
    const b = Buffer.from(sig, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  })
}

type SessionCheckout = {
  id?: string
  object?: string
  mode?: string
  payment_status?: string
  metadata?: { orderId?: string; clientId?: string; kind?: string; prelevementId?: string }
}

async function marquerPayeeDepuisSession(session: SessionCheckout) {
  if (session.mode === 'setup' || session.metadata?.kind === 'sepa_mandat') {
    await traiterMandatCheckout(session)
    return
  }
  if (session.payment_status && session.payment_status !== 'paid') return
  const orderId = session.metadata?.orderId?.trim()
  if (orderId) {
    await prisma.order.updateMany({
      where: { id: orderId },
      data: {
        payee: true,
        ...(session.id ? { stripeSessionId: session.id } : {}),
      },
    })
    return
  }
  if (session.id) {
    await prisma.order.updateMany({
      where: { stripeSessionId: session.id },
      data: { payee: true },
    })
  }
}

const EVENEMENTS_PAYES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
])

export async function traiterWebhookStripe(rawBody: string, signature: string | undefined) {
  if (!env.stripe.webhookSecret) {
    throw new AppError(503, 'Webhook Stripe non configuré', 'STRIPE_WEBHOOK')
  }
  if (!verifierSignatureStripe(rawBody, signature ?? '', env.stripe.webhookSecret)) {
    throw new AppError(400, 'Signature Stripe invalide', 'STRIPE_WEBHOOK')
  }

  let event: { type?: string; data?: { object?: SessionCheckout & StripeObj } }
  try {
    event = JSON.parse(rawBody) as { type?: string; data?: { object?: SessionCheckout & StripeObj } }
  } catch {
    throw new AppError(400, 'Webhook Stripe illisible', 'STRIPE_WEBHOOK')
  }

  const obj = event.data?.object
  if (event.type && EVENEMENTS_PAYES.has(event.type) && obj) {
    await marquerPayeeDepuisSession(obj)
  }
  if (event.type === 'setup_intent.succeeded' && obj?.metadata?.clientId && obj.metadata.kind === 'sepa_mandat') {
    const pm = obj.payment_method
    const pmId = typeof pm === 'string' ? pm : pm?.id
    if (pmId) {
      const last4 = typeof pm === 'object' ? pm?.sepa_debit?.last4 ?? '' : ''
      await enregistrerMandatSepa(obj.metadata.clientId, obj.customer, pmId, last4)
    }
  }
  if (event.type === 'payment_intent.succeeded' && obj) {
    await marquerPrelevementDepuisIntent(obj, true)
  }
  if (event.type === 'payment_intent.payment_failed' && obj) {
    await marquerPrelevementDepuisIntent(obj, false)
  }
  return { recu: true }
}
