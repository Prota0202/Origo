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

/**
 * Derrière un reverse proxy, sans ceci toutes les requêtes semblent venir de l'IP du proxy :
 * le rate-limit login devient global (un seul bot bloque tous les restaurants).
 * Nombre de sauts plutôt que `true` : X-Forwarded-For est spoofable côté client.
 */
const trustProxy = (() => {
  const raw = process.env.TRUST_PROXY?.trim()
  if (!raw || raw === '0' || raw === 'false') {
    if (isProd) {
      console.warn(
        '[origo] TRUST_PROXY absent : si un reverse proxy est devant, le rate-limit sera global et les IP des logs fausses.',
      )
    }
    return false
  }
  if (raw === 'true') return 1
  const hops = Number(raw)
  return Number.isInteger(hops) && hops > 0 ? hops : raw
})()

/**
 * Odoo est optionnel : tant qu'il n'est pas configuré, ORIGO fonctionne seul et
 * reste la source de vérité. Aucun démarrage ne doit échouer parce qu'Odoo manque.
 */
const odoo = (() => {
  const url = process.env.ODOO_URL?.trim().replace(/\/$/, '')
  const db = process.env.ODOO_DB?.trim()
  const user = process.env.ODOO_USER?.trim()
  const apiKey = process.env.ODOO_API_KEY?.trim()
  const actif = Boolean(url && db && user && apiKey)

  if (!actif && (url || db || user || apiKey)) {
    // Configuration à moitié remplie : silencieusement ignorée, on le signale.
    console.warn(
      '[origo] Configuration Odoo incomplète (URL, DB, USER et API_KEY sont tous requis) — intégration désactivée.',
    )
  }

  return {
    actif,
    url: url ?? '',
    db: db ?? '',
    user: user ?? '',
    apiKey: apiKey ?? '',
    /** Au-delà, on abandonne : un Odoo qui ne répond pas ne doit pas figer ORIGO. */
    timeoutMs: Number(process.env.ODOO_TIMEOUT_MS ?? '15000'),
    /** Nombre de nouvelles tentatives sur conflit de sérialisation Postgres. */
    tentatives: Number(process.env.ODOO_TENTATIVES ?? '3'),
  }
})()

export const env = {
  nodeEnv,
  isProd,
  odoo,
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  trustProxy,
  jwtSecret,
  /** Durée de session (ex. 16h, 7d). Court = moins de risque si token volé. */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? (isProd ? '16h' : '7d'),
  corsOrigin,
  company: {
    name: process.env.COMPANY_NAME ?? 'ORIGO',
    address: process.env.COMPANY_ADDRESS ?? 'Avenue des Anciens Combattants 23, 1140 Evere',
    email: process.env.COMPANY_EMAIL ?? 'pro@origo.be',
    phone: process.env.COMPANY_PHONE ?? '+32 468 08 96 03',
    vat: process.env.COMPANY_VAT ?? '',
    tvaRate: Number(process.env.TVA_RATE ?? '0.21'),
  },
  /** Fenêtre client pour modifier / annuler seul (ms) */
  delaiModificationMs: Number(process.env.DELAI_MODIFICATION_MS ?? String(60 * 60 * 1000)),
  /**
   * Validité des URLs signées de `/uploads` (secondes). Assez long pour qu’un onglet
   * resté ouvert affiche encore ses images, assez court pour qu’une URL copiée dans
   * un e-mail ne soit pas éternelle.
   */
  uploadsUrlTtlS: Number(process.env.UPLOADS_URL_TTL_S ?? String(6 * 3600)),
  /**
   * Dossier où le job de dump écrit `origo.last_ok` / `origo.last_fail`.
   * Vide en local : `/ready` signale « inconnu », l’API reste up.
   */
  backupStatusDir: process.env.BACKUP_STATUS_DIR?.trim() || '',
  publicUrl: (process.env.PUBLIC_URL?.trim() || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').replace(/\/$/, ''),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '',
    actif: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
  },
  sms: {
    accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() ?? '',
    token: process.env.TWILIO_AUTH_TOKEN?.trim() ?? '',
    from: process.env.TWILIO_FROM?.trim() ?? '',
    actif: Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim() &&
        process.env.TWILIO_AUTH_TOKEN?.trim() &&
        process.env.TWILIO_FROM?.trim(),
    ),
  },
}
