import { useState } from 'react'
import { Plus, Pencil, Trash2, X, ImagePlus, ImageOff, Crop } from 'lucide-react'
import { euros } from '../../data.js'
import { ProductsApi } from '../../api/index.js'
import { chargerImagePourRecadrage } from '../../image.js'
import AjusterPhoto from '../AjusterPhoto.jsx'
import { slug } from './utils.js'

export function ProduitForm({ produit, categories, onSave, onClose }) {
  const [f, setF] = useState(
    produit
      ? { ...produit, remiseSeuil: produit.remise?.seuil ?? '', remisePourcent: produit.remise?.pourcent ?? '' }
      : {
          nom: '', description: '', categorie: categories[0] ?? '', unitesParCarton: '', prixCarton: '',
          stock: 20, seuilAlerte: 10, remiseSeuil: '', remisePourcent: '', photo: null,
        }
  )
  const [erreurPhoto, setErreurPhoto] = useState(null)
  const [photoAAjuster, setPhotoAAjuster] = useState(null)
  const maj = (champ) => (e) => setF({ ...f, [champ]: e.target.value })

  const choisirPhoto = async (e) => {
    const fichier = e.target.files?.[0]
    e.target.value = ''
    if (!fichier) return
    if (!fichier.type.startsWith('image/')) {
      setErreurPhoto('Ce fichier n’est pas une image.')
      return
    }
    try {
      const dataUrl = await chargerImagePourRecadrage(fichier)
      setErreurPhoto(null)
      setPhotoAAjuster(dataUrl)
    } catch {
      setErreurPhoto('Impossible de charger cette image, réessayez.')
    }
  }

  const validerRecadrage = (dataUrl) => {
    setF((prev) => ({ ...prev, photo: dataUrl }))
    setPhotoAAjuster(null)
  }

  const enregistrer = (e) => {
    e.preventDefault()
    const { remiseSeuil, remisePourcent, ...reste } = f
    onSave({
      ...reste,
      id: produit?.id ?? slug(f.nom),
      unitesParCarton: Number(f.unitesParCarton),
      prixCarton: Number(f.prixCarton),
      stock: Number(f.stock),
      seuilAlerte: Number(f.seuilAlerte),
      remise:
        remiseSeuil !== '' && remisePourcent !== ''
          ? { seuil: Number(remiseSeuil), pourcent: Number(remisePourcent) }
          : undefined,
    })
  }

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <form className="sheet" onSubmit={enregistrer} role="dialog" aria-modal="true" aria-labelledby="titre-produit-form">
        <div className="sheet-header">
          <h2 id="titre-produit-form" className="sheet-title">
            {produit ? 'Modifier le produit' : 'Nouveau produit'}
          </h2>
          <button type="button" className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body form-body">
          <div className="champ-photo">
            {f.photo ? (
              <div className="photo-preview">
                <img src={f.photo} alt="" />
                <button type="button" className="photo-suppr" onClick={() => setF((prev) => ({ ...prev, photo: null }))} aria-label="Supprimer la photo">
                  <ImageOff size={16} /> Retirer
                </button>
              </div>
            ) : (
              <label className="photo-vide">
                <ImagePlus size={22} aria-hidden="true" />
                <span>Ajouter une photo</span>
                <input type="file" accept="image/*" onChange={choisirPhoto} style={{ display: 'none' }} />
              </label>
            )}
            {f.photo && (
              <div style={{ display: 'flex', gap: 16 }}>
                <label className="lien-changer-photo">
                  Changer la photo
                  <input type="file" accept="image/*" onChange={choisirPhoto} style={{ display: 'none' }} />
                </label>
                <button type="button" className="lien-ajuster-photo" onClick={() => setPhotoAAjuster(f.photo)}>
                  <Crop size={14} aria-hidden="true" /> Ajuster le cadrage
                </button>
              </div>
            )}
            {erreurPhoto && <p className="erreur-photo">{erreurPhoto}</p>}
          </div>
          <label className="champ">
            <span>Nom du produit</span>
            <input type="text" value={f.nom} onChange={maj('nom')} placeholder="ex. Bol kraft 500 ml" required />
          </label>
          <label className="champ">
            <span>Description</span>
            <input type="text" value={f.description} onChange={maj('description')} placeholder="Courte description" required />
          </label>
          <label className="champ">
            <span>Catégorie</span>
            <input type="text" value={f.categorie} onChange={maj('categorie')} list="categories" placeholder="ex. Vaisselle jetable" required />
            <datalist id="categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <div className="champ-row">
            <label className="champ">
              <span>Pièces / carton</span>
              <input type="number" inputMode="numeric" min="1" value={f.unitesParCarton} onChange={maj('unitesParCarton')} required />
            </label>
            <label className="champ">
              <span>Prix carton HT (€)</span>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={f.prixCarton} onChange={maj('prixCarton')} required />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>Stock (cartons)</span>
              <input type="number" inputMode="numeric" min="0" value={f.stock} onChange={maj('stock')} required />
            </label>
            <label className="champ">
              <span>Seuil d’alerte</span>
              <input type="number" inputMode="numeric" min="0" value={f.seuilAlerte} onChange={maj('seuilAlerte')} required />
            </label>
          </div>
          <div className="champ-row">
            <label className="champ">
              <span>Remise dès (cartons)</span>
              <input type="number" inputMode="numeric" min="2" value={f.remiseSeuil} onChange={maj('remiseSeuil')} placeholder="optionnel" />
            </label>
            <label className="champ">
              <span>Remise (%)</span>
              <input type="number" inputMode="decimal" min="1" max="50" value={f.remisePourcent} onChange={maj('remisePourcent')} placeholder="optionnel" />
            </label>
          </div>
        </div>
        <div className="sheet-footer">
          <button type="submit" className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
      {photoAAjuster && (
        <AjusterPhoto
          src={photoAAjuster}
          onValider={validerRecadrage}
          onAnnuler={() => setPhotoAAjuster(null)}
        />
      )}
    </>
  )
}

