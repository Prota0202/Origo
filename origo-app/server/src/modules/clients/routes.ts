import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasherMotDePasse } from '../../lib/password.js'
import { assertMotDePasseAcceptable } from '../../lib/mot-de-passe.js'
import { mapClient } from '../../lib/mappers.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { requireStaff } from '../../plugins/auth.js'
import { apresMutationClient } from '../../lib/odoo/sync.js'

const clientInclude = {
  catalogue: true,
  favoris: true,
  notes: true,
  paliers: true,
} as const

const createClientSchema = z.object({
  code: z.string().min(2).max(32),
  motDePasse: z.string().min(1),
  nom: z.string().min(1),
  ville: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  telephone: z.string().min(6, 'Téléphone de livraison requis'),
  adresse: z.string().min(5, 'Adresse de livraison requise'),
  numeroTva: z.string().optional(),
  minCartons: z.number().int().positive().optional(),
  modePaiement: z.enum(['sepa', 'stripe']).optional(),
  /** IDs produits du catalogue initial */
  productIds: z.array(z.string()).optional(),
})

export async function clientRoutes(app: FastifyInstance) {
  app.get('/api/v1/clients', { preHandler: requireStaff('DIRECTION', 'PREPARATION') }, async () => {
    const clients = await prisma.client.findMany({
      include: clientInclude,
      orderBy: { nom: 'asc' },
    })
    return clients.map(mapClient)
  })

  app.get('/api/v1/clients/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const c = await prisma.client.findUnique({ where: { id }, include: clientInclude })
    if (!c) throw new NotFoundError('Client introuvable')
    return mapClient(c)
  })

  /** Créer le 1er client (ou suivants) — direction uniquement */
  app.post('/api/v1/clients', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const parsed = createClientSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données client invalides', parsed.error.flatten())

    const data = parsed.data
    const code = data.code.trim().toUpperCase()
    const exists = await prisma.client.findUnique({ where: { code } })
    if (exists) throw new ConflictError(`Le code client « ${code} » existe déjà`)
    assertMotDePasseAcceptable(data.motDePasse)

    const hash = await hasherMotDePasse(data.motDePasse)
    const c = await prisma.client.create({
      data: {
        code,
        motDePasseHash: hash,
        nom: data.nom,
        ville: data.ville,
        email: data.email || null,
        telephone: data.telephone,
        adresse: data.adresse,
        numeroTva: data.numeroTva,
        minCartons: data.minCartons ?? 5,
        modePaiement: data.modePaiement ?? 'sepa',
        catalogue: data.productIds?.length
          ? {
              create: data.productIds.map((productId) => ({ productId, visible: true })),
            }
          : undefined,
      },
      include: clientInclude,
    })
    apresMutationClient(c.id)
    return mapClient(c)
  })

  app.patch('/api/v1/clients/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      nom: z.string().min(1).optional(),
      ville: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      telephone: z.string().nullable().optional(),
      adresse: z.string().nullable().optional(),
      numeroTva: z.string().nullable().optional(),
      minCartons: z.number().int().positive().optional(),
      modePaiement: z.enum(['sepa', 'stripe']).optional(),
      actif: z.boolean().optional(),
      motDePasse: z.string().min(1).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données invalides', parsed.error.flatten())

    const exists = await prisma.client.findUnique({ where: { id } })
    if (!exists) throw new NotFoundError('Client introuvable')

    const d = parsed.data
    if (d.motDePasse) assertMotDePasseAcceptable(d.motDePasse)
    const c = await prisma.client.update({
      where: { id },
      data: {
        ...(d.nom != null && { nom: d.nom }),
        ...(d.ville !== undefined && { ville: d.ville }),
        ...(d.email !== undefined && { email: d.email }),
        ...(d.telephone !== undefined && { telephone: d.telephone }),
        ...(d.adresse !== undefined && { adresse: d.adresse }),
        ...(d.numeroTva !== undefined && { numeroTva: d.numeroTva }),
        ...(d.minCartons != null && { minCartons: d.minCartons }),
        ...(d.modePaiement != null && { modePaiement: d.modePaiement }),
        ...(d.actif != null && { actif: d.actif }),
        ...(d.motDePasse && {
          motDePasseHash: await hasherMotDePasse(d.motDePasse),
          mdpAChanger: false,
        }),
      },
      include: clientInclude,
    })
    apresMutationClient(c.id)
    return mapClient(c)
  })

  /** Remplace le catalogue + prix négociés d'un client */
  app.put(
    '/api/v1/clients/:id/catalogue',
    { preHandler: requireStaff('DIRECTION') },
    async (req) => {
      const { id } = req.params as { id: string }
      const schema = z.object({
        entries: z.array(
          z.object({
            productId: z.string(),
            prixNegocie: z.number().nonnegative().nullable().optional(),
            visible: z.boolean().optional(),
          }),
        ),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw new ValidationError('Catalogue invalide')

      const client = await prisma.client.findUnique({ where: { id } })
      if (!client) throw new NotFoundError('Client introuvable')

      await prisma.$transaction(async (tx) => {
        await tx.catalogEntry.deleteMany({ where: { clientId: id } })
        if (parsed.data.entries.length > 0) {
          await tx.catalogEntry.createMany({
            data: parsed.data.entries.map((e) => ({
              clientId: id,
              productId: e.productId,
              prixNegocie: e.prixNegocie ?? null,
              visible: e.visible ?? true,
            })),
          })
        }
      })

      const c = await prisma.client.findUniqueOrThrow({ where: { id }, include: clientInclude })
      apresMutationClient(c.id)
      return mapClient(c)
    },
  )

  /** Paliers de prix */
  app.put(
    '/api/v1/clients/:id/paliers',
    { preHandler: requireStaff('DIRECTION') },
    async (req) => {
      const { id } = req.params as { id: string }
      const schema = z.object({
        productId: z.string(),
        paliers: z.array(z.object({ seuil: z.number().int().positive(), prix: z.number().positive() })),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw new ValidationError('Paliers invalides')

      await prisma.$transaction(async (tx) => {
        await tx.prixPalier.deleteMany({
          where: { clientId: id, productId: parsed.data.productId },
        })
        if (parsed.data.paliers.length > 0) {
          await tx.prixPalier.createMany({
            data: parsed.data.paliers.map((p) => ({
              clientId: id,
              productId: parsed.data.productId,
              seuil: p.seuil,
              prix: p.prix,
            })),
          })
        }
      })

      const c = await prisma.client.findUniqueOrThrow({ where: { id }, include: clientInclude })
      apresMutationClient(c.id)
      return mapClient(c)
    },
  )

}
