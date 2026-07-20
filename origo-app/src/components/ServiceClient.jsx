import { Phone, Mail, Clock, MessageCircle } from 'lucide-react'
import { CONTACT } from '../data.js'

export default function ServiceClient() {
  return (
    <section aria-labelledby="titre-service">
      <h1 id="titre-service" className="page-title">Service client</h1>
      <p className="page-subtitle">Une question sur votre catalogue ou une livraison&nbsp;?</p>

      <div className="contact-hero">
        <MessageCircle size={32} aria-hidden="true" style={{ marginBottom: 8 }} />
        <h2>Besoin d’aide&nbsp;?</h2>
        <p>Notre équipe vous répond du lundi au vendredi.</p>
        <a className="btn btn-appel" href={CONTACT.telephoneLien}>
          <Phone size={20} aria-hidden="true" /> Appeler ORIGO
        </a>
      </div>

      <div className="card">
        <div className="contact-ligne">
          <Phone size={20} aria-hidden="true" />
          <a href={CONTACT.telephoneLien}>{CONTACT.telephone}</a>
        </div>
        <div className="contact-ligne">
          <Mail size={20} aria-hidden="true" />
          <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
        </div>
        <div className="contact-ligne">
          <Clock size={20} aria-hidden="true" />
          <span>{CONTACT.horaires}</span>
        </div>
      </div>
    </section>
  )
}
