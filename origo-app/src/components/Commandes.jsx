import { useEffect, useState } from 'react'
import {
  FileText, Receipt, ClipboardList, X, Download, Mail, Truck, CreditCard,
  Pencil, Ban, Clock, Camera,
} from 'lucide-react'
import { euros } from '../data.js'
import { envoyerParEmail, htDocument, libelleDocument, portDocument } from '../document-montant.js'
import { TEXTE_PAIEMENT_SEPA } from '../frais-livraison.js'
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

const bonDisponible = (c) => c.statut !== 'Annulée'
const factureDisponible = (c) => c.statut === 'Livrée' || c.statut === 'Livrée partiellement'

const formatRestant = (ms) => {
  const min = Math.max(0, Math.ceil(ms / 60000))
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim()
  return `${min} min`
}

function DocumentModal({ type, commande, onClose }) {
  const company = useCompany()
  const tvaRate = company.tvaRate ?? 0.21
  const estFacture = type === 'facture'
  const lib = libelleDocument(type, company.factureLegale)
  // La facture / le relevé ne porte que sur les articles réellement livrés
  const lignesDoc = estFacture ? commande.lignes.filter((l) => l.livree !== false) : commande.lignes
  const port = portDocument(commande)
  const ht = htDocument(type, commande)
  const tva = Math.round(ht * tvaRate * 100) / 100
  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-doc">
        <div className="sheet-header">
          <h2 id="titre-doc" className="sheet-title">
            {lib.court} {commande.numero}
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
              {port > 0 && (
                <tr>
                  <td>Frais de livraison</td>
                  <td className="num">1</td>
                  <td className="num">{euros(port)}</td>
                  <td className="num">{euros(port)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {estFacture && commande.lignes.some((l) => l.qtyCommandee != null) && (
            <p style={{ color: 'var(--red-600)', fontSize: 12, marginBottom: 8 }}>
              Certains articles ont été livrés en quantité réduite ou non livrés — ce document reflète les quantités réellement livrées.
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
            {commande.odooNom ? `Réf. Odoo : ${commande.odooNom}. ` : ''}
            {company.textePaiementSepa || TEXTE_PAIEMENT_SEPA}
            {commande.signatureNom ? ` Signé par ${commande.signatureNom}.` : ''}
          </p>
          {(commande.signatureImage || commande.signatureImageUrl) && (
            <div className="preuve-signature">
              <img src={commande.signatureImage || commande.signatureImageUrl} alt={`Signature de ${commande.signatureNom || 'le client'}`} />
            </div>
          )}
          <p style={{ color: 'var(--gray-400)', fontSize: 12, marginTop: 12 }}>
            {estFacture
              ? lib.note
              : 'Bon de commande. Si Odoo a déjà le devis, le PDF est le même modèle que dans Ventes.'}
          </p>
        </div>
        <div className="sheet-footer">
          <button className="btn btn-primary" onClick={async () => {
            const { telechargerDocument } = await import('../pdf.js')
            await telechargerDocument(type, commande)
          }}>
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

export default function Commandes({ commandes, client, produits, onModifier, onAnnuler, onAllerCatalogue }) {
  const company = useCompany()
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
      <h1 id="titre-commandes" className="page-title">Commandes</h1>
      <p className="page-subtitle">Historique, documents et bons de commande</p>

      {commandes.length === 0 ? (
        <div className="empty">
          <ClipboardList size={40} aria-hidden="true" />
          <p>Aucune commande pour le moment.</p>
          <p style={{ fontSize: 14 }}>Vos commandes validées apparaîtront ici, avec le bon dès la confirmation.</p>
          {onAllerCatalogue && (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onAllerCatalogue}>
              Voir le catalogue
            </button>
          )}
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
                    <span style={{ color: 'var(--green-600)', fontWeight: 600 }}>Payée</span>
                  ) : (
                    <span>Domiciliation SEPA : le 15 et le dernier jour du mois</span>
                  )}
                </p>
                {modifiable && (
                  <p className="info-livraison" style={{ color: 'var(--orange-600)' }}>
                    <Clock size={15} aria-hidden="true" /> Modifiable ou annulable encore {formatRestant(restant)}
                  </p>
                )}
                {!factureDisponible(c) && c.statut !== 'Annulée' && (
                  <p className="info-livraison" style={{ color: 'var(--gray-400)' }}>
                    <Receipt size={15} aria-hidden="true" />
                    {libelleDocument('facture', company.factureLegale).court} disponible une fois la livraison confirmée
                  </p>
                )}
                <div className="commande-actions">
                  {bonDisponible(c) && (
                    <button className="btn btn-secondary" onClick={() => setDoc({ type: 'bon', commande: c })}>
                      <FileText size={16} aria-hidden="true" /> Bon de commande
                    </button>
                  )}
                  {factureDisponible(c) && (
                    <button className="btn btn-ghost" onClick={() => setDoc({ type: 'facture', commande: c })}>
                      <Receipt size={16} aria-hidden="true" /> {libelleDocument('facture', company.factureLegale).court}
                    </button>
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
