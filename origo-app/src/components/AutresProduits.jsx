import { PackageOpen, PackageX, Send, Check, PackageSearch } from 'lucide-react'
import { euros } from '../data.js'

// Produit hors du catalogue négocié du client : prix catalogue de base
// (non négocié) affiché à titre indicatif, pas d'ajout direct au panier —
// le client demande le produit, à charge pour ORIGO de fixer un tarif et
// de l'ajouter ensuite à son catalogue personnalisé.
function CarteProduitDemande({ produit: p, demande, onDemande }) {
  const rupture = (p.stock ?? 0) <= 0
  return (
    <article className="card card-hors-catalogue">
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
          <span className="produit-prix">{euros(p.prixCarton)}</span>
        </div>
      </div>
      <p className="produit-meta">
        <PackageOpen size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" />{' '}
        {p.unitesParCarton} pièces / carton
      </p>
      <p className="tag-hors-catalogue">Tarif catalogue, non négocié pour votre compte</p>
      <div className="produit-footer">
        {rupture ? (
          <p className="tag-rupture">
            <PackageX size={16} aria-hidden="true" /> Rupture de stock — bientôt réapprovisionné
          </p>
        ) : demande ? (
          <button type="button" className="btn btn-ghost" disabled>
            <Check size={18} aria-hidden="true" /> Demande envoyée
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => onDemande(p)}>
            <Send size={16} aria-hidden="true" /> Demander ce produit
          </button>
        )}
      </div>
    </article>
  )
}

export default function AutresProduits({ client, produits, demandesEnvoyees, onDemande }) {
  const produitsHorsCatalogue = produits.filter((p) => !client.produits.includes(p.id))
  const categories = [...new Set(produitsHorsCatalogue.map((p) => p.categorie))]

  return (
    <section aria-labelledby="titre-autres-produits">
      <h1 id="titre-autres-produits" className="page-title">Autres produits</h1>
      <p className="page-subtitle">
        Le reste du catalogue ORIGO, au tarif de base — demandez un produit pour qu'on l'ajoute à
        votre sélection avec un tarif négocié.
      </p>

      {produitsHorsCatalogue.length === 0 ? (
        <div className="empty">
          <PackageSearch size={40} aria-hidden="true" />
          <p>Votre sélection couvre déjà tout notre catalogue.</p>
        </div>
      ) : (
        categories.map((cat) => (
          <div key={cat}>
            <h2 className="categorie-titre">{cat}</h2>
            <div className="grid">
              {produitsHorsCatalogue
                .filter((p) => p.categorie === cat)
                .map((p) => (
                  <CarteProduitDemande
                    key={p.id}
                    produit={p}
                    demande={demandesEnvoyees.includes(p.id)}
                    onDemande={onDemande}
                  />
                ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}
