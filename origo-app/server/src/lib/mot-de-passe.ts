import { env } from '../config/env.js'
import { ValidationError } from './errors.js'

/** Mots de passe du seed / trop courants : refusés à la création et au changement. */
export const MOTS_DE_PASSE_INTERDITS = [
  '1234',
  '123456',
  '12345678',
  'password',
  'motdepasse',
  'changeme',
  'admin',
  'admin2026',
  'prepa2026',
  'livreur2026',
  'origo',
  'origo2026',
  'azerty',
  'azerty123',
]

export function longueurMinMotDePasse() {
  return env.isProd ? 12 : 8
}

export function estMotDePasseInterdit(motDePasse: string) {
  return MOTS_DE_PASSE_INTERDITS.includes(motDePasse.trim().toLowerCase())
}

export function assertMotDePasseAcceptable(motDePasse: string) {
  const min = longueurMinMotDePasse()
  if (motDePasse.length < min) {
    throw new ValidationError(`Mot de passe : ${min} caractères minimum`)
  }
  if (estMotDePasseInterdit(motDePasse)) {
    throw new ValidationError('Ce mot de passe est trop courant — choisis-en un autre')
  }
}
