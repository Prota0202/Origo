import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fjwt from '@fastify/jwt'
import { env } from '../config/env.js'
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js'

export type JwtStaff = {
  typ: 'staff'
  sub: string
  role: 'DIRECTION' | 'PREPARATION' | 'LIVREUR'
  code: string
  nom: string
  mdpAChanger?: boolean
}

export type JwtClient = {
  typ: 'client'
  sub: string
  code: string
  nom: string
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
  await app.register(fjwt, { secret: env.jwtSecret })
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

  if (!req.user.mdpAChanger) return
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
