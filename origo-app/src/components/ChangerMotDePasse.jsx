import { useState } from 'react'
import { AuthApi } from '../api/index.js'
import { useCompany } from '../company.jsx'

export default function ChangerMotDePasse({ obligatoire = false, onChange }) {
  const { mdpMinCaracteres = 12 } = useCompany()
  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [msg, setMsg] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  const enregistrer = async (e) => {
    e.preventDefault()
    setMsg('')
    setErreur('')
    setEnCours(true)
    try {
      const res = await AuthApi.changerMotDePasse(actuel, nouveau)
      setActuel('')
      setNouveau('')
      setMsg('Mot de passe mis à jour.')
      if (res?.user) onChange?.(res)
    } catch (err) {
      setErreur(err.message)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <form className="commande-card" style={{ marginTop: obligatoire ? 0 : 20 }} onSubmit={enregistrer}>
      <p className="ligne-nom">
        {obligatoire ? 'Mot de passe à changer' : 'Changer le mot de passe'}
      </p>
      <label className="champ">
        <span>Mot de passe actuel</span>
        <input
          type="password"
          autoComplete="current-password"
          value={actuel}
          onChange={(e) => setActuel(e.target.value)}
          required
        />
      </label>
      <label className="champ">
        <span>Nouveau mot de passe ({mdpMinCaracteres} caractères minimum)</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={mdpMinCaracteres}
          value={nouveau}
          onChange={(e) => setNouveau(e.target.value)}
          required
        />
      </label>
      {msg && <p className="ligne-detail">{msg}</p>}
      {erreur && (
        <p className="ligne-detail" role="alert" style={{ color: 'var(--red-600)' }}>
          {erreur}
        </p>
      )}
      <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }} disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Mettre à jour'}
      </button>
    </form>
  )
}
