import { jsPDF } from 'jspdf'
import { euros } from './data.js'
import { getCompany, getTvaRate } from './company.jsx'
import { htDocument, libelleDocument, lignesDuDocument, portDocument } from './document-montant.js'
import { TEXTE_PAIEMENT_SEPA } from './frais-livraison.js'

export { htDocument, lignesDuDocument } from './document-montant.js'

const ORANGE = [232, 128, 79]
const GRIS_FONCE = [31, 41, 55]
const GRIS = [107, 114, 128]
const GRIS_CLAIR = [229, 231, 235]

const round2 = (n) => Math.round(Number(n) * 100) / 100

function construirePDF(type, commande) {
  const company = getCompany()
  const tvaRate = getTvaRate()
  const estFacture = type === 'facture'
  const lib = libelleDocument(type, company.factureLegale)
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
  doc.text(lib.bandeau, largeur - marge, 19, { align: 'right' })

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

  const clientNom = commande.clientNom || commande.client || ''
  const ref = commande.odooNom || commande.numero
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRIS_FONCE)
  doc.setFontSize(11)
  doc.text(`${lib.court} ${ref}`, largeur - marge, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRIS)
  doc.setFontSize(9)
  doc.text(`Date : ${commande.date}`, largeur - marge, y + 5, { align: 'right' })
  if (commande.odooNom && commande.numero && commande.odooNom !== commande.numero) {
    doc.text(`ORIGO ${commande.numero}`, largeur - marge, y + 10, { align: 'right' })
    y += 5
  }
  doc.text(clientNom, largeur - marge, y + 10, { align: 'right' })
  let yClient = y + 15
  if (commande.clientAdresse) {
    doc.text(commande.clientAdresse, largeur - marge, yClient, { align: 'right' })
    yClient += 5
  }
  if (commande.clientVille) {
    doc.text(commande.clientVille, largeur - marge, yClient, { align: 'right' })
    yClient += 5
  }
  if (commande.clientTva) {
    doc.text(`TVA : ${commande.clientTva}`, largeur - marge, yClient, { align: 'right' })
  }

  y = 78
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

  const lignesDoc = lignesDuDocument(type, commande)
  doc.setFont('helvetica', 'normal')
  y += 9
  lignesDoc.forEach((l) => {
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setTextColor(...GRIS_FONCE)
    doc.text(String(l.nom).slice(0, 48), colonnes[0] + 2, y)
    doc.text(String(l.qty), colonnes[1], y, { align: 'right' })
    doc.text(euros(l.prixCarton), colonnes[2], y, { align: 'right' })
    doc.text(euros(round2(l.qty * l.prixCarton)), colonnes[3] - 2, y, { align: 'right' })
    doc.setDrawColor(...GRIS_CLAIR)
    doc.line(marge, y + 2.5, largeur - marge, y + 2.5)
    y += 8
  })

  const port = portDocument(commande)
  if (port > 0) {
    doc.setTextColor(...GRIS_FONCE)
    doc.text('Frais de livraison', colonnes[0] + 2, y)
    doc.text('1', colonnes[1], y, { align: 'right' })
    doc.text(euros(port), colonnes[2], y, { align: 'right' })
    doc.text(euros(port), colonnes[3] - 2, y, { align: 'right' })
    y += 8
  }

  const ht = htDocument(type, commande)
  const tva = round2(ht * tvaRate)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Total HT', colonnes[2], y, { align: 'right' })
  doc.text(euros(ht), colonnes[3] - 2, y, { align: 'right' })
  y += 7
  if (estFacture) {
    doc.text(`TVA ${Math.round(tvaRate * 100)} %`, colonnes[2], y, { align: 'right' })
    doc.text(euros(tva), colonnes[3] - 2, y, { align: 'right' })
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...ORANGE)
    doc.text('Total TTC', colonnes[2], y, { align: 'right' })
    doc.text(euros(round2(ht + tva)), colonnes[3] - 2, y, { align: 'right' })
    y += 10
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    const noteLignes = doc.splitTextToSize(lib.note, largeur - marge * 2)
    doc.text(noteLignes, marge, y)
    y += noteLignes.length * 4
  }

  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRIS)
  const paiement = company.textePaiementSepa || TEXTE_PAIEMENT_SEPA
  const lignesPaiement = doc.splitTextToSize(paiement, largeur - marge * 2)
  doc.text(lignesPaiement, marge, y)
  y += lignesPaiement.length * 4 + 4
  const dateSig = commande.cgvAccepteesLe
    ? new Date(commande.cgvAccepteesLe).toLocaleString('fr-BE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : commande.date
  if (commande.signatureDataUrl) {
    if (y > 230) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRIS_FONCE)
    doc.text('Signature', marge, y)
    y += 3
    try {
      doc.addImage(commande.signatureDataUrl, 'JPEG', marge, y, 55, 22)
    } catch {
      try {
        doc.addImage(commande.signatureDataUrl, 'PNG', marge, y, 55, 22)
      } catch {
        /* image illisible : le texte ci-dessous reste */
      }
    }
    y += 26
  }
  if (commande.signatureNom) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text(
      `Signé dans ORIGO par ${commande.signatureNom}${dateSig ? ` le ${dateSig}` : ''}.`,
      marge,
      y,
    )
    y += 5
  }

  if (!estFacture && company.conditionsGenerales) {
    y += 4
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRIS_FONCE)
    doc.text('Conditions générales', marge, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRIS)
    const bloc = doc.splitTextToSize(company.conditionsGenerales, largeur - marge * 2)
    doc.text(bloc, marge, y)
  }

  return doc
}

async function dataUrlSignature(commande) {
  const src = commande.signatureDataUrl || commande.signatureImage || commande.signatureImageUrl
  if (!src) return null
  if (src.startsWith('data:')) return src
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const lecteur = new FileReader()
      lecteur.onload = () => resolve(lecteur.result)
      lecteur.onerror = reject
      lecteur.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function telechargerPDF(type, commande) {
  const signatureDataUrl = await dataUrlSignature(commande)
  const doc = construirePDF(type, { ...commande, signatureDataUrl })
  const nom = commande.odooNom || commande.numero || 'brouillon'
  const lib = libelleDocument(type, getCompany().factureLegale)
  doc.save(`${lib.fichier}-${nom}.pdf`)
}

/** Préfère le PDF Odoo (même modèle que Ventes) ; sinon PDF local aux mêmes montants. */
export async function telechargerDocument(type, commande) {
  if (commande.id) {
    try {
      const res = await fetch(`/api/v1/orders/${commande.id}/document?type=${encodeURIComponent(type)}`, {
        headers: { Accept: 'application/pdf' },
        credentials: 'include',
      })
      if (res.status === 200) {
        const blob = await res.blob()
        if (blob.size > 80) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${libelleDocument(type, getCompany().factureLegale).fichier}-${commande.odooNom || commande.numero}.pdf`
          a.click()
          URL.revokeObjectURL(url)
          return
        }
      }
    } catch {
      /* repli local */
    }
  }
  await telechargerPDF(type, commande)
}
