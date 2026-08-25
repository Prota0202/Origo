import { Phone, Mail, Clock } from 'lucide-react'
import { useCompany } from '../company.jsx'
import ChangerMotDePasse from './ChangerMotDePasse.jsx'

export default function ServiceClient() {
  const company = useCompany()

  return (
    <section aria-labelledby="titre-service">
      <h1 id="titre-service" className="page-title">Aide</h1>

      <div className="card">
        <div className="contact-ligne">
          <Phone size={20} aria-hidden="true" />
          <a href={company.phoneLink}>{company.phone}</a>
        </div>
        <div className="contact-ligne">
          <Mail size={20} aria-hidden="true" />
          <a href={`mailto:${company.email}`}>{company.email}</a>
        </div>
        <div className="contact-ligne">
          <Clock size={20} aria-hidden="true" />
          <span>{company.horaires}</span>
        </div>
      </div>

      <ChangerMotDePasse />
    </section>
  )
}
