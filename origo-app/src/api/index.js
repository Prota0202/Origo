import { api, setToken, clearSession, getToken } from './http.js'

export { getToken, setToken, clearSession }

export const AuthApi = {
  login: (code, motDePasse) =>
    api('/api/v1/auth/login', { method: 'POST', body: { code, motDePasse }, auth: false }),
  logout: () => api('/api/v1/auth/logout', { method: 'POST', auth: false }),
  me: () => api('/api/v1/auth/me'),
  company: () => api('/api/v1/company', { auth: false }),
  updateCompany: (data) => api('/api/v1/company', { method: 'PATCH', body: data }),
  ready: () => api('/api/v1/ready', { auth: false }),
  changerMotDePasse: (actuel, nouveau) =>
    api('/api/v1/me/mot-de-passe', { method: 'PATCH', body: { actuel, nouveau } }),
}

export const ProductsApi = {
  list: () => api('/api/v1/products'),
  create: (data) => api('/api/v1/products', { method: 'POST', body: data }),
  update: (id, data) => api(`/api/v1/products/${id}`, { method: 'PATCH', body: data }),
  adjustStock: (id, delta, note) =>
    api(`/api/v1/products/${id}/stock-adjust`, { method: 'POST', body: { delta, note } }),
}

export const ClientsApi = {
  list: () => api('/api/v1/clients'),
  create: (data) => api('/api/v1/clients', { method: 'POST', body: data }),
  update: (id, data) => api(`/api/v1/clients/${id}`, { method: 'PATCH', body: data }),
  setCatalogue: (id, entries) =>
    api(`/api/v1/clients/${id}/catalogue`, { method: 'PUT', body: { entries } }),
  setPaliers: (id, productId, paliers) =>
    api(`/api/v1/clients/${id}/paliers`, { method: 'PUT', body: { productId, paliers } }),
  setFavoris: (productIds) =>
    api('/api/v1/me/favoris', { method: 'PUT', body: { productIds } }),
  setNote: (productId, texte) =>
    api(`/api/v1/me/notes/${productId}`, { method: 'PUT', body: { texte } }),
  demanderProduit: (productId) =>
    api('/api/v1/me/demandes', { method: 'POST', body: { productId } }),
  mesDemandes: () => api('/api/v1/me/demandes'),
  listDemandes: () => api('/api/v1/demandes'),
  traiterDemande: (id) => api(`/api/v1/demandes/${id}/traiter`, { method: 'POST' }),
  mandatSepa: () => api('/api/v1/me/sepa/mandat', { method: 'POST' }),
}

export const OrdersApi = {
  get: (id) => api(`/api/v1/orders/${id}`),
  mine: () => api('/api/v1/me/orders'),
  all: () => api('/api/v1/orders'),
  create: (lignes, signature) =>
    api('/api/v1/me/orders', {
      method: 'POST',
      body: {
        lignes,
        signatureNom: signature.nom,
        acceptationCgv: signature.acceptationCgv,
        signatureImage: signature.image,
      },
    }),
  confirmerPaiement: (id) => api(`/api/v1/me/orders/${id}/paiement`),
  annuler: (id) => api(`/api/v1/me/orders/${id}/annuler`, { method: 'POST' }),
  modifier: (id, lignes) => api(`/api/v1/me/orders/${id}`, { method: 'PATCH', body: { lignes } }),
  modifierAdmin: (id, lignes) => api(`/api/v1/orders/${id}`, { method: 'PATCH', body: { lignes } }),
  setStatut: (id, body) => api(`/api/v1/orders/${id}/statut`, { method: 'PATCH', body }),
  setPayee: (id, payee) => api(`/api/v1/orders/${id}/payee`, { method: 'PATCH', body: { payee } }),
  // remiseEnStock : obligatoire pour une commande déjà livrée (la marchandise
  // est-elle physiquement revenue ?), ignoré sinon.
  annulerAdmin: (id, remiseEnStock) =>
    api(`/api/v1/orders/${id}/annuler`, { method: 'POST', body: { remiseEnStock } }),
  retour: (id, motif, lignes) =>
    api(`/api/v1/orders/${id}/retours`, { method: 'POST', body: { motif, lignes } }),
}

export const StaffApi = {
  list: () => api('/api/v1/staff'),
  create: (data) => api('/api/v1/staff', { method: 'POST', body: data }),
  update: (id, data) => api(`/api/v1/staff/${id}`, { method: 'PATCH', body: data }),
}

export const OdooApi = {
  etat: () => api('/api/v1/odoo'),
  synchroniser: (inclureStock = false) =>
    api('/api/v1/odoo/synchroniser', { method: 'POST', body: { inclureStock } }),
}

export const SepaApi = {
  liste: () => api('/api/v1/sepa/prelevements'),
  lancer: (forcer = false) => api('/api/v1/sepa/lancer', { method: 'POST', body: { forcer } }),
}
