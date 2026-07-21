import { createContext, useContext, useEffect, useState } from 'react'
import { AuthApi } from './api/index.js'

const defaults = {
  name: 'ORIGO',
  address: 'Belgique',
  email: 'pro@origo.be',
  phone: '+32 2 000 00 00',
  phoneLink: 'tel:+3220000000',
  vat: '',
  tvaRate: 0.21,
  delaiModificationMs: 60 * 60 * 1000,
  horaires: 'Lun – Ven · 8h00 – 18h00',
}

const CompanyContext = createContext(defaults)

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(defaults)

  useEffect(() => {
    AuthApi.company()
      .then((c) =>
        setCompany({
          name: c.name ?? defaults.name,
          address: c.address ?? defaults.address,
          email: c.email ?? defaults.email,
          phone: c.phone ?? defaults.phone,
          phoneLink: c.phoneLink ?? `tel:${String(c.phone ?? '').replace(/\s/g, '')}`,
          vat: c.vat ?? '',
          tvaRate: Number(c.tvaRate ?? 0.21),
          delaiModificationMs: Number(c.delaiModificationMs ?? defaults.delaiModificationMs),
          horaires: c.horaires ?? defaults.horaires,
        }),
      )
      .catch(() => {})
  }, [])

  return <CompanyContext.Provider value={company}>{children}</CompanyContext.Provider>
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
