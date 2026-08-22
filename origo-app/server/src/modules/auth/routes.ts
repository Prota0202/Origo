import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { verifierMotDePasse } from '../../lib/password.js'
import { UnauthorizedError, ValidationError } from '../../lib/errors.js'
import { ROLE_UI, mapClient } from '../../lib/mappers.js'
import { authenticate, signerSession } from '../../plugins/auth.js'
import type { JwtClient, JwtStaff } from '../../plugins/auth.js'
import { ecrireSociete, lireSociete } from '../../lib/societe.js'
import { requireStaff } from '../../plugins/auth.js'

const loginSchema = z.object({
  code: z.string().min(1),
  motDePasse: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        // Anti brute-force : 20 essais / IP / 15 min (suffisant pour un resto, pas pour un bot)
        rateLimit: { max: 20, timeWindow: '15 minutes' },
      },
    },
    async (req) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Code et mot de passe requis')

    const code = parsed.data.code.trim().toUpperCase()
    const { motDePasse } = parsed.data

    const staff = await prisma.staff.findUnique({ where: { code } })
    if (staff?.actif) {
      const ok = await verifierMotDePasse(motDePasse, staff.motDePasseHash)
      if (!ok) throw new UnauthorizedError('Code ou mot de passe incorrect')

      const payload: JwtStaff = {
        typ: 'staff',
        sub: staff.id,
        role: staff.role,
        code: staff.code,
        nom: staff.nom,
        mdpAChanger: staff.mdpAChanger,
      }
      const token = signerSession(app, payload)
      return {
        token,
        user: {
          type: 'staff',
          id: staff.id,
          code: staff.code,
          nom: staff.nom,
          role: ROLE_UI[staff.role],
          mdpAChanger: staff.mdpAChanger,
        },
      }
    }

    const client = await prisma.client.findUnique({
      where: { code },
      include: {
        catalogue: true,
        favoris: true,
        notes: true,
        paliers: true,
      },
    })
    if (!client?.actif) {
      throw new UnauthorizedError('Code ou mot de passe incorrect')
    }

    const ok = await verifierMotDePasse(motDePasse, client.motDePasseHash)
    if (!ok) throw new UnauthorizedError('Code ou mot de passe incorrect')

    const payload: JwtClient = {
      typ: 'client',
      sub: client.id,
      code: client.code,
      nom: client.nom,
      mdpAChanger: client.mdpAChanger,
    }
    const token = signerSession(app, payload)
    return {
      token,
      user: {
        type: 'client',
        ...mapClient(client),
        mdpAChanger: client.mdpAChanger,
      },
    }
    },
  )

  app.get('/api/v1/auth/me', { preHandler: authenticate }, async (req) => {
    const user = req.user
    if (user.typ === 'staff') {
      const staff = await prisma.staff.findUniqueOrThrow({ where: { id: user.sub } })
      return {
        type: 'staff' as const,
        id: staff.id,
        code: staff.code,
        nom: staff.nom,
        role: ROLE_UI[staff.role],
        mdpAChanger: staff.mdpAChanger,
      }
    }

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: user.sub },
      include: {
        catalogue: true,
        favoris: true,
        notes: true,
        paliers: true,
      },
    })
    return { type: 'client' as const, ...mapClient(client), mdpAChanger: client.mdpAChanger }
  })

  app.get('/api/v1/company', async () => lireSociete())

  app.patch('/api/v1/company', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        address: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        vat: z.string().optional(),
        horaires: z.string().optional(),
        conditionsGenerales: z.string().optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données société invalides')
    return ecrireSociete({
      nom: parsed.data.name,
      adresse: parsed.data.address,
      email: parsed.data.email,
      telephone: parsed.data.phone,
      numeroTva: parsed.data.vat,
      horaires: parsed.data.horaires,
      conditionsGenerales: parsed.data.conditionsGenerales,
    })
  })
}
