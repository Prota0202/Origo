import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Package, Users, ReceiptText, LogOut, Plus, Pencil, Trash2, X,
  ClipboardList, ClipboardCheck, AlertTriangle, Download, Printer, Euro, TrendingUp, UserX, ImagePlus, ImageOff,
  Crop, Ban, PackageCheck, Undo2, Truck, RotateCcw, Clock, Camera, Send, Check,
} from 'lucide-react'
import { euros, pourcentagePalier, formatPourcentage, DELAI_MODIFICATION_MS } from '../data.js'
import { TVA } from '../pdf.js'
import { chargerCommandesClient, sauverCommandesClient, chargerDemandes, sauverDemandes } from '../store.js'
import { chargerImagePourRecadrage } from '../image.js'
import AjusterPhoto from './AjusterPhoto.jsx'
import ModifierCommande from './ModifierCommande.jsx'
import ConfirmerLivraison from './ConfirmerLivraison.jsx'
import RetourCommande from './RetourCommande.jsx'

const TOUS_TABS = [
  { id: 'dashboard', label: 'Tableau', icon: LayoutDashboard, roles: ['direction'] },
  { id: 'produits', label: 'Produits', icon: Package, roles: ['direction'] },
  { id: 'clients', label: 'Clients', icon: Users, roles: ['direction'] },
  { id: 'commandes', label: 'Commandes', icon: ReceiptText, roles: ['direction', 'preparation'] },
  { id: 'retours', label: 'Retours', icon: Undo2, roles: ['direction', 'preparation'] },
]

const JOUR = 24 * 60 * 60 * 1000

const slug = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `id-${Date.now()}`

const chargerToutes = (clients) =>
  clients.flatMap((c) =>
    chargerCommandesClient(c.id).map((cmd) => ({ ...cmd, clientId: c.id, clientNom: c.nom, clientVille: c.ville }))
  )

const formatRestant = (ms) => {
  const min = Math.max(0, Math.ceil(ms / 60000))
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim()
  return `${min} min`
}

