import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

// Prisma 7 nécessite un adaptateur explicite pour la connexion (plus de
// connexion implicite via la seule chaîne du datasource).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

// Instance unique du client Prisma, réutilisée dans tout le serveur
// (évite d'épuiser le pool de connexions Postgres en développement).
export const prisma = new PrismaClient({ adapter })
export type { Prisma } from '../generated/prisma/client.js'
