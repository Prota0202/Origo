import { useState } from 'react'
import { X, Minus, Plus, Trash2, AlertCircle, CheckCircle2, Check } from 'lucide-react'
import { euros } from '../data.js'
import { fraisLivraisonHT } from '../frais-livraison.js'

// Modale partagée (client + admin) pour ajuster les quantités d'une commande
// déjà validée. Le prix unitaire par ligne reste celui déjà appliqué à la
// commande d'origine — on ne recalcule pas les paliers de remise ici, on
// ajuste seulement les quantités et donc les totaux.
export default function ModifierCommande({ commande, produits, minCartons, onValider, onClose }) {
  const [quantites, setQuantites] = useState(() =>
    Object.fromEntries(commande.lignes.map((l) => [l.id, l.qty]))
  )

  const lignesAffichees = commande.lignes.map((l) => {
    const produit = produits.find((p) => p.id === l.id)
    // Marge disponible : stock actuel du produit + ce que cette commande a déjà réservé
    const maxQty = produit ? (produit.stock ?? 0) + l.qty : l.qty
    return { ...l, maxQty, produitExiste: !!produit }
  })

  const changerQty = (id, qty, maxQty) => {
    setQuantites((prev) => ({ ...prev, [id]: Math.max(0, Math.min(qty, maxQty)) }))
  }

  const lignesFinales = lignesAffichees.filter((l) => (quantites[l.id] ?? 0) > 0)
  const totalCartons = lignesFinales.reduce((s, l) => s + quantites[l.id], 0)
  const totalPrix = lignesFinales.reduce((s, l) => s + quantites[l.id] * l.prixCarton, 0)
  const frais = fraisLivraisonHT(totalPrix)
  const totalAvecPort = Math.round((totalPrix + frais) * 100) / 100
  const manque = minCartons ? minCartons - totalCartons : 0
  const toutRetire = totalCartons === 0

  const valider = () => {
    if (toutRetire || manque > 0) return
    onValider(
      lignesFinales.map((l) => ({ id: l.id, nom: l.nom, prixCarton: l.prixCarton, qty: quantites[l.id], livree: null })),
      totalPrix,
      totalCartons
    )
  }

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-modifier-commande">
        <div className="sheet-header">
          <h2 id="titre-modifier-commande" className="sheet-title">Modifier {commande.numero}</h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>

        <div className="sheet-body">
          {lignesAffichees.map((l) => (
            <div key={l.id} className="ligne-panier">
              <div className="ligne-infos">
                <p className="ligne-nom">{l.nom}</p>
                <p className="ligne-detail">
                  {quantites[l.id]} × {euros(l.prixCarton)} = {euros(quantites[l.id] * l.prixCarton)}
                </p>
                {!l.produitExiste && (
                  <p className="ligne-detail" style={{ color: 'var(--red-600)' }}>
                    Ce produit n'est plus au catalogue — quantité modifiable à la baisse uniquement
                  </p>
                )}
              </div>
              <div className="stepper" style={{ padding: 2 }}>
                <button
                  aria-label={`Retirer un carton de ${l.nom}`}
                  onClick={() => changerQty(l.id, quantites[l.id] - 1, l.maxQty)}
                >
                  <Minus size={16} />
                </button>
                <span className="stepper-qty" style={{ minWidth: 32 }}>{quantites[l.id]}</span>
                <button
                  aria-label={`Ajouter un carton de ${l.nom}`}
                  onClick={() => changerQty(l.id, quantites[l.id] + 1, l.maxQty)}
                  disabled={quantites[l.id] >= l.maxQty}
                >
                  <Plus size={16} />
                </button>
              </div>
              <button
                className="ligne-suppr"
                aria-label={`Retirer ${l.nom} de la commande`}
                onClick={() => changerQty(l.id, 0, l.maxQty)}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>

        <div className="sheet-footer">
          {toutRetire ? (
            <div className="alerte-min" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>Impossible de tout retirer ici — utilisez « Annuler la commande » à la place.</span>
            </div>
          ) : manque > 0 ? (
            <div className="alerte-min" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>
                Il faut au moins {minCartons} cartons ({manque} de plus) pour garder cette commande active.
              </span>
            </div>
          ) : (
            <div className="ok-min">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>Commande valide</span>
            </div>
          )}
          <div className="total-row">
            <span>{totalCartons} {totalCartons > 1 ? 'cartons' : 'carton'}</span>
            <span>{euros(totalPrix)} HT</span>
          </div>
          <div className="total-row">
            <span>{frais === 0 ? 'Livraison (franco dès 150 € HT)' : 'Frais de livraison'}</span>
            <span>{frais === 0 ? 'offerts' : euros(frais)}</span>
          </div>
          <div className="total-row">
            <span>Total</span>
            <strong>{euros(totalAvecPort)} HT</strong>
          </div>
          <button className="btn btn-primary" disabled={toutRetire || manque > 0} onClick={valider}>
            <Check size={18} aria-hidden="true" /> Enregistrer les modifications
          </button>
        </div>
      </div>
    </>
  )
}
