import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireClient, requireStaff } from '../../plugins/auth.js'
import * as orders from './service.js'

const lignesSchema = z.object({
  lignes: z.array(
    z.object({
      productId: z.string(),
      qty: z.number().int().positive(),
    }),
  ),
})

export async function orderRoutes(app: FastifyInstance) {
  app.get('/api/v1/orders', { preHandler: requireStaff('DIRECTION', 'PREPARATION', 'LIVREUR') }, async () => {
    return orders.listerToutesCommandes()
  })

  app.get('/api/v1/me/orders', { preHandler: requireClient }, async (req) => {
    return orders.listerCommandesClient(req.user.sub)
  })

  app.post('/api/v1/me/orders', { preHandler: requireClient }, async (req) => {
    const parsed = lignesSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Lignes invalides', parsed.error.flatten())
    return orders.creerCommande(req.user.sub, parsed.data.lignes)
  })

  app.post('/api/v1/me/orders/:id/annuler', { preHandler: requireClient }, async (req) => {
    const { id } = req.params as { id: string }
    return orders.annulerCommande(id, req.user.sub, false)
  })

  app.patch('/api/v1/me/orders/:id', { preHandler: requireClient }, async (req) => {
    const { id } = req.params as { id: string }
    const parsed = lignesSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Lignes invalides')
    return orders.modifierCommande(id, req.user.sub, parsed.data.lignes)
  })

  app.post('/api/v1/orders/:id/annuler', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    return orders.annulerCommande(id, null, true)
  })

  app.patch('/api/v1/orders/:id/statut', { preHandler: requireStaff('DIRECTION', 'PREPARATION', 'LIVREUR') }, async (req) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      statut: z.enum(['PREPAREE', 'EN_LIVRAISON', 'LIVREE', 'LIVREE_PARTIELLEMENT', 'ANNULEE', 'CONFIRMEE']),
      photoLivraisonUrl: z.string().nullable().optional(),
      noteLivraison: z.string().nullable().optional(),
      lignesLivrees: z
        .array(
          z.object({
            itemId: z.string(),
            qtyLivree: z.number().int().nonnegative().optional(),
            livree: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Statut invalide', parsed.error.flatten())

    const user = req.user
    const lignesLivrees = parsed.data.lignesLivrees?.map((l) => ({
      itemId: l.itemId,
      qtyLivree: l.qtyLivree ?? (l.livree === false ? 0 : 1),
    }))
    return orders.changerStatut(id, parsed.data.statut, {
      livreParId: user.typ === 'staff' ? user.sub : undefined,
      photoLivraisonUrl: parsed.data.photoLivraisonUrl ?? undefined,
      noteLivraison: parsed.data.noteLivraison ?? undefined,
      lignesLivrees,
    })
  })

  app.patch('/api/v1/orders/:id/payee', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ payee: z.boolean() }).safeParse(req.body)
    if (!parsed.success) throw new ValidationError('payee requis')
    return orders.setPayee(id, parsed.data.payee)
  })

  /** Modification admin (sans fenêtre 1 h) */
  app.patch('/api/v1/orders/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const parsed = lignesSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Lignes invalides')
    const order = await prisma.order.findUnique({ where: { id } })
    if (!order) throw new NotFoundError('Commande introuvable')
    return orders.modifierCommande(id, order.clientId, parsed.data.lignes, { admin: true })
  })

  app.post(
    '/api/v1/orders/:id/retours',
    { preHandler: requireStaff('DIRECTION', 'PREPARATION', 'LIVREUR') },
    async (req) => {
      const { id } = req.params as { id: string }
      const schema = z.object({
        motif: z.string().min(1),
        lignes: z.array(
          z.object({
            productId: z.string(),
            qty: z.number().int().positive(),
            remisEnStock: z.boolean(),
          }),
        ),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw new ValidationError('Retour invalide', parsed.error.flatten())
      return orders.enregistrerRetour(id, parsed.data.motif, parsed.data.lignes)
    },
  )
}
