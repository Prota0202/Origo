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
      <div className="produit-visuel">
        {p.photo ? (
          <img className="produit-photo" src={p.photo} alt={p.nom} loading="lazy" />
        ) : (
          <div className="produit-photo produit-photo-vide" aria-hidden="true">
            <PackageOpen size={22} />
          </div>
        )}
        <span className="prix-badge">{euros(p.prixCarton)}</span>
      </div>
      <h3 className="produit-nom">{p.nom}</h3>
      <p className="produit-meta">{p.unitesParCarton} p. / carton</p>
      <div className="produit-footer">
        {rupture ? (
          <p className="tag-rupture">
            <PackageX size={16} aria-hidden="true" /> Rupture
          </p>
        ) : demande ? (
          <button type="button" className="btn btn-ghost" disabled>
            <Check size={16} aria-hidden="true" /> Demandé
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => onDemande(p)}>
            <Send size={15} aria-hidden="true" /> Demander
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

      {produitsHorsCatalogue.length === 0 ? (
        <div className="empty">
          <PackageSearch size={40} aria-hidden="true" />
          <p>Tout le catalogue est déjà dans votre sélection.</p>
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
