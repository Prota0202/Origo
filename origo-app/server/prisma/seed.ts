import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const PRODUITS = [
  {
    sku: 'bol-kraft-750',
    nom: 'Bol kraft 750 ml',
    description: 'Bol carton kraft brun, spécial vente à emporter',
    unitesParCarton: 300,
    prixCarton: 58,
    categorie: 'Vaisselle jetable',
    stock: 42,
  },
  {
    sku: 'couvercle-bol-750',
    nom: 'Couvercle PET 750 ml',
    description: 'Couvercle transparent pour bol kraft 750 ml',
    unitesParCarton: 300,
    prixCarton: 34.5,
    categorie: 'Vaisselle jetable',
    stock: 35,
    remiseSeuil: 10,
    remisePourcent: 5,
  },
  {
    sku: 'gobelet-25',
    nom: 'Gobelet carton 25 cl',
    description: 'Gobelet double paroi pour boissons chaudes',
    unitesParCarton: 1000,
    prixCarton: 62,
    categorie: 'Vaisselle jetable',
    stock: 18,
  },
  {
    sku: 'barquette-alu',
    nom: 'Barquette alu + couvercle',
    description: 'Barquette aluminium 1 000 ml avec couvercle carton',
    unitesParCarton: 100,
    prixCarton: 27,
    categorie: 'Vaisselle jetable',
    stock: 0,
  },
  {
    sku: 'sac-kraft',
    nom: 'Sac kraft poignées torsadées',
    description: 'Sac papier kraft brun, format moyen',
    unitesParCarton: 250,
    prixCarton: 44,
    categorie: 'Emballage & cuisine',
    stock: 24,
    remiseSeuil: 10,
    remisePourcent: 5,
  },
  {
    sku: 'film-etirable',
    nom: 'Film étirable pro 300 m',
    description: 'Film alimentaire en boîte distributrice',
    unitesParCarton: 6,
    prixCarton: 31.5,
    categorie: 'Emballage & cuisine',
    stock: 15,
  },
  {
    sku: 'papier-toilette',
    nom: 'Papier toilette 2 plis',
    description: 'Rouleaux blancs double épaisseur',
    unitesParCarton: 96,
    prixCarton: 38,
    categorie: 'Hygiène & entretien',
    stock: 30,
  },
  {
    sku: 'bobine-essuyage',
    nom: 'Bobine d’essuyage 800 formats',
    description: 'Bobine blanche à dévidage central',
    unitesParCarton: 2,
    prixCarton: 21,
    categorie: 'Hygiène & entretien',
    stock: 7,
  },
  {
    sku: 'serviettes-ouate',
    nom: 'Serviettes ouate 2 plis',
    description: 'Serviettes blanches 30 × 30 cm',
    unitesParCarton: 2400,
    prixCarton: 46,
    categorie: 'Hygiène & entretien',
    stock: 26,
  },
  {
    sku: 'gants-nitrile',
    nom: 'Gants nitrile taille M',
    description: 'Gants jetables non poudrés, usage alimentaire',
    unitesParCarton: 1000,
    prixCarton: 54,
    categorie: 'Hygiène & entretien',
    stock: 12,
  },
]

async function main() {
  console.log('Seed ORIGO…')

  await prisma.orderItem.deleteMany()
  await prisma.stockMouvement.deleteMany()
  await prisma.retourCommande.deleteMany()
  await prisma.order.deleteMany()
  await prisma.demandeProduit.deleteMany()
  await prisma.prixPalier.deleteMany()
  await prisma.clientNote.deleteMany()
  await prisma.clientFavori.deleteMany()
  await prisma.catalogEntry.deleteMany()
  await prisma.client.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.sequence.deleteMany()

  const staff = [
    { code: 'ORIGO', nom: 'Direction', role: 'DIRECTION' as const, mdp: 'admin2026' },
    { code: 'PREPA', nom: 'Préparation', role: 'PREPARATION' as const, mdp: 'prepa2026' },
    { code: 'LIVREUR', nom: 'Livreur', role: 'LIVREUR' as const, mdp: 'livreur2026' },
  ]

  for (const s of staff) {
    await prisma.staff.create({
      data: {
        code: s.code,
        nom: s.nom,
        role: s.role,
        motDePasseHash: await bcrypt.hash(s.mdp, 10),
      },
    })
    console.log(`  staff ${s.code} / ${s.mdp}`)
  }

  const products = []
  for (const p of PRODUITS) {
    const created = await prisma.product.create({ data: p })
    products.push(created)
  }
  console.log(`  ${products.length} produits`)

  // Clients démo (mêmes codes qu’avant la migration)
  const bySku = Object.fromEntries(products.map((p) => [p.sku, p]))
  const clients = [
    {
      code: 'BOMBAY',
      nom: 'Le Bombay',
      ville: 'Bruxelles',
      email: 'contact@lebombay.be',
      mdp: '1234',
      skus: ['bol-kraft-750', 'couvercle-bol-750', 'sac-kraft', 'serviettes-ouate', 'papier-toilette'],
    },
    {
      code: 'MARCO',
      nom: 'Chez Marco',
      ville: 'Liège',
      email: 'commande@chezmarco.be',
      mdp: '1234',
      skus: ['gobelet-25', 'barquette-alu', 'film-etirable', 'bobine-essuyage', 'gants-nitrile'],
    },
  ]

  for (const c of clients) {
    const catalogue = c.skus
      .map((sku) => bySku[sku])
      .filter(Boolean)
      .map((p) => ({ productId: p.id, visible: true }))
    await prisma.client.create({
      data: {
        code: c.code,
        nom: c.nom,
        ville: c.ville,
        email: c.email,
        minCartons: 5,
        motDePasseHash: await bcrypt.hash(c.mdp, 10),
        catalogue: { create: catalogue },
      },
    })
    console.log(`  client ${c.code} / ${c.mdp}`)
  }

  await prisma.sequence.create({ data: { nom: 'order', valeur: 0 } })
  console.log('Seed OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
