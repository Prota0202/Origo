import { useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { euros, pourcentagePalier, formatPourcentage } from '../../data.js'
import { ClientsApi } from '../../api/index.js'
import { slug } from './utils.js'
import { useCompany } from '../../company.jsx'
import Overlay from '../Overlay.jsx'

const CAL_DEFAUT = { type: 'jours_mois', jours: [15, -1] }
const JOURS_FR = [
  { id: 1, label: 'lundi' },
  { id: 2, label: 'mardi' },
  { id: 3, label: 'mercredi' },
  { id: 4, label: 'jeudi' },
  { id: 5, label: 'vendredi' },
  { id: 6, label: 'samedi' },
  { id: 7, label: 'dimanche' },
]

function calendrierInitial(client) {
  return client?.sepaCalendrier ?? CAL_DEFAUT
}

function CalendrierSepaChamp({ valeur, jourMoisAjout, setJourMoisAjout, onChange }) {
  const cal = valeur ?? CAL_DEFAUT
  const jours = cal.type === 'jours_mois' ? cal.jours ?? [15, -1] : [15, -1]

  const changerType = (type) => {
    if (type === 'hebdo') onChange({ type: 'hebdo', jour: 1 })
    else if (type === 'intervalle') {
      const aujourdHui = new Date().toISOString().slice(0, 10)
      onChange({ type: 'intervalle', jours: 21, depuis: aujourdHui })
    } else onChange({ type: 'jours_mois', jours: [15, -1] })
  }

  const toggleJourMois = (n) => {
    const next = jours.includes(n) ? jours.filter((j) => j !== n) : [...jours, n]
    onChange({ type: 'jours_mois', jours: next.length > 0 ? next : [15] })
  }

  const ajouterJour = () => {
    const n = Number(jourMoisAjout)
    if (!Number.isInteger(n) || n < 1 || n > 31) return
    if (!jours.includes(n)) onChange({ type: 'jours_mois', jours: [...jours, n].sort((a, b) => a - b) })
    setJourMoisAjout('')
  }

  return (
    <div className="champ" style={{ marginBottom: 12 }}>
      <span>Dates de prélèvement</span>
      <select value={cal.type} onChange={(e) => changerType(e.target.value)}>
        <option value="jours_mois">Jours du mois (1×, 2×…)</option>
        <option value="hebdo">1× par semaine</option>
        <option value="intervalle">Tous les N jours (ex. 3 semaines)</option>
      </select>
      {cal.type === 'jours_mois' && (
        <div style={{ marginTop: 8 }}>
          <p className="ligne-detail" style={{ marginBottom: 6 }}>Coche les jours. « Fin de mois » = dernier jour civil.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {[1, 15].map((n) => (
              <label key={n} className="check-label" style={{ margin: 0 }}>
                <input type="checkbox" checked={jours.includes(n)} onChange={() => toggleJourMois(n)} />
                <span>le {n}</span>
              </label>
            ))}
            <label className="check-label" style={{ margin: 0 }}>
              <input type="checkbox" checked={jours.includes(-1)} onChange={() => toggleJourMois(-1)} />
              <span>fin de mois</span>
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>Autre jour (1–31)</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="31"
                value={jourMoisAjout}
                onChange={(e) => setJourMoisAjout(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-ghost" style={{ alignSelf: 'end', minHeight: 40 }} onClick={ajouterJour}>
              Ajouter
            </button>
          </div>
          {jours.filter((j) => j !== 1 && j !== 15 && j !== -1).length > 0 && (
            <p className="ligne-detail">
              Aussi : {jours.filter((j) => j !== 1 && j !== 15 && j !== -1).map((j) => `le ${j}`).join(', ')}
            </p>
          )}
        </div>
      )}
      {cal.type === 'hebdo' && (
        <label className="champ" style={{ marginTop: 8 }}>
          <span>Jour de la semaine</span>
          <select value={cal.jour} onChange={(e) => onChange({ type: 'hebdo', jour: Number(e.target.value) })}>
            {JOURS_FR.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        </label>
      )}
      {cal.type === 'intervalle' && (
        <div className="champ-row" style={{ marginTop: 8 }}>
          <label className="champ">
            <span>Tous les (jours)</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="366"
              value={cal.jours}
              onChange={(e) => onChange({ ...cal, jours: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="champ">
            <span>À partir du</span>
            <input
              type="date"
              value={cal.depuis}
              onChange={(e) => onChange({ ...cal, depuis: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  )
}

export function ClientForm({ client, produits, onSave, onClose }) {
  const { mdpMinCaracteres: mdpMin = 12 } = useCompany()
  const [f, setF] = useState(
    client
      ? { ...client, paliers: client.paliers ?? {}, sepaCalendrier: calendrierInitial(client) }
      : {
          nom: '', ville: '', adresse: '', telephone: '', numeroTva: '', code: '', motDePasse: '',
          email: '', minCartons: 5, modePaiement: 'sepa', sepaCalendrier: CAL_DEFAUT,
          produits: [], prix: {}, paliers: {},
        }
  )
  const [jourMoisAjout, setJourMoisAjout] = useState('')
  const maj = (champ) => (e) => setF({ ...f, [champ]: e.target.value })

  const basculerProduit = (id) =>
    setF((prev) => ({
      ...prev,
      produits: prev.produits.includes(id)
        ? prev.produits.filter((x) => x !== id)
        : [...prev.produits, id],
    }))

  const majPrix = (id) => (e) => {
    const v = e.target.value
    setF((prev) => {
      const prix = { ...(prev.prix ?? {}) }
      if (v === '') delete prix[id]
      else prix[id] = Number(v)
      return { ...prev, prix }
    })
  }

  // Tarifs par palier : l'admin choisit librement le seuil (10, 20, ou
  // n'importe quel multiple) et le prix par carton pour chaque palier.
  const ajouterPalier = (id) =>
    setF((prev) => {
      const paliers = prev.paliers?.[id] ?? []
      const seuil = (paliers.at(-1)?.seuil || 0) + 10
      return { ...prev, paliers: { ...prev.paliers, [id]: [...paliers, { seuil, prix: '' }] } }
    })

  const majPalierSeuil = (id, index) => (e) => {
    const v = e.target.value
    setF((prev) => {
      const paliers = [...(prev.paliers?.[id] ?? [])]
      paliers[index] = { ...paliers[index], seuil: v === '' ? '' : Number(v) }
      return { ...prev, paliers: { ...prev.paliers, [id]: paliers } }
    })
  }

  const majPalierPrix = (id, index) => (e) => {
    const prix = e.target.value
    setF((prev) => {
      const paliers = [...(prev.paliers?.[id] ?? [])]
      paliers[index] = { ...paliers[index], prix }
      return { ...prev, paliers: { ...prev.paliers, [id]: paliers } }
    })
  }

  const supprimerPalier = (id, index) =>
    setF((prev) => ({
      ...prev,
      paliers: { ...prev.paliers, [id]: (prev.paliers?.[id] ?? []).filter((_, i) => i !== index) },
    }))

  const enregistrer = (e) => {
    e.preventDefault()
    const paliers = Object.fromEntries(
      Object.entries(f.paliers ?? {})
        .map(([id, liste]) => [
          id,
          liste
            .filter((p) => p.prix !== '' && p.seuil !== '' && !Number.isNaN(Number(p.seuil)))
            .map((p) => ({ seuil: Number(p.seuil), prix: Number(p.prix) }))
            .sort((a, b) => a.seuil - b.seuil),
        ])
        .filter(([, liste]) => liste.length > 0)
    )
    onSave({ ...f, id: client?.id ?? slug(f.nom), minCartons: Number(f.minCartons), paliers })
  }

  return (
    <>
      <Overlay onClick={onClose} />
      <form className="sheet" onSubmit={enregistrer} role="dialog" aria-modal="true" aria-labelledby="titre-client-form">
        <div className="sheet-header">
          <h2 id="titre-client-form" className="sheet-title">
            {client ? client.nom : 'Nouveau client'}
          </h2>
          <button type="button" className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body form-body">
          <div className="champ-row">
            <label className="champ">
              <span>Nom du restaurant</span>
              <input type="text" value={f.nom} onChange={maj('nom')} required />
            </label>
            <label className="champ">
              <span>Ville</span>
              <input type="text" value={f.ville} onChange={maj('ville')} />
            </label>
          </div>
          <label className="champ">
            <span>Adresse de livraison</span>
            <input type="text" value={f.adresse ?? ''} onChange={maj('adresse')} placeholder="Rue, n°, code postal" required />
          </label>
          <div className="champ-row">
            <label className="champ">
              <span>Téléphone</span>
              <input type="tel" value={f.telephone ?? ''} onChange={maj('telephone')} required />
            </label>
            <label className="champ">
              <span>N° TVA (si connu)</span>
              <input type="text" value={f.numeroTva ?? ''} onChange={maj('numeroTva')} placeholder="BE0…" />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>Code client</span>
              <input type="text" value={f.code} onChange={maj('code')} autoCapitalize="characters" required />
            </label>
            <label className="champ">
              <span>
                Mot de passe{client ? ' (laisser vide = inchangé)' : ` (${mdpMin} caractères minimum)`}
              </span>
              <input
                type="password"
                value={f.motDePasse ?? ''}
                onChange={maj('motDePasse')}
                required={!client}
                minLength={f.motDePasse ? mdpMin : undefined}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>E-mail</span>
              <input type="email" value={f.email} onChange={maj('email')} placeholder="utile pour le mandat SEPA" />
            </label>
            <label className="champ">
              <span>Franco de port</span>
              <input type="text" value="dès 150 € HT" disabled readOnly />
            </label>
            <label className="champ">
              <span>Paiement</span>
              <select value={f.modePaiement ?? 'sepa'} onChange={maj('modePaiement')}>
                <option value="sepa">Domiciliation SEPA (dates au choix)</option>
                <option value="stripe">Carte (Stripe) à la commande</option>
                <option value="virement">Virement</option>
              </select>
            </label>
          </div>
          {(f.modePaiement ?? 'sepa') === 'sepa' && (
            <CalendrierSepaChamp
              valeur={f.sepaCalendrier ?? CAL_DEFAUT}
              jourMoisAjout={jourMoisAjout}
              setJourMoisAjout={setJourMoisAjout}
              onChange={(sepaCalendrier) => setF((prev) => ({ ...prev, sepaCalendrier }))}
            />
          )}

          <h3 className="categorie-titre" style={{ margin: '8px 0 4px' }}>
            Catalogue personnalisé — {f.produits.length} produit(s)
          </h3>
          <p className="ligne-detail" style={{ marginBottom: 4 }}>
            Cochez les produits visibles par ce client. Laissez le prix vide pour appliquer le tarif catalogue.
            Ajoutez des paliers pour un prix dégressif à partir d'une quantité de votre choix (10, 20…).
          </p>
          {produits.filter((p) => p.actif !== false || f.produits.includes(p.id)).map((p) => {
            const actif = f.produits.includes(p.id)
            const paliers = f.paliers?.[p.id] ?? []
            const prixBase = f.prix?.[p.id] !== undefined && f.prix[p.id] !== '' ? Number(f.prix[p.id]) : p.prixCarton
            return (
              <div key={p.id} className={`check-ligne ${actif ? 'actif' : ''}`}>
                <div className="check-ligne-top">
                  <label className="check-label">
                    <input type="checkbox" checked={actif} onChange={() => basculerProduit(p.id)} />
                    <span>
                      {p.nom}
                      <small>{euros(p.prixCarton)} HT / carton</small>
                    </span>
                  </label>
                  {actif && (
                    <input
                      className="prix-client"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={f.prix?.[p.id] ?? ''}
                      onChange={majPrix(p.id)}
                      placeholder={String(p.prixCarton)}
                      aria-label={`Prix négocié pour ${p.nom}`}
                    />
                  )}
                </div>
                {actif && (
                  <div className="paliers-client">
                    {paliers.map((palier, i) => (
                      <div key={i} className="palier-ligne">
                        <span className="palier-seuil">dès</span>
                        <input
                          className="palier-seuil-input"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          value={palier.seuil}
                          onChange={majPalierSeuil(p.id, i)}
                          placeholder="cartons"
                          aria-label={`Seuil du palier ${i + 1} pour ${p.nom}`}
                        />
                        <span className="palier-seuil">cartons →</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={palier.prix}
                          onChange={majPalierPrix(p.id, i)}
                          placeholder="prix / carton"
                          aria-label={`Prix du palier ${i + 1} pour ${p.nom}`}
                        />
                        {palier.prix !== '' && (() => {
                          const pct = pourcentagePalier(prixBase, Number(palier.prix))
                          return (
                            <span className="palier-pct" style={pct < 0 ? { color: 'var(--red-600)' } : undefined}>
                              {formatPourcentage(pct)}
                            </span>
                          )
                        })()}
                        <button
                          type="button"
                          className="icon-btn icon-btn-gris"
                          onClick={() => supprimerPalier(p.id, i)}
                          aria-label={`Supprimer le palier ${i + 1} de ${p.nom}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="lien-ajouter-palier" onClick={() => ajouterPalier(p.id)}>
                      <Plus size={13} aria-hidden="true" /> Ajouter un palier
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="sheet-footer">
          <button type="submit" className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </>
  )
}

/* ---------- Onglet Clients ---------- */
export function AdminClients({ produits, clients, setClients, onRefresh }) {
  const [form, setForm] = useState(null)

  const enregistrer = async (c) => {
    try {
      const isNew = !clients.some((x) => x.id === c.id)
      let saved
      if (isNew) {
        saved = await ClientsApi.create({
          code: c.code,
          motDePasse: c.motDePasse,
          nom: c.nom,
          ville: c.ville,
          email: c.email,
          telephone: c.telephone,
          adresse: c.adresse,
          numeroTva: c.numeroTva,
          minCartons: c.minCartons,
          modePaiement: c.modePaiement ?? 'sepa',
          sepaCalendrier: c.modePaiement === 'virement' || c.modePaiement === 'stripe' ? undefined : (c.sepaCalendrier ?? CAL_DEFAUT),
          productIds: c.produits,
        })
      } else {
        saved = await ClientsApi.update(c.id, {
          nom: c.nom,
          ville: c.ville,
          email: c.email,
          telephone: c.telephone,
          adresse: c.adresse,
          numeroTva: c.numeroTva,
          minCartons: c.minCartons,
          modePaiement: c.modePaiement ?? 'sepa',
          sepaCalendrier: c.modePaiement === 'virement' || c.modePaiement === 'stripe' ? undefined : (c.sepaCalendrier ?? CAL_DEFAUT),
          ...(c.motDePasse ? { motDePasse: c.motDePasse } : {}),
        })
      }
      const entries = (c.produits ?? []).map((productId) => ({
        productId,
        prixNegocie: c.prix?.[productId] ?? null,
        visible: true,
      }))
      saved = await ClientsApi.setCatalogue(saved.id, entries)
      for (const [productId, paliers] of Object.entries(c.paliers ?? {})) {
        await ClientsApi.setPaliers(saved.id, productId, paliers)
      }
      await onRefresh?.()
      setForm(null)
    } catch (e) {
      alert(e.message)
    }
  }

  const supprimer = async (c) => {
    if (
      !window.confirm(
        `Supprimer définitivement « ${c.nom} » (code ${c.code}) ? Ses commandes ORIGO sont effacées. Tu pourras recréer le même code.`,
      )
    ) {
      return
    }
    try {
      await ClientsApi.remove(c.id)
      await onRefresh?.()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <section aria-labelledby="titre-admin-clients">
      <h1 id="titre-admin-clients" className="page-title">Clients</h1>
      <p className="page-subtitle">Chaque client ne voit que le catalogue que vous lui attribuez</p>

      <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={() => setForm({ client: null })}>
        <Plus size={18} aria-hidden="true" /> Nouveau client
      </button>

      {clients.map((c) => (
        <article key={c.id} className="commande-card admin-ligne">
          <div className="ligne-infos">
            <p className="ligne-nom">
              {c.nom}
              {c.actif === false && (
                <span className="statut statut-annulee" style={{ marginLeft: 8, fontSize: 11 }}>inactif</span>
              )}
            </p>
            <p className="ligne-detail">
              {[c.ville, c.adresse, c.telephone, `code ${c.code}`].filter(Boolean).join(' · ')}
              {` · ${c.produits.length} produits · franco dès 150 € HT`}
              {(c.modePaiement ?? 'sepa') === 'stripe'
                ? ' · carte'
                : (c.modePaiement ?? 'sepa') === 'virement'
                  ? ' · virement'
                  : c.sepaMandatOk
                    ? ` · SEPA ${c.sepaCalendrierLibelle || ''} ••••${c.sepaIbanLast4 || 'iban'}`
                    : ` · SEPA ${c.sepaCalendrierLibelle || ''} sans mandat`}
              {Object.keys(c.prix ?? {}).length > 0 && ` · ${Object.keys(c.prix).length} prix négocié(s)`}
              {Object.keys(c.paliers ?? {}).length > 0 && ` · ${Object.keys(c.paliers).length} palier(s) de prix`}
            </p>
          </div>
          <div className="admin-actions">
            <button className="icon-btn icon-btn-gris" onClick={() => setForm({ client: c })} aria-label={`Modifier ${c.nom}`}>
              <Pencil size={18} />
            </button>
            <button className="icon-btn icon-btn-gris" onClick={() => supprimer(c)} aria-label={`Supprimer ${c.nom}`}>
              <Trash2 size={18} />
            </button>
          </div>
        </article>
      ))}

      {form && (
        <ClientForm client={form.client} produits={produits} onSave={enregistrer} onClose={() => setForm(null)} />
      )}
    </section>
  )
}
