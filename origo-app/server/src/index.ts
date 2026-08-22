import './load-env.js'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { appliquerGardeProd } from './lib/garde-prod.js'

const app = await buildApp()
await appliquerGardeProd(app.log)
await app.listen({ port: env.port, host: env.host })
app.log.info(`ORIGO API → http://localhost:${env.port}`)

// `docker stop` / redéploiement envoient SIGTERM : on finit les requêtes en cours
// au lieu de couper au milieu d'une commande client.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} reçu — arrêt propre`)
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error(err)
      process.exit(1)
    }
  })
}
