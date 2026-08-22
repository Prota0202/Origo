import { useState } from 'react'
import { LogIn, AlertCircle } from 'lucide-react'
import { useCompany } from '../company.jsx'

export default function Login({ onLogin }) {
  const company = useCompany()
  const [code, setCode] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState(null)

  const [loading, setLoading] = useState(false)

  const connecter = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErreur(null)
    try {
      const err = await onLogin(code, motDePasse)
      if (err) setErreur(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-hero">
        <span className="logo">origo<span className="logo-dot" aria-hidden="true" /></span>
        <p>Espace professionnel</p>
      </div>
      <form className="login-card" onSubmit={connecter}>
        <h1 className="page-title">Connexion</h1>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          Restaurants et équipe ORIGO
        </p>

        <label className="champ">
          <span>Code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Votre code"
            autoComplete="username"
            autoCapitalize="characters"
            required
          />
        </label>

        <label className="champ">
          <span>Mot de passe</span>
          <input
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            placeholder="••••"
            autoComplete="current-password"
            required
          />
        </label>

        {erreur && (
          <div className="alerte-min" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{erreur}</span>
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          <LogIn size={18} aria-hidden="true" /> {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="login-aide">
          Pas encore de compte&nbsp;? Appelez{' '}
          <a href={company.phoneLink}>{company.phone}</a>
          {' '}ou écrivez à{' '}
          <a href={`mailto:${company.email}`}>{company.email}</a>.
        </p>
        <p className="login-aide">{company.address}</p>
      </form>
    </div>
  )
}
