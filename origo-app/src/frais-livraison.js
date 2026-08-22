/** Doit rester aligné avec server/src/lib/frais-livraison.ts */
export const SEUIL_FRANCO_HT = 150
export const FRAIS_LIVRAISON_HT = 10

export function fraisLivraisonHT(sousTotalArticlesHT) {
  const ht = Math.round(Number(sousTotalArticlesHT) * 100) / 100
  return ht >= SEUIL_FRANCO_HT ? 0 : FRAIS_LIVRAISON_HT
}

export const TEXTE_PAIEMENT_SEPA =
  'Prélèvement SEPA le 15 et le dernier jour du mois, sur les commandes livrées non encore payées.'

export const CGV_DEFAUT = `Conditions de commande ORIGO (B2B)

1. Commande — La validation dans l'application, avec acceptation de ces conditions, vaut bon de commande signé.
2. Livraison — Franco de port à partir de 150 € HT. En dessous : 10 € HT de frais de livraison.
3. Paiement — Prélèvement SEPA le 15 et le dernier jour du mois (commandes livrées), sauf paiement carte convenu. Un mandat IBAN est signé dans l’application.
4. Réclamations — À formuler à la livraison. Les retours suivent la procédure ORIGO.
5. Facture — La facture électronique Peppol sera émise dès attribution du n° TVA ORIGO.

Version 2026-08.`
