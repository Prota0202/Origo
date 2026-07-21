import { jsPDF } from 'jspdf'
import { euros } from './data.js'
import { getCompany, getTvaRate } from './company.jsx'

const ORANGE = [232, 128, 79]
const GRIS_FONCE = [31, 41, 55]
const GRIS = [107, 114, 128]
const GRIS_CLAIR = [229, 231, 235]

function construirePDF(type, commande) {
  const company = getCompany()
  const tvaRate = getTvaRate()
  const estFacture = type === 'facture'
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const largeur = doc.internal.pageSize.getWidth()
  const marge = 18

  doc.setFillColor(...ORANGE)
  doc.rect(0, 0, largeur, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('O R I G O', marge, 19)
  doc.setFontSize(11)
  doc.text(estFacture ? 'FACTURE' : 'BON DE COMMANDE', largeur - marge, 19, { align: 'right' })

  let y = 42
  doc.setTextColor(...GRIS_FONCE)
  doc.setFontSize(11)
  doc.text(company.name || 'ORIGO', marge, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRIS)
  doc.setFontSize(9)
  doc.text(company.address || '', marge, y + 5)
  doc.text(company.email || '', marge, y + 10)
  doc.text(company.phone || '', marge, y + 15)
  if (company.vat) doc.text(`TVA : ${company.vat}`, marge, y + 20)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRIS_FONCE)
  doc.setFontSize(11)
  doc.text(`${estFacture ? 'Facture' : 'Bon de commande'} ${commande.numero}`, largeur - marge, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRIS)
  doc.setFontSize(9)
  doc.text(`Date : ${commande.date}`, largeur - marge, y + 5, { align: 'right' })
  doc.text(`Client : ${commande.client}`, largeur - marge, y + 10, { align: 'right' })

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

  const ht = lignesDoc.reduce((s, l) => s + l.qty * l.prixCarton, 0)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Total HT', colonnes[2], y, { align: 'right' })
  doc.text(euros(ht), colonnes[3] - 2, y, { align: 'right' })
  y += 7
  if (estFacture) {
    doc.text(`TVA ${Math.round(tvaRate * 100)} %`, colonnes[2], y, { align: 'right' })
    doc.text(euros(ht * tvaRate), colonnes[3] - 2, y, { align: 'right' })
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...ORANGE)
    doc.text('Total TTC', colonnes[2], y, { align: 'right' })
    doc.text(euros(ht * (1 + tvaRate)), colonnes[3] - 2, y, { align: 'right' })
  }

  return doc
}

export function telechargerPDF(type, commande) {
  const doc = construirePDF(type, commande)
  doc.save(`${type === 'facture' ? 'Facture' : 'Bon'}-${commande.numero}.pdf`)
}

export function envoyerParEmail(type, commande) {
  const company = getCompany()
  const titre = `${type === 'facture' ? 'Facture' : 'Bon de commande'} ${commande.numero}`
  const corps = encodeURIComponent(
    `Bonjour,\n\nVeuillez trouver ci-joint ${titre}.\n\nCordialement,\n${company.name || 'ORIGO'}`,
  )
  window.location.href = `mailto:${company.email}?subject=${encodeURIComponent(titre)}&body=${corps}`
}
