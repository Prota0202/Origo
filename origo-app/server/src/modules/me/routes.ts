import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasherMotDePasse, verifierMotDePasse } from '../../lib/password.js'
import { assertMotDePasseAcceptable } from '../../lib/mot-de-passe.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { requireClient, requireStaff, authenticate, signerSession } from '../../plugins/auth.js'
import { ROLE_UI, mapClient } from '../../lib/mappers.js'

const clientInclude = {
  catalogue: true,
  favoris: true,
  notes: true,
  paliers: true,
} as const

/** Self-service client (/me) + demandes produit (staff). */
export async function meRoutes(app: FastifyInstance) {
  app.patch('/api/v1/me/mot-de-passe', { preHandler: authenticate }, async (req) => {
    const parsed = z
      .object({
        actuel: z.string().min(1),
        nouveau: z.string().min(1),
      })
      .safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données invalides', parsed.error.flatten())
    if (parsed.data.actuel === parsed.data.nouveau) {
      throw new ValidationError('Le nouveau mot de passe doit être différent')
    }
    assertMotDePasseAcceptable(parsed.data.nouveau)

    const { actuel, nouveau } = parsed.data
    const hash = await hasherMotDePasse(nouveau)

    if (req.user.typ === 'staff') {
      const staff = await prisma.staff.findUnique({ where: { id: req.user.sub } })
      if (!staff) throw new NotFoundError('Compte introuvable')
      if (!(await verifierMotDePasse(actuel, staff.motDePasseHash))) {
        throw new ValidationError('Mot de passe actuel incorrect')
      }
      const updated = await prisma.staff.update({
        where: { id: staff.id },
        data: { motDePasseHash: hash, mdpAChanger: false },
      })
      const token = signerSession(app, {
        typ: 'staff',
        sub: updated.id,
        role: updated.role,
        code: updated.code,
        nom: updated.nom,
        mdpAChanger: false,
      })
      return {
        ok: true,
        token,
        user: {
          type: 'staff' as const,
          id: updated.id,
          code: updated.code,
          nom: updated.nom,
          role: ROLE_UI[updated.role],
          mdpAChanger: false,
        },
      }
    }

    const client = await prisma.client.findUnique({ where: { id: req.user.sub } })
    if (!client) throw new NotFoundError('Compte introuvable')
    if (!(await verifierMotDePasse(actuel, client.motDePasseHash))) {
      throw new ValidationError('Mot de passe actuel incorrect')
    }
    const updated = await prisma.client.update({
      where: { id: client.id },
      data: { motDePasseHash: hash, mdpAChanger: false },
    })
    const token = signerSession(app, {
      typ: 'client',
      sub: updated.id,
      code: updated.code,
      nom: updated.nom,
      mdpAChanger: false,
    })
    const complet = await prisma.client.findUniqueOrThrow({
      where: { id: updated.id },
      include: clientInclude,
    })
    return {
      ok: true,
      token,
      user: { type: 'client' as const, ...mapClient(complet), mdpAChanger: false },
    }
  })

  app.put('/api/v1/me/favoris', { preHandler: requireClient }, async (req) => {
    const clientId = req.user.sub
    const parsed = z.object({ productIds: z.array(z.string()) }).safeParse(req.body)
    if (!parsed.success) throw new ValidationError('productIds requis')

    await prisma.$transaction(async (tx) => {
      await tx.clientFavori.deleteMany({ where: { clientId } })
      if (parsed.data.productIds.length > 0) {
        await tx.clientFavori.createMany({
          data: parsed.data.productIds.map((productId) => ({ clientId, productId })),
        })
      }
    })

    const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: clientInclude })
    return mapClient(c)
  })

  app.put('/api/v1/me/notes/:productId', { preHandler: requireClient }, async (req) => {
    const clientId = req.user.sub
    const { productId } = req.params as { productId: string }
    const parsed = z.object({ texte: z.string() }).safeParse(req.body)
    if (!parsed.success) throw new ValidationError('texte requis')

    if (!parsed.data.texte.trim()) {
      await prisma.clientNote.deleteMany({ where: { clientId, productId } })
    } else {
      await prisma.clientNote.upsert({
        where: { clientId_productId: { clientId, productId } },
        create: { clientId, productId, texte: parsed.data.texte },
        update: { texte: parsed.data.texte },
      })
    }

    const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: clientInclude })
    return mapClient(c)
  })

  app.post('/api/v1/me/demandes', { preHandler: requireClient }, async (req) => {
    const clientId = req.user.sub
    const parsed = z.object({ productId: z.string() }).safeParse(req.body)
    if (!parsed.success) throw new ValidationError('productId requis')

    const existing = await prisma.demandeProduit.findFirst({
      where: { clientId, productId: parsed.data.productId, traite: false },
    })
    if (existing) throw new ConflictError('Demande déjà envoyée pour ce produit')

    const d = await prisma.demandeProduit.create({
      data: { clientId, productId: parsed.data.productId },
      include: { product: true, client: true },
    })
    return {
      id: d.id,
      clientId: d.clientId,
      clientNom: d.client.nom,
      produitId: d.productId,
      produitNom: d.product.nom,
      date: d.createdAt.getTime(),
    }
  })

  app.get('/api/v1/me/demandes', { preHandler: requireClient }, async (req) => {
    const list = await prisma.demandeProduit.findMany({
      where: { clientId: req.user.sub, traite: false },
      include: { product: true, client: true },
      orderBy: { createdAt: 'desc' },
    })
    return list.map((d) => ({
      id: d.id,
      clientId: d.clientId,
      clientNom: d.client.nom,
      produitId: d.productId,
      produitNom: d.product.nom,
      date: d.createdAt.getTime(),
    }))
  })

  app.get('/api/v1/demandes', { preHandler: requireStaff('DIRECTION') }, async () => {
    const list = await prisma.demandeProduit.findMany({
      where: { traite: false },
      include: { product: true, client: true },
      orderBy: { createdAt: 'desc' },
    })
    return list.map((d) => ({
      id: d.id,
      clientId: d.clientId,
      clientNom: d.client.nom,
      produitId: d.productId,
      produitNom: d.product.nom,
      date: d.createdAt.getTime(),
    }))
  })

  app.post('/api/v1/demandes/:id/traiter', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const existing = await prisma.demandeProduit.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('Demande introuvable')
    await prisma.demandeProduit.update({ where: { id }, data: { traite: true } })
    return { ok: true }
  })
}
