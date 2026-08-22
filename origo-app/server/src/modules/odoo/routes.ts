import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { etatOdoo } from '../../lib/odoo/sonde.js'
import { dernierSyncOdoo, synchroniserTout } from '../../lib/odoo/sync.js'
import { statsVentesOdoo } from '../../lib/odoo/ventes.js'
import { ValidationError } from '../../lib/errors.js'
import { requireStaff } from '../../plugins/auth.js'

export async function odooRoutes(app: FastifyInstance) {
  app.get('/api/v1/odoo', { preHandler: requireStaff('DIRECTION') }, async () => ({
    actif: env.odoo.actif,
    sonde: etatOdoo(),
    dernierSync: dernierSyncOdoo(),
    commandes: await statsVentesOdoo(),
  }))

  app.post(
    '/api/v1/odoo/synchroniser',
    {
      preHandler: requireStaff('DIRECTION'),
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    },
    async (req) => {
      const parsed = z.object({ inclureStock: z.boolean().optional() }).safeParse(req.body ?? {})
      if (!parsed.success) throw new ValidationError('Corps invalide')

      const rapport = await synchroniserTout({ inclureStock: parsed.data.inclureStock })
      if (rapport.erreurs.some((e) => e.cible === 'prerequis')) {
        return { ok: false, ...rapport }
      }
      return { ok: rapport.erreurs.length === 0, ...rapport }
    },
  )
}
