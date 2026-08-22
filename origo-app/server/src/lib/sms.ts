/**
 * SMS transactionnels (statuts commande). Désactivé tant que TWILIO_* manque :
 * une commande ne doit jamais échouer parce que le SMS n'est pas branché.
 */
import { env } from '../config/env.js'
import { prisma } from './prisma.js'

const MESSAGES: Record<string, (numero: string) => string> = {
  CONFIRMEE: (n) => `ORIGO : commande ${n} confirmée. Prélèvement SEPA le 15 et le dernier jour du mois, sauf paiement carte.`,
  PREPAREE: (n) => `ORIGO : votre commande ${n} est en préparation.`,
  EN_LIVRAISON: (n) => `ORIGO : votre commande ${n} est en livraison.`,
  LIVREE: (n) => `ORIGO : votre commande ${n} a été livrée.`,
  LIVREE_PARTIELLEMENT: (n) => `ORIGO : votre commande ${n} a été livrée (partiellement).`,
  ANNULEE: (n) => `ORIGO : commande ${n} annulée.`,
}

function normaliserGsmBelge(brut: string) {
  const compact = brut.replace(/[\s./-]/g, '')
  if (compact.startsWith('+')) return compact
  if (compact.startsWith('00')) return `+${compact.slice(2)}`
  if (compact.startsWith('0')) return `+32${compact.slice(1)}`
  return compact
}

export async function notifierSmsStatut(orderId: string, statut: string) {
  if (!env.sms.actif) return
  const textePour = MESSAGES[statut]
  if (!textePour) return

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      numero: true,
      client: { select: { telephone: true } },
    },
  })
  const tel = order?.client.telephone?.trim()
  if (!order || !tel) return

  const to = normaliserGsmBelge(tel)
  const body = textePour(order.numero)
  const auth = Buffer.from(`${env.sms.accountSid}:${env.sms.token}`).toString('base64')
  const params = new URLSearchParams({
    To: to,
    From: env.sms.from,
    Body: body,
  })

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.sms.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`[origo] SMS Twilio HTTP ${res.status} ${detail.slice(0, 200)}`)
    }
  } catch (e) {
    console.error('[origo] SMS non envoyé', e instanceof Error ? e.message : e)
  }
}
