import { config } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

import { buildApp } from './app.js'
import { env } from './config/env.js'

const app = await buildApp()
await app.listen({ port: env.port, host: env.host })
app.log.info(`ORIGO API → http://localhost:${env.port}`)
