function requis(nom: string, fallback?: string): string {
  const v = process.env[nom] ?? fallback
  if (!v) throw new Error(`Variable d'environnement manquante : ${nom}`)
  return v
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: requis('JWT_SECRET', 'dev-origo-jwt-secret-change-in-prod'),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
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
