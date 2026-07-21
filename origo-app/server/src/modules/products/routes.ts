import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { mapProduct } from '../../lib/mappers.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'
import { authenticate, requireStaff } from '../../plugins/auth.js'

const productBody = z.object({
  sku: z.string().min(1).optional(),
  nom: z.string().min(1),
  description: z.string().default(''),
  categorie: z.string().min(1),
  unitesParCarton: z.number().int().positive(),
  prixCarton: z.number().nonnegative(),
  stock: z.number().int().nonnegative().optional(),
  seuilAlerte: z.number().int().nonnegative().optional(),
  photoUrl: z.string().nullable().optional(),
  remiseSeuil: z.number().int().positive().nullable().optional(),
  remisePourcent: z.number().positive().max(50).nullable().optional(),
  actif: z.boolean().optional(),
})

function slugify(nom: string) {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export async function productRoutes(app: FastifyInstance) {
  // Catalogue complet — auth requise (client voit ensuite son filtre côté app)
  app.get('/api/v1/products', { preHandler: authenticate }, async (req) => {
    const onlyActive = req.user.typ === 'client'
    const products = await prisma.product.findMany({
      where: onlyActive ? { actif: true } : undefined,
      orderBy: [{ categorie: 'asc' }, { nom: 'asc' }],
    })
    return products.map(mapProduct)
  })

  app.get('/api/v1/products/:id', { preHandler: authenticate }, async (req) => {
    const { id } = req.params as { id: string }
    const p = await prisma.product.findUnique({ where: { id } })
    if (!p) throw new NotFoundError('Produit introuvable')
    return mapProduct(p)
  })

  app.post('/api/v1/products', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const parsed = productBody.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données produit invalides', parsed.error.flatten())

    const data = parsed.data
    const sku = data.sku?.trim() || `${slugify(data.nom)}-${Date.now().toString(36)}`

    const p = await prisma.product.create({
      data: {
        sku,
        nom: data.nom,
        description: data.description,
        categorie: data.categorie,
        unitesParCarton: data.unitesParCarton,
        prixCarton: data.prixCarton,
        stock: data.stock ?? 0,
        seuilAlerte: data.seuilAlerte ?? 10,
        photoUrl: data.photoUrl ?? null,
        remiseSeuil: data.remiseSeuil ?? null,
        remisePourcent: data.remisePourcent ?? null,
      },
    })
    return mapProduct(p)
  })

  app.patch('/api/v1/products/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const parsed = productBody.partial().safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données produit invalides', parsed.error.flatten())

    const exists = await prisma.product.findUnique({ where: { id } })
    if (!exists) throw new NotFoundError('Produit introuvable')

    const d = parsed.data
    const p = await prisma.product.update({
      where: { id },
      data: {
        ...(d.nom != null && { nom: d.nom }),
        ...(d.description != null && { description: d.description }),
        ...(d.categorie != null && { categorie: d.categorie }),
        ...(d.unitesParCarton != null && { unitesParCarton: d.unitesParCarton }),
        ...(d.prixCarton != null && { prixCarton: d.prixCarton }),
        ...(d.stock != null && { stock: d.stock }),
        ...(d.seuilAlerte != null && { seuilAlerte: d.seuilAlerte }),
        ...(d.photoUrl !== undefined && { photoUrl: d.photoUrl }),
        ...(d.remiseSeuil !== undefined && { remiseSeuil: d.remiseSeuil }),
        ...(d.remisePourcent !== undefined && { remisePourcent: d.remisePourcent }),
        ...(d.actif != null && { actif: d.actif }),
        ...(d.sku != null && { sku: d.sku }),
      },
    })
    return mapProduct(p)
  })

  app.post(
    '/api/v1/products/:id/stock-adjust',
    { preHandler: requireStaff('DIRECTION') },
    async (req) => {
      const { id } = req.params as { id: string }
      const body = z
        .object({ delta: z.number().int(), note: z.string().optional() })
        .safeParse(req.body)
      if (!body.success) throw new ValidationError('delta requis')

      const p = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({ where: { id } })
        if (!product) throw new NotFoundError('Produit introuvable')

        const stock = Math.max(0, product.stock + body.data.delta)
        const updated = await tx.product.update({
          where: { id },
          data: { stock },
        })
        await tx.stockMouvement.create({
          data: {
            productId: id,
            type: 'AJUSTEMENT',
            quantite: body.data.delta,
            stockApres: stock,
            note: body.data.note,
          },
        })
        return updated
      })
      return mapProduct(p)
    },
  )
}
