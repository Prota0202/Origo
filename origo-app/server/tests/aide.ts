import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'

export const prisma = new PrismaClient()

export const PHOTO_LIVRAISON_TEST =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

export const SIGNATURE_COMMANDE = {
  signatureNom: 'Restaurant Test',
  acceptationCgv: true as const,
  signatureImage: PHOTO_LIVRAISON_TEST,
}

/** Jeu de données isolé par test : pas de dépendance à l'ordre d'exécution. */
export async function creerJeuDeDonnees(opts: { stock: number; prixCarton?: number; minCartons?: number }) {
  const suffixe = randomUUID().slice(0, 8)

  const product = await prisma.product.create({
    data: {
      sku: `test-${suffixe}`,
      nom: `Produit ${suffixe}`,
      categorie: 'Test',
      unitesParCarton: 10,
      prixCarton: opts.prixCarton ?? 150,
      stock: opts.stock,
    },
  })

  const client = await prisma.client.create({
    data: {
      code: `CLI${suffixe.toUpperCase()}`,
      nom: `Client ${suffixe}`,
      motDePasseHash: await bcrypt.hash('motdepasse-test', 4),
      minCartons: opts.minCartons ?? 1,
      adresse: 'Rue de Test 1, 1000 Bruxelles',
      telephone: '+32 2 000 00 00',
      catalogue: { create: [{ productId: product.id, visible: true }] },
    },
  })

  const staff = await prisma.staff.create({
    data: {
      code: `STAFF${suffixe.toUpperCase()}`,
      nom: 'Direction test',
      role: 'DIRECTION',
      motDePasseHash: await bcrypt.hash('motdepasse-test', 4),
    },
  })

  const livreur = await prisma.staff.create({
    data: {
      code: `LIV${suffixe.toUpperCase()}`,
      nom: 'Livreur test',
      role: 'LIVREUR',
      motDePasseHash: await bcrypt.hash('motdepasse-test', 4),
    },
  })

  return { product, client, staff, livreur }
}

/** Produit supplémentaire visible pour un client donné. */
export async function ajouterProduitAuCatalogue(clientId: string, stock: number) {
  const suffixe = randomUUID().slice(0, 8)
  const product = await prisma.product.create({
    data: {
      sku: `extra-${suffixe}`,
      nom: `Extra ${suffixe}`,
      categorie: 'Test',
      unitesParCarton: 10,
      prixCarton: 150,
      stock,
    },
  })
  await prisma.catalogEntry.create({
    data: { clientId, productId: product.id, visible: true },
  })
  return product
}

export function tokenClient(app: FastifyInstance, client: { id: string; code: string; nom: string }) {
  return app.jwt.sign({ typ: 'client', sub: client.id, code: client.code, nom: client.nom, sv: 0 })
}

export function tokenStaff(
  app: FastifyInstance,
  staff: { id: string; code: string; nom: string; role: 'DIRECTION' | 'PREPARATION' | 'LIVREUR' },
) {
  return app.jwt.sign({
    typ: 'staff',
    sub: staff.id,
    code: staff.code,
    nom: staff.nom,
    role: staff.role,
    sv: 0,
  })
}

export async function stockDe(productId: string) {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
  return p.stock
}
