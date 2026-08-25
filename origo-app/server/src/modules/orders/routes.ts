import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { mapOrder } from '../../lib/mappers.js'
import { signerUrlUpload } from '../../lib/uploads.js'
import { requireClient, requireStaff, authenticate } from '../../plugins/auth.js'
import { pdfBonOdoo, pdfFactureOdoo } from '../../lib/odoo/documents.js'
import { confirmerPaiementStripe } from '../../lib/stripe.js'
import { lireSociete } from '../../lib/societe.js'
import * as orders from './service.js'

const lignesSchema = z.object({
  lignes: z.array(
    z.object({
      productId: z.string().min(1),
      qty: z.coerce.number().int().positive(),
    }),
  ),
})

export async function orderRoutes(app: FastifyInstance) {
  app.get('/api/v1/orders', { preHandler: requireStaff('DIRECTION', 'PREPARATION', 'LIVREUR') }, async () => {
    return orders.listerToutesCommandes()
  })

  /** Détail (ex. ancienne photo base64 encore en base) */
  app.get('/api/v1/orders/:id', { preHandler: requireStaff('DIRECTION', 'PREPARATION', 'LIVREUR') }, async (req) => {
    const { id } = req.params as { id: string }
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        client: { select: { nom: true, ville: true, adresse: true, telephone: true, email: true, numeroTva: true } },
        retours: { include: { lignes: true } },
      },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    const mapped = mapOrder(order)
    // Cette route court-circuite volontairement photoForList pour renvoyer les
    // anciennes photos base64 encore en base. Il faut donc signer ici aussi :
    // signerUrlUpload laisse les data: intactes et ne signe que les chemins fichier.
    const photo = order.photoLivraisonUrl ? signerUrlUpload(order.photoLivraisonUrl) : null
    return {
      ...mapped,
      photoLivraison: photo,
      photoLivraisonUrl: photo,
      hasPhotoLivraison: !!photo,
    }
  })

  app.get('/api/v1/me/orders', { preHandler: requireClient }, async (req) => {
    return orders.listerCommandesClient(req.user.sub)
  })

  app.post('/api/v1/me/orders', { preHandler: requireClient }, async (req) => {
    const parsed = lignesSchema
      .extend({
        signatureNom: z.string().trim().min(2, 'Indiquez votre nom'),
        acceptationCgv: z
          .union([z.literal(true), z.literal('true'), z.literal(1)])
          .transform(() => true as const),
        signatureImage: z
          .string()
          .min(80, 'Signez le bon de commande')
          .refine((v) => v.startsWith('data:image/'), 'Signez le bon de commande'),
      })
      .safeParse(req.body)
    if (!parsed.success) {
      const champs = parsed.error.flatten().fieldErrors
      if (champs.signatureNom || champs.acceptationCgv || champs.signatureImage) {
        throw new ValidationError(
          'Il faut accepter les conditions et signer le bon de commande',
          parsed.error.flatten(),
        )
      }
      throw new ValidationError('Lignes invalides', parsed.error.flatten())
    }
    return orders.creerCommande(req.user.sub, parsed.data.lignes, {
      nom: parsed.data.signatureNom,
      acceptationCgv: parsed.data.acceptationCgv,
      image: parsed.data.signatureImage,
    })
  })

  app.get('/api/v1/me/orders/:id/paiement', { preHandler: requireClient }, async (req) => {
    const { id } = req.params as { id: string }
    const order = await prisma.order.findUnique({ where: { id }, select: { clientId: true } })
    if (!order) throw new NotFoundError('Commande introuvable')
    if (order.clientId !== req.user.sub) throw new NotFoundError('Commande introuvable')
    return confirmerPaiementStripe(id)
  })

  app.get('/api/v1/orders/:id/document', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const type = (req.query as { type?: string }).type === 'facture' ? 'facture' : 'bon'
    const order = await prisma.order.findUnique({
      where: { id },
      select: { clientId: true, odooId: true, odooFactureId: true, numero: true, odooNom: true },
    })
    if (!order) throw new NotFoundError('Commande introuvable')
    const user = req.user
    if (user.typ === 'client' && user.sub !== order.clientId) throw new NotFoundError('Commande introuvable')
    if (user.typ === 'staff' && !['DIRECTION', 'PREPARATION', 'LIVREUR'].includes(user.role)) {
      throw new ForbiddenError()
    }

    let pdf: Buffer | null = null
    const societe = await lireSociete()
    if (type === 'facture' && order.odooFactureId && societe.factureLegale) {
      pdf = await pdfFactureOdoo(order.odooFactureId)
    } else if (type === 'bon' && order.odooId) {
      pdf = await pdfBonOdoo(order.odooId)
    }
    if (!pdf) return reply.code(204).send()

    const nom = order.odooNom || order.numero
    const fichier = `${type === 'facture' && societe.factureLegale ? 'Facture' : type === 'facture' ? 'Releve' : 'Bon'}-${nom}.pdf`
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${fichier}"`)
      .send(pdf)
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
    const parsed = z
      .object({ remiseEnStock: z.boolean().optional() })
      .safeParse(req.body ?? {})
    if (!parsed.success) throw new ValidationError('remiseEnStock invalide')
    return orders.annulerCommande(id, null, true, parsed.data.remiseEnStock)
  })

  /**
   * ANNULEE n'est volontairement pas acceptée ici : cette route ne sait pas
   * quoi faire du stock. L'annulation passe par POST /annuler, réservée à la
   * direction. Avant, un livreur pouvait annuler par ce biais en laissant le
   * stock débité.
   */
  app.patch('/api/v1/orders/:id/statut', { preHandler: requireStaff('DIRECTION', 'PREPARATION', 'LIVREUR') }, async (req) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      statut: z.enum(['PREPAREE', 'EN_LIVRAISON', 'LIVREE', 'LIVREE_PARTIELLEMENT', 'CONFIRMEE']),
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
    if (user.typ !== 'staff') throw new ValidationError('Statut réservé au staff')

    const { statut } = parsed.data
    if (statut === 'PREPAREE' && user.role === 'LIVREUR') {
      throw new ForbiddenError('Seul la préparation (ou la direction) peut accepter une commande')
    }
    if (
      (statut === 'LIVREE' || statut === 'LIVREE_PARTIELLEMENT') &&
      user.role === 'PREPARATION'
    ) {
      throw new ForbiddenError('Seul le livreur (ou la direction) peut confirmer une livraison')
    }

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
