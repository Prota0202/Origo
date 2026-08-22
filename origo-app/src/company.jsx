import { createContext, useContext, useEffect, useState } from 'react'
import { AuthApi } from './api/index.js'
import { CGV_DEFAUT, TEXTE_PAIEMENT_SEPA } from './frais-livraison.js'

const defaults = {
  name: 'ORIGO',
  address: 'Avenue des Anciens Combattants 23, 1140 Evere',
  email: 'pro@origo.be',
  phone: '+32 468 08 96 03',
  phoneLink: 'tel:+32468089603',
  vat: '',
  factureLegale: false,
  tvaRate: 0.21,
  delaiModificationMs: 60 * 60 * 1000,
  horaires: 'Lun – Ven · 8h00 – 18h00',
  conditionsGenerales: CGV_DEFAUT,
  textePaiementSepa: TEXTE_PAIEMENT_SEPA,
  seuilFrancoHT: 150,
  fraisLivraisonHT: 10,
  paiementStripeActif: false,
}

const CompanyContext = createContext(defaults)

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(defaults)

  const charger = () =>
    AuthApi.company()
      .then((c) => {
        const next = {
          name: c.name ?? defaults.name,
          address: c.address ?? defaults.address,
          email: c.email ?? defaults.email,
          phone: c.phone ?? defaults.phone,
          phoneLink: c.phoneLink ?? `tel:${String(c.phone ?? '').replace(/\s/g, '')}`,
          vat: c.vat ?? '',
          factureLegale: Boolean(c.factureLegale ?? c.vat),
          tvaRate: Number(c.tvaRate ?? 0.21),
          delaiModificationMs: Number(c.delaiModificationMs ?? defaults.delaiModificationMs),
          horaires: c.horaires ?? defaults.horaires,
          conditionsGenerales: c.conditionsGenerales || CGV_DEFAUT,
          textePaiementSepa: c.textePaiementSepa ?? defaults.textePaiementSepa,
          seuilFrancoHT: Number(c.seuilFrancoHT ?? 150),
          fraisLivraisonHT: Number(c.fraisLivraisonHT ?? 10),
          paiementStripeActif: Boolean(c.paiementStripeActif),
        }
        setCompany(next)
        setCompanySnapshot(next)
      })
      .catch(() => {})

  useEffect(() => { void charger() }, [])

  return (
    <CompanyContext.Provider value={{ ...company, recharger: charger }}>
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  return useContext(CompanyContext)
}

/** Snapshot synchrone pour PDF / helpers hors React */
let companySnapshot = { ...defaults }

export function setCompanySnapshot(c) {
  companySnapshot = c
}

export function getCompany() {
  return companySnapshot
}

export function getTvaRate() {
  return companySnapshot.tvaRate ?? 0.21
}

export function getDelaiModificationMs() {
  return companySnapshot.delaiModificationMs ?? defaults.delaiModificationMs
}
