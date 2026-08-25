import { useState } from 'react'
import { X, Minus, Plus, Undo2, PackageCheck, PackageX } from 'lucide-react'
import { euros } from '../data.js'
import Overlay from './Overlay.jsx'

// Retour après livraison (admin uniquement) : le client a signalé un souci
// (casse, périmé, erreur…) après coup, une fois la commande déjà livrée.
// Pour chaque ligne, l'admin choisit la quantité retournée et si elle est
// remise en stock (bon état) ou perdue (ne réintègre pas le stock).
export default function RetourCommande({ commande, onValider, onClose }) {
  // Les lignes refusées à la livraison (livree === false) ne sont jamais
  // arrivées chez le client : elles ont déjà réintégré le stock via
  // ConfirmerLivraison et ne peuvent pas faire l'objet d'un retour.
  const lignesLivrees = commande.lignes.filter((l) => l.livree !== false)

  const [quantites, setQuantites] = useState(() =>
    Object.fromEntries(lignesLivrees.map((l) => [l.id, 0]))
  )
  const [remisEnStock, setRemisEnStock] = useState(() =>
    Object.fromEntries(lignesLivrees.map((l) => [l.id, true]))
  )
  const [motif, setMotif] = useState('')

  const changerQty = (id, qty, max) => {
    setQuantites((prev) => ({ ...prev, [id]: Math.max(0, Math.min(qty, max)) }))
  }

  const lignesRetournees = lignesLivrees.filter((l) => quantites[l.id] > 0)
  const cartonsRetour = lignesRetournees.reduce((s, l) => s + quantites[l.id], 0)
  const totalRetour = lignesRetournees.reduce((s, l) => s + quantites[l.id] * l.prixCarton, 0)
  const rienSelectionne = cartonsRetour === 0

  const valider = () => {
    if (rienSelectionne) return
    onValider(
      lignesRetournees.map((l) => ({
        id: l.id,
        nom: l.nom,
        prixCarton: l.prixCarton,
        qty: quantites[l.id],
        remisEnStock: remisEnStock[l.id],
      })),
      motif.trim()
    )
  }

  return (
    <>
      <Overlay onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-retour-commande">
        <div className="sheet-header">
          <h2 id="titre-retour-commande" className="sheet-title">Retour {commande.numero}</h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>

        <div className="sheet-body">
          <p className="ligne-detail" style={{ marginBottom: 12 }}>
            Indiquez la quantité retournée par produit, et si elle repart en stock (bon état) ou non (casse, périmé…).
          </p>
          {lignesLivrees.map((l) => (
            <div key={l.id} className="ligne-panier" style={{ flexWrap: 'wrap' }}>
              <div className="ligne-infos">
                <p className="ligne-nom">{l.nom}</p>
                <p className="ligne-detail">
                  Livré : {l.qty} · Retour : {quantites[l.id]} × {euros(l.prixCarton)} = {euros(quantites[l.id] * l.prixCarton)}
                </p>
              </div>
              <div className="stepper" style={{ padding: 2 }}>
                <button
                  aria-label={`Réduire le retour de ${l.nom}`}
                  onClick={() => changerQty(l.id, quantites[l.id] - 1, l.qty)}
                >
                  <Minus size={16} />
                </button>
                <span className="stepper-qty" style={{ minWidth: 32 }}>{quantites[l.id]}</span>
                <button
                  aria-label={`Augmenter le retour de ${l.nom}`}
                  onClick={() => changerQty(l.id, quantites[l.id] + 1, l.qty)}
                  disabled={quantites[l.id] >= l.qty}
                >
                  <Plus size={16} />
                </button>
              </div>
              {quantites[l.id] > 0 && (
                <button
                  type="button"
                  className={`toggle-remis-stock ${remisEnStock[l.id] ? 'bon-etat' : 'perte'}`}
                  onClick={() => setRemisEnStock((prev) => ({ ...prev, [l.id]: !prev[l.id] }))}
                >
                  {remisEnStock[l.id] ? (
                    <><PackageCheck size={14} aria-hidden="true" /> Bon état — remis en stock</>
                  ) : (
                    <><PackageX size={14} aria-hidden="true" /> Perdu — pas de restock</>
                  )}
                </button>
              )}
            </div>
          ))}

          <label className="champ" style={{ marginTop: 8 }}>
            <span>Motif</span>
            <input
              type="text"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="ex. produit périmé, cassé pendant le transport…"
              required
            />
          </label>
        </div>

        <div className="sheet-footer">
          <div className="total-row">
            <span>{cartonsRetour} {cartonsRetour > 1 ? 'cartons retournés' : 'carton retourné'}</span>
            <strong>−{euros(totalRetour)} HT</strong>
          </div>
          <button className="btn btn-primary" disabled={rienSelectionne || !motif.trim()} onClick={valider}>
            <Undo2 size={18} aria-hidden="true" /> Enregistrer le retour
          </button>
        </div>
      </div>
    </>
  )
}
