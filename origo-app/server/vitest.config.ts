import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Base dédiée : les tests écrivent et suppriment des données.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://origo:origo@localhost:5432/origo_test?schema=public',
      JWT_SECRET: 'secret-de-test-uniquement-pour-les-tests-locaux',
      LOG_LEVEL: 'silent',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_FROM: '',
      // Jamais les identifiants du .env : un `npm test` ne doit pas écrire
      // sur origo.odoo.com (produits de test, partenaires fantômes).
      ODOO_URL: process.env.ODOO_SYNC_TEST === '1' ? (process.env.ODOO_URL ?? '') : '',
      ODOO_DB: process.env.ODOO_SYNC_TEST === '1' ? (process.env.ODOO_DB ?? '') : '',
      ODOO_USER: process.env.ODOO_SYNC_TEST === '1' ? (process.env.ODOO_USER ?? '') : '',
      ODOO_API_KEY: process.env.ODOO_SYNC_TEST === '1' ? (process.env.ODOO_API_KEY ?? '') : '',
    },
    // Les tests de concurrence s'appuient sur des verrous Postgres réels :
    // un seul worker évite que deux fichiers se bloquent mutuellement.
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
})
