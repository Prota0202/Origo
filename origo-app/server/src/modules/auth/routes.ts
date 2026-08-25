import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hashLeurre, verifierMotDePasse } from '../../lib/password.js'
import { UnauthorizedError, ValidationError } from '../../lib/errors.js'
import { ROLE_UI, mapClient } from '../../lib/mappers.js'
import { authenticate, poserCookieSession, retirerCookieSession, signerSession } from '../../plugins/auth.js'
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
        // Par code resto, pas par IP : 40 téléphones derrière un NAT d’hôtel
        // ne doivent pas se bloquer entre eux. Un bot vise un code, pas une IP.
        rateLimit: {
          max: 12,
          timeWindow: '15 minutes',
          hook: 'preValidation',
          keyGenerator: (req) => {
            const code =
              req.body && typeof req.body === 'object' && 'code' in req.body
                ? String((req.body as { code?: unknown }).code ?? '')
                    .trim()
                    .toUpperCase()
                : ''
            return `login:${code || 'inconnu'}`
          },
        },
      },
    },
    async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Code et mot de passe requis')

    const code = parsed.data.code.trim().toUpperCase()
    const { motDePasse } = parsed.data

    // Les deux lookups partent ensemble, puis un seul bcrypt.compare (hash réel ou leurre)
    // pour qu’un code inexistant ne réponde pas plus vite qu’un mauvais mot de passe.
    const [staff, client] = await Promise.all([
      prisma.staff.findUnique({ where: { code } }),
      prisma.client.findUnique({ where: { code } }),
    ])

    const compte = staff?.actif ? staff : client?.actif ? client : null
    const ok = await verifierMotDePasse(motDePasse, compte?.motDePasseHash ?? hashLeurre())
    if (!ok || !compte) throw new UnauthorizedError('Code ou mot de passe incorrect')

    if (staff?.actif && compte === staff) {
      const payload: JwtStaff = {
        typ: 'staff',
        sub: staff.id,
        role: staff.role,
        code: staff.code,
        nom: staff.nom,
        sv: staff.sessionVersion,
        mdpAChanger: staff.mdpAChanger,
      }
      const token = signerSession(app, payload)
      poserCookieSession(reply, token)
      return {
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

    if (!client?.actif) throw new UnauthorizedError('Code ou mot de passe incorrect')

    const complet = await prisma.client.findUniqueOrThrow({
      where: { id: client.id },
      include: {
        catalogue: true,
        favoris: true,
        notes: true,
        paliers: true,
      },
    })
    const payload: JwtClient = {
      typ: 'client',
      sub: client.id,
      code: client.code,
      nom: client.nom,
      sv: client.sessionVersion,
      mdpAChanger: client.mdpAChanger,
    }
    const token = signerSession(app, payload)
    poserCookieSession(reply, token)
    return {
      user: {
        type: 'client',
        ...mapClient(complet),
        mdpAChanger: client.mdpAChanger,
      },
    }
    },
  )

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    retirerCookieSession(reply)
    return { ok: true }
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
