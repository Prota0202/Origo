import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { hasherMotDePasse } from '../../lib/password.js'
import { assertMotDePasseAcceptable } from '../../lib/mot-de-passe.js'
import { ROLE_UI } from '../../lib/mappers.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { requireStaff } from '../../plugins/auth.js'
import type { RoleStaff } from '@prisma/client'

const ROLE_API: Record<string, RoleStaff> = {
  direction: 'DIRECTION',
  preparation: 'PREPARATION',
  livreur: 'LIVREUR',
}

function mapStaff(s: { id: string; code: string; nom: string; role: RoleStaff; actif: boolean }) {
  return {
    id: s.id,
    code: s.code,
    nom: s.nom,
    role: ROLE_UI[s.role],
    actif: s.actif,
  }
}

async function compterDirectionActive(saufId?: string) {
  return prisma.staff.count({
    where: { role: 'DIRECTION', actif: true, ...(saufId ? { id: { not: saufId } } : {}) },
  })
}

export async function staffRoutes(app: FastifyInstance) {
  app.get('/api/v1/staff', { preHandler: requireStaff('DIRECTION') }, async () => {
    const liste = await prisma.staff.findMany({ orderBy: [{ role: 'asc' }, { nom: 'asc' }] })
    return liste.map(mapStaff)
  })

  app.post('/api/v1/staff', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const parsed = z
      .object({
        code: z.string().min(2).max(32),
        motDePasse: z.string().min(1),
        nom: z.string().min(1),
        role: z.enum(['direction', 'preparation', 'livreur']),
      })
      .safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données invalides', parsed.error.flatten())

    const code = parsed.data.code.trim().toUpperCase()
    const exists = await prisma.staff.findUnique({ where: { code } })
    if (exists) throw new ConflictError(`Le code « ${code} » existe déjà`)
    assertMotDePasseAcceptable(parsed.data.motDePasse)

    const s = await prisma.staff.create({
      data: {
        code,
        nom: parsed.data.nom,
        role: ROLE_API[parsed.data.role],
        motDePasseHash: await hasherMotDePasse(parsed.data.motDePasse),
      },
    })
    return mapStaff(s)
  })

  app.patch('/api/v1/staff/:id', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const { id } = req.params as { id: string }
    const parsed = z
      .object({
        nom: z.string().min(1).optional(),
        role: z.enum(['direction', 'preparation', 'livreur']).optional(),
        actif: z.boolean().optional(),
        motDePasse: z.string().min(1).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Données invalides', parsed.error.flatten())

    const exists = await prisma.staff.findUnique({ where: { id } })
    if (!exists) throw new NotFoundError('Compte introuvable')
    if (parsed.data.motDePasse) assertMotDePasseAcceptable(parsed.data.motDePasse)

    const nouveauRole = parsed.data.role ? ROLE_API[parsed.data.role] : exists.role
    const nouvelActif = parsed.data.actif ?? exists.actif
    const resteDirection = nouveauRole === 'DIRECTION' && nouvelActif

    if (exists.role === 'DIRECTION' && exists.actif && !resteDirection) {
      const autres = await compterDirectionActive(id)
      if (autres === 0) {
        throw new ConflictError('Impossible de retirer le dernier compte direction')
      }
    }

    const s = await prisma.staff.update({
      where: { id },
      data: {
        ...(parsed.data.nom != null && { nom: parsed.data.nom }),
        ...(parsed.data.role && { role: nouveauRole }),
        ...(parsed.data.actif != null && { actif: parsed.data.actif }),
        ...(parsed.data.motDePasse && {
          motDePasseHash: await hasherMotDePasse(parsed.data.motDePasse),
          mdpAChanger: false,
        }),
      },
    })
    return mapStaff(s)
  })
}
