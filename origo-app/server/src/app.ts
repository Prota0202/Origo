import Fastify from 'fastify'
import cors from '@fastify/cors'
import { Readable } from 'node:stream'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { AppError } from './lib/errors.js'
import { registerAuth } from './plugins/auth.js'
import { registerUploadsStatic } from './lib/uploads.js'
import { arreterSondeOdoo, demarrerSondeOdoo } from './lib/odoo/sonde.js'
import { brancherJournalOdoo } from './lib/odoo/sync.js'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './modules/auth/routes.js'
import { productRoutes } from './modules/products/routes.js'
import { clientRoutes } from './modules/clients/routes.js'
import { meRoutes } from './modules/me/routes.js'
import { orderRoutes } from './modules/orders/routes.js'
import { odooRoutes } from './modules/odoo/routes.js'
import { staffRoutes } from './modules/staff/routes.js'
import { stripeRoutes } from './modules/stripe/routes.js'
import { sepaRoutes } from './modules/sepa/routes.js'
import { arreterPrelevementsSepa, demarrerPrelevementsSepa } from './lib/sepa.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Corps brut, uniquement pour HMAC Stripe. */
    rawBody?: Buffer
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.logLevel },
    // Upload photo compressée (data URL) puis conversion fichier côté serveur
    bodyLimit: 3 * 1024 * 1024,
    ajv: { customOptions: { coerceTypes: true } },
    trustProxy: env.trustProxy,
  })

  app.addHook('preParsing', async (req, _reply, payload) => {
    if (req.url.split('?')[0] !== '/api/v1/stripe/webhook') return payload
    const morceaux: Buffer[] = []
    for await (const chunk of payload) {
      morceaux.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }
    const brut = Buffer.concat(morceaux)
    req.rawBody = brut
    return Readable.from(brut)
  })

  await app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
  })

  // Limite globale douce ; login a une limite plus stricte (voir auth routes)
  await app.register(rateLimit, {
    global: true,
    // Par IP : 40 PWA derrière un même NAT (foire, hôtel) × ~20 req/min.
    max: env.isProd ? 2000 : 4000,
    timeWindow: '1 minute',
    allowList: (req) => req.url.split('?')[0] === '/api/v1/stripe/webhook',
  })

  await registerAuth(app)
  await registerUploadsStatic(app)

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    if (!req.url.startsWith('/uploads/')) {
      reply.header('Cache-Control', 'no-store')
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      )
    }
    return payload
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      const body: { error: string; message: string } = {
        error: err.code ?? 'ERROR',
        message: err.message,
      }
      return reply.status(err.statusCode).send(body)
    }

    // Erreurs Fastify / JWT : en prod, pas de message interne (chemins, schémas)
    const { statusCode, message } = err as { statusCode?: number; message?: string }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: 'REQUEST_ERROR',
        message: env.isProd ? 'Requête invalide' : (message ?? 'Requête invalide'),
      })
    }

    app.log.error(err)
    return reply.status(500).send({
      error: 'INTERNAL',
      message: 'Erreur serveur',
    })
  })

  // Liveness : ne touche pas la DB, sinon une DB lente ferait redémarrer l'API en boucle
  app.get('/api/v1/health', async () => ({
    ok: true,
    service: 'origo-api',
    time: new Date().toISOString(),
  }))

  // Readiness public : DB seulement. Odoo / backups restent sur GET /api/v1/odoo (direction).
  app.get('/api/v1/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return { ok: true, db: 'up' }
    } catch {
      return reply.status(503).send({ ok: false, db: 'down' })
    }
  })

  await authRoutes(app)
  await productRoutes(app)
  await clientRoutes(app)
  await meRoutes(app)
  await orderRoutes(app)
  await odooRoutes(app)
  await staffRoutes(app)
  await stripeRoutes(app)
  await sepaRoutes(app)

  brancherJournalOdoo(app.log)
  demarrerSondeOdoo(app.log)
  demarrerPrelevementsSepa(app.log)
  app.addHook('onClose', async () => {
    arreterSondeOdoo()
    arreterPrelevementsSepa()
  })

  return app
}
