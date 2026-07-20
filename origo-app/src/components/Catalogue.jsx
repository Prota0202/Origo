import { useState } from 'react'
import { Minus, Plus, PackageOpen, Info, Star, StickyNote, RotateCcw, PackageX, BadgePercent } from 'lucide-react'
import { euros, prixPour, pourcentagePalier, formatPourcentage } from '../data.js'

function Stepper({ produit, qty, onChange }) {
  const plusDesactive = qty >= (produit.stock ?? Infinity)
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label={`Retirer un carton de ${produit.nom}`}
        onClick={() => onChange(produit, qty - 1)}
      >
        <Minus size={18} />
      </button>
      <span className="stepper-qty" aria-live="polite">
        {qty}
        <small>{qty > 1 ? 'cartons' : 'carton'}</small>
      </span>
      <button
        type="button"
        aria-label={`Ajouter un carton de ${produit.nom}`}
        onClick={() => onChange(produit, qty + 1)}
        disabled={plusDesactive}
        style={plusDesactive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <Plus size={18} />
      </button>
    </div>
  )
}

function CarteProduit({ produit: p, client, panier, onChange, onMajClient, noteEnEdition, setNoteEnEdition }) {
  const qty = panier[p.id] ?? 0
  const rupture = (p.stock ?? 0) <= 0
  const favori = client.favoris?.includes(p.id)
  const note = client.notes?.[p.id]

  const basculerFavori = () =>
    onMajClient({
      favoris: favori ? client.favoris.filter((id) => id !== p.id) : [...(client.favoris ?? []), p.id],
    })

  const sauverNote = (texte) => {
    const notes = { ...(client.notes ?? {}) }
    if (texte.trim() === '') delete notes[p.id]
    else notes[p.id] = texte.trim()
    onMajClient({ notes })
    setNoteEnEdition(null)
  }

  return (
    <article className={`card ${rupture ? 'card-rupture' : ''}`}>
      {p.photo ? (
        <img className="produit-photo" src={p.photo} alt={p.nom} loading="lazy" />
      ) : (
        <div className="produit-photo produit-photo-vide" aria-hidden="true">
          <PackageOpen size={28} />
        </div>
      )}
      <div className="produit-header">
        <div>
          <h3 className="produit-nom">{p.nom}</h3>
          <p className="produit-desc">{p.description}</p>
        </div>
        <div className="produit-cote">
          <span className="produit-prix">{euros(prixPour(client, p))}</span>
          <button
            type="button"
            className={`fav-btn ${favori ? 'actif' : ''}`}
            onClick={basculerFavori}
            aria-label={favori ? `Retirer ${p.nom} des favoris` : `Épingler ${p.nom} en favori`}
            aria-pressed={favori}
          >
            <Star size={20} fill={favori ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      <p className="produit-meta">
        <PackageOpen size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" />{' '}
        {p.unitesParCarton} pièces / carton
      </p>
      {client.paliers?.[p.id]?.length > 0 && !rupture ? (
        <p className="tag-remise">
          <BadgePercent size={14} aria-hidden="true" />{' '}
          {client.paliers[p.id]
            .map((pal) => `${formatPourcentage(pourcentagePalier(prixPour(client, p), pal.prix))} dès ${pal.seuil} cartons`)
            .join(' · ')}
        </p>
      ) : (
        p.remise && !rupture && (
          <p className="tag-remise">
            <BadgePercent size={14} aria-hidden="true" /> −{p.remise.pourcent} % dès {p.remise.seuil} cartons
          </p>
        )
      )}
      {note && noteEnEdition !== p.id && (
        <p className="note-produit" onClick={() => setNoteEnEdition(p.id)}>
          <StickyNote size={14} aria-hidden="true" /> {note}
        </p>
      )}
      {noteEnEdition === p.id && (
        <input
          className="note-input"
          type="text"
          defaultValue={note ?? ''}
          placeholder="Votre note (ex. prévoir 2 cartons de plus vendredi)"
          autoFocus
          onBlur={(e) => sauverNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sauverNote(e.target.value)}
          aria-label={`Note pour ${p.nom}`}
        />
      )}
      <div className="produit-footer">
        {rupture ? (
          <p className="tag-rupture">
            <PackageX size={16} aria-hidden="true" /> Rupture de stock — bientôt réapprovisionné
          </p>
        ) : qty === 0 ? (
          <div className="footer-actions">
            <button type="button" className="btn btn-primary" onClick={() => onChange(p, 1)}>
              <Plus size={18} aria-hidden="true" /> Ajouter au panier
            </button>
            {!note && noteEnEdition !== p.id && (
              <button
                type="button"
                className="icon-btn icon-btn-gris"
                onClick={() => setNoteEnEdition(p.id)}
                aria-label={`Ajouter une note sur ${p.nom}`}
              >
                <StickyNote size={18} />
              </button>
            )}
          </div>
        ) : (
          <Stepper produit={p} qty={qty} onChange={onChange} />
        )}
      </div>
    </article>
  )
}

export default function Catalogue({ client, produits, panier, onChange, onMajClient, onRecommander }) {
  const [noteEnEdition, setNoteEnEdition] = useState(null)
  const produitsClient = produits.filter((p) => client.produits.includes(p.id))
  const favoris = produitsClient.filter((p) => client.favoris?.includes(p.id))
  const autres = produitsClient.filter((p) => !client.favoris?.includes(p.id))
  const categories = [...new Set(autres.map((p) => p.categorie))]

  const props = { client, panier, onChange, onMajClient, noteEnEdition, setNoteEnEdition }

  return (
    <section aria-labelledby="titre-catalogue">
      <h1 id="titre-catalogue" className="page-title">Catalogue</h1>
      <p className="page-subtitle">
        Sélection établie pour <strong>{client.nom}</strong> — vendue au carton
      </p>

      <div className="min-banner" role="note">
        <Info size={20} aria-hidden="true" />
        <span>
          Minimum de commande&nbsp;: <strong>{client.minCartons} cartons</strong> par livraison
        </span>
      </div>

      {onRecommander && (
        <button type="button" className="btn btn-ghost btn-recommander" onClick={onRecommander}>
          <RotateCcw size={18} aria-hidden="true" /> Recommander ma dernière commande
        </button>
      )}

      {favoris.length > 0 && (
        <div>
          <h2 className="categorie-titre">
            <Star size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Favoris
          </h2>
          <div className="grid">
            {favoris.map((p) => <CarteProduit key={p.id} produit={p} {...props} />)}
          </div>
        </div>
      )}

      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="categorie-titre">{cat}</h2>
          <div className="grid">
            {autres.filter((p) => p.categorie === cat).map((p) => (
              <CarteProduit key={p.id} produit={p} {...props} />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
