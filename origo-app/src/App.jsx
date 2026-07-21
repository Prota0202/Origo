import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ReceiptText, Headset, ShoppingCart, QrCode, CheckCircle2, LogOut, PackageSearch } from 'lucide-react'
import { tarifLigne } from './data.js'
import { getDelaiModificationMs } from './company.jsx'
import { AuthApi, ProductsApi, ClientsApi, OrdersApi, setToken, clearSession, getToken } from './api/index.js'
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

const MESSAGE_STATUT = {
  Préparée: (numero) => `Commande ${numero} confirmée par ORIGO — en cours de préparation.`,
  'En livraison': (numero) => `Votre commande ${numero} est en cours de livraison !`,
  Livrée: (numero) => `Commande ${numero} livrée.`,
  'Livrée partiellement': (numero) => `Commande ${numero} livrée partiellement.`,
  Annulée: (numero) => `Commande ${numero} annulée.`,
}

export default function App() {
  const [boot, setBoot] = useState(!!getToken())
  const [user, setUser] = useState(null)
  const [produits, setProduits] = useState([])
  const [clients, setClients] = useState([])
  const [commandes, setCommandes] = useState([])
  const [commandesAdmin, setCommandesAdmin] = useState([])
  const [demandes, setDemandes] = useState([])
  const [tab, setTab] = useState('catalogue')
  const [panier, setPanier] = useState({})
  const [panierOuvert, setPanierOuvert] = useState(false)
  const panierOuvertRef = useRef(false)
  const [qrOuvert, setQrOuvert] = useState(false)
  const [toast, setToast] = useState(null)
  const [notifCommandes, setNotifCommandes] = useState(false)
  const [erreurBoot, setErreurBoot] = useState(null)

  useEffect(() => {
    panierOuvertRef.current = panierOuvert
  }, [panierOuvert])

  const isStaff = user?.type === 'staff'
  const client = user?.type === 'client' ? user : null
  const admin = isStaff ? user : null

  const showToast = (msg) => setToast(msg)

  const chargerDonneesStaff = useCallback(async () => {
    const [p, o] = await Promise.all([ProductsApi.list(), OrdersApi.all()])
    setProduits(p)

    let c = []
    try {
      c = await ClientsApi.list()
      setClients(c)
    } catch {
      // Livreur n'a pas accès à la liste clients — on enrichit au minimum
      setClients([])
    }

    const byId = Object.fromEntries(c.map((x) => [x.id, x]))
    setCommandesAdmin(
      o.map((cmd) => ({
        ...cmd,
        clientNom: cmd.client ?? byId[cmd.clientId]?.nom ?? cmd.client,
        clientVille: byId[cmd.clientId]?.ville,
      })),
    )

    try {
      setDemandes(await ClientsApi.listDemandes())
    } catch {
      setDemandes([])
    }
  }, [])

  const chargerDonneesClient = useCallback(async (clientUser) => {
    const [p, o, d] = await Promise.all([
      ProductsApi.list(),
      OrdersApi.mine(),
      ClientsApi.mesDemandes().catch(() => []),
    ])
    setProduits(p)
    setCommandes(o)
    setDemandes(d)

    const cleVu = `origo-vu-${clientUser.id}`
    let vu = {}
    try {
      vu = JSON.parse(localStorage.getItem(cleVu)) ?? {}
    } catch {
      vu = {}
    }
    const changees = o.filter((c) => vu[c.numero] && vu[c.numero] !== c.statut)
    if (changees.length > 0) {
      setToast(
        changees.length === 1
          ? (MESSAGE_STATUT[changees[0].statut]?.(changees[0].numero) ??
              `Votre commande ${changees[0].numero} est passée au statut « ${changees[0].statut} »`)
          : `${changees.length} commandes ont changé de statut`,
      )
      setNotifCommandes(true)
    }
    localStorage.setItem(
      cleVu,
      JSON.stringify(Object.fromEntries(o.map((c) => [c.numero, c.statut]))),
    )
  }, [])

  // Restaurer session JWT au démarrage (timeout pour ne jamais rester bloqué)
  useEffect(() => {
    let cancelled = false
    const finBoot = () => {
      if (!cancelled) setBoot(false)
    }

    if (!getToken()) {
      finBoot()
      return () => {
        cancelled = true
      }
    }

    const timeout = setTimeout(() => {
      if (cancelled) return
      clearSession()
      setUser(null)
      setErreurBoot('Connexion trop longue — reconnectez-vous.')
      finBoot()
    }, 10000)

    ;(async () => {
      try {
        const me = await AuthApi.me()
        if (cancelled) return
        setUser(me)
        if (me.type === 'staff') await chargerDonneesStaff()
        else await chargerDonneesClient(me)
      } catch {
        clearSession()
        if (!cancelled) setUser(null)
      } finally {
        clearTimeout(timeout)
        finBoot()
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [chargerDonneesClient, chargerDonneesStaff])

  // Polling léger des commandes (sync multi-appareils)
  useEffect(() => {
    if (!user) return
    const tick = async () => {
      try {
        if (user.type === 'client') {
          const o = await OrdersApi.mine()
          setCommandes((prev) => {
            const cleVu = `origo-vu-${user.id}`
            let vu = {}
            try {
              vu = JSON.parse(localStorage.getItem(cleVu)) ?? {}
            } catch {
              /* ignore */
            }
            const changees = o.filter((c) => {
              const avant = prev.find((p) => p.numero === c.numero)
              return (avant && avant.statut !== c.statut) || (vu[c.numero] && vu[c.numero] !== c.statut)
            })
            if (changees.length > 0) {
              setToast(
                MESSAGE_STATUT[changees[0].statut]?.(changees[0].numero) ??
                  `Commande ${changees[0].numero} : ${changees[0].statut}`,
              )
              setNotifCommandes(true)
            }
            localStorage.setItem(
              cleVu,
              JSON.stringify(Object.fromEntries(o.map((c) => [c.numero, c.statut]))),
            )
            return o
          })
          if (!panierOuvertRef.current) {
            const p = await ProductsApi.list()
            setProduits(p)
          }
        } else {
          await chargerDonneesStaff()
        }
      } catch {
        /* réseau temporaire */
      }
    }
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [user, chargerDonneesStaff])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const majClient = async (patch) => {
    if (!client) return
    if (patch.favoris) {
      const updated = await ClientsApi.setFavoris(patch.favoris)
      setUser({ type: 'client', ...updated })
      return
    }
    if (patch.notes) {
      const entries = Object.entries(patch.notes)
      let updated = client
      for (const [productId, texte] of entries) {
        if (client.notes?.[productId] !== texte) {
          updated = await ClientsApi.setNote(productId, texte ?? '')
        }
      }
      setUser({ type: 'client', ...updated })
      return
    }
    setUser((u) => ({ ...u, ...patch }))
  }

  const demanderProduit = async (produit) => {
    try {
      const d = await ClientsApi.demanderProduit(produit.id)
      setDemandes((prev) => [...prev, d])
      showToast(`Demande envoyée à ORIGO pour « ${produit.nom} ».`)
    } catch (e) {
      showToast(e.message)
    }
  }

  const seConnecter = async (code, motDePasse) => {
    try {
      const { token, user: u } = await AuthApi.login(code, motDePasse)
      setToken(token)
      setUser(u)
      setTab('catalogue')
      setPanier({})
      setNotifCommandes(false)
      if (u.type === 'staff') await chargerDonneesStaff()
      else await chargerDonneesClient(u)
      return null
    } catch (e) {
      return e.message || 'Code client ou mot de passe incorrect.'
    }
  }

  const seDeconnecter = () => {
    clearSession()
    setUser(null)
    setProduits([])
    setClients([])
    setCommandes([])
    setCommandesAdmin([])
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

  const recommanderDerniere = () => {
    const derniere = commandes[0]
    if (!derniere || !client) return
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
    showToast(
      indisponibles.length > 0
        ? `Panier re-rempli (indisponible : ${indisponibles.join(', ')})`
        : 'Panier re-rempli à l’identique de votre dernière commande',
    )
  }

  const validerCommande = async () => {
    try {
      const lignes = Object.entries(panier).map(([productId, qty]) => ({ productId, qty }))
      const commande = await OrdersApi.create(lignes)
      setCommandes((prev) => [commande, ...prev])
      const p = await ProductsApi.list()
      setProduits(p)
      setPanier({})
      setPanierOuvert(false)
      setTab('commandes')
      showToast(`Commande ${commande.numero} confirmée`)
    } catch (e) {
      showToast(e.message)
    }
  }

  const peutModifierSeul = (c) =>
    c.statut === 'Confirmée' && Date.now() - c.ts <= getDelaiModificationMs()

  const annulerCommande = async (commande) => {
    if (!peutModifierSeul(commande) || !commande.id) return
    try {
      const updated = await OrdersApi.annuler(commande.id)
      setCommandes((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setProduits(await ProductsApi.list())
      showToast(`Commande ${commande.numero} annulée`)
    } catch (e) {
      showToast(e.message)
    }
  }

  const modifierCommande = async (commande, nouvellesLignes) => {
    if (!peutModifierSeul(commande) || !commande.id) return
    try {
      const lignes = nouvellesLignes.map((l) => ({ productId: l.id, qty: l.qty }))
      const updated = await OrdersApi.modifier(commande.id, lignes)
      setCommandes((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setProduits(await ProductsApi.list())
      showToast(`Commande ${commande.numero} modifiée`)
    } catch (e) {
      showToast(e.message)
    }
  }

  if (boot) {
    return (
      <div className="login-page">
        <div className="login-hero">
          <span className="logo">
            origo<span className="logo-dot" aria-hidden="true" />
          </span>
          <p>Chargement…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <>
        <Login onLogin={seConnecter} />
        {erreurBoot && <div className="toast">{erreurBoot}</div>}
      </>
    )
  }

  if (admin) {
    return (
      <>
        <Admin
          admin={admin}
          produits={produits}
          setProduits={setProduits}
          clients={clients}
          setClients={setClients}
          commandesGlobales={commandesAdmin}
          demandes={demandes}
          onRefresh={chargerDonneesStaff}
          onLogout={seDeconnecter}
        />
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            {toast}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <span className="logo">
            origo<span className="logo-dot" aria-hidden="true" />
          </span>
          <span className="header-client">{client.nom}</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={() => setQrOuvert(true)}
            aria-label="Afficher le QR code pour ouvrir sur mobile"
          >
            <QrCode size={22} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setPanierOuvert(true)}
            aria-label={`Ouvrir le panier, ${totalCartons} cartons`}
          >
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
              {id === 'commandes' && notifCommandes && (
                <span className="point-notif" aria-label="Nouveau statut" />
              )}
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
          onValider={() => {
            const lignes = Object.keys(panier)
              .map((id) => produits.find((p) => p.id === id))
              .filter(Boolean)
            const cartons = Object.values(panier).reduce((s, q) => s + q, 0)
            const total = lignes.reduce((s, p) => s + tarifLigne(client, p, panier[p.id]).total, 0)
            if (cartons < (client.minCartons ?? 5)) {
              showToast(`Minimum ${client.minCartons} cartons`)
              return
            }
            void validerCommande(lignes, total, cartons)
          }}
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
