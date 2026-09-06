/** Doit rester aligné avec server/src/lib/frais-livraison.ts */
export const SEUIL_FRANCO_HT = 150
export const FRAIS_LIVRAISON_HT = 10

export function fraisLivraisonHT(sousTotalArticlesHT) {
  const ht = Math.round(Number(sousTotalArticlesHT) * 100) / 100
  return ht >= SEUIL_FRANCO_HT ? 0 : FRAIS_LIVRAISON_HT
}

export const TEXTE_PAIEMENT_SEPA =
  'Prélèvement SEPA selon le calendrier convenu avec ORIGO, sur les commandes livrées non encore payées.'

export const TEXTE_PAIEMENT_STRIPE = 'Paiement par carte (Stripe) à la commande.'

export const TEXTE_PAIEMENT_VIREMENT =
  'Paiement par virement après livraison, sur les coordonnées communiquées par ORIGO.'

const ANCIENNE_LIGNE_MIN =
  'Minimum de commande 150 € HT. Franco de port à partir de ce montant. En dessous (correction ORIGO) : 10 € HT.'
const LIGNE_LIVRAISON =
  'Franco de port dès 150 € HT. En dessous : 10 € HT de livraison.'

export function normaliserCgv(texte) {
  return (texte || '').replaceAll(ANCIENNE_LIGNE_MIN, LIGNE_LIVRAISON)
}

export const CGV_DEFAUT = `Conditions de commande ORIGO (B2B)

1. Commande — La validation dans l'application, avec acceptation de ces conditions, vaut bon de commande signé.
2. Livraison — ${LIGNE_LIVRAISON}
3. Paiement — Selon le mode convenu : carte à la commande, virement, ou prélèvement SEPA aux dates fixées pour le restaurant. Un mandat IBAN est signé dans l’application pour la domiciliation.
4. Réclamations — À formuler à la livraison. Les retours suivent la procédure ORIGO.
5. Facture — La facture électronique Peppol sera émise dès attribution du n° TVA ORIGO.

Version 2026-08.`
