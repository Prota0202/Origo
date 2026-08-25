import { useEffect, useState } from 'react'
import {
  AlertTriangle, Download, Printer, Euro, TrendingUp, UserX, Package, Send, Check, X, RefreshCw,
} from 'lucide-react'
import { euros } from '../../data.js'
import { getTvaRate } from '../../company.jsx'
import { ClientsApi, OdooApi, SepaApi } from '../../api/index.js'
import { useCompany } from '../../company.jsx'
import { JOUR } from './utils.js'

export function Dashboard({ produits, clients, setClients, commandesGlobales, demandes: demandesProp, onRefresh }) {
  const toutes = commandesGlobales ?? []
  const company = useCompany()
  const [demandes, setDemandes] = useState(demandesProp ?? [])
  const [odoo, setOdoo] = useState(null)
  const [backup, setBackup] = useState(null)
  const [prelevements, setPrelevements] = useState([])
  const [prelevementMsg, setPrelevementMsg] = useState('')
  const [syncEnCours, setSyncEnCours] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [societe, setSociete] = useState({
    name: '',
    address: '',
    email: '',
    phone: '',
    vat: '',
    horaires: '',
    conditionsGenerales: '',
  })
  const [societeMsg, setSocieteMsg] = useState('')

  useEffect(() => {
    setSociete({
      name: company.name ?? '',
      address: company.address ?? '',
      email: company.email ?? '',
      phone: company.phone ?? '',
      vat: company.vat ?? '',
      horaires: company.horaires ?? '',
      conditionsGenerales: company.conditionsGenerales ?? '',
    })
  }, [company.name, company.address, company.email, company.phone, company.vat, company.horaires, company.conditionsGenerales])
  useEffect(() => setDemandes(demandesProp ?? []), [demandesProp])
  useEffect(() => {
    let ignore = false
    OdooApi.etat()
      .then((etat) => {
        if (ignore) return
        setOdoo(etat)
        setBackup(etat.backup ?? null)
      })
      .catch(() => {
        if (ignore) return
        setOdoo(null)
        setBackup(null)
      })
    SepaApi.liste()
      .then((liste) => { if (!ignore) setPrelevements(liste) })
      .catch(() => { if (!ignore) setPrelevements([]) })
    return () => { ignore = true }
  }, [])

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

  const enregistrerSociete = async (e) => {
    e.preventDefault()
    setSocieteMsg('')
    try {
      await AuthApi.updateCompany(societe)
      await company.recharger?.()
      setSocieteMsg('Fiche société enregistrée.')
    } catch (err) {
      setSocieteMsg(err.message)
    }
  }

  const pousserVersOdoo = async () => {
    setSyncEnCours(true)
    setSyncMessage('')
    try {
      const rapport = await OdooApi.synchroniser(false)
      setOdoo((prev) => ({ ...(prev ?? {}), dernierSync: rapport, actif: true }))
      if (rapport.ok) {
        setSyncMessage(
          `Envoyé : ${rapport.produits.crees + rapport.produits.misAJour} produits, ${rapport.clients.crees + rapport.clients.misAJour} clients. Le stock Odoo se met à jour quand tu enregistres une quantité dans Produits.`,
        )
      } else {
        const premiere = rapport.erreurs?.[0]
        setSyncMessage(premiere ? `${premiere.cible} : ${premiere.message}` : 'Synchronisation incomplète.')
      }
    } catch (e) {
      setSyncMessage(e.message)
    } finally {
      setSyncEnCours(false)
    }
  }

  const lancerSepa = async (forcer) => {
    setPrelevementMsg('')
    try {
      const r = await SepaApi.lancer(forcer)
      if (r.raison === 'stripe_inactif') {
        setPrelevementMsg('Stripe n’est pas configuré : aucun prélèvement ne part. Coller STRIPE_SECRET_KEY dans .env.prod puis redéployer.')
      } else if (r.raison === 'pas_le_jour') {
        setPrelevementMsg('Pas un jour de prélèvement (15 ou fin de mois). « Forcer » lance quand même, pour un test.')
      } else {
        setPrelevementMsg(`${r.preleves} prélèvement(s) lancé(s)${r.periode ? ` (${r.periode})` : ''}.`)
      }
      setPrelevements(await SepaApi.liste())
    } catch (e) {
      setPrelevementMsg(e.message)
    }
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

      {backup?.statut === 'echec' && (
        <div className="alerte-min" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Le dernier dump Postgres a échoué{backup.dernierEchec ? ` (${backup.dernierEchec})` : ''}.
            Vérifier les logs du service backup avant qu’un vrai resto commande.
          </span>
        </div>
      )}
      {backup?.statut === 'en_retard' && (
        <div className="alerte-min" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Aucun dump réussi depuis plus de 48 h
            {backup.dernierOk ? ` (dernier OK : ${backup.dernierOk})` : ''}.
          </span>
        </div>
      )}
      {backup?.offsite?.statut === 'absent' && (
        <div className="alerte-min" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Copie hors VPS absente : le Mac n’a pas encore tiré les dumps (marqueur origo.last_offsite manquant).
          </span>
        </div>
      )}
      {backup?.offsite?.statut === 'en_retard' && (
        <div className="alerte-min" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Copie hors VPS trop vieille
            {backup.offsite.dernier ? ` (dernier : ${backup.offsite.dernier})` : ''}.
            Vérifier que le Mac est allumé et que LaunchAgent be.origo.pull-backups tourne.
          </span>
        </div>
      )}

      {odoo && (
        <div className="commande-card admin-ligne" style={{ marginBottom: 20 }}>
          <div className="ligne-infos">
            <p className="ligne-nom">Odoo</p>
            <p className="ligne-detail">
              {odoo.actif
                ? odoo.sonde?.statut === 'ok'
                  ? `Connecté (${odoo.sonde.version})`
                  : odoo.sonde?.statut === 'hs'
                    ? `Injoignable : ${odoo.sonde.raison}`
                    : 'Configuré, sonde en cours'
                : 'Non configuré — ORIGO fonctionne seul'}
            </p>
            {syncMessage && <p className="ligne-detail">{syncMessage}</p>}
            {(odoo.commandes?.erreurs > 0 || odoo.commandes?.attente > 0) && (
              <p className="ligne-detail">
                {odoo.commandes.erreurs > 0
                  ? `${odoo.commandes.erreurs} commande(s) pas copiées dans Odoo — elles restent dans ORIGO.`
                  : `${odoo.commandes.attente} commande(s) en cours d’envoi vers Odoo.`}
              </p>
            )}
          </div>
          {odoo.actif && (
            <button
              className="btn btn-secondary"
              style={{ minHeight: 40 }}
              disabled={syncEnCours}
              onClick={pousserVersOdoo}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {syncEnCours ? 'Envoi…' : 'Envoyer le catalogue'}
            </button>
          )}
        </div>
      )}

      <div className="commande-card" style={{ marginBottom: 20 }}>
        <p className="ligne-nom">Prélèvements SEPA</p>
        <p className="ligne-detail" style={{ marginBottom: 12 }}>
          {company.paiementStripeActif
            ? 'Le 15 et le dernier jour du mois (Bruxelles), ORIGO prélève les commandes livrées non payées. Le resto doit avoir signé le mandat IBAN.'
            : 'Stripe n’est pas encore configuré : rien n’est débité. Après les clés dans .env.prod, les restos signent le mandat dans le panier.'}
        </p>
        {prelevementMsg && <p className="ligne-detail">{prelevementMsg}</p>}
        <div className="admin-actions" style={{ marginBottom: 12 }}>
          <button className="btn btn-secondary" type="button" onClick={() => void lancerSepa(false)}>
            Lancer si c’est le jour
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => {
            if (window.confirm('Prélever maintenant toutes les commandes livrées non payées des clients SEPA avec mandat ?')) {
              void lancerSepa(true)
            }
          }}>
            Forcer un prélèvement (test)
          </button>
        </div>
        {prelevements.length === 0 ? (
          <p className="ligne-detail">Aucun prélèvement pour l’instant.</p>
        ) : (
          prelevements.slice(0, 8).map((p) => (
            <p key={p.id} className="ligne-detail">
              {p.periode} · {p.clientNom} · {(p.montantCents / 100).toFixed(2)} € · {p.statut}
              {p.erreur ? ` — ${p.erreur}` : ''}
            </p>
          ))
        )}
      </div>

      <form className="commande-card" style={{ marginBottom: 20 }} onSubmit={enregistrerSociete}>
        <p className="ligne-nom">Fiche société</p>
        <p className="ligne-detail" style={{ marginBottom: 12 }}>
          Affichée sur les bons et l’écran service client. Sans n° TVA, les PDF disent « document interne », jamais « facture ». Peppol n’est pas activé.
        </p>
        <label className="champ">
          <span>Nom</span>
          <input value={societe.name} onChange={(e) => setSociete({ ...societe, name: e.target.value })} required />
        </label>
        <label className="champ">
          <span>Adresse</span>
          <input value={societe.address} onChange={(e) => setSociete({ ...societe, address: e.target.value })} />
        </label>
        <div className="champ-row">
          <label className="champ">
            <span>E-mail</span>
            <input type="email" value={societe.email} onChange={(e) => setSociete({ ...societe, email: e.target.value })} />
          </label>
          <label className="champ">
            <span>Téléphone</span>
            <input type="tel" value={societe.phone} onChange={(e) => setSociete({ ...societe, phone: e.target.value })} />
          </label>
        </div>
        <div className="champ-row">
          <label className="champ">
            <span>N° TVA (septembre)</span>
            <input value={societe.vat} onChange={(e) => setSociete({ ...societe, vat: e.target.value })} placeholder="vide jusqu’à attribution — ne pas inventer" />
          </label>
          <label className="champ">
            <span>Horaires</span>
            <input value={societe.horaires} onChange={(e) => setSociete({ ...societe, horaires: e.target.value })} />
          </label>
        </div>
        <label className="champ">
          <span>Conditions générales (bon de commande)</span>
          <textarea
            rows={8}
            value={societe.conditionsGenerales}
            onChange={(e) => setSociete({ ...societe, conditionsGenerales: e.target.value })}
          />
        </label>
        {societeMsg && <p className="ligne-detail">{societeMsg}</p>}
        <button type="submit" className="btn btn-secondary" style={{ marginTop: 8 }}>Enregistrer la fiche</button>
      </form>

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

