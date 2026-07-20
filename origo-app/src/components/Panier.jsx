import { X, Trash2, AlertCircle, CheckCircle2, Minus, Plus, BadgePercent, Package } from 'lucide-react'
import { euros, tarifLigne } from '../data.js'

export default function Panier({ client, produits, panier, onChange, onClose, onValider }) {
  const minCartons = client.minCartons
  const lignes = produits.filter((p) => (panier[p.id] ?? 0) > 0)
  const totalCartons = lignes.reduce((s, p) => s + panier[p.id], 0)
  const tarifs = Object.fromEntries(lignes.map((p) => [p.id, tarifLigne(client, p, panier[p.id])]))
  const totalPrix = lignes.reduce((s, p) => s + tarifs[p.id].total, 0)
  const economie = lignes.reduce((s, p) => s + (tarifs[p.id].pu * panier[p.id] - tarifs[p.id].total), 0)
  const manque = minCartons - totalCartons

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-panier">
        <div className="sheet-header">
          <h2 id="titre-panier" className="sheet-title">Panier de commande</h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer le panier">
            <X size={22} />
          </button>
        </div>

        <div className="sheet-body">
          {lignes.length === 0 ? (
            <div className="empty">
              <p>Votre panier est vide.</p>
              <p style={{ fontSize: 14 }}>Ajoutez des cartons depuis le catalogue.</p>
            </div>
          ) : (
            lignes.map((p) => {
              const t = tarifs[p.id]
              return (
                <div key={p.id} className="ligne-panier">
                  {p.photo ? (
                    <img className="mini-photo" src={p.photo} alt="" />
                  ) : (
                    <span className="mini-photo mini-photo-vide" aria-hidden="true"><Package size={16} /></span>
                  )}
                  <div className="ligne-infos">
                    <p className="ligne-nom">{p.nom}</p>
                    <p className="ligne-detail">
                      {panier[p.id]} × {euros(t.puFinal)} = {euros(t.total)}
                    </p>
                    {t.remisePct > 0 && (
                      <p className="tag-remise">
                        <BadgePercent size={13} aria-hidden="true" />{' '}
                        {t.palierSeuil
                          ? `Tarif palier −${t.remisePct} % dès ${t.palierSeuil} cartons`
                          : `Remise −${t.remisePct} % appliquée`}
                      </p>
                    )}
                  </div>
                  <div className="stepper" style={{ padding: 2 }}>
                    <button aria-label={`Retirer un carton de ${p.nom}`} onClick={() => onChange(p, panier[p.id] - 1)}>
                      <Minus size={16} />
                    </button>
                    <span className="stepper-qty" style={{ minWidth: 32 }}>{panier[p.id]}</span>
                    <button
                      aria-label={`Ajouter un carton de ${p.nom}`}
                      onClick={() => onChange(p, panier[p.id] + 1)}
                      disabled={panier[p.id] >= (p.stock ?? Infinity)}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <button className="ligne-suppr" aria-label={`Supprimer ${p.nom} du panier`} onClick={() => onChange(p, 0)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        {lignes.length > 0 && (
          <div className="sheet-footer">
            {manque > 0 ? (
              <div className="alerte-min" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>
                  Ajoutez encore {manque} {manque > 1 ? 'cartons' : 'carton'} pour atteindre le
                  minimum de {minCartons} cartons par livraison.
                </span>
              </div>
            ) : (
              <div className="ok-min">
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>Minimum de commande atteint</span>
              </div>
            )}
            {economie > 0.004 && (
              <div className="total-row">
                <span>Économie remises</span>
                <span style={{ color: 'var(--green-600)', fontWeight: 600 }}>−{euros(economie)}</span>
              </div>
            )}
            <div className="total-row">
              <span>{totalCartons} {totalCartons > 1 ? 'cartons' : 'carton'}</span>
              <strong>{euros(totalPrix)} HT</strong>
            </div>
            <button
              className="btn btn-primary"
              disabled={manque > 0}
              onClick={() => onValider(lignes, totalPrix, totalCartons)}
            >
              Valider la commande
            </button>
          </div>
        )}
      </div>
    </>
  )
}
