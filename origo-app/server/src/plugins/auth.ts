import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import fjwt from '@fastify/jwt'
import { env } from '../config/env.js'
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js'
import { lireCompteSession } from '../lib/session.js'

export const COOKIE_SESSION = 'origo_session'

function dureeCookieSecondes(expiresIn: string): number {
  const m = /^(\d+)([smhd])$/i.exec(expiresIn.trim())
  if (!m) return 16 * 3600
  const n = Number(m[1])
  switch (m[2].toLowerCase()) {
    case 's':
      return n
    case 'm':
      return n * 60
    case 'h':
      return n * 3600
    case 'd':
      return n * 86400
    default:
      return 16 * 3600
  }
}

const OPTIONS_COOKIE = {
  path: '/',
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'strict' as const,
}

export function poserCookieSession(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_SESSION, token, {
    ...OPTIONS_COOKIE,
    maxAge: dureeCookieSecondes(env.jwtExpiresIn),
  })
}

export function retirerCookieSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE_SESSION, { path: '/' })
}

export type JwtStaff = {
  typ: 'staff'
  sub: string
  role: 'DIRECTION' | 'PREPARATION' | 'LIVREUR'
  code: string
  nom: string
  sv: number
  mdpAChanger?: boolean
}

export type JwtClient = {
  typ: 'client'
  sub: string
  code: string
  nom: string
  sv: number
  mdpAChanger?: boolean
}

export type JwtUser = JwtStaff | JwtClient

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser
    user: JwtUser
  }
}

const ROUTES_MDP_A_CHANGER = new Set(['/api/v1/me/mot-de-passe', '/api/v1/auth/me'])

export async function registerAuth(app: FastifyInstance) {
  await app.register(cookie)
  await app.register(fjwt, {
    secret: env.jwtSecret,
    cookie: {
      cookieName: COOKIE_SESSION,
      signed: false,
    },
  })
}

export function signerSession(app: FastifyInstance, payload: JwtUser) {
  return app.jwt.sign(payload, { expiresIn: env.jwtExpiresIn })
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  try {
    await req.jwtVerify()
  } catch {
    throw new UnauthorizedError()
  }

  const user = req.user
  const compte = await lireCompteSession(user.typ, user.sub)
  if (!compte?.actif || compte.sessionVersion !== (user.sv ?? 0)) {
    throw new UnauthorizedError()
  }
  user.mdpAChanger = compte.mdpAChanger
  if (user.typ === 'staff' && compte.role) user.role = compte.role

  if (!user.mdpAChanger) return
  const chemin = req.url.split('?')[0]
  if (ROUTES_MDP_A_CHANGER.has(chemin)) return
  throw new ForbiddenError('Changez votre mot de passe avant de continuer', 'MDP_A_CHANGER')
}

export function requireStaff(...roles: JwtStaff['role'][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply)
    const user = req.user
    if (user.typ !== 'staff') throw new ForbiddenError()
    if (roles.length > 0 && !roles.includes(user.role)) {
      throw new ForbiddenError('Rôle insuffisant')
    }
  }
}

export async function requireClient(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply)
  if (req.user.typ !== 'client') throw new ForbiddenError()
}
