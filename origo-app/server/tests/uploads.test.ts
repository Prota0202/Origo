/**
 * Les photos de livraison sont des données personnelles (locaux d'un client
 * identifié). Elles étaient servies sans aucune authentification : l'URL seule
 * suffisait, et elle est devinable pour qui connaît le format du nom.
 *
 * Ces tests verrouillent le contrat : rien ne sort de /uploads sans signature
 * valide, et l'API ne signe que ce que l'appelant avait le droit de voir.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import {
  UPLOAD_DIR,
  ensureUploadDir,
  persistImageField,
  signerUrlUpload,
} from '../src/lib/uploads.js'
import { creerJeuDeDonnees, prisma, SIGNATURE_COMMANDE, tokenStaff } from './aide.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  ensureUploadDir()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

/** Une image réelle sur le disque, pour distinguer « refusé » de « absent ». */
async function photoSurLeDisque() {
  const nom = `test-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.jpg`
  await writeFile(join(UPLOAD_DIR, nom), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  return nom
}

describe('accès aux fichiers /uploads', () => {
  it('refuse une URL sans signature, même si le fichier existe', async () => {
    const nom = await photoSurLeDisque()

    const res = await app.inject({ method: 'GET', url: `/uploads/${nom}` })

    expect(res.statusCode).toBe(403)
    expect(res.body).not.toContain('\xff\xd8')
  })

  it('sert le fichier avec une signature valide', async () => {
    const nom = await photoSurLeDisque()

    const res = await app.inject({ method: 'GET', url: signerUrlUpload(`/uploads/${nom}`) })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-type']).toContain('image/jpeg')
  })

  it("n'autorise pas un cache partagé à conserver la photo", async () => {
    const nom = await photoSurLeDisque()

    const res = await app.inject({ method: 'GET', url: signerUrlUpload(`/uploads/${nom}`) })

    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/)
  })

  it('refuse une signature valide pour un autre fichier', async () => {
    const cible = await photoSurLeDisque()
    const autre = await photoSurLeDisque()

    // Signature légitime de `autre`, recollée sur l'URL de `cible`.
    const params = signerUrlUpload(`/uploads/${autre}`).split('?')[1]
    const res = await app.inject({ method: 'GET', url: `/uploads/${cible}?${params}` })

    expect(res.statusCode).toBe(403)
  })

  it('refuse une signature expirée', async () => {
    const nom = await photoSurLeDisque()
    const ilYADeuxJours = Date.now() - 2 * 24 * 3600 * 1000

    const res = await app.inject({
      method: 'GET',
      url: signerUrlUpload(`/uploads/${nom}`, ilYADeuxJours),
    })

    expect(res.statusCode).toBe(403)
  })

  it('refuse une signature bricolée', async () => {
    const nom = await photoSurLeDisque()
    const url = signerUrlUpload(`/uploads/${nom}`)

    // Expiration repoussée sans resigner : c'est la tentative la plus évidente.
    const falsifiee = url.replace(/e=\d+/, `e=${Math.floor(Date.now() / 1000) + 999999}`)
    expect(falsifiee).not.toBe(url)

    expect((await app.inject({ method: 'GET', url: falsifiee })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: `${url}x` })).statusCode).toBe(403)
  })

  it('ne révèle pas si un fichier existe (même code sans signature)', async () => {
    const existant = await photoSurLeDisque()

    const present = await app.inject({ method: 'GET', url: `/uploads/${existant}` })
    const absent = await app.inject({ method: 'GET', url: '/uploads/inexistant-jamais-cree.jpg' })

    expect(present.statusCode).toBe(absent.statusCode)
  })

  it('refuse une remontée de répertoire', async () => {
    for (const chemin of ['/uploads/..%2F..%2Fpackage.json', '/uploads/.%2E/.env']) {
      const res = await app.inject({ method: 'GET', url: chemin })
      expect(res.statusCode, chemin).not.toBe(200)
      expect(res.body, chemin).not.toContain('origo-api')
    }
  })
})

