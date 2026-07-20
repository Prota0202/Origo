import { PRODUITS, CLIENTS } from './data.js'

// Données modifiables par l'admin, persistées en localStorage
// (à remplacer par une vraie API/BDD en production)
const K_PRODUITS = 'origo-produits'
const K_CLIENTS = 'origo-clients'

function charger(cle, defaut) {
  try {
    const v = JSON.parse(localStorage.getItem(cle))
    return Array.isArray(v) && v.length > 0 ? v : defaut
  } catch {
    return defaut
  }
}

// Complète les enregistrements anciens avec les champs ajoutés depuis
const normaliserProduit = (p) => ({ stock: 20, seuilAlerte: 10, photo: null, ...p })
const normaliserClient = (c) => ({ prix: {}, favoris: [], notes: {}, ...c })

// Chaque appareil (téléphone, navigateur) garde sa propre copie du catalogue
// dans son localStorage, indépendante du code. Quand de nouveaux produits
// sont ajoutés dans data.js (ex. import d'un fichier fournisseur), il faut
// les fusionner dans la copie déjà enregistrée sur l'appareil — sans écraser
// les prix/stocks déjà personnalisés localement — pour qu'ils apparaissent
// automatiquement à la prochaine ouverture de l'app, sur tous les appareils.
export function chargerProduits() {
  const persistes = charger(K_PRODUITS, null)
  if (!persistes) return PRODUITS.map(normaliserProduit)

  const idsExistants = new Set(persistes.map((p) => p.id))
  const nouveaux = PRODUITS.filter((p) => !idsExistants.has(p.id))
  if (nouveaux.length === 0) return persistes.map(normaliserProduit)

  const fusion = [...persistes, ...nouveaux].map(normaliserProduit)
  sauverProduits(fusion)
  return fusion
}

export const chargerClients = () => charger(K_CLIENTS, CLIENTS).map(normaliserClient)
export const sauverProduits = (p) => localStorage.setItem(K_PRODUITS, JSON.stringify(p))
export const sauverClients = (c) => localStorage.setItem(K_CLIENTS, JSON.stringify(c))

export function chargerCommandesClient(id) {
  try {
    return JSON.parse(localStorage.getItem(`origo-commandes-${id}`)) ?? []
  } catch {
    return []
  }
}

export const sauverCommandesClient = (id, commandes) =>
  localStorage.setItem(`origo-commandes-${id}`, JSON.stringify(commandes))

// Demandes client pour des produits hors de leur catalogue négocié — l'admin
// les traite pour ajouter le produit au client (avec un tarif) ou les ignorer.
const K_DEMANDES = 'origo-demandes'
export const chargerDemandes = () => charger(K_DEMANDES, [])
export const sauverDemandes = (d) => localStorage.setItem(K_DEMANDES, JSON.stringify(d))
