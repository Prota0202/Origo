import type {
  Client,
  Order,
  OrderItem,
  Product,
  RetourCommande,
  RetourLigne,
  RoleStaff,
  StatutCommande,
} from '@prisma/client'
import { toNum } from './money.js'

/** Statuts API → libellés UI front existants */
export const STATUT_UI: Record<StatutCommande, string> = {
  CONFIRMEE: 'Confirmée',
  PREPAREE: 'Préparée',
  EN_LIVRAISON: 'En livraison',
  LIVREE: 'Livrée',
  LIVREE_PARTIELLEMENT: 'Livrée partiellement',
  ANNULEE: 'Annulée',
}

export const STATUT_FROM_UI: Record<string, StatutCommande> = {
  Confirmée: 'CONFIRMEE',
  Préparée: 'PREPAREE',
  'En livraison': 'EN_LIVRAISON',
  Livrée: 'LIVREE',
  'Livrée partiellement': 'LIVREE_PARTIELLEMENT',
  Annulée: 'ANNULEE',
}

export const ROLE_UI: Record<RoleStaff, string> = {
  DIRECTION: 'direction',
  PREPARATION: 'preparation',
  LIVREUR: 'livreur',
}

export function mapProduct(p: Product) {
  return {
    id: p.id,
    sku: p.sku,
    nom: p.nom,
    description: p.description,
    categorie: p.categorie,
    unitesParCarton: p.unitesParCarton,
    prixCarton: toNum(p.prixCarton),
    stock: p.stock,
    seuilAlerte: p.seuilAlerte,
    photo: p.photoUrl,
    actif: p.actif,
    remise:
      p.remiseSeuil != null && p.remisePourcent != null
        ? { seuil: p.remiseSeuil, pourcent: toNum(p.remisePourcent) }
        : undefined,
  }
}

export function mapClient(
  c: Client & {
    catalogue?: { productId: string; prixNegocie: unknown; visible: boolean }[]
    favoris?: { productId: string }[]
    notes?: { productId: string; texte: string }[]
    paliers?: { productId: string; seuil: number; prix: unknown }[]
  },
) {
  const prix: Record<string, number> = {}
  const produits: string[] = []
  for (const e of c.catalogue ?? []) {
    if (e.visible) produits.push(e.productId)
    if (e.prixNegocie != null) prix[e.productId] = toNum(e.prixNegocie)
  }
  const favoris = (c.favoris ?? []).map((f) => f.productId)
  const notes: Record<string, string> = {}
  for (const n of c.notes ?? []) notes[n.productId] = n.texte
  const paliers: Record<string, { seuil: number; prix: number }[]> = {}
  for (const p of c.paliers ?? []) {
    if (!paliers[p.productId]) paliers[p.productId] = []
    paliers[p.productId].push({ seuil: p.seuil, prix: toNum(p.prix) })
  }

  return {
    id: c.id,
    code: c.code,
    nom: c.nom,
    ville: c.ville,
    email: c.email,
    telephone: c.telephone,
    adresse: c.adresse,
    numeroTva: c.numeroTva,
    minCartons: c.minCartons,
    actif: c.actif,
    produits,
    prix,
    favoris,
    notes,
    paliers,
  }
}

export function mapOrder(
  o: Order & {
    items: OrderItem[]
    client?: { nom: string }
    retours?: (RetourCommande & { lignes?: RetourLigne[] })[]
  },
) {
  return {
    id: o.id,
    numero: o.numero,
    clientId: o.clientId,
    client: o.client?.nom ?? undefined,
    ts: o.createdAt.getTime(),
    date: o.createdAt.toLocaleDateString('fr-BE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    livraisonPrevue: o.dateLivraisonPrevue
      ? o.dateLivraisonPrevue.toLocaleDateString('fr-BE', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : null,
    lignes: o.items.map((i) => ({
      id: i.productId,
      itemId: i.id,
      nom: i.nomSnapshot,
      prixCarton: toNum(i.prixUnitaire),
      qty: i.quantiteCartons,
      livree: i.livree,
      coche: i.coche,
    })),
    cartons: o.cartonsTotal,
    total: toNum(o.totalHT),
    statut: STATUT_UI[o.statut],
    payee: o.payee,
    photoLivraisonUrl: o.photoLivraisonUrl,
    photoLivraison: o.photoLivraisonUrl,
    noteLivraison: o.noteLivraison,
    motifAnnulation: o.motifAnnulation,
    annuleeLe: o.annuleeLe?.getTime() ?? null,
    modifieeLe: o.modifieeLe?.getTime() ?? null,
    livreeLe: o.livreeLe?.getTime() ?? null,
    createdAt: o.createdAt.toISOString(),
    retours: (o.retours ?? []).map((r) => ({
      id: r.id,
      date: r.createdAt.getTime(),
      motif: r.motif,
      lignes: (r.lignes ?? []).map((l) => ({
        id: l.productId,
        qty: l.quantite,
        remisEnStock: l.remisEnStock,
      })),
    })),
  }
}
