import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { verifierMotDePasse } from '../../lib/password.js'
import { UnauthorizedError, ValidationError } from '../../lib/errors.js'
import { ROLE_UI, mapClient } from '../../lib/mappers.js'
import { authenticate } from '../../plugins/auth.js'
import type { JwtClient, JwtStaff } from '../../plugins/auth.js'
import { env } from '../../config/env.js'

const loginSchema = z.object({
  code: z.string().min(1),
  motDePasse: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (req) => {
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
      }
      const token = app.jwt.sign(payload, { expiresIn: '30d' })
      return {
        token,
        user: {
          type: 'staff',
          id: staff.id,
          code: staff.code,
          nom: staff.nom,
          role: ROLE_UI[staff.role],
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
    }
    const token = app.jwt.sign(payload, { expiresIn: '30d' })
    return {
      token,
      user: {
        type: 'client',
        ...mapClient(client),
      },
    }
  })

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
    return { type: 'client' as const, ...mapClient(client) }
  })

  app.get('/api/v1/company', async () => ({
    name: env.company.name,
    address: env.company.address,
    email: env.company.email,
    phone: env.company.phone,
    phoneLink: `tel:${env.company.phone.replace(/\s/g, '')}`,
    vat: env.company.vat,
    tvaRate: env.company.tvaRate,
    delaiModificationMs: env.delaiModificationMs,
    horaires: 'Lun – Ven · 8h00 – 18h00',
  }))
}