describe('signature dans les réponses de l’API', () => {
  it('signe la photo de livraison renvoyée avec la commande', async () => {
    const { product, client, staff, livreur } = await creerJeuDeDonnees({ stock: 10 })

    const creation = await app.inject({
      method: 'POST',
      url: '/api/v1/me/orders',
      headers: { authorization: `Bearer ${app.jwt.sign({ typ: 'client', sub: client.id, code: client.code, nom: client.nom })}` },
      payload: { lignes: [{ productId: product.id, qty: 2 }], ...SIGNATURE_COMMANDE },
    })
    expect(creation.statusCode, creation.body).toBe(200)
    const commande = creation.json()

    const livraison = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${commande.id}/statut`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { statut: 'PREPAREE' },
    })
    expect(livraison.statusCode, livraison.body).toBe(200)
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${commande.id}/statut`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: { statut: 'EN_LIVRAISON' },
    })
    const confirmee = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${commande.id}/statut`,
      headers: { authorization: `Bearer ${tokenStaff(app, livreur)}` },
      payload: {
        statut: 'LIVREE',
        photoLivraisonUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      },
    })
    expect(confirmee.statusCode, confirmee.body).toBe(200)

    const url: string = confirmee.json().photoLivraison
    expect(url).toMatch(/^\/uploads\/livraison-.+\?e=\d+&s=[A-Za-z0-9_-]+$/)

    // L'URL signée fonctionne réellement, et sans elle rien ne sort.
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: url.split('?')[0] })).statusCode).toBe(403)

    // La base ne doit contenir que le chemin nu : une signature stockée serait
    // périmée à la première expiration.
    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: commande.id } })
    expect(enBase.photoLivraisonUrl).toMatch(/^\/uploads\/livraison-[^?]+$/)

    // Le staff direction voit la même chose (pas de régression de rôle).
    const relecture = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${commande.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
    })
    expect(relecture.json().photoLivraison).toMatch(/\?e=\d+&s=/)
  })

  it('ne stocke pas la signature quand le front réenvoie l’URL reçue', async () => {
    const signee = signerUrlUpload('/uploads/produit-123.jpg')
    expect(signee).toContain('?')

    expect(await persistImageField(signee, 'produit')).toBe('/uploads/produit-123.jpg')
  })

  it('produit une URL stable dans la même heure (sinon le cache navigateur ne sert à rien)', async () => {
    const t = Date.parse('2026-08-09T10:05:00Z')
    const memeHeure = Date.parse('2026-08-09T10:52:00Z')
    const heureSuivante = Date.parse('2026-08-09T11:05:00Z')

    expect(signerUrlUpload('/uploads/x.jpg', t)).toBe(signerUrlUpload('/uploads/x.jpg', memeHeure))
    expect(signerUrlUpload('/uploads/x.jpg', t)).not.toBe(
      signerUrlUpload('/uploads/x.jpg', heureSuivante),
    )
  })

  it('efface l’ancienne photo produit quand on la remplace', async () => {
    const { product, staff } = await creerJeuDeDonnees({ stock: 5 })
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
    const autre =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='

    const premiere = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${product.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {
        nom: product.nom,
        categorie: product.categorie,
        unitesParCarton: product.unitesParCarton,
        prixCarton: 10,
        photoUrl: png,
      },
    })
    expect(premiere.statusCode, premiere.body).toBe(200)
    const ancienne = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    const ancienFichier = join(UPLOAD_DIR, ancienne.photoUrl!.slice('/uploads/'.length))
    expect(existsSync(ancienFichier)).toBe(true)

    const seconde = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${product.id}`,
      headers: { authorization: `Bearer ${tokenStaff(app, staff)}` },
      payload: {
        nom: product.nom,
        categorie: product.categorie,
        unitesParCarton: product.unitesParCarton,
        prixCarton: 10,
        photoUrl: autre,
      },
    })
    expect(seconde.statusCode, seconde.body).toBe(200)
    expect(existsSync(ancienFichier)).toBe(false)
    const nouvelle = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(nouvelle.photoUrl).not.toBe(ancienne.photoUrl)
    expect(existsSync(join(UPLOAD_DIR, nouvelle.photoUrl!.slice('/uploads/'.length)))).toBe(true)
  })
})
