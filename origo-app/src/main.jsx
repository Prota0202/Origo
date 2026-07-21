import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { CompanyProvider, useCompany, setCompanySnapshot } from './company.jsx'

function Bootstrap() {
  const company = useCompany()
  useEffect(() => setCompanySnapshot(company), [company])
  return <App />
}

const el = document.getElementById('root')
// Évite le crash HMR « createRoot() already called »
const root = globalThis.__origoRoot ?? createRoot(el)
globalThis.__origoRoot = root

root.render(
  <StrictMode>
    <CompanyProvider>
      <Bootstrap />
    </CompanyProvider>
  </StrictMode>,
)
