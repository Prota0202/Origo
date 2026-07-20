import { useEffect, useState } from 'react'
import { BookOpen, ReceiptText, Headset, ShoppingCart, QrCode, CheckCircle2, LogOut, PackageSearch } from 'lucide-react'
import { ADMINS, tarifLigne, formatPourcentage, DELAI_MODIFICATION_MS } from './data.js'
import {
  chargerProduits, chargerClients, sauverProduits, sauverClients, chargerDemandes, sauverDemandes,
} from './store.js'
import Login from './components/Login.jsx'
import Admin from './components/Admin.jsx'
import Catalogue from './components/Catalogue.jsx'
import AutresProduits from './components/AutresProduits.jsx'
import Panier from './components/Panier.jsx'
import Commandes from './components/Commandes.jsx'
import ServiceClient from './components/ServiceClient.jsx'
import QRModal from './components/QRModal.jsx'

const TABS = [
  { id: 'catalogue', label: 'Catalogue', icon: BookOpen },
  { id: 'autres', label: 'Autres produits', icon: PackageSearch },
  { id: 'commandes', label: 'Commandes', icon: ReceiptText },
  { id: 'service', label: 'Service client', icon: Headset },
]

const JOUR = 24 * 60 * 60 * 1000

// Messages affichés au client quand sa commande change de statut, notamment
// aux deux moments clés : acceptation par ORIGO ("Préparée") et départ du
// livreur ("En livraison"). Les autres statuts gardent un message générique.
const MESSAGE_STATUT = {
  Préparée: (numero) => `Commande ${numero} confirmée par ORIGO — en cours de préparation.`,
  'En livraison': (numero) => `Votre commande ${numero} est en cours de livraison !`,
  Livrée: (numero) => `Commande ${numero} livrée.`,
  'Livrée partiellement': (numero) => `Commande ${numero} livrée partiellement.`,
  Annulée: (numero) => `Commande ${numero} annulée.`,
}