/* ---------- Onglet Produits ---------- */
export function AdminProduits({ produits, setProduits, clients, setClients, onRefresh }) {
  const [form, setForm] = useState(null)
  const categories = [...new Set(produits.map((p) => p.categorie))]

  const enregistrer = async (p) => {
    try {
      const body = {
        nom: p.nom,
        description: p.description,
        categorie: p.categorie,
        unitesParCarton: Number(p.unitesParCarton),
        prixCarton: Number(p.prixCarton),
        stock: Number(p.stock ?? 0),
        seuilAlerte: Number(p.seuilAlerte ?? 10),
        photoUrl: p.photo ?? null,
        remiseSeuil: p.remise?.seuil ?? null,
        remisePourcent: p.remise?.pourcent ?? null,
        sku: p.sku,
      }
      const exists = produits.some((x) => x.id === p.id)
      if (exists) await ProductsApi.update(p.id, body)
      else await ProductsApi.create(body)
      await onRefresh?.()
      setForm(null)
    } catch (e) {
      alert(e.message)
    }
  }

  const supprimer = async (p) => {
    if (!window.confirm(`Désactiver « ${p.nom} » du catalogue ?`)) return
    try {
      await ProductsApi.update(p.id, { actif: false })
      await onRefresh?.()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <section aria-labelledby="titre-admin-produits">
      <h1 id="titre-admin-produits" className="page-title">Catalogue général</h1>
      <p className="page-subtitle">{produits.length} produits — visibles uniquement des clients auxquels vous les attribuez</p>

      <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={() => setForm({ produit: null })}>
        <Plus size={18} aria-hidden="true" /> Ajouter un produit
      </button>

      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="categorie-titre">{cat}</h2>
          {produits.filter((p) => p.categorie === cat).map((p) => {
            const alerte = (p.stock ?? 0) <= (p.seuilAlerte ?? 10)
            return (
              <article key={p.id} className={`commande-card admin-ligne ${alerte ? 'alerte-stock' : ''}`}>
                {p.photo ? (
                  <img className="mini-photo" src={p.photo} alt="" />
                ) : (
                  <span className="mini-photo mini-photo-vide" aria-hidden="true"><ImagePlus size={16} /></span>
                )}
                <div className="ligne-infos">
                  <p className="ligne-nom">{p.nom}</p>
                  <p className="ligne-detail">
                    {euros(p.prixCarton)} HT · stock {p.stock ?? 0}
                    {alerte && ' ⚠'} · {clients.filter((c) => c.produits.includes(p.id)).length} client(s)
                    {p.remise && ` · −${p.remise.pourcent} % dès ${p.remise.seuil}`}
                  </p>
                </div>
                <div className="admin-actions">
                  <button className="icon-btn icon-btn-gris" onClick={() => setForm({ produit: p })} aria-label={`Modifier ${p.nom}`}>
                    <Pencil size={18} />
                  </button>
                  <button className="icon-btn icon-btn-gris" onClick={() => supprimer(p)} aria-label={`Supprimer ${p.nom}`}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ))}

      {form && (
        <ProduitForm produit={form.produit} categories={categories} onSave={enregistrer} onClose={() => setForm(null)} />
      )}
    </section>
  )
}

