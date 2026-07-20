import { jsPDF } from 'jspdf'
import { CONTACT, euros } from './data.js'

export const TVA = 0.2

const ORANGE = [232, 128, 79]
const GRIS_FONCE = [31, 41, 55]
const GRIS = [107, 114, 128]
const GRIS_CLAIR = [229, 231, 235]

function construirePDF(type, commande) {
  const estFacture = type === 'facture'
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const largeur = doc.internal.pageSize.getWidth()
  const marge = 18

  // Bandeau orange
  doc.setFillColor(...ORANGE)
  doc.rect(0, 0, largeur, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('O R I G O', marge, 19)
  doc.setFontSize(11)
  doc.text(estFacture ? 'FACTURE' : 'BON DE COMMANDE', largeur - marge, 19, { align: 'right' })

  // Coordonnées
  let y = 42
  doc.setTextColor(...GRIS_FONCE)
  doc.setFontSize(11)
  doc.text('ORIGO', marge, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRIS)
  doc.setFontSize(9)
  doc.text('12 rue du Four, 75011 Paris', marge, y + 5)
  doc.text(CONTACT.email, marge, y + 10)
  doc.text(CONTACT.telephone, marge, y + 15)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRIS_FONCE)
  doc.setFontSize(11)
  doc.text(`${estFacture ? 'Facture' : 'Bon de commande'} ${commande.numero}`, largeur - marge, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRIS)
  doc.setFontSize(9)
  doc.text(`Date : ${commande.date}`, largeur - marge, y + 5, { align: 'right' })
  doc.text(`Client : ${commande.client}`, largeur - marge, y + 10, { align: 'right' })

  // Tableau
  y = 72
  const colonnes = [marge, largeur - marge - 70, largeur - marge - 40, largeur - marge]
  doc.setFillColor(...GRIS_CLAIR)
  doc.rect(marge, y - 5, largeur - marge * 2, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...GRIS_FONCE)
  doc.text('Produit', colonnes[0] + 2, y)
  doc.text('Cartons', colonnes[1], y, { align: 'right' })
  doc.text('P.U. HT', colonnes[2], y, { align: 'right' })
  doc.text('Total HT', colonnes[3] - 2, y, { align: 'right' })

  // La facture ne porte que sur les articles réellement livrés (un refus à la
  // livraison ne doit pas être facturé) ; le bon de commande garde tout, tel
  // que commandé à l'origine.
  const lignesDoc = estFacture ? commande.lignes.filter((l) => l.livree !== false) : commande.lignes

  doc.setFont('helvetica', 'normal')
  y += 9
  lignesDoc.forEach((l) => {
    doc.setTextColor(...GRIS_FONCE)
    doc.text(l.nom, colonnes[0] + 2, y)
    doc.text(String(l.qty), colonnes[1], y, { align: 'right' })
    doc.text(euros(l.prixCarton), colonnes[2], y, { align: 'right' })
    doc.text(euros(l.qty * l.prixCarton), colonnes[3] - 2, y, { align: 'right' })
    doc.setDrawColor(...GRIS_CLAIR)
    doc.line(marge, y + 2.5, largeur - marge, y + 2.5)
    y += 8
  })

  // Totaux
  y += 4
  const ht = lignesDoc.reduce((s, l) => s + l.qty * l.prixCarton, 0)
  doc.setTextColor(...GRIS)
  doc.text(`Total HT`, colonnes[2], y, { align: 'right' })
  doc.setTextColor(...GRIS_FONCE)
  doc.text(euros(ht), colonnes[3] - 2, y, { align: 'right' })
  if (estFacture) {
    y += 6
    doc.setTextColor(...GRIS)
    doc.text(`TVA 20 %`, colonnes[2], y, { align: 'right' })
    doc.setTextColor(...GRIS_FONCE)
    doc.text(euros(ht * TVA), colonnes[3] - 2, y, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ORANGE)
    doc.text(`Total TTC`, colonnes[2], y, { align: 'right' })
    doc.text(euros(ht * (1 + TVA)), colonnes[3] - 2, y, { align: 'right' })
  }

  // Pied de page
  const nbAjustes = commande.lignes.filter((l) => l.qtyCommandee != null).length
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRIS)
  doc.text(
    estFacture
      ? nbAjustes > 0
        ? `Facture émise par ORIGO — ${nbAjustes} article(s) partiellement ou non livré(s), quantité ajustée sur cette facture.`
        : 'Facture émise par ORIGO — exemplaire client et ORIGO.'
      : 'Bon de commande transmis à ORIGO pour préparation de la livraison.',
    marge,
    doc.internal.pageSize.getHeight() - 15
  )

  return doc
}

export function nomFichier(type, commande) {
  return `${type === 'facture' ? 'facture' : 'bon-de-commande'}-${commande.numero}.pdf`
}

export function telechargerPDF(type, commande) {
  construirePDF(type, commande).save(nomFichier(type, commande))
}

// Envoi par e-mail : partage natif du PDF sur mobile (Mail, Gmail…),
// sinon téléchargement + brouillon e-mail pré-rempli.
export async function envoyerParEmail(type, commande) {
  const doc = construirePDF(type, commande)
  const titre = `${type === 'facture' ? 'Facture' : 'Bon de commande'} ${commande.numero} — ORIGO`
  const fichier = new File([doc.output('blob')], nomFichier(type, commande), {
    type: 'application/pdf',
  })

  if (navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: titre, text: titre })
      return 'partage'
    } catch (e) {
      if (e.name === 'AbortError') return 'annule'
    }
  }

  doc.save(nomFichier(type, commande))
  const corps = `Bonjour,%0D%0A%0D%0AVeuillez trouver ci-joint ${
    type === 'facture' ? 'la facture' : 'le bon de commande'
  } ${commande.numero} (${commande.client}).%0D%0A%0D%0APensez à joindre le PDF téléchargé.%0D%0A%0D%0ACordialement`
  window.location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(titre)}&body=${corps}`
  return 'mailto'
}
