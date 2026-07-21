import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { euros } from '../../data.js'
import { OrdersApi } from '../../api/index.js'
import RetourCommande from '../RetourCommande.jsx'
import { CLASSE_STATUT } from './utils.js'

export function AdminRetours({ commandesGlobales, onRefresh }) {
  const [retourCible, setRetourCible] = useState(null)

  const enregistrerRetour = async (cmd, lignesRetour, motif) => {
    try {
      await OrdersApi.retour(
        cmd.id,
        motif,
        lignesRetour.map((l) => ({
          productId: l.id,
          qty: l.qty,
          remisEnStock: !!l.remisEnStock,
        })),
      )
      await onRefresh?.()
      setRetourCible(null)
    } catch (e) {
      alert(e.message)
    }
  }

  // Les plus récemment livrées en tête : c'est le flux naturel en fin de
  // tournée, juste après avoir passé ConfirmerLivraison.
  const livrees = (commandesGlobales ?? [])
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
