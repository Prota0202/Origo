import { useEffect, useState } from 'react'
import {
  FileText, Receipt, ClipboardList, X, Download, Mail, Truck, CreditCard,
  Pencil, Ban, Clock, Camera,
} from 'lucide-react'
import { euros } from '../data.js'
import { telechargerPDF, envoyerParEmail } from '../pdf.js'
import { useCompany, getDelaiModificationMs } from '../company.jsx'
import ModifierCommande from './ModifierCommande.jsx'

const CLASSE_STATUT = {
  Confirmée: 'statut-confirmee',
  Préparée: 'statut-preparee',
  'En livraison': 'statut-enlivraison',
  Livrée: 'statut-livree',
  'Livrée partiellement': 'statut-partielle',
  Annulée: 'statut-annulee',
}

const peutModifierSeul = (c) =>
  c.statut === 'Confirmée' && Date.now() - c.ts <= getDelaiModificationMs()

// Facture et bon de commande ne sont générés qu'une fois la livraison
// confirmée (checklist livreur) — pas avant, pour ne jamais facturer ou
// documenter une commande qui n'est pas encore passée par ce contrôle.
const documentsDisponibles = (c) => c.statut === 'Livrée' || c.statut === 'Livrée partiellement'

const formatRestant = (ms) => {
  const min = Math.max(0, Math.ceil(ms / 60000))
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim()
  return `${min} min`
}