/* ---------- Tableau de bord ---------- */
function Dashboard({ produits, clients, setClients }) {
  const [toutes, setToutes] = useState([])
  useEffect(() => setToutes(chargerToutes(clients)), [clients])

  const [demandes, setDemandes] = useState(chargerDemandes)
  // Demande en cours d'acceptation : on ne l'ajoute au client qu'une fois un
  // tarif fixé pour lui, jamais au prix catalogue par défaut sans y penser.
  const [demandeOuverte, setDemandeOuverte] = useState(null)
  const [prixPropose, setPrixPropose] = useState('')

  const retirerDemande = (id) => {
    setDemandes((prev) => {
      const suivant = prev.filter((d) => d.id !== id)
      sauverDemandes(suivant)
      return suivant
    })
  }

  const ouvrirAcceptation = (demande, produit) => {
    setDemandeOuverte(demande.id)
    setPrixPropose(String(produit?.prixCarton ?? ''))
  }

  const validerAcceptation = (demande) => {
    const valeur = Number(prixPropose)
    if (!(valeur > 0)) return
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== demande.clientId) return c
        const produits2 = c.produits.includes(demande.produitId) ? c.produits : [...c.produits, demande.produitId]
        return { ...c, produits: produits2, prix: { ...(c.prix ?? {}), [demande.produitId]: valeur } }
      })
    )
    retirerDemande(demande.id)
    setDemandeOuverte(null)
  }

  const ignorerDemande = (demande) => {
    retirerDemande(demande.id)
    if (demandeOuverte === demande.id) setDemandeOuverte(null)
  }

  const maintenant = new Date()
  const duMois = toutes.filter((c) => {
    if (!c.ts) return false
    const d = new Date(c.ts)
    return d.getMonth() === maintenant.getMonth() && d.getFullYear() === maintenant.getFullYear()
  })
  const caMois = duMois.reduce((s, c) => s + c.total, 0)
  const enAttente = toutes.filter((c) => !c.payee).reduce((s, c) => s + c.total * (1 + TVA), 0)

  // Top produits (cartons, tous temps)
  const parProduit = {}
  toutes.forEach((c) =>
    c.lignes.forEach((l) => {
      parProduit[l.id] = parProduit[l.id] ?? { nom: l.nom.replace(/ \(remise.*\)$/, ''), cartons: 0 }
      parProduit[l.id].cartons += l.qty
    })
  )
  const top = Object.values(parProduit).sort((a, b) => b.cartons - a.cartons).slice(0, 3)

  // Clients inactifs : aucune commande depuis 21 jours
  const inactifs = clients.filter((c) => {
    const cmds = toutes.filter((x) => x.clientId === c.id && x.ts)
    if (cmds.length === 0) return true
    return Math.max(...cmds.map((x) => x.ts)) < Date.now() - 21 * JOUR
  })

  const alertesStock = produits.filter((p) => (p.stock ?? 0) <= (p.seuilAlerte ?? 10))

  const exporterCSV = () => {
    const lignes = [
      ['Numéro', 'Client', 'Date', 'Cartons', 'Total HT', 'TVA', 'Total TTC', 'Statut', 'Payée'],
      ...duMois.map((c) => [
        c.numero, c.clientNom, c.date, c.cartons,
        c.total.toFixed(2), (c.total * TVA).toFixed(2), (c.total * (1 + TVA)).toFixed(2),
        c.statut, c.payee ? 'Oui' : 'Non',
      ]),
    ]
    const csv = lignes.map((l) => l.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `factures-origo-${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section aria-labelledby="titre-dashboard">
      <h1 id="titre-dashboard" className="page-title">Tableau de bord</h1>
      <p className="page-subtitle">
        {maintenant.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
      </p>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-valeur">{euros(caMois)}</span>
          <span className="stat-label">CA HT du mois</span>
        </div>
        <div className="stat-card">
          <span className="stat-valeur">{duMois.length}</span>
          <span className="stat-label">Commandes du mois</span>
        </div>
        <div className="stat-card">
          <span className="stat-valeur">{euros(enAttente)}</span>
          <span className="stat-label">Encours TTC à encaisser</span>
        </div>
        <div className="stat-card">
          <span className="stat-valeur">{clients.length}</span>
          <span className="stat-label">Clients actifs</span>
        </div>
      </div>

      <h2 className="categorie-titre"><Send size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Demandes de produits hors catalogue</h2>
      {demandes.length === 0 ? (
        <p className="page-subtitle">Aucune demande en attente.</p>
      ) : (
        demandes.map((d) => {
          const produit = produits.find((p) => p.id === d.produitId)
          const enCours = demandeOuverte === d.id
          return (
            <div key={d.id} className={`commande-card ${enCours ? '' : 'admin-ligne'}`}>
              <div className="ligne-infos">
                <p className="ligne-nom">{d.produitNom}</p>
                <p className="ligne-detail">
                  {d.clientNom}{produit && ` · ${euros(produit.prixCarton)} tarif catalogue`}
                </p>
              </div>
              {enCours ? (
                <div style={{ marginTop: 10 }}>
                  <label className="champ">
                    <span>Tarif pour {d.clientNom} (€ / carton)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={prixPropose}
                      onChange={(e) => setPrixPropose(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <div className="admin-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost" onClick={() => setDemandeOuverte(null)}>
                      Annuler
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={!(Number(prixPropose) > 0)}
                      onClick={() => validerAcceptation(d)}
                    >
                      <Check size={16} aria-hidden="true" /> Valider et ajouter au catalogue
                    </button>
                  </div>
                </div>
              ) : (
                <div className="admin-actions">
                  <button
                    className="icon-btn icon-btn-gris"
                    onClick={() => ignorerDemande(d)}
                    aria-label={`Ignorer la demande de ${d.clientNom} pour ${d.produitNom}`}
                  >
                    <X size={18} />
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ minHeight: 40 }}
                    onClick={() => ouvrirAcceptation(d, produit)}
                  >
                    <Check size={16} aria-hidden="true" /> Fixer un tarif
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}

      <h2 className="categorie-titre"><TrendingUp size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Top produits</h2>
      {top.length === 0 ? (
        <p className="page-subtitle">Aucune commande enregistrée pour l’instant.</p>
      ) : (
        top.map((p, i) => (
          <div key={p.nom} className="commande-card admin-ligne">
            <div className="ligne-infos">
              <p className="ligne-nom">{i + 1}. {p.nom}</p>
              <p className="ligne-detail">{p.cartons} cartons commandés</p>
            </div>
          </div>
        ))
      )}

      <h2 className="categorie-titre"><AlertTriangle size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Alertes stock</h2>
      {alertesStock.length === 0 ? (
        <p className="page-subtitle">Aucune alerte : tous les stocks sont au-dessus du seuil.</p>
      ) : (
        alertesStock.map((p) => (
          <div key={p.id} className="commande-card admin-ligne alerte-stock">
            <div className="ligne-infos">
              <p className="ligne-nom">{p.nom}</p>
              <p className="ligne-detail">
                {(p.stock ?? 0) <= 0 ? 'Rupture de stock' : `${p.stock} cartons restants (seuil : ${p.seuilAlerte})`}
              </p>
            </div>
          </div>
        ))
      )}

      <h2 className="categorie-titre"><UserX size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Clients à relancer (21 j sans commande)</h2>
      {inactifs.length === 0 ? (
        <p className="page-subtitle">Tous vos clients ont commandé récemment.</p>
      ) : (
        inactifs.map((c) => (
          <div key={c.id} className="commande-card admin-ligne">
            <div className="ligne-infos">
              <p className="ligne-nom">{c.nom}</p>
              <p className="ligne-detail">{c.ville} · {c.email || 'pas d’e-mail'}</p>
            </div>
            {c.email && (
              <a className="btn btn-ghost" style={{ minHeight: 40 }} href={`mailto:${c.email}?subject=${encodeURIComponent('Votre réassort ORIGO')}`}>
                Relancer
              </a>
            )}
          </div>
        ))
      )}

      <button className="btn btn-secondary" style={{ marginTop: 20, width: '100%' }} onClick={exporterCSV}>
        <Download size={18} aria-hidden="true" /> Exporter les factures du mois (CSV)
      </button>
    </section>
  )
}

/* ---------- Fiche produit ---------- */
function ProduitForm({ produit, categories, onSave, onClose }) {
  const [f, setF] = useState(
    produit
      ? { ...produit, remiseSeuil: produit.remise?.seuil ?? '', remisePourcent: produit.remise?.pourcent ?? '' }
      : {
          nom: '', description: '', categorie: categories[0] ?? '', unitesParCarton: '', prixCarton: '',
          stock: 20, seuilAlerte: 10, remiseSeuil: '', remisePourcent: '', photo: null,
        }
  )
  const [erreurPhoto, setErreurPhoto] = useState(null)
  const [photoAAjuster, setPhotoAAjuster] = useState(null)
  const maj = (champ) => (e) => setF({ ...f, [champ]: e.target.value })

  const choisirPhoto = async (e) => {
    const fichier = e.target.files?.[0]
    e.target.value = ''
    if (!fichier) return
    if (!fichier.type.startsWith('image/')) {
      setErreurPhoto('Ce fichier n’est pas une image.')
      return
    }
    try {
      const dataUrl = await chargerImagePourRecadrage(fichier)
      setErreurPhoto(null)
      setPhotoAAjuster(dataUrl)
    } catch {
      setErreurPhoto('Impossible de charger cette image, réessayez.')
    }
  }

  const validerRecadrage = (dataUrl) => {
    setF((prev) => ({ ...prev, photo: dataUrl }))
    setPhotoAAjuster(null)
  }

  const enregistrer = (e) => {
    e.preventDefault()
    const { remiseSeuil, remisePourcent, ...reste } = f
    onSave({
      ...reste,
      id: produit?.id ?? slug(f.nom),
      unitesParCarton: Number(f.unitesParCarton),
      prixCarton: Number(f.prixCarton),
      stock: Number(f.stock),
      seuilAlerte: Number(f.seuilAlerte),
      remise:
        remiseSeuil !== '' && remisePourcent !== ''
          ? { seuil: Number(remiseSeuil), pourcent: Number(remisePourcent) }
          : undefined,
    })
  }

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <form className="sheet" onSubmit={enregistrer} role="dialog" aria-modal="true" aria-labelledby="titre-produit-form">
        <div className="sheet-header">
          <h2 id="titre-produit-form" className="sheet-title">
            {produit ? 'Modifier le produit' : 'Nouveau produit'}
          </h2>
          <button type="button" className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body form-body">
          <div className="champ-photo">
            {f.photo ? (
              <div className="photo-preview">
                <img src={f.photo} alt="" />
                <button type="button" className="photo-suppr" onClick={() => setF((prev) => ({ ...prev, photo: null }))} aria-label="Supprimer la photo">
                  <ImageOff size={16} /> Retirer
                </button>
              </div>
            ) : (
              <label className="photo-vide">
                <ImagePlus size={22} aria-hidden="true" />
                <span>Ajouter une photo</span>
                <input type="file" accept="image/*" onChange={choisirPhoto} style={{ display: 'none' }} />
              </label>
            )}
            {f.photo && (
              <div style={{ display: 'flex', gap: 16 }}>
                <label className="lien-changer-photo">
                  Changer la photo
                  <input type="file" accept="image/*" onChange={choisirPhoto} style={{ display: 'none' }} />
                </label>
                <button type="button" className="lien-ajuster-photo" onClick={() => setPhotoAAjuster(f.photo)}>
                  <Crop size={14} aria-hidden="true" /> Ajuster le cadrage
                </button>
              </div>
            )}
            {erreurPhoto && <p className="erreur-photo">{erreurPhoto}</p>}
          </div>
          <label className="champ">
            <span>Nom du produit</span>
            <input type="text" value={f.nom} onChange={maj('nom')} placeholder="ex. Bol kraft 500 ml" required />
          </label>
          <label className="champ">
            <span>Description</span>
            <input type="text" value={f.description} onChange={maj('description')} placeholder="Courte description" required />
          </label>
          <label className="champ">
            <span>Catégorie</span>
            <input type="text" value={f.categorie} onChange={maj('categorie')} list="categories" placeholder="ex. Vaisselle jetable" required />
            <datalist id="categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <div className="champ-row">
            <label className="champ">
              <span>Pièces / carton</span>
              <input type="number" inputMode="numeric" min="1" value={f.unitesParCarton} onChange={maj('unitesParCarton')} required />
            </label>
            <label className="champ">
              <span>Prix carton HT (€)</span>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={f.prixCarton} onChange={maj('prixCarton')} required />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>Stock (cartons)</span>
              <input type="number" inputMode="numeric" min="0" value={f.stock} onChange={maj('stock')} required />
            </label>
            <label className="champ">
              <span>Seuil d’alerte</span>
              <input type="number" inputMode="numeric" min="0" value={f.seuilAlerte} onChange={maj('seuilAlerte')} required />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>Remise dès (cartons)</span>
              <input type="number" inputMode="numeric" min="2" value={f.remiseSeuil} onChange={maj('remiseSeuil')} placeholder="optionnel" />
            </label>
            <label className="champ">
              <span>Remise (%)</span>
              <input type="number" inputMode="decimal" min="1" max="50" value={f.remisePourcent} onChange={maj('remisePourcent')} placeholder="optionnel" />
            </label>
          </div>
        </div>
        <div className="sheet-footer">
          <button type="submit" className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
      {photoAAjuster && (
        <AjusterPhoto
          src={photoAAjuster}
          onValider={validerRecadrage}
          onAnnuler={() => setPhotoAAjuster(null)}
        />
      )}
    </>
  )
}

/* ---------- Onglet Produits ---------- */
function AdminProduits({ produits, setProduits, clients, setClients }) {
  const [form, setForm] = useState(null)
  const categories = [...new Set(produits.map((p) => p.categorie))]

  const enregistrer = (p) => {
    setProduits((prev) =>
      prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]
    )
    setForm(null)
  }

  const supprimer = (p) => {
    if (!window.confirm(`Supprimer « ${p.nom} » du catalogue ? Il sera retiré de tous les clients.`)) return
    setProduits((prev) => prev.filter((x) => x.id !== p.id))
    setClients((prev) =>
      prev.map((c) => ({
        ...c,
        produits: c.produits.filter((id) => id !== p.id),
        prix: Object.fromEntries(Object.entries(c.prix ?? {}).filter(([id]) => id !== p.id)),
      }))
    )
  }

  return (
    <section aria-labelledby="titre-admin-produits">
      <h1 id="titre-admin-produits" className="page-title">Catalogue général</h1>
      <p className="page-subtitle">{produits.length} produits — visibles uniquement des clients auxquels vous les attribuez</p>

      <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={() => setForm({ produit: null })}>
        <Plus size={18} aria-hidden="true" /> Ajouter un produit
      </button>

      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="categorie-titre">{cat}</h2>
          {produits.filter((p) => p.categorie === cat).map((p) => {
            const alerte = (p.stock ?? 0) <= (p.seuilAlerte ?? 10)
            return (
              <article key={p.id} className={`commande-card admin-ligne ${alerte ? 'alerte-stock' : ''}`}>
                {p.photo ? (
                  <img className="mini-photo" src={p.photo} alt="" />
                ) : (
                  <span className="mini-photo mini-photo-vide" aria-hidden="true"><ImagePlus size={16} /></span>
                )}
                <div className="ligne-infos">
                  <p className="ligne-nom">{p.nom}</p>
                  <p className="ligne-detail">
                    {euros(p.prixCarton)} HT · stock {p.stock ?? 0}
                    {alerte && ' ⚠'} · {clients.filter((c) => c.produits.includes(p.id)).length} client(s)
                    {p.remise && ` · −${p.remise.pourcent} % dès ${p.remise.seuil}`}
                  </p>
                </div>
                <div className="admin-actions">
                  <button className="icon-btn icon-btn-gris" onClick={() => setForm({ produit: p })} aria-label={`Modifier ${p.nom}`}>
                    <Pencil size={18} />
                  </button>
                  <button className="icon-btn icon-btn-gris" onClick={() => supprimer(p)} aria-label={`Supprimer ${p.nom}`}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ))}

      {form && (
        <ProduitForm produit={form.produit} categories={categories} onSave={enregistrer} onClose={() => setForm(null)} />
      )}
    </section>
  )
}

/* ---------- Fiche client ---------- */
function ClientForm({ client, produits, onSave, onClose }) {
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
              <span>Mot de passe</span>
              <input type="text" value={f.motDePasse} onChange={maj('motDePasse')} required />
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
function AdminClients({ produits, clients, setClients }) {
  const [form, setForm] = useState(null)

  const enregistrer = (c) => {
    setClients((prev) =>
      prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]
    )
    setForm(null)
  }

  const supprimer = (c) => {
    if (!window.confirm(`Supprimer le compte « ${c.nom} » ?`)) return
    setClients((prev) => prev.filter((x) => x.id !== c.id))
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
            <p className="ligne-nom">{c.nom}</p>
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

/* ---------- Onglet Commandes + Tournées ---------- */
const CLASSE_STATUT = {
  Confirmée: 'statut-confirmee',
  Préparée: 'statut-preparee',
  'En livraison': 'statut-enlivraison',
  Livrée: 'statut-livree',
  'Livrée partiellement': 'statut-partielle',
  Annulée: 'statut-annulee',
}

const sauverPatchCommande = (clients, setToutes, clientId, numero, patch) => {
  const cmds = chargerCommandesClient(clientId).map((cmd) =>
    cmd.numero === numero ? { ...cmd, ...patch } : cmd
  )
  sauverCommandesClient(clientId, cmds)
  setToutes(chargerToutes(clients))
}

const restituerStock = (setProduits, lignes) => {
  setProduits((prev) =>
    prev.map((p) => {
      const l = lignes.find((x) => x.id === p.id)
      return l ? { ...p, stock: (p.stock ?? 0) + l.qty } : p
    })
  )
}

// Retour après livraison : seules les lignes marquées "bon état" réintègrent
// le stock, le reste (casse, périmé…) est simplement retiré de la commande.
// Logique partagée entre l'onglet Commandes (Direction, action ponctuelle) et
// l'onglet Retours (Direction + Préparation, pensé pour la fin de tournée).
const appliquerRetour = (setProduits, majCommande, cmd, lignesRetour, motif) => {
  const aRestituer = lignesRetour.filter((l) => l.remisEnStock)
  if (aRestituer.length > 0) restituerStock(setProduits, aRestituer)

  const nouvellesLignes = cmd.lignes.map((l) => {
    const retour = lignesRetour.find((r) => r.id === l.id)
    return retour ? { ...l, qty: l.qty - retour.qty } : l
  })
  const cartons = nouvellesLignes.reduce((s, l) => s + l.qty, 0)
  const total = nouvellesLignes.reduce((s, l) => s + l.qty * l.prixCarton, 0)

  majCommande(cmd.clientId, cmd.numero, {
    lignes: nouvellesLignes,
    cartons,
    total,
    retours: [...(cmd.retours ?? []), { date: Date.now(), motif, lignes: lignesRetour }],
  })
}

function AdminCommandes({ admin, clients, produits, setProduits }) {
  const [toutes, setToutes] = useState([])
  const [vue, setVue] = useState('liste') // 'liste' | 'tournees'
  const [modifierCible, setModifierCible] = useState(null)
  const [livraisonCible, setLivraisonCible] = useState(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())

  useEffect(() => setToutes(chargerToutes(clients)), [clients])

  // Fait avancer le compte à rebours de correction pour la Préparation, sans
  // qu'elle ait besoin de recharger la page.
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const majCommande = (clientId, numero, patch) => sauverPatchCommande(clients, setToutes, clientId, numero, patch)

  // Chaque étape du pipeline (Confirmée → Préparée → En livraison → Livrée)
  // a son propre bouton explicite dans la liste, plutôt qu'un badge de statut
  // cliquable qui faisait plusieurs choses différentes selon l'état — plus
  // clair pour la Préparation comme pour la Direction.
  const accepterCommande = (cmd) => majCommande(cmd.clientId, cmd.numero, { statut: 'Préparée', accepteeLe: Date.now() })

  const demarrerTournee = (cmd) => majCommande(cmd.clientId, cmd.numero, { statut: 'En livraison', enLivraisonLe: Date.now() })

  // La Direction peut toujours revenir en arrière/modifier/annuler une
  // commande livrée. La Préparation (le livreur) ne le peut que dans l'heure
  // qui suit sa propre confirmation de livraison — le temps de corriger une
  // erreur de saisie sur la checklist, sans pouvoir rouvrir indéfiniment une
  // commande déjà ancienne.
  const modifiableApresLivraison = (cmd) =>
    !!cmd.livreeLe && maintenant - cmd.livreeLe <= DELAI_MODIFICATION_MS
  const peutToucherLivree = (cmd) => admin.role === 'direction' || modifiableApresLivraison(cmd)

  const rouvrirCommande = (cmd) => {
    if (!peutToucherLivree(cmd)) return
    majCommande(cmd.clientId, cmd.numero, { statut: 'Confirmée' })
  }

  const basculerPayee = (cmd) => majCommande(cmd.clientId, cmd.numero, { payee: !cmd.payee })

  // L'admin peut modifier/annuler une commande à tout moment, sans limite de
  // temps ni condition de statut (contrairement au client) — utile pour
  // corriger une erreur même après le début de préparation.
  const annulerCommande = (cmd) => {
    if (cmd.statut === 'Annulée') return
    if (!window.confirm(`Annuler la commande ${cmd.numero} de ${cmd.clientNom} ? Le stock sera réintégré.`)) return
    restituerStock(setProduits, cmd.lignes)
    majCommande(cmd.clientId, cmd.numero, { statut: 'Annulée', annuleeLe: Date.now() })
  }

  const modifierCommande = (cmd, nouvellesLignes, nouveauTotal, nouveauxCartons) => {
    setProduits((prev) =>
      prev.map((p) => {
        const avant = cmd.lignes.find((l) => l.id === p.id)?.qty ?? 0
        const apres = nouvellesLignes.find((l) => l.id === p.id)?.qty ?? 0
        const delta = apres - avant
        return delta !== 0 ? { ...p, stock: Math.max(0, (p.stock ?? 0) - delta) } : p
      })
    )
    majCommande(cmd.clientId, cmd.numero, {
      lignes: nouvellesLignes,
      total: nouveauTotal,
      cartons: nouveauxCartons,
      modifieeLe: Date.now(),
    })
  }

  // Checklist du livreur : la quantité livrée par ligne peut être réduite
  // (refus partiel, casse, article manquant…) — l'écart réintègre le stock
  // et n'est pas facturé. "qtyCommandee" garde la quantité d'origine pour
  // affichage tant qu'il y a un écart ; la commande passe "Livrée
  // partiellement" dès qu'une ligne n'est pas livrée en totalité.
  const confirmerLivraison = (cmd, resultats, photo) => {
    const manquants = cmd.lignes
      .map((l) => {
        const qtyLivree = resultats.find((r) => r.id === l.id)?.qty ?? l.qty
        const manquant = l.qty - qtyLivree
        return manquant > 0 ? { id: l.id, qty: manquant } : null
      })
      .filter(Boolean)
    if (manquants.length > 0) restituerStock(setProduits, manquants)

    const nouvellesLignes = cmd.lignes.map((l) => {
      const qtyLivree = resultats.find((r) => r.id === l.id)?.qty ?? l.qty
      if (qtyLivree >= l.qty) return { ...l, livree: true }
      return { ...l, qty: qtyLivree, qtyCommandee: l.qty, livree: qtyLivree > 0 ? 'partielle' : false }
    })
    const cartonsLivres = nouvellesLignes.reduce((s, l) => s + l.qty, 0)
    const totalLivre = nouvellesLignes.reduce((s, l) => s + l.qty * l.prixCarton, 0)

    majCommande(cmd.clientId, cmd.numero, {
      lignes: nouvellesLignes,
      cartons: cartonsLivres,
      total: totalLivre,
      statut: manquants.length > 0 ? 'Livrée partiellement' : 'Livrée',
      livreeLe: Date.now(),
      photoLivraison: photo,
    })
    setLivraisonCible(null)
  }

  // Triées par ancienneté (la plus vieille commande d'abord) : une ville
  // n'est jamais priorisée sur une autre à cause d'un simple regroupement —
  // c'est la commande la plus urgente de chaque ville qui détermine l'ordre
  // d'affichage, pour ne pas faire attendre un client ancien derrière un
  // client du jour simplement parce qu'ils sont dans la même ville.
  const aLivrer = toutes
    .filter((c) => !['Livrée', 'Livrée partiellement', 'Annulée'].includes(c.statut))
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  const villes = [...new Set(aLivrer.map((c) => c.clientVille || 'Sans ville'))]

  return (
    <section aria-labelledby="titre-admin-commandes">
      <h1 id="titre-admin-commandes" className="page-title">Commandes clients</h1>

      <div className="segmented" role="tablist" aria-label="Vue des commandes">
        <button
          role="tab"
          aria-selected={vue === 'liste'}
          className={vue === 'liste' ? 'actif' : ''}
          onClick={() => setVue('liste')}
        >
          Liste
        </button>
        <button
          role="tab"
          aria-selected={vue === 'tournees'}
          className={vue === 'tournees' ? 'actif' : ''}
          onClick={() => setVue('tournees')}
        >
          Tournées ({aLivrer.length})
        </button>
      </div>

      {vue === 'liste' ? (
        toutes.length === 0 ? (
          <div className="empty">
            <ClipboardList size={40} aria-hidden="true" />
            <p>Aucune commande client pour le moment.</p>
          </div>
        ) : (
          <>
            <p className="page-subtitle">Utilisez les actions ci-dessous pour faire avancer une commande · € pour marquer payée</p>
            {toutes.map((cmd) => (
              <article key={cmd.clientId + cmd.numero} className="commande-card">
                <div className="commande-top">
                  <span className="commande-num">{cmd.numero} — {cmd.clientNom}</span>
                  <span className={`statut ${CLASSE_STATUT[cmd.statut] ?? 'statut-confirmee'}`}>
                    {cmd.statut}
                  </span>
                </div>
                <p className="commande-detail">
                  {cmd.date} · {cmd.cartons} cartons · {euros(cmd.total)} HT
                </p>
                <p className="ligne-detail">
                  {cmd.lignes.map((l) => `${l.qty} × ${l.nom}`).join(' · ')}
                </p>
                {cmd.statut === 'Livrée partiellement' && (
                  <p className="ligne-detail" style={{ color: 'var(--red-600)' }}>
                    Non livré : {cmd.lignes.filter((l) => l.qtyCommandee != null).map((l) => `${l.qtyCommandee - l.qty} × ${l.nom}`).join(' · ')}
                  </p>
                )}
                {cmd.photoLivraison && (
                  <button
                    type="button"
                    className="lien-photo-livraison"
                    onClick={() => window.open(cmd.photoLivraison, '_blank')}
                  >
                    <img src={cmd.photoLivraison} alt="" />
                    <span><Camera size={13} aria-hidden="true" /> Voir la photo de livraison</span>
                  </button>
                )}
                {cmd.retours?.length > 0 && (
                  <p className="ligne-detail" style={{ color: 'var(--orange-600)' }}>
                    <Undo2 size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" />{' '}
                    {cmd.retours.length} retour{cmd.retours.length > 1 ? 's' : ''} enregistré{cmd.retours.length > 1 ? 's' : ''}
                  </p>
                )}
                {['Livrée', 'Livrée partiellement'].includes(cmd.statut) && admin.role !== 'direction' && (
                  modifiableApresLivraison(cmd) ? (
                    <p className="ligne-detail" style={{ color: 'var(--orange-600)' }}>
                      <Clock size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" />{' '}
                      Modifiable ou annulable encore {formatRestant(DELAI_MODIFICATION_MS - (maintenant - cmd.livreeLe))}
                    </p>
                  ) : (
                    <p className="ligne-detail" style={{ color: 'var(--gray-400)' }}>
                      Seule la Direction peut modifier ou annuler une commande livrée depuis plus d'1h.
                    </p>
                  )
                )}
                <div className="commande-actions" style={{ marginTop: 10 }}>
                  <button
                    className={`btn ${cmd.payee ? 'btn-ghost' : 'btn-secondary'}`}
                    onClick={() => basculerPayee(cmd)}
                    aria-pressed={cmd.payee}
                  >
                    <Euro size={16} aria-hidden="true" />
                    {cmd.payee ? 'Payée ✓' : 'Marquer payée'}
                  </button>
                  {cmd.statut === 'Confirmée' && (
                    <button className="btn btn-primary" onClick={() => accepterCommande(cmd)}>
                      <ClipboardCheck size={16} aria-hidden="true" /> Accepter la commande
                    </button>
                  )}
                  {cmd.statut === 'Préparée' && (
                    <button className="btn btn-primary" onClick={() => demarrerTournee(cmd)}>
                      <Truck size={16} aria-hidden="true" /> Démarrer la tournée
                    </button>
                  )}
                  {cmd.statut === 'En livraison' && (
                    <button className="btn btn-primary" onClick={() => setLivraisonCible(cmd)}>
                      <PackageCheck size={16} aria-hidden="true" /> Confirmer la livraison
                    </button>
                  )}
                  {['Livrée', 'Livrée partiellement'].includes(cmd.statut) && peutToucherLivree(cmd) && (
                    <button className="btn btn-ghost" onClick={() => rouvrirCommande(cmd)}>
                      <RotateCcw size={16} aria-hidden="true" /> Rouvrir
                    </button>
                  )}
                  {cmd.statut !== 'Annulée' &&
                    (!['Livrée', 'Livrée partiellement'].includes(cmd.statut) || peutToucherLivree(cmd)) && (
                      <>
                        <button className="btn btn-secondary" onClick={() => setModifierCible(cmd)}>
                          <Pencil size={16} aria-hidden="true" /> Modifier
                        </button>
                        <button className="btn btn-secondary btn-danger" onClick={() => annulerCommande(cmd)}>
                          <Ban size={16} aria-hidden="true" /> Annuler
                        </button>
                      </>
                    )}
                </div>
              </article>
            ))}
          </>
        )
      ) : aLivrer.length === 0 ? (
        <div className="empty">
          <ClipboardList size={40} aria-hidden="true" />
          <p>Rien à livrer : toutes les commandes sont livrées.</p>
        </div>
      ) : (
        <>
          <p className="page-subtitle">Commandes à livrer, groupées par ville et triées par ancienneté</p>
          {villes.map((ville) => (
            <div key={ville}>
              <h2 className="categorie-titre">{ville}</h2>
              {aLivrer
                .filter((c) => (c.clientVille || 'Sans ville') === ville)
                .map((cmd) => (
                  <article key={cmd.clientId + cmd.numero} className="commande-card">
                    <div className="commande-top">
                      <span className="commande-num">{cmd.clientNom}</span>
                      <span className={`statut ${CLASSE_STATUT[cmd.statut]}`}>{cmd.statut}</span>
                    </div>
                    <p className="commande-detail">{cmd.numero} · {cmd.cartons} cartons · prévu {cmd.livraisonPrevue ?? '—'}</p>
                    <p className="ligne-detail">
                      {cmd.lignes.map((l) => `${l.qty} × ${l.nom}`).join(' · ')}
                    </p>
                    {cmd.ts && Date.now() - cmd.ts > 2 * JOUR && (
                      <p className="ligne-detail" style={{ color: 'var(--red-600)' }}>
                        <AlertTriangle size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" />{' '}
                        En attente depuis {Math.floor((Date.now() - cmd.ts) / JOUR)} jours — à livrer en priorité
                      </p>
                    )}
                    {cmd.statut === 'Préparée' && (
                      <div className="commande-actions" style={{ marginTop: 10 }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => majCommande(cmd.clientId, cmd.numero, { statut: 'En livraison', enLivraisonLe: Date.now() })}
                        >
                          <Truck size={16} aria-hidden="true" /> Démarrer la tournée
                        </button>
                      </div>
                    )}
                    {cmd.statut === 'En livraison' && (
                      <div className="commande-actions" style={{ marginTop: 10 }}>
                        <button className="btn btn-primary" onClick={() => setLivraisonCible(cmd)}>
                          <PackageCheck size={16} aria-hidden="true" /> Confirmer la livraison
                        </button>
                      </div>
                    )}
                  </article>
                ))}
            </div>
          ))}
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => window.print()}>
            <Printer size={18} aria-hidden="true" /> Imprimer la feuille de route
          </button>
        </>
      )}

      {modifierCible && (
        <ModifierCommande
          commande={modifierCible}
          produits={produits}
          minCartons={null}
          onValider={(lignes, total, cartons) => {
            modifierCommande(modifierCible, lignes, total, cartons)
            setModifierCible(null)
          }}
          onClose={() => setModifierCible(null)}
        />
      )}

      {livraisonCible && (
        <ConfirmerLivraison
          commande={livraisonCible}
          onValider={(resultats, photo) => confirmerLivraison(livraisonCible, resultats, photo)}
          onClose={() => setLivraisonCible(null)}
        />
      )}
    </section>
  )
}

/* ---------- Onglet Retours (Direction + Préparation) ---------- */
// Traitement des retours en fin de tournée : le livreur ou la Direction
// enregistre, pour chaque commande livrée, ce qui revient (bon état ou
// perdu). Contrairement à Modifier/Annuler, cette action reste ouverte à la
// Préparation puisqu'elle fait partie de son travail de fin de tournée.
function AdminRetours({ clients, produits, setProduits }) {
  const [toutes, setToutes] = useState([])
  const [retourCible, setRetourCible] = useState(null)

  useEffect(() => setToutes(chargerToutes(clients)), [clients])

  const majCommande = (clientId, numero, patch) => sauverPatchCommande(clients, setToutes, clientId, numero, patch)

  const enregistrerRetour = (cmd, lignesRetour, motif) => {
    appliquerRetour(setProduits, majCommande, cmd, lignesRetour, motif)
    setRetourCible(null)
  }

  // Les plus récemment livrées en tête : c'est le flux naturel en fin de
  // tournée, juste après avoir passé ConfirmerLivraison.
  const livrees = toutes
    .filter((c) => ['Livrée', 'Livrée partiellement'].includes(c.statut))
    .sort((a, b) => (b.livreeLe ?? 0) - (a.livreeLe ?? 0))

  return (
    <section aria-labelledby="titre-admin-retours">
      <h1 id="titre-admin-retours" className="page-title">Retours &amp; récupération</h1>
      <p className="page-subtitle">Commandes livrées — à traiter en fin de tournée</p>

      {livrees.length === 0 ? (
        <div className="empty">
          <Undo2 size={40} aria-hidden="true" />
          <p>Aucune commande livrée pour le moment.</p>
        </div>
      ) : (
        livrees.map((cmd) => (
          <article key={cmd.clientId + cmd.numero} className="commande-card">
            <div className="commande-top">
              <span className="commande-num">{cmd.numero} — {cmd.clientNom}</span>
              <span className={`statut ${CLASSE_STATUT[cmd.statut] ?? 'statut-confirmee'}`}>{cmd.statut}</span>
            </div>
            <p className="commande-detail">
              {cmd.date} · {cmd.cartons} cartons · {euros(cmd.total)} HT
            </p>
            <p className="ligne-detail">
              {cmd.lignes.filter((l) => l.livree !== false).map((l) => `${l.qty} × ${l.nom}`).join(' · ')}
            </p>
            {cmd.retours?.length > 0 && (
              <p className="ligne-detail" style={{ color: 'var(--orange-600)' }}>
                <Undo2 size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" />{' '}
                {cmd.retours.length} retour{cmd.retours.length > 1 ? 's' : ''} enregistré{cmd.retours.length > 1 ? 's' : ''}
              </p>
            )}
            <div className="commande-actions" style={{ marginTop: 10 }}>
              <button className="btn btn-secondary" onClick={() => setRetourCible(cmd)}>
                <Undo2 size={16} aria-hidden="true" /> Enregistrer un retour
              </button>
            </div>
          </article>
        ))
      )}

      {retourCible && (
        <RetourCommande
          commande={retourCible}
          onValider={(lignesRetour, motif) => enregistrerRetour(retourCible, lignesRetour, motif)}
          onClose={() => setRetourCible(null)}
        />
      )}
    </section>
  )
}

/* ---------- Coquille admin ---------- */
export default function Admin({ admin, produits, setProduits, clients, setClients, onLogout }) {
  const tabs = TOUS_TABS.filter((t) => t.roles.includes(admin.role))
  const [tab, setTab] = useState(tabs[0].id)

  return (
    <div className="app">
      <header className="header header-admin">
        <div>
          <span className="logo">origo<span className="logo-dot" aria-hidden="true" /></span>
          <span className="header-client">{admin.nom}</span>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={onLogout} aria-label="Se déconnecter">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'dashboard' && <Dashboard produits={produits} clients={clients} setClients={setClients} />}
        {tab === 'produits' && (
          <AdminProduits produits={produits} setProduits={setProduits} clients={clients} setClients={setClients} />
        )}
        {tab === 'clients' && (
          <AdminClients produits={produits} clients={clients} setClients={setClients} />
        )}
        {tab === 'commandes' && (
          <AdminCommandes admin={admin} clients={clients} produits={produits} setProduits={setProduits} />
        )}
        {tab === 'retours' && (
          <AdminRetours clients={clients} produits={produits} setProduits={setProduits} />
        )}
      </main>

      <nav className="tabbar" aria-label="Navigation administration">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            <Icon size={22} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
