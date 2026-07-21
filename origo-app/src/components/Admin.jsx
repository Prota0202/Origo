import { useState } from 'react'
import { LayoutDashboard, Package, Users, ReceiptText, LogOut, Undo2 } from 'lucide-react'
import { Dashboard } from './admin/Dashboard.jsx'
import { AdminProduits } from './admin/Produits.jsx'
import { AdminClients } from './admin/Clients.jsx'
import { AdminCommandes } from './admin/Commandes.jsx'
import { AdminRetours } from './admin/Retours.jsx'

const TOUS_TABS = [
  { id: 'dashboard', label: 'Tableau', icon: LayoutDashboard, roles: ['direction'] },
  { id: 'produits', label: 'Produits', icon: Package, roles: ['direction'] },
  { id: 'clients', label: 'Clients', icon: Users, roles: ['direction'] },
  { id: 'commandes', label: 'Commandes', icon: ReceiptText, roles: ['direction', 'preparation', 'livreur'] },
  { id: 'retours', label: 'Retours', icon: Undo2, roles: ['direction', 'preparation', 'livreur'] },
]

export default function Admin({
  admin,
  produits,
  setProduits,
  clients,
  setClients,
  commandesGlobales,
  demandes,
  onRefresh,
  onLogout,
}) {
  const tabs = TOUS_TABS.filter((t) => t.roles.includes(admin.role))
  const [tab, setTab] = useState(tabs[0]?.id ?? 'commandes')

  if (tabs.length === 0) {
    return (
      <div className="app">
        <header className="header header-admin">
          <span className="logo">origo<span className="logo-dot" aria-hidden="true" /></span>
          <button className="icon-btn" onClick={onLogout} aria-label="Se déconnecter">
            <LogOut size={20} />
          </button>
        </header>
        <main className="main">
          <p className="page-subtitle">Aucun onglet pour ce rôle.</p>
        </main>
      </div>
    )
  }

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
        {tab === 'dashboard' && (
          <Dashboard
            produits={produits}
            clients={clients}
            setClients={setClients}
            commandesGlobales={commandesGlobales}
            demandes={demandes}
            onRefresh={onRefresh}
          />
        )}
        {tab === 'produits' && (
          <AdminProduits
            produits={produits}
            setProduits={setProduits}
            clients={clients}
            setClients={setClients}
            onRefresh={onRefresh}
          />
        )}
        {tab === 'clients' && (
          <AdminClients
            produits={produits}
            clients={clients}
            setClients={setClients}
            onRefresh={onRefresh}
          />
        )}
        {tab === 'commandes' && (
          <AdminCommandes
            admin={admin}
            clients={clients}
            produits={produits}
            setProduits={setProduits}
            commandesGlobales={commandesGlobales}
            onRefresh={onRefresh}
          />
        )}
        {tab === 'retours' && (
          <AdminRetours commandesGlobales={commandesGlobales} onRefresh={onRefresh} />
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