function DocumentModal({ type, commande, onClose }) {
  const company = useCompany()
  const tvaRate = company.tvaRate ?? 0.21
  const estFacture = type === 'facture'
  // La facture ne porte que sur les articles réellement livrés
  const lignesDoc = estFacture ? commande.lignes.filter((l) => l.livree !== false) : commande.lignes
  const ht = lignesDoc.reduce((s, l) => s + l.qty * l.prixCarton, 0)
  const tva = ht * tvaRate
  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-doc">
        <div className="sheet-header">
          <h2 id="titre-doc" className="sheet-title">
            {estFacture ? 'Facture' : 'Bon de commande'} {commande.numero}
          </h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer le document">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body doc">
          <div className="doc-entete">
            <div>
              <p className="doc-logo">{company.name || 'ORIGO'}</p>
              <p style={{ color: 'var(--gray-600)' }}>{company.address}</p>
            </div>
            <div style={{ textAlign: 'right', color: 'var(--gray-600)' }}>
              <p><strong style={{ color: 'var(--gray-900)' }}>{commande.numero}</strong></p>
              <p>{commande.date}</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th scope="col">Produit</th>
                <th scope="col" className="num">Cartons</th>
                <th scope="col" className="num">P.U. HT</th>
                <th scope="col" className="num">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {lignesDoc.map((l) => (
                <tr key={l.id}>
                  <td>{l.nom}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{euros(l.prixCarton)}</td>
                  <td className="num">{euros(l.qty * l.prixCarton)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {estFacture && commande.lignes.some((l) => l.qtyCommandee != null) && (
            <p style={{ color: 'var(--red-600)', fontSize: 12, marginBottom: 8 }}>
              Certains articles ont été livrés en quantité réduite ou non livrés — cette facture reflète les quantités réellement livrées.
            </p>
          )}
          {estFacture ? (
            <>
              <div className="total-row"><span>Total HT</span><span>{euros(ht)}</span></div>
              <div className="total-row"><span>TVA {Math.round(tvaRate * 100)} %</span><span>{euros(tva)}</span></div>
              <div className="doc-total"><span>Total TTC</span><span>{euros(ht + tva)}</span></div>
            </>
          ) : (
            <div className="doc-total"><span>Total HT</span><span>{euros(ht)}</span></div>
          )}
          <p style={{ color: 'var(--gray-400)', fontSize: 12, marginTop: 12 }}>
            {estFacture
              ? 'Facture envoyée par e-mail au client et à ORIGO.'
              : 'Bon de commande transmis à ORIGO pour préparation.'}
          </p>
        </div>
        <div className="sheet-footer">
          <button className="btn btn-primary" onClick={() => telechargerPDF(type, commande)}>
            <Download size={18} aria-hidden="true" /> Télécharger le PDF
          </button>
          <button className="btn btn-secondary" onClick={() => envoyerParEmail(type, commande)}>
            <Mail size={18} aria-hidden="true" /> Envoyer par e-mail
          </button>
        </div>
      </div>
    </>
  )
}

// Historique de consommation : cartons commandés sur les 6 derniers mois
function GraphConsommation({ commandes }) {
  const maintenant = new Date()
  const mois = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1)
    mois.push({
      cle: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }),
      cartons: 0,
    })
  }
  commandes.forEach((c) => {
    if (!c.ts) return
    const d = new Date(c.ts)
    const m = mois.find((x) => x.cle === `${d.getFullYear()}-${d.getMonth()}`)
    if (m) m.cartons += c.cartons
  })
  const max = Math.max(...mois.map((m) => m.cartons), 1)
  if (mois.every((m) => m.cartons === 0)) return null

  return (
    <div className="card graphe" role="img" aria-label={`Cartons commandés par mois : ${mois.map((m) => `${m.label} ${m.cartons}`).join(', ')}`}>
      <h2 className="categorie-titre" style={{ margin: '0 0 12px' }}>Vos cartons par mois</h2>
      <div className="graphe-barres">
        {mois.map((m) => (
          <div key={m.cle} className="graphe-col">
            <span className="graphe-valeur">{m.cartons > 0 ? m.cartons : ''}</span>
            <div className="graphe-barre" style={{ height: `${(m.cartons / max) * 72 + 4}px` }} />
            <span className="graphe-label">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Commandes({ commandes, client, produits, onModifier, onAnnuler }) {
  const [doc, setDoc] = useState(null)
  const [modifierCible, setModifierCible] = useState(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())

  // Fait avancer le compte à rebours et désactive les boutons dès l'expiration,
  // sans que le client ait besoin de recharger la page.
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const annuler = (c) => {
    if (!window.confirm(`Annuler la commande ${c.numero} ? Les cartons seront retirés de votre commande.`)) return
    onAnnuler(c)
  }

  return (
    <section aria-labelledby="titre-commandes">
      <h1 id="titre-commandes" className="page-title">Commandes &amp; Factures</h1>
      <p className="page-subtitle">Historique, factures et bons de commande</p>

      {commandes.length === 0 ? (
        <div className="empty">
          <ClipboardList size={40} aria-hidden="true" />
          <p>Aucune commande pour le moment.</p>
          <p style={{ fontSize: 14 }}>Vos commandes validées apparaîtront ici avec leur facture.</p>
        </div>
      ) : (
        <>
          <GraphConsommation commandes={commandes} />
          {commandes.map((c) => {
            const delai = getDelaiModificationMs()
            const modifiable = peutModifierSeul(c) && maintenant - c.ts <= delai
            const restant = delai - (maintenant - c.ts)
            return (
              <article key={c.numero} className={`commande-card ${c.statut === 'Annulée' ? 'commande-annulee' : ''}`}>
                <div className="commande-top">
                  <span className="commande-num">{c.numero}</span>
                  <span className={`statut ${CLASSE_STATUT[c.statut] ?? 'statut-confirmee'}`}>
                    {c.statut}
                  </span>
                </div>
                <p className="commande-detail">
                  {c.date} · {c.cartons} cartons · {euros(c.total)} HT
                </p>
                {!['Livrée', 'Livrée partiellement', 'Annulée'].includes(c.statut) && c.livraisonPrevue && (
                  <p className="info-livraison">
                    <Truck size={15} aria-hidden="true" /> Livraison prévue {c.livraisonPrevue}
                  </p>
                )}
                {c.statut === 'Livrée partiellement' && (
                  <p className="info-livraison" style={{ color: 'var(--red-600)' }}>
                    <Truck size={15} aria-hidden="true" />
                    Non livré : {c.lignes.filter((l) => l.qtyCommandee != null).map((l) => `${l.qtyCommandee - l.qty} × ${l.nom}`).join(' · ')}
                  </p>
                )}
                {c.photoLivraison && (
                  <button
                    type="button"
                    className="lien-photo-livraison"
                    onClick={() => window.open(c.photoLivraison, '_blank')}
                  >
                    <img src={c.photoLivraison} alt="" />
                    <span><Camera size={13} aria-hidden="true" /> Voir la photo de livraison</span>
                  </button>
                )}
                <p className="info-livraison">
                  <CreditCard size={15} aria-hidden="true" />
                  {c.payee ? (
                    <span style={{ color: 'var(--green-600)', fontWeight: 600 }}>Facture payée</span>
                  ) : (
                    <span>Paiement à 30 jours — en attente</span>
                  )}
                </p>
                {modifiable && (
                  <p className="info-livraison" style={{ color: 'var(--orange-600)' }}>
                    <Clock size={15} aria-hidden="true" /> Modifiable ou annulable encore {formatRestant(restant)}
                  </p>
                )}
                {!documentsDisponibles(c) && (
                  <p className="info-livraison" style={{ color: 'var(--gray-400)' }}>
                    <FileText size={15} aria-hidden="true" />
                    Facture et bon de commande disponibles une fois la livraison confirmée par le livreur
                  </p>
                )}
                <div className="commande-actions">
                  {documentsDisponibles(c) && (
                    <>
                      <button className="btn btn-ghost" onClick={() => setDoc({ type: 'facture', commande: c })}>
                        <Receipt size={16} aria-hidden="true" /> Facture
                      </button>
                      <button className="btn btn-secondary" onClick={() => setDoc({ type: 'bon', commande: c })}>
                        <FileText size={16} aria-hidden="true" /> Bon de commande
                      </button>
                    </>
                  )}
                  {modifiable && (
                    <>
                      <button className="btn btn-secondary" onClick={() => setModifierCible(c)}>
                        <Pencil size={16} aria-hidden="true" /> Modifier
                      </button>
                      <button className="btn btn-secondary btn-danger" onClick={() => annuler(c)}>
                        <Ban size={16} aria-hidden="true" /> Annuler
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </>
      )}

      {doc && <DocumentModal type={doc.type} commande={doc.commande} onClose={() => setDoc(null)} />}

      {modifierCible && (
        <ModifierCommande
          commande={modifierCible}
          produits={produits}
          minCartons={client.minCartons}
          onValider={(lignes, total, cartons) => {
            onModifier(modifierCible, lignes, total, cartons)
            setModifierCible(null)
          }}
          onClose={() => setModifierCible(null)}
        />
      )}
    </section>
  )
}
