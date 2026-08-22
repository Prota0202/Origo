import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Chargé en premier par index.ts. En ESM les `import` sont hoistés : sans ce
 * module dédié, `config/env.ts` lirait process.env avant dotenv.
 */
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') })
