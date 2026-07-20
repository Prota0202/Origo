import { useState } from 'react'
import { X, Minus, Plus, Check, PackageX, Camera, RotateCcw } from 'lucide-react'
import { euros } from '../data.js'
import { redimensionnerImage } from '../image.js'

// Checklist livreur : chaque ligne démarre à la quantité commandée (cas le
// plus fréquent), le livreur n'ajuste que les lignes où tout n'a pas pu être
// livré (refus partiel, casse, article manquant…) pour minimiser les taps.
// Une photo de livraison est obligatoire avant de pouvoir confirmer — preuve
// que la commande a bien été déposée chez le client, en cas de litige.
export default function ConfirmerLivraison({ commande, onValider, onClose }) {
  const [quantites, setQuantites] = useState(() =>
    Object.fromEntries(commande.lignes.map((l) => [l.id, l.qty]))
  )
  const [photo, setPhoto] = useState(null)
  const [erreurPhoto, setErreurPhoto] = useState(null)

  const changerQty = (id, qty, max) => {
    setQuantites((prev) => ({ ...prev, [id]: Math.max(0, Math.min(qty, max)) }))
  }

  const capturerPhoto = async (e) => {
    const fichier = e.target.files?.[0]
    e.target.value = ''
    if (!fichier) return
    if (!fichier.type.startsWith('image/')) {
      setErreurPhoto('Ce fichier n’est pas une image.')
      return
    }
    try {
      const dataUrl = await redimensionnerImage(fichier)
      setErreurPhoto(null)
      setPhoto(dataUrl)
    } catch {
      setErreurPhoto('Impossible de charger cette photo, réessayez.')
    }
  }

  const toutLivre = commande.lignes.every((l) => quantites[l.id] === l.qty)
  const cartonsLivres = commande.lignes.reduce((s, l) => s + quantites[l.id], 0)
  const totalLivre = commande.lignes.reduce((s, l) => s + quantites[l.id] * l.prixCarton, 0)

  const confirmer = () => {
    if (!photo) return
    const resultats = commande.lignes.map((l) => ({ id: l.id, qty: quantites[l.id] }))
    onValider(resultats, photo)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-confirmer-livraison">
        <div className="sheet-header">
          <h2 id="titre-confirmer-livraison" className="sheet-title">Livraison {commande.numero}</h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>

        <div className="sheet-body">
          <p className="ligne-detail" style={{ marginBottom: 12 }}>
            Ajustez la quantité réellement livrée par produit (refus, casse, article manquant…).
          </p>
          {commande.lignes.map((l) => {
            const qty = quantites[l.id]
            const etat = qty === l.qty ? 'livree' : qty === 0 ? 'refusee' : 'partielle'
            return (
              <div key={l.id} className={`ligne-checklist ${etat}`}>
                <div className="ligne-infos">
                  <p className="ligne-nom">{l.nom}</p>
                  <p className="ligne-detail">
                    Commandé : {l.qty} · Livré : {qty} × {euros(l.prixCarton)} = {euros(qty * l.prixCarton)}
                  </p>
                </div>
                <div className="stepper" style={{ padding: 2 }}>
                  <button
                    aria-label={`Réduire la quantité livrée de ${l.nom}`}
                    onClick={() => changerQty(l.id, qty - 1, l.qty)}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="stepper-qty" style={{ minWidth: 32 }}>{qty}</span>
                  <button
                    aria-label={`Augmenter la quantité livrée de ${l.nom}`}
                    onClick={() => changerQty(l.id, qty + 1, l.qty)}
                    disabled={qty >= l.qty}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )
          })}

          <p className="ligne-detail" style={{ margin: '16px 0 8px' }}>
            Photo de livraison (obligatoire)
          </p>
          {photo ? (
            <div className="photo-preview">
              <img src={photo} alt="Photo de livraison" />
              <label className="photo-suppr" style={{ cursor: 'pointer' }}>
                <RotateCcw size={16} /> Reprendre
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={capturerPhoto}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          ) : (
            <label className="photo-vide">
              <Camera size={22} aria-hidden="true" />
              <span>Prendre une photo de la livraison</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={capturerPhoto}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {erreurPhoto && <p className="erreur-photo">{erreurPhoto}</p>}
        </div>

        <div className="sheet-footer">
          {!photo && (
            <div className="alerte-min" role="alert">
              <Camera size={18} aria-hidden="true" />
              <span>Ajoutez une photo de livraison pour pouvoir confirmer.</span>
            </div>
          )}
          {toutLivre ? (
            <div className="ok-min">
              <Check size={18} aria-hidden="true" />
              <span>Tout est livré — {cartonsLivres} cartons</span>
            </div>
          ) : (
            <div className="alerte-min" role="alert">
              <PackageX size={18} aria-hidden="true" />
              <span>
                {cartonsLivres} / {commande.cartons} cartons livrés, seront facturés ({euros(totalLivre)} HT),
                le reste réintègre le stock.
              </span>
            </div>
          )}
          <button className="btn btn-primary" onClick={confirmer} disabled={!photo}>
            <Check size={18} aria-hidden="true" /> Confirmer la livraison
          </button>
        </div>
      </div>
    </>
  )
}
