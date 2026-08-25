import { prisma } from './prisma.js'

type Typ = 'staff' | 'client'

export type CompteSession = {
  actif: boolean
  sessionVersion: number
  mdpAChanger: boolean
  role?: 'DIRECTION' | 'PREPARATION' | 'LIVREUR'
}

/** Cache court : 200 restos qui pollent ne doivent pas chacun faire un SELECT à chaque requête. */
const CACHE_MS = 3_000
const cache = new Map<string, { v: CompteSession; exp: number }>()

function cle(typ: Typ, id: string) {
  return `${typ}:${id}`
}

export function oublierSession(typ: Typ, id: string) {
  cache.delete(cle(typ, id))
}

export async function incrementerSession(typ: Typ, id: string): Promise<number> {
  const data = { sessionVersion: { increment: 1 as const } }
  const row =
    typ === 'staff'
      ? await prisma.staff.update({ where: { id }, data, select: { sessionVersion: true } })
      : await prisma.client.update({ where: { id }, data, select: { sessionVersion: true } })
  oublierSession(typ, id)
  return row.sessionVersion
}

export async function lireCompteSession(typ: Typ, id: string): Promise<CompteSession | null> {
  const k = cle(typ, id)
  const now = Date.now()
  const hit = cache.get(k)
  if (hit && hit.exp > now) return hit.v

  let compte: CompteSession | null = null
  if (typ === 'staff') {
    const v = await prisma.staff.findUnique({
      where: { id },
      select: { actif: true, sessionVersion: true, mdpAChanger: true, role: true },
    })
    if (v) {
      compte = {
        actif: v.actif,
        sessionVersion: v.sessionVersion,
        mdpAChanger: v.mdpAChanger,
        role: v.role,
      }
    }
  } else {
    const v = await prisma.client.findUnique({
      where: { id },
      select: { actif: true, sessionVersion: true, mdpAChanger: true },
    })
    if (v) {
      compte = {
        actif: v.actif,
        sessionVersion: v.sessionVersion,
        mdpAChanger: v.mdpAChanger,
      }
    }
  }
  if (!compte) {
    cache.delete(k)
    return null
  }
  cache.set(k, { v: compte, exp: now + CACHE_MS })
  return compte
}
