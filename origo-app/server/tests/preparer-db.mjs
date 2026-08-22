// Applique les migrations sur la base de test avant vitest.
// Passe par un script Node plutôt qu'une variable inline pour rester
// utilisable aussi bien sous macOS/Linux que sous Windows.
import { spawnSync } from 'node:child_process'

const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://origo:origo@localhost:5432/origo_test?schema=public'

const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
  shell: process.platform === 'win32',
})

process.exit(res.status ?? 1)
