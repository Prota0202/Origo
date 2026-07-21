import { useEffect, useState } from 'react'
import {
  AlertTriangle, Download, Printer, Euro, TrendingUp, UserX, Package, Send, Check, X,
} from 'lucide-react'
import { euros } from '../../data.js'
import { getTvaRate } from '../../company.jsx'
import { ClientsApi } from '../../api/index.js'
import { JOUR } from './utils.js'

export function Dashboard({ produits, clients, setClients, commandesGlobales, demandes: demandesProp, onRefresh }) {
  const toutes = commandesGlobales ?? []
  const [demandes, setDemandes] = useState(demandesProp ?? [])
  useEffect(() => setDemandes(demandesProp ?? []), [demandesProp])

  // Demande en cours d'acceptation : on ne l'ajoute au client qu'une fois un
  // tarif fixé pour lui, jamais au prix catalogue par défaut sans y penser.
  const [demandeOuverte, setDemandeOuverte] = useState(null)
  const [prixPropose, setPrixPropose] = useState('')

  const retirerDemande = async (id) => {
    try {
      await ClientsApi.traiterDemande(id)
      setDemandes((prev) => prev.filter((d) => d.id !== id))
      await onRefresh?.()
    } catch (e) {
      alert(e.message)
    }
  }

  const ouvrirAcceptation = (demande, produit) => {
    setDemandeOuverte(demande.id)
    setPrixPropose(String(produit?.prixCarton ?? ''))
  }

  const validerAcceptation = async (demande) => {
    const valeur = Number(prixPropose)
    if (!(valeur > 0)) return
    const client = clients.find((c) => c.id === demande.clientId)
    if (!client) return
    const entries = [
      ...client.produits
        .filter((pid) => pid !== demande.produitId)
        .map((productId) => ({
          productId,
          prixNegocie: client.prix?.[productId] ?? null,
          visible: true,
        })),
      { productId: demande.produitId, prixNegocie: valeur, visible: true },
    ]
    try {
      const updated = await ClientsApi.setCatalogue(client.id, entries)
      setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      await retirerDemande(demande.id)
      setDemandeOuverte(null)
    } catch (e) {
      alert(e.message)
    }
  }

  const ignorerDemande = async (demande) => {
    await retirerDemande(demande.id)
    if (demandeOuverte === demande.id) setDemandeOuverte(null)
  }

  const maintenant = new Date()
  const duMois = toutes.filter((c) => {
    if (!c.ts) return false
    const d = new Date(c.ts)
    return d.getMonth() === maintenant.getMonth() && d.getFullYear() === maintenant.getFullYear()
  })
  const caMois = duMois.reduce((s, c) => s + c.total, 0)
  const enAttente = toutes.filter((c) => !c.payee).reduce((s, c) => s + c.total * (1 + getTvaRate()), 0)

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
        c.total.toFixed(2), (c.total * getTvaRate()).toFixed(2), (c.total * (1 + getTvaRate())).toFixed(2),
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