export default function App() {
  const [produits, setProduits] = useState(chargerProduits)
  const [clients, setClients] = useState(chargerClients)
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('origo-session'))
  const [tab, setTab] = useState('catalogue')
  const [panier, setPanier] = useState({})
  const [panierOuvert, setPanierOuvert] = useState(false)
  const [qrOuvert, setQrOuvert] = useState(false)
  const [toast, setToast] = useState(null)
  const [commandes, setCommandes] = useState([])
  const [notifCommandes, setNotifCommandes] = useState(false)
  const [demandes, setDemandes] = useState(chargerDemandes)

  const admin = ADMINS.find((a) => a.id === sessionId) ?? null
  const client = admin ? null : clients.find((c) => c.id === sessionId) ?? null

  useEffect(() => sauverProduits(produits), [produits])
  useEffect(() => sauverClients(clients), [clients])

  // Charger les commandes du client connecté + notifier les changements de statut
  useEffect(() => {
    if (!client?.id) return
    let cmds = []
    try {
      cmds = JSON.parse(localStorage.getItem(`origo-commandes-${client.id}`)) ?? []
    } catch {
      cmds = []
    }
    setCommandes(cmds)

    const cleVu = `origo-vu-${client.id}`
    let vu = {}
    try {
      vu = JSON.parse(localStorage.getItem(cleVu)) ?? {}
    } catch {
      vu = {}
    }
    const changees = cmds.filter((c) => vu[c.numero] && vu[c.numero] !== c.statut)
    if (changees.length > 0) {
      setToast(
        changees.length === 1
          ? (MESSAGE_STATUT[changees[0].statut]?.(changees[0].numero) ??
              `Votre commande ${changees[0].numero} est passée au statut « ${changees[0].statut} »`)
          : `${changees.length} commandes ont changé de statut`
      )
      setNotifCommandes(true)
    }
    localStorage.setItem(cleVu, JSON.stringify(Object.fromEntries(cmds.map((c) => [c.numero, c.statut]))))
  }, [client?.id])

  useEffect(() => {
    if (!client?.id) return
    localStorage.setItem(`origo-commandes-${client.id}`, JSON.stringify(commandes))
    localStorage.setItem(
      `origo-vu-${client.id}`,
      JSON.stringify(Object.fromEntries(commandes.map((c) => [c.numero, c.statut])))
    )
  }, [client?.id, commandes])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Met à jour la fiche du client connecté (favoris, notes…)
  const majClient = (patch) =>
    setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, ...patch } : c)))

  // Demande d'ajout d'un produit hors catalogue négocié — l'admin la traite
  // pour fixer un tarif et l'ajouter au client, plutôt qu'un ajout direct au
  // panier sans prix convenu.
  const demanderProduit = (produit) => {
    if (demandes.some((d) => d.clientId === client.id && d.produitId === produit.id)) {
      setToast('Demande déjà envoyée pour ce produit.')
      return
    }
    const demande = {
      id: `${Date.now()}-${produit.id}`,
      clientId: client.id,
      clientNom: client.nom,
      produitId: produit.id,
      produitNom: produit.nom,
      date: Date.now(),
    }
    setDemandes((prev) => {
      const suivant = [...prev, demande]
      sauverDemandes(suivant)
      return suivant
    })
    setToast(`Demande envoyée à ORIGO pour « ${produit.nom} ».`)
  }

  // Retourne un message d'erreur, ou null si la connexion réussit
  const seConnecter = (code, motDePasse) => {
    const codeNorm = code.trim().toLowerCase()
    const compte =
      ADMINS.find((a) => a.code.toLowerCase() === codeNorm && a.motDePasse === motDePasse) ??
      clients.find((c) => c.code.toLowerCase() === codeNorm && c.motDePasse === motDePasse)
    if (!compte) return 'Code client ou mot de passe incorrect. Vérifiez vos identifiants ORIGO.'
    localStorage.setItem('origo-session', compte.id)
    setSessionId(compte.id)
    setTab('catalogue')
    setPanier({})
    setNotifCommandes(false)
    return null
  }

  const seDeconnecter = () => {
    localStorage.removeItem('origo-session')
    setSessionId(null)
    setPanier({})
    setPanierOuvert(false)
  }

  const totalCartons = Object.values(panier).reduce((s, q) => s + q, 0)

  const changerQuantite = (produit, qty) => {
    const max = produit.stock ?? Infinity
    const q = Math.min(qty, max)
    setPanier((prev) => {
      const next = { ...prev }
      if (q <= 0) delete next[produit.id]
      else next[produit.id] = q
      return next
    })
  }

  // Recommander en 1 clic : re-remplit le panier avec la dernière commande
  const recommanderDerniere = () => {
    const derniere = commandes[0]
    if (!derniere) return
    const next = {}
    const indisponibles = []
    derniere.lignes.forEach((l) => {
      const p = produits.find((x) => x.id === l.id)
      if (p && client.produits.includes(p.id) && (p.stock ?? 0) > 0) {
        next[p.id] = Math.min(l.qty, p.stock)
      } else {
        indisponibles.push(l.nom)
      }
    })
    setPanier(next)
    setPanierOuvert(true)
    setToast(
      indisponibles.length > 0
        ? `Panier re-rempli (indisponible : ${indisponibles.join(', ')})`
        : 'Panier re-rempli à l’identique de votre dernière commande'
    )
  }

  const validerCommande = (lignes, total, cartons) => {
    const numero = `CMD-${String(commandes.length + 1).padStart(4, '0')}`
    const ts = Date.now()
    const commande = {
      numero,
      client: client.nom,
      ts,
      date: new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
      livraisonPrevue: new Date(ts + 2 * JOUR).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long',
      }),
      lignes: lignes.map((p) => {
        const t = tarifLigne(client, p, panier[p.id])
        const suffixe = t.palierSeuil
          ? ` (palier ${formatPourcentage(t.remisePct)} dès ${t.palierSeuil} cartons)`
          : t.remisePct > 0
            ? ` (remise −${t.remisePct} %)`
            : ''
        return {
          id: p.id,
          nom: `${p.nom}${suffixe}`,
          prixCarton: t.puFinal,
          qty: panier[p.id],
          livree: null, // null = pas encore livrée, true/false = coché par le livreur
        }
      }),
      cartons,
      total,
      statut: 'Confirmée',
      payee: false,
    }
    setCommandes((prev) => [commande, ...prev])
    // Déstockage
    setProduits((prev) =>
      prev.map((p) => (panier[p.id] ? { ...p, stock: Math.max(0, (p.stock ?? 0) - panier[p.id]) } : p))
    )
    setPanier({})
    setPanierOuvert(false)
    setTab('commandes')
    setToast(`Commande ${numero} confirmée — facture et bon de commande générés`)
  }

  // Réintègre au stock les cartons d'une commande annulée ou réduite
  const restituerStock = (lignes) => {
    setProduits((prev) =>
      prev.map((p) => {
        const l = lignes.find((x) => x.id === p.id)
        return l ? { ...p, stock: (p.stock ?? 0) + l.qty } : p
      })
    )
  }

  const peutModifierSeul = (c) =>
    c.statut === 'Confirmée' && Date.now() - c.ts <= DELAI_MODIFICATION_MS

  const annulerCommande = (commande) => {
    if (!peutModifierSeul(commande)) return
    restituerStock(commande.lignes)
    setCommandes((prev) =>
      prev.map((c) => (c.numero === commande.numero ? { ...c, statut: 'Annulée', annuleeLe: Date.now() } : c))
    )
    setToast(`Commande ${commande.numero} annulée`)
  }

  const modifierCommande = (commande, nouvellesLignes, nouveauTotal, nouveauxCartons) => {
    if (!peutModifierSeul(commande)) return
    // Ajuste le stock du delta entre l'ancienne et la nouvelle quantité par ligne
    setProduits((prev) =>
      prev.map((p) => {
        const avant = commande.lignes.find((l) => l.id === p.id)?.qty ?? 0
        const apres = nouvellesLignes.find((l) => l.id === p.id)?.qty ?? 0
        const delta = apres - avant
        return delta !== 0 ? { ...p, stock: Math.max(0, (p.stock ?? 0) - delta) } : p
      })
    )
    setCommandes((prev) =>
      prev.map((c) =>
        c.numero === commande.numero
          ? { ...c, lignes: nouvellesLignes, total: nouveauTotal, cartons: nouveauxCartons, modifieeLe: Date.now() }
          : c
      )
    )
    setToast(`Commande ${commande.numero} modifiée`)
  }

  if (!sessionId || (!admin && !client)) {
    return <Login onLogin={seConnecter} />
  }

  if (admin) {
    return (
      <Admin
        admin={admin}
        produits={produits}
        setProduits={setProduits}
        clients={clients}
        setClients={setClients}
        onLogout={seDeconnecter}
      />
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <span className="logo">origo<span className="logo-dot" aria-hidden="true" /></span>
          <span className="header-client">{client.nom}</span>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setQrOuvert(true)} aria-label="Afficher le QR code pour ouvrir sur mobile">
            <QrCode size={22} />
          </button>
          <button className="icon-btn" onClick={() => setPanierOuvert(true)} aria-label={`Ouvrir le panier, ${totalCartons} cartons`}>
            <ShoppingCart size={22} />
            {totalCartons > 0 && <span className="badge">{totalCartons}</span>}
          </button>
          <button className="icon-btn" onClick={seDeconnecter} aria-label="Se déconnecter">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'catalogue' && (
          <Catalogue
            client={client}
            produits={produits}
            panier={panier}
            onChange={changerQuantite}
            onMajClient={majClient}
            onRecommander={commandes.length > 0 ? recommanderDerniere : null}
          />
        )}
        {tab === 'autres' && (
          <AutresProduits
            client={client}
            produits={produits}
            demandesEnvoyees={demandes.filter((d) => d.clientId === client.id).map((d) => d.produitId)}
            onDemande={demanderProduit}
          />
        )}
        {tab === 'commandes' && (
          <Commandes
            commandes={commandes}
            client={client}
            produits={produits}
            onModifier={modifierCommande}
            onAnnuler={annulerCommande}
          />
        )}
        {tab === 'service' && <ServiceClient />}
      </main>

      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => {
              setTab(id)
              if (id === 'commandes') setNotifCommandes(false)
            }}
            aria-current={tab === id ? 'page' : undefined}
          >
            <span className="tab-icone">
              <Icon size={22} aria-hidden="true" />
              {id === 'commandes' && notifCommandes && <span className="point-notif" aria-label="Nouveau statut" />}
            </span>
            {label}
          </button>
        ))}
      </nav>

      {panierOuvert && (
        <Panier
          client={client}
          produits={produits}
          panier={panier}
          onChange={changerQuantite}
          onClose={() => setPanierOuvert(false)}
          onValider={validerCommande}
        />
      )}
      {qrOuvert && <QRModal onClose={() => setQrOuvert(false)} />}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          {toast}
        </div>
      )}
    </div>
  )
}
