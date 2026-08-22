import { getCompany } from './company.jsx'

const round2 = (n) => Math.round(Number(n) * 100) / 100

export function lignesDuDocument(type, commande) {
  return type === 'facture' ? commande.lignes.filter((l) => l.livree !== false) : commande.lignes
}

export function portDocument(commande) {
  return round2(Number(commande.fraisLivraisonHT ?? 0))
}

/** Bon : total enregistré en base (articles + port). Facture : lignes livrées + port figé. */
export function htDocument(type, commande) {
  const lignes = lignesDuDocument(type, commande)
  const depuisLignes = round2(lignes.reduce((s, l) => s + l.qty * l.prixCarton, 0))
  const port = portDocument(commande)
  if (type !== 'facture' && commande.total != null) return round2(commande.total)
  return round2(depuisLignes + port)
}

/**
 * Tant que le n° TVA ORIGO n'est pas attribué, on n'appelle pas ça une facture.
 * Peppol n'est jamais activé par ce code.
 */
export function libelleDocument(type, factureLegale) {
  if (type !== 'facture') {
    return {
      court: 'Bon de commande',
      bandeau: 'BON DE COMMANDE',
      fichier: 'Bon',
      note: 'Bon de commande. Si Odoo a déjà le devis, le PDF est le même modèle que dans Ventes.',
    }
  }
  if (factureLegale) {
    return {
      court: 'Facture',
      bandeau: 'FACTURE',
      fichier: 'Facture',
      note: 'Facture ORIGO. L’envoi Peppol n’est pas activé.',
    }
  }
  return {
    court: 'Document interne',
    bandeau: 'DOCUMENT INTERNE',
    fichier: 'Releve',
    note: 'Document interne — pas une facture légale (n° TVA ORIGO pas encore attribué). Pas d’envoi Peppol.',
  }
}

export function envoyerParEmail(type, commande) {
  const company = getCompany()
  const dest = commande.clientEmail || company.email
  const lib = libelleDocument(type, company.factureLegale)
  const titre = `${lib.court} ${commande.odooNom || commande.numero}`
  const corps = encodeURIComponent(
    `Bonjour,\n\nMerci de joindre le PDF téléchargé : ${titre}.\n(Le mail n’attache pas le fichier automatiquement.)\n\nCordialement,\n${company.name || 'ORIGO'}`,
  )
  window.location.href = `mailto:${dest}?subject=${encodeURIComponent(titre)}&body=${corps}`
}
