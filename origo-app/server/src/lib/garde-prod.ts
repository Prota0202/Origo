/**
 * En production : un dump de la base locale (BOMBAY / 1234) ne doit pas
 * laisser commander un faux restaurant. Les comptes démo sont désactivés ;
 * un compte direction encore en `admin2026` doit changer son mot de passe
 * avant d'ouvrir l'app.
 */
import type { FastifyBaseLogger } from 'fastify'
import { env } from '../config/env.js'
import { prisma } from './prisma.js'
import { verifierMotDePasse } from './password.js'
import { MOTS_DE_PASSE_INTERDITS } from './mot-de-passe.js'

const CLIENTS_DEMO = ['BOMBAY', 'MARCO']
const STAFF_DEMO = ['PREPA', 'LIVREUR']

async function hashEstUnDemo(hash: string) {
  for (const clair of MOTS_DE_PASSE_INTERDITS) {
    if (await verifierMotDePasse(clair, hash)) return true
  }
  return false
}

export async function appliquerGardeProd(log: FastifyBaseLogger) {
  if (!env.isProd) return

  const clients = await prisma.client.findMany({
    where: { code: { in: CLIENTS_DEMO }, actif: true },
    select: { id: true, code: true },
  })
  if (clients.length > 0) {
    await prisma.client.updateMany({
      where: { id: { in: clients.map((c) => c.id) } },
      data: { actif: false },
    })
    log.warn(
      `Comptes restaurants démo désactivés : ${clients.map((c) => c.code).join(', ')}. Crée les vrais clients depuis l'admin.`,
    )
  }

  const staffDemo = await prisma.staff.findMany({
    where: { code: { in: STAFF_DEMO }, actif: true },
    select: { id: true, code: true, motDePasseHash: true },
  })
  for (const s of staffDemo) {
    if (await hashEstUnDemo(s.motDePasseHash)) {
      await prisma.staff.update({ where: { id: s.id }, data: { actif: false } })
      log.warn(`Compte staff démo ${s.code} désactivé (mot de passe de seed).`)
    }
  }

  const direction = await prisma.staff.findMany({
    where: { role: 'DIRECTION', actif: true },
    select: { id: true, code: true, motDePasseHash: true, mdpAChanger: true },
  })
  for (const s of direction) {
    if (await hashEstUnDemo(s.motDePasseHash)) {
      await prisma.staff.update({ where: { id: s.id }, data: { mdpAChanger: true } })
      log.warn(
        `Compte direction ${s.code} a encore un mot de passe de démo — il devra le changer à la connexion.`,
      )
    }
  }
}
