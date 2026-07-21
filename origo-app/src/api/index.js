import { api, setToken, clearSession, getToken } from './http.js'

export { getToken, setToken, clearSession }

export const AuthApi = {
  login: (code, motDePasse) =>
    api('/api/v1/auth/login', { method: 'POST', body: { code, motDePasse }, auth: false }),
  me: () => api('/api/v1/auth/me'),
  company: () => api('/api/v1/company', { auth: false }),
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
}

export const OrdersApi = {
  mine: () => api('/api/v1/me/orders'),
  all: () => api('/api/v1/orders'),
  create: (lignes) => api('/api/v1/me/orders', { method: 'POST', body: { lignes } }),
  annuler: (id) => api(`/api/v1/me/orders/${id}/annuler`, { method: 'POST' }),
  modifier: (id, lignes) => api(`/api/v1/me/orders/${id}`, { method: 'PATCH', body: { lignes } }),
  modifierAdmin: (id, lignes) => api(`/api/v1/orders/${id}`, { method: 'PATCH', body: { lignes } }),
  setStatut: (id, body) => api(`/api/v1/orders/${id}/statut`, { method: 'PATCH', body }),
  setPayee: (id, payee) => api(`/api/v1/orders/${id}/payee`, { method: 'PATCH', body: { payee } }),
  annulerAdmin: (id) => api(`/api/v1/orders/${id}/annuler`, { method: 'POST' }),
  retour: (id, motif, lignes) =>
    api(`/api/v1/orders/${id}/retours`, { method: 'POST', body: { motif, lignes } }),
}
