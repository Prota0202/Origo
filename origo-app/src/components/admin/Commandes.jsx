import { useEffect, useState } from 'react'
import {
  ClipboardList, ClipboardCheck, Euro, Ban, PackageCheck, Truck, RotateCcw, Clock, Camera, Pencil, Undo2,
  AlertTriangle, Printer,
} from 'lucide-react'
import { euros } from '../../data.js'
import { getCompany, getDelaiModificationMs } from '../../company.jsx'
import { libelleDocument } from '../../document-montant.js'
import { OrdersApi, ProductsApi } from '../../api/index.js'
import ModifierCommande from '../ModifierCommande.jsx'
import ConfirmerLivraison from '../ConfirmerLivraison.jsx'
import { STATUT_API, formatRestant, JOUR, CLASSE_STATUT } from './utils.js'

const appliquerStatutApi = async (cmd, statutUi, extras = {}) => {
  if (!cmd.id) throw new Error('Commande sans id API')
  const statut = STATUT_API[statutUi]
  if (!statut) throw new Error(`Statut inconnu : ${statutUi}`)
  return OrdersApi.setStatut(cmd.id, { statut, ...extras })
}

export function AdminCommandes({ admin, clients, produits, setProduits, commandesGlobales, onRefresh }) {
  const toutes = commandesGlobales ?? []
  const [vue, setVue] = useState('liste') // 'liste' | 'tournees'
  const [modifierCible, setModifierCible] = useState(null)
  const [livraisonCible, setLivraisonCible] = useState(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())

  // Fait avancer le compte à rebours de correction pour la Préparation, sans
  // qu'elle ait besoin de recharger la page.
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const refresh = async () => {
    await onRefresh?.()
    setProduits(await ProductsApi.list())
  }

  // Chaque étape du pipeline (Confirmée → Préparée → En livraison → Livrée)
  // a son propre bouton explicite dans la liste, plutôt qu'un badge de statut
  // cliquable qui faisait plusieurs choses différentes selon l'état — plus
  // clair pour la Préparation comme pour la Direction.
  const accepterCommande = async (cmd) => {
    try {
      await appliquerStatutApi(cmd, 'Préparée')
      await refresh()
    } catch (e) {
      alert(e.message)
    }
  }

  const demarrerTournee = async (cmd) => {
    try {
      await appliquerStatutApi(cmd, 'En livraison')
      await refresh()
    } catch (e) {
      alert(e.message)
    }
  }

  // La Direction peut toujours revenir en arrière/modifier/annuler une
  // commande livrée. La Préparation (le livreur) ne le peut que dans l'heure
  // qui suit sa propre confirmation de livraison — le temps de corriger une
  // erreur de saisie sur la checklist, sans pouvoir rouvrir indéfiniment une
  // commande déjà ancienne.
  const modifiableApresLivraison = (cmd) =>
    !!cmd.livreeLe && maintenant - cmd.livreeLe <= getDelaiModificationMs()
  const peutToucherLivree = (cmd) => admin.role === 'direction' || modifiableApresLivraison(cmd)

  const basculerPayee = async (cmd) => {
    try {
      await OrdersApi.setPayee(cmd.id, !cmd.payee)
      await refresh()
    } catch (e) {
      alert(e.message)
    }
  }

  // L'admin peut modifier/annuler une commande à tout moment, sans limite de
  // temps ni condition de statut (contrairement au client) — utile pour
  // corriger une erreur même après le début de préparation.
  const annulerCommande = async (cmd) => {
    if (cmd.statut === 'Annulée') return
    const dejaLivree = ['Livrée', 'Livrée partiellement'].includes(cmd.statut)

    // Sur une commande livrée, la marchandise est chez le client : la
    // réintégrer d'office créerait du stock qui n'existe pas physiquement.
    let remiseEnStock
    if (dejaLivree) {
      if (!window.confirm(`Annuler la commande ${cmd.numero} de ${cmd.clientNom} , déjà livrée ?`)) return
      remiseEnStock = window.confirm(
        'La marchandise est-elle revenue en stock ?\n\nOK = oui, réintégrer au stock\nAnnuler = non, elle reste chez le client',
      )
    } else if (!window.confirm(`Annuler la commande ${cmd.numero} de ${cmd.clientNom} ? Le stock sera réintégré.`)) {
      return
    }

    try {
      await OrdersApi.annulerAdmin(cmd.id, remiseEnStock)
      await refresh()
    } catch (e) {
      alert(e.message)
    }
  }

  const modifierCommande = async (cmd, nouvellesLignes) => {
    try {
      await OrdersApi.modifierAdmin(
        cmd.id,
        nouvellesLignes.map((l) => ({ productId: l.id, qty: l.qty })),
      )
      await refresh()
    } catch (e) {
      alert(e.message)
    }
  }

  // Checklist du livreur : la quantité livrée par ligne peut être réduite
  // (refus partiel, casse, article manquant…) — l'écart réintègre le stock
  // et n'est pas facturé. "qtyCommandee" garde la quantité d'origine pour
  // affichage tant qu'il y a un écart ; la commande passe "Livrée
  // partiellement" dès qu'une ligne n'est pas livrée en totalité.
  const confirmerLivraison = async (cmd, resultats, photo) => {
    const lignesLivrees = cmd.lignes
      .filter((l) => l.itemId)
      .map((l) => {
        const qtyLivree = resultats.find((r) => r.id === l.id)?.qty ?? l.qty
        return { itemId: l.itemId, qtyLivree }
      })
    const manquants = cmd.lignes.some((l) => {
      const qtyLivree = resultats.find((r) => r.id === l.id)?.qty ?? l.qty
      return qtyLivree < l.qty
    })
    try {
      await appliquerStatutApi(cmd, manquants ? 'Livrée partiellement' : 'Livrée', {
        photoLivraisonUrl: photo || null,
        lignesLivrees,
      })
      await refresh()
      setLivraisonCible(null)
    } catch (e) {
      alert(e.message)
    }
  }

  const rouvrirCommande = async (cmd) => {
    if (!peutToucherLivree(cmd)) return
    try {
      await appliquerStatutApi(cmd, 'Confirmée')
      await refresh()
    } catch (e) {
      alert(e.message)
    }
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
                {(cmd.signatureImage || cmd.signatureImageUrl) && (
                  <div className="preuve-signature">
                    <img src={cmd.signatureImage || cmd.signatureImageUrl} alt={`Signature ${cmd.signatureNom || cmd.clientNom || ''}`} />
                    <p className="ligne-detail" style={{ marginTop: 4 }}>
                      Signé par {cmd.signatureNom || 'le client'}
                    </p>
                  </div>
                )}
                {(cmd.photoLivraison || cmd.hasPhotoLivraison) && (
                  <button
                    type="button"
                    className="lien-photo-livraison"
                    onClick={async () => {
                      let url = cmd.photoLivraison
                      if (!url && cmd.id) {
                        try {
                          const full = await OrdersApi.get(cmd.id)
                          url = full.photoLivraison
                        } catch (e) {
                          alert(e.message)
                          return
                        }
                      }
                      if (url) window.open(url, '_blank')
                    }}
                  >
                    {cmd.photoLivraison ? <img src={cmd.photoLivraison} alt="" /> : null}
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
                      Modifiable ou annulable encore {formatRestant(getDelaiModificationMs() - (maintenant - cmd.livreeLe))}
                    </p>
                  ) : (
                    <p className="ligne-detail" style={{ color: 'var(--gray-400)' }}>
                      Seule la Direction peut modifier ou annuler une commande livrée depuis plus d'1h.
                    </p>
                  )
                )}
                <div className="commande-actions" style={{ marginTop: 10 }}>
                  {admin.role === 'direction' && (
                    <button
                      className={`btn ${cmd.payee ? 'btn-ghost' : 'btn-secondary'}`}
                      onClick={() => basculerPayee(cmd)}
                      aria-pressed={cmd.payee}
                    >
                      <Euro size={16} aria-hidden="true" />
                      {cmd.payee ? 'Payée ✓' : 'Marquer payée'}
                    </button>
                  )}
                  {cmd.statut !== 'Annulée' && (
                    <button
                      className="btn btn-ghost"
                      onClick={async () => {
                        const { telechargerDocument } = await import('../../pdf.js')
                        await telechargerDocument('bon', cmd)
                      }}
                    >
                      <Printer size={16} aria-hidden="true" /> Bon
                    </button>
                  )}
                  {['Livrée', 'Livrée partiellement'].includes(cmd.statut) && (
                    <button
                      className="btn btn-ghost"
                      onClick={async () => {
                        const { telechargerDocument } = await import('../../pdf.js')
                        await telechargerDocument('facture', cmd)
                      }}
                    >
                      <Printer size={16} aria-hidden="true" /> {libelleDocument('facture', getCompany().factureLegale).court}
                    </button>
                  )}
                  {cmd.statut === 'Confirmée' && admin.role !== 'livreur' && (
                    <button className="btn btn-primary" onClick={() => accepterCommande(cmd)}>
                      <ClipboardCheck size={16} aria-hidden="true" /> Accepter la commande
                    </button>
                  )}
                  {cmd.statut === 'Préparée' && (
                    <button className="btn btn-primary" onClick={() => demarrerTournee(cmd)}>
                      <Truck size={16} aria-hidden="true" /> Démarrer la tournée
                    </button>
                  )}
                  {cmd.statut === 'En livraison' && admin.role !== 'preparation' && (
                    <button className="btn btn-primary" onClick={() => setLivraisonCible(cmd)}>
                      <PackageCheck size={16} aria-hidden="true" /> Confirmer la livraison
                    </button>
                  )}
                  {/* Rouvrir = repasser en « Confirmée ». Sur une commande
                      livrée, le serveur annule aussi les effets de la
                      livraison (quantités et stock des manquants). */}
                  {admin.role === 'direction' &&
                    ['Préparée', 'En livraison', 'Livrée', 'Livrée partiellement'].includes(cmd.statut) &&
                    peutToucherLivree(cmd) && (
                      <button className="btn btn-ghost" onClick={() => rouvrirCommande(cmd)}>
                        <RotateCcw size={16} aria-hidden="true" /> Rouvrir
                      </button>
                    )}
                  {/* Modifier seulement tant que rien n'est préparé : au-delà,
                      recalculer les lignes réécrirait le montant d'une
                      commande déjà partie. Il faut rouvrir, ou faire un retour. */}
                  {admin.role === 'direction' && cmd.statut === 'Confirmée' && (
                    <button className="btn btn-secondary" onClick={() => setModifierCible(cmd)}>
                      <Pencil size={16} aria-hidden="true" /> Modifier
                    </button>
                  )}
                  {admin.role === 'direction' &&
                    cmd.statut !== 'Annulée' &&
                    (!['Livrée', 'Livrée partiellement'].includes(cmd.statut) || peutToucherLivree(cmd)) && (
                      <button className="btn btn-secondary btn-danger" onClick={() => annulerCommande(cmd)}>
                        <Ban size={16} aria-hidden="true" /> Annuler
                      </button>
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
                    {(cmd.clientAdresse || cmd.clientTelephone) && (
                      <p className="ligne-detail">
                        {[cmd.clientAdresse, cmd.clientTelephone].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {cmd.clientTelephone && (
                      <a className="btn btn-ghost" style={{ minHeight: 36, marginTop: 6 }} href={`tel:${cmd.clientTelephone.replace(/\s/g, '')}`}>
                        Appeler
                      </a>
                    )}
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
                          onClick={() => demarrerTournee(cmd)}
                        >
                          <Truck size={16} aria-hidden="true" /> Démarrer la tournée
                        </button>
                      </div>
                    )}
                    {cmd.statut === 'En livraison' && admin.role !== 'preparation' && (
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
