import { QRCodeSVG } from 'qrcode.react'
import { X } from 'lucide-react'

const urlApp = () => {
  if (typeof window === 'undefined') return ''
  if (window.location.protocol === 'https:') return window.location.origin
  return `http://${import.meta.env.VITE_LAN_IP || window.location.hostname}${
    window.location.port ? `:${window.location.port}` : ''
  }`
}

export default function QRModal({ onClose }) {
  const url = urlApp()
  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-qr">
        <div className="sheet-header">
          <h2 id="titre-qr" className="sheet-title">Ouvrir sur mobile</h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body qr-box">
          <p style={{ color: 'var(--gray-600)', fontSize: 14, maxWidth: 320 }}>
            Scannez ce QR code avec l’appareil photo pour ouvrir ORIGO sur ce téléphone.
          </p>
          <div className="qr-cadre">
            <QRCodeSVG value={url} size={220} fgColor="#1f2937" level="M" aria-label={`QR code vers ${url}`} />
          </div>
          <span className="qr-url">{url}</span>
        </div>
      </div>
    </>
  )
}
