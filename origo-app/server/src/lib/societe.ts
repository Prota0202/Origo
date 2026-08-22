/**
 * Fiche société : env en repli, base si la direction l'a saisie.
 * Un n° TVA placeholder (BE000…) n'est jamais renvoyé : ce n'est pas un
 * identifiant, et l'imprimer sur un bon ferait croire à une facture valide.
 */
import { CGV_DEFAUT, FRAIS_LIVRAISON_HT, SEUIL_FRANCO_HT, TEXTE_PAIEMENT_SEPA } from './frais-livraison.js'
import { env } from '../config/env.js'
import { prisma } from './prisma.js'

const TVA_PLACEHOLDER = /^(BE0{9,10}|BE0000000000)$/i

export function tvaAffichable(brut: string | null | undefined) {
  const v = (brut ?? '').replace(/\s/g, '').trim()
  if (!v || TVA_PLACEHOLDER.test(v)) return ''
  return brut!.trim()
}

export async function lireSociete() {
  const row = await prisma.societe.findUnique({ where: { id: 'origo' } })
  const name = row?.nom?.trim() || env.company.name
  const address = row?.adresse?.trim() || env.company.address
  const email = row?.email?.trim() || env.company.email
  const phone = row?.telephone?.trim() || env.company.phone
  const vat = tvaAffichable(row?.numeroTva) || tvaAffichable(env.company.vat)
  const horaires = row?.horaires?.trim() || 'Lun – Ven · 8h00 – 18h00'

  return {
    name,
    address,
    email,
    phone,
    phoneLink: `tel:${phone.replace(/\s/g, '')}`,
    vat,
    factureLegale: Boolean(vat),
    tvaRate: env.company.tvaRate,
    delaiModificationMs: env.delaiModificationMs,
    horaires,
    conditionsGenerales: row?.conditionsGenerales?.trim() || CGV_DEFAUT,
    seuilFrancoHT: SEUIL_FRANCO_HT,
    fraisLivraisonHT: FRAIS_LIVRAISON_HT,
    textePaiementSepa: TEXTE_PAIEMENT_SEPA,
    paiementStripeActif: env.stripe.actif,
  }
}

export async function ecrireSociete(data: {
  nom?: string
  adresse?: string
  email?: string
  telephone?: string
  numeroTva?: string
  horaires?: string
  conditionsGenerales?: string
}) {
  const actuel = await prisma.societe.findUnique({ where: { id: 'origo' } })
  const nom = data.nom?.trim() || actuel?.nom || env.company.name
  await prisma.societe.upsert({
    where: { id: 'origo' },
    create: {
      id: 'origo',
      nom,
      adresse: data.adresse ?? actuel?.adresse ?? env.company.address,
      email: data.email ?? actuel?.email ?? env.company.email,
      telephone: data.telephone ?? actuel?.telephone ?? env.company.phone,
      numeroTva: data.numeroTva ?? actuel?.numeroTva ?? '',
      horaires: data.horaires ?? actuel?.horaires ?? 'Lun – Ven · 8h00 – 18h00',
      conditionsGenerales: data.conditionsGenerales ?? actuel?.conditionsGenerales ?? '',
    },
    update: {
      ...(data.nom != null && { nom: data.nom.trim() || nom }),
      ...(data.adresse != null && { adresse: data.adresse }),
      ...(data.email != null && { email: data.email }),
      ...(data.telephone != null && { telephone: data.telephone }),
      ...(data.numeroTva != null && { numeroTva: data.numeroTva }),
      ...(data.horaires != null && { horaires: data.horaires }),
      ...(data.conditionsGenerales != null && { conditionsGenerales: data.conditionsGenerales }),
    },
  })
  return lireSociete()
}
