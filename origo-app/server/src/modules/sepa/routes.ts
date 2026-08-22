import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ValidationError } from '../../lib/errors.js'
import { lancerPrelevementsSepa } from '../../lib/sepa.js'
import { sessionMandatSepa } from '../../lib/stripe.js'
import { prisma } from '../../lib/prisma.js'
import { requireClient, requireStaff } from '../../plugins/auth.js'

export async function sepaRoutes(app: FastifyInstance) {
  app.post('/api/v1/me/sepa/mandat', { preHandler: requireClient }, async (req) => {
    const url = await sessionMandatSepa(req.user.sub)
    return { url }
  })

  app.get('/api/v1/sepa/prelevements', { preHandler: requireStaff('DIRECTION') }, async () => {
    const rows = await prisma.prelevementSepa.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: {
        client: { select: { nom: true, code: true } },
        _count: { select: { commandes: true } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      clientNom: r.client.nom,
      clientCode: r.client.code,
      periode: r.periodeCle,
      montantCents: r.montantCents,
      statut: r.statut,
      commandes: r._count.commandes,
      erreur: r.erreur,
      le: r.createdAt.toISOString(),
    }))
  })

  app.post('/api/v1/sepa/lancer', { preHandler: requireStaff('DIRECTION') }, async (req) => {
    const parsed = z.object({ forcer: z.boolean().optional() }).safeParse(req.body ?? {})
    if (!parsed.success) throw new ValidationError('Paramètre forcer invalide')
    return lancerPrelevementsSepa({ forcer: parsed.data.forcer === true })
  })
}
