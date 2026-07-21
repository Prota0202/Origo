import Fastify from 'fastify'
import cors from '@fastify/cors'
import { env } from './config/env.js'
import { AppError } from './lib/errors.js'
import { registerAuth } from './plugins/auth.js'
import { registerUploadsStatic } from './lib/uploads.js'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './modules/auth/routes.js'
import { productRoutes } from './modules/products/routes.js'
import { clientRoutes } from './modules/clients/routes.js'
import { meRoutes } from './modules/me/routes.js'
import { orderRoutes } from './modules/orders/routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: true,
    // Upload photo compressée (data URL) puis conversion fichier côté serveur
    bodyLimit: 3 * 1024 * 1024,
    ajv: { customOptions: { coerceTypes: true } },
  })

  await app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
  })

  // Limite globale douce ; login a une limite plus stricte (voir auth routes)
  await app.register(rateLimit, {
    global: true,
    max: env.isProd ? 300 : 1000,
    timeWindow: '1 minute',
  })

  await registerAuth(app)
  await registerUploadsStatic(app)

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: err.code ?? 'ERROR',
        message: err.message,
        details: err.details,
      })
    }

    // Erreurs Fastify / JWT
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: 'REQUEST_ERROR',
        message: err.message,
      })
    }

    app.log.error(err)
    return reply.status(500).send({
      error: 'INTERNAL',
      message: 'Erreur serveur',
    })
  })

  app.get('/api/v1/health', async () => ({
    ok: true,
    service: 'origo-api',
    time: new Date().toISOString(),
  }))

  await authRoutes(app)
  await productRoutes(app)
  await clientRoutes(app)
  await meRoutes(app)
  await orderRoutes(app)

  return app
}
