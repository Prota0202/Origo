import { useEffect, useState } from 'react'
import { Plus, Pencil, UserX, X } from 'lucide-react'
import { StaffApi } from '../../api/index.js'
import { useCompany } from '../../company.jsx'
import Overlay from '../Overlay.jsx'

const ROLES = [
  { id: 'direction', label: 'Direction' },
  { id: 'preparation', label: 'Préparation' },
  { id: 'livreur', label: 'Livreur' },
]

function libelleRole(role) {
  return ROLES.find((r) => r.id === role)?.label ?? role
}

function FormStaff({ compte, onSave, onClose }) {
  const { mdpMinCaracteres: mdpMin = 12 } = useCompany()
  const [f, setF] = useState(
    compte
      ? { nom: compte.nom, code: compte.code, role: compte.role, motDePasse: '' }
      : { nom: '', code: '', role: 'preparation', motDePasse: '' },
  )
  const maj = (champ) => (e) => setF({ ...f, [champ]: e.target.value })

  return (
    <>
      <Overlay onClick={onClose} />
      <form
        className="sheet"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(f)
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-staff-form"
      >
        <div className="sheet-header">
          <h2 id="titre-staff-form" className="sheet-title">
            {compte ? compte.nom : 'Nouveau compte'}
          </h2>
          <button type="button" className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body form-body">
          <label className="champ">
            <span>Nom</span>
            <input type="text" value={f.nom} onChange={maj('nom')} required />
          </label>
          {!compte && (
            <label className="champ">
              <span>Code de connexion</span>
              <input type="text" value={f.code} onChange={maj('code')} autoCapitalize="characters" required />
            </label>
          )}
          <label className="champ">
            <span>Rôle</span>
            <select value={f.role} onChange={maj('role')}>
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="champ">
            <span>Mot de passe{compte ? ' (laisser vide = inchangé)' : ` (${mdpMin} caractères minimum)`}</span>
            <input
              type="password"
              value={f.motDePasse}
              onChange={maj('motDePasse')}
              required={!compte}
              minLength={f.motDePasse ? mdpMin : undefined}
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className="sheet-footer">
          <button type="submit" className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </>
  )
}

export function AdminEquipe() {
  const [liste, setListe] = useState([])
  const [form, setForm] = useState(null)
  const [erreur, setErreur] = useState('')

  const charger = async () => {
    try {
      setListe(await StaffApi.list())
    } catch (e) {
      setErreur(e.message)
    }
  }

  useEffect(() => { void charger() }, [])

  const enregistrer = async (f) => {
    try {
      if (form?.compte) {
        await StaffApi.update(form.compte.id, {
          nom: f.nom,
          role: f.role,
          ...(f.motDePasse ? { motDePasse: f.motDePasse } : {}),
        })
      } else {
        await StaffApi.create({
          nom: f.nom,
          code: f.code,
          role: f.role,
          motDePasse: f.motDePasse,
        })
      }
      setForm(null)
      await charger()
    } catch (e) {
      alert(e.message)
    }
  }

  const desactiver = async (s) => {
    if (!window.confirm(`Désactiver le compte « ${s.nom} » (${s.code}) ?`)) return
    try {
      await StaffApi.update(s.id, { actif: false })
      await charger()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <section aria-labelledby="titre-equipe">
      <h1 id="titre-equipe" className="page-title">Équipe</h1>
      <p className="page-subtitle">Comptes préparation et livreur — indispensables pour faire tourner ORIGO</p>
      {erreur && <p className="page-subtitle" style={{ color: 'var(--red-600)' }}>{erreur}</p>}

      <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={() => setForm({ compte: null })}>
        <Plus size={18} aria-hidden="true" /> Nouveau compte
      </button>

      {liste.map((s) => (
        <article key={s.id} className="commande-card admin-ligne">
          <div className="ligne-infos">
            <p className="ligne-nom">
              {s.nom}
              {s.actif === false && (
                <span className="statut statut-annulee" style={{ marginLeft: 8, fontSize: 11 }}>inactif</span>
              )}
            </p>
            <p className="ligne-detail">{libelleRole(s.role)} · code {s.code}</p>
          </div>
          <div className="admin-actions">
            <button className="icon-btn icon-btn-gris" onClick={() => setForm({ compte: s })} aria-label={`Modifier ${s.nom}`}>
              <Pencil size={18} />
            </button>
            {s.actif !== false && (
              <button className="icon-btn icon-btn-gris" onClick={() => desactiver(s)} aria-label={`Désactiver ${s.nom}`}>
                <UserX size={18} />
              </button>
            )}
          </div>
        </article>
      ))}

      {form && <FormStaff compte={form.compte} onSave={enregistrer} onClose={() => setForm(null)} />}
    </section>
  )
}
