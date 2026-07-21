function requis(nom: string, fallback?: string): string {
  const v = process.env[nom] ?? fallback
  if (!v) throw new Error(`Variable d'environnement manquante : ${nom}`)
  return v
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProd = nodeEnv === 'production'

const jwtSecret = (() => {
  const raw = process.env.JWT_SECRET
  if (isProd) {
    if (!raw || raw.length < 32 || raw.includes('change-moi') || raw.includes('dev-origo')) {
      throw new Error(
        'JWT_SECRET obligatoire en production (≥ 32 caractères, pas de valeur placeholder)',
      )
    }
    return raw
  }
  return requis('JWT_SECRET', 'dev-origo-jwt-secret-change-in-prod')
})()

const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (isProd) {
  if (corsOrigin.length === 0 || corsOrigin.some((o) => o === '*')) {
    throw new Error('CORS_ORIGIN doit lister des origines précises en production (pas *)')
  }
  if (corsOrigin.every((o) => o.includes('localhost') || o.includes('127.0.0.1'))) {
    console.warn(
      '[origo] CORS_ORIGIN ne pointe que vers localhost en production — vérifie le domaine du front.',
    )
  }
}

export const env = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret,
  /** Durée de session (ex. 12h, 7d). Court = moins de risque si token volé. */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? (isProd ? '12h' : '7d'),
  corsOrigin,
  company: {
    name: process.env.COMPANY_NAME ?? 'ORIGO',
    address: process.env.COMPANY_ADDRESS ?? 'Belgique',
    email: process.env.COMPANY_EMAIL ?? 'pro@origo.be',
    phone: process.env.COMPANY_PHONE ?? '+32 2 000 00 00',
    vat: process.env.COMPANY_VAT ?? 'BE0000000000',
    tvaRate: Number(process.env.TVA_RATE ?? '0.21'),
  },
  /** Fenêtre client pour modifier / annuler seul (ms) */
  delaiModificationMs: Number(process.env.DELAI_MODIFICATION_MS ?? String(60 * 60 * 1000)),
}
