import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

/**
 * Crée (ou met à jour le mot de passe de) le compte direction — et rien d'autre.
 * Contrairement au seed, ce script ne supprime aucune donnée : il est sûr sur un
 * serveur qui contient déjà des commandes réelles.
 *
 * Ne pas importer `src/` : l'image Docker de prod n'embarque que `prisma/` + `dist/`.
 *
 * Usage : ADMIN_CODE=ORIGO ADMIN_PASSWORD='...' npm run db:bootstrap-admin
 */
const prisma = new PrismaClient()

const MIN_LONGUEUR = 12
const INTERDITS = [
  '1234',
  '123456',
  'password',
  'motdepasse',
  'changeme',
  'admin',
  'admin2026',
  'prepa2026',
  'livreur2026',
  'origo',
  'origo2026',
  'azerty',
]

function requis(nom: string): string {
  const v = process.env[nom]?.trim()
  if (!v) throw new Error(`Variable d'environnement manquante : ${nom}`)
  return v
}

async function main() {
  const code = (process.env.ADMIN_CODE?.trim() || 'ORIGO').toUpperCase()
  const nom = process.env.ADMIN_NAME?.trim() || 'Direction'
  const motDePasse = requis('ADMIN_PASSWORD')

  if (motDePasse.length < MIN_LONGUEUR) {
    throw new Error(`ADMIN_PASSWORD trop court (≥ ${MIN_LONGUEUR} caractères)`)
  }
  if (INTERDITS.includes(motDePasse.toLowerCase())) {
    throw new Error('ADMIN_PASSWORD est un mot de passe de démo — choisis-en un vrai')
  }

  const motDePasseHash = await bcrypt.hash(motDePasse, 12)
  const staff = await prisma.staff.upsert({
    where: { code },
    update: {
      motDePasseHash,
      actif: true,
      nom,
      role: 'DIRECTION',
      mdpAChanger: false,
      sessionVersion: { increment: 1 },
    },
    create: { code, nom, role: 'DIRECTION', motDePasseHash, mdpAChanger: false },
  })

  await prisma.societe.upsert({
    where: { id: 'origo' },
    create: {
      id: 'origo',
      nom: process.env.COMPANY_NAME?.trim() || 'ORIGO',
      adresse: process.env.COMPANY_ADDRESS?.trim() || 'Avenue des Anciens Combattants 23, 1140 Evere',
      email: process.env.COMPANY_EMAIL?.trim() || 'pro@origo.be',
      telephone: process.env.COMPANY_PHONE?.trim() || '+32 468 08 96 03',
      numeroTva: process.env.COMPANY_VAT?.trim() || '',
      horaires: 'Lun – Ven · 8h00 – 18h00',
    },
    update: {},
  })

  console.log(`Compte direction prêt : ${staff.code} (${staff.nom})`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
