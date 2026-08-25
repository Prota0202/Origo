import type { FastifyInstance } from 'fastify'
import { traiterWebhookStripe } from '../../lib/stripe.js'

export async function stripeRoutes(app: FastifyInstance) {
  app.get('/api/v1/stripe/webhook', async (_req, reply) => reply.code(405).send({ error: 'METHOD_NOT_ALLOWED' }))

  app.post('/api/v1/stripe/webhook', {
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
  }, async (req) => {
    const brut = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {})
    const signature = req.headers['stripe-signature']
    const header = Array.isArray(signature) ? signature[0] : signature
    return traiterWebhookStripe(brut, header)
  })
}
