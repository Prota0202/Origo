/**
 * PDF Odoo (même modèle que Ventes / Factures) pour une commande ORIGO.
 * Si Odoo refuse ou n'a pas encore le devis, on renvoie null : le front retombe
 * sur le PDF local, qui reprend les mêmes montants.
 */
import { executerKw } from './rpc.js'
import { MODELES } from './modeles.js'

function bufferDepuisRpc(resultat: unknown): Buffer | null {
  if (typeof resultat === 'string' && resultat.length > 80) {
    return Buffer.from(resultat, 'base64')
  }
  if (Array.isArray(resultat) && typeof resultat[0] === 'string') {
    return Buffer.from(resultat[0], 'base64')
  }
  if (resultat && typeof resultat === 'object' && 'pdf' in resultat) {
    const pdf = (resultat as { pdf?: unknown }).pdf
    if (typeof pdf === 'string') return Buffer.from(pdf, 'base64')
  }
  return null
}

export async function pdfRapportOdoo(xmlid: string, resId: number): Promise<Buffer | null> {
  try {
    const rendu = await executerKw<unknown>('ir.actions.report', '_render_qweb_pdf', [
      xmlid,
      [resId],
    ])
    return bufferDepuisRpc(rendu)
  } catch {
    try {
      const rendu = await executerKw<unknown>('ir.actions.report', 'render_qweb_pdf', [
        xmlid,
        [resId],
      ])
      return bufferDepuisRpc(rendu)
    } catch {
      return null
    }
  }
}

export async function pdfBonOdoo(devisId: number) {
  return pdfRapportOdoo('sale.report_saleorder', devisId)
}

export async function pdfFactureOdoo(factureId: number) {
  return pdfRapportOdoo('account.report_invoice', factureId)
}

export async function creerFactureBrouillonOdoo(devisId: number): Promise<number | null> {
  try {
    const wizId = await executerKw<number>(
      'sale.advance.payment.inv',
      'create',
      [{ advance_payment_method: 'delivered' }],
      { context: { active_model: MODELES.devis, active_ids: [devisId], active_id: devisId } },
    )
    const action = await executerKw<{ res_id?: number } | boolean>(
      'sale.advance.payment.inv',
      'create_invoices',
      [[wizId]],
      { context: { active_model: MODELES.devis, active_ids: [devisId], active_id: devisId } },
    )
    if (action && typeof action === 'object' && typeof action.res_id === 'number') {
      return action.res_id
    }
    return null
  } catch {
    return null
  }
}
