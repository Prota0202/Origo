import bcrypt from 'bcryptjs'

const ROUNDS = 10

export async function hasherMotDePasse(motDePasse: string): Promise<string> {
  return bcrypt.hash(motDePasse, ROUNDS)
}

export async function verifierMotDePasse(motDePasse: string, hash: string): Promise<boolean> {
  return bcrypt.compare(motDePasse, hash)
}
