import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { mapProduct } from '../../lib/mappers.js'
import { persistImageField, supprimerFichierUpload } from '../../lib/uploads.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { authenticate, requireStaff } from '../../plugins/auth.js'
import { apresAjustementStock, apresMutationProduit, archiverProduitOdoo } from '../../lib/odoo/sync.js'

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
    if (req.user.typ === 'client' && !p.actif) throw new NotFoundError('Produit introuvable')
    return mapProduct(p)
  })

  app.post('/api/v1/products', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const parsed = productBody.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données produit invalides', parsed.error.flatten())

    const data = parsed.data
    const sku = data.sku?.trim() || `${slugify(data.nom)}-${Date.now().toString(36)}`
    const photoUrl = await persistImageField(data.photoUrl ?? null, 'produit')

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
        photoUrl: photoUrl ?? null,
        remiseSeuil: data.remiseSeuil ?? null,
        remisePourcent: data.remisePourcent ?? null,
      },
    })
    apresMutationProduit(p.id, { alignerStock: (data.stock ?? 0) > 0 })
    return mapProduct(p)
  })

  app.patch('/api/v1/products/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const parsed = productBody.partial().safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données produit invalides', parsed.error.flatten())

    const exists = await prisma.product.findUnique({ where: { id } })
    if (!exists) throw new NotFoundError('Produit introuvable')

    const d = parsed.data
    const photoUrl =
      d.photoUrl !== undefined ? await persistImageField(d.photoUrl, 'produit') : undefined
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
        ...(photoUrl !== undefined && { photoUrl }),
        ...(d.remiseSeuil !== undefined && { remiseSeuil: d.remiseSeuil }),
        ...(d.remisePourcent !== undefined && { remisePourcent: d.remisePourcent }),
        ...(d.actif != null && { actif: d.actif }),
        ...(d.sku != null && { sku: d.sku }),
      },
    })
    if (photoUrl !== undefined && exists.photoUrl && photoUrl !== exists.photoUrl) {
      supprimerFichierUpload(exists.photoUrl)
    }
    apresMutationProduit(p.id, { alignerStock: d.stock != null && d.stock !== exists.stock })
    return mapProduct(p)
  })

  app.delete('/api/v1/products/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const exists = await prisma.product.findUnique({ where: { id } })
    if (!exists) throw new NotFoundError('Produit introuvable')

    const commandes = await prisma.orderItem.count({ where: { productId: id } })
    if (commandes > 0) {
      const p = await prisma.product.update({ where: { id }, data: { actif: false } })
      if (p.odooId != null) archiverProduitOdoo(p.odooId)
      return { ok: true, mode: 'desactive' as const, produit: mapProduct(p) }
    }

    if (exists.odooId != null) archiverProduitOdoo(exists.odooId)
    if (exists.photoUrl) supprimerFichierUpload(exists.photoUrl)
    await prisma.$transaction(async (tx) => {
      await tx.stockMouvement.deleteMany({ where: { productId: id } })
      await tx.product.delete({ where: { id } })
    })
    return { ok: true, mode: 'supprime' as const }
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
        const rows = await tx.$queryRaw<{ stock: number }[]>`
          UPDATE "Product" SET stock = stock + ${body.data.delta}
          WHERE id = ${id} AND stock + ${body.data.delta} >= 0
          RETURNING stock`
        if (rows.length === 0) {
          const product = await tx.product.findUnique({ where: { id } })
          if (!product) throw new NotFoundError('Produit introuvable')
          throw new ConflictError(`Stock insuffisant pour « ${product.nom} »`, {
            disponible: product.stock,
            demande: -body.data.delta,
          })
        }
        await tx.stockMouvement.create({
          data: {
            productId: id,
            type: 'AJUSTEMENT',
            quantite: body.data.delta,
            stockApres: rows[0].stock,
            note: body.data.note,
          },
        })
        return tx.product.findUniqueOrThrow({ where: { id } })
      })
      apresAjustementStock(p.id)
      return mapProduct(p)
    },
  )
}
