import bcrypt from 'bcryptjs'

/** 12 en prod (plus lent à brute-forcer) ; 10 en local pour ne pas ralentir le seed. */
const ROUNDS = process.env.NODE_ENV === 'production' ? 12 : 10

/** Hash figé au 1er appel : un login sur un code inexistant doit durer autant qu’un vrai bcrypt.compare. */
let hashLeurreMemo: string | undefined

export function hashLeurre(): string {
  if (!hashLeurreMemo) hashLeurreMemo = bcrypt.hashSync('origo-timing-pad', ROUNDS)
  return hashLeurreMemo
}

export async function hasherMotDePasse(motDePasse: string): Promise<string> {
  return bcrypt.hash(motDePasse, ROUNDS)
}

export async function verifierMotDePasse(motDePasse: string, hash: string): Promise<boolean> {
  return bcrypt.compare(motDePasse, hash)
}
