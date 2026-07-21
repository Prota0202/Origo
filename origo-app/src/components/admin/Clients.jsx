import { useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { euros, pourcentagePalier, formatPourcentage } from '../../data.js'
import { ClientsApi } from '../../api/index.js'
import { slug } from './utils.js'

export function ClientForm({ client, produits, onSave, onClose }) {
  const [f, setF] = useState(
    client
      ? { ...client, paliers: client.paliers ?? {} }
      : { nom: '', ville: '', code: '', motDePasse: '', email: '', minCartons: 5, produits: [], prix: {}, paliers: {} }
  )
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
      <div className="overlay" onClick={onClose} aria-hidden="true" />
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
          <div className="champ-row">
            <label className="champ">
              <span>Code client</span>
              <input type="text" value={f.code} onChange={maj('code')} autoCapitalize="characters" required />
            </label>
            <label className="champ">
              <span>Mot de passe{client ? ' (laisser vide = inchangé)' : ''}</span>
              <input
                type="text"
                value={f.motDePasse ?? ''}
                onChange={maj('motDePasse')}
                required={!client}
              />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>E-mail</span>
              <input type="email" value={f.email} onChange={maj('email')} />
            </label>
            <label className="champ">
              <span>Min. cartons / livraison</span>
              <input type="number" inputMode="numeric" min="1" value={f.minCartons} onChange={maj('minCartons')} required />
            </label>
          </div>

          <h3 className="categorie-titre" style={{ margin: '8px 0 4px' }}>
            Catalogue personnalisé — {f.produits.length} produit(s)
          </h3>
          <p className="ligne-detail" style={{ marginBottom: 4 }}>
            Cochez les produits visibles par ce client. Laissez le prix vide pour appliquer le tarif catalogue.
            Ajoutez des paliers pour un prix dégressif à partir d'une quantité de votre choix (10, 20…).
          </p>
          {produits.map((p) => {
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
          minCartons: c.minCartons,
          productIds: c.produits,
        })
      } else {
        saved = await ClientsApi.update(c.id, {
          nom: c.nom,
          ville: c.ville,
          email: c.email,
          minCartons: c.minCartons,
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
    if (!window.confirm(`Désactiver le compte « ${c.nom} » ?`)) return
    try {
      await ClientsApi.update(c.id, { actif: false })
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
              {c.ville} · code {c.code} · {c.produits.length} produits · min. {c.minCartons} cartons
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
