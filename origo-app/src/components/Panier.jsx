import { useEffect, useRef, useState } from 'react'
import { X, Trash2, AlertCircle, Minus, Plus, BadgePercent, Package, FileText } from 'lucide-react'
import { euros, tarifLigne } from '../data.js'
import { fraisLivraisonHT, TEXTE_PAIEMENT_SEPA, TEXTE_PAIEMENT_STRIPE, TEXTE_PAIEMENT_VIREMENT } from '../frais-livraison.js'
import { useCompany } from '../company.jsx'
import { ClientsApi } from '../api/index.js'
import Overlay from './Overlay.jsx'

function canvasADeLencre(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let n = 0
  for (let i = 0; i < data.length; i += 16) {
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) n++
  }
  return n > 40
}

function PadSignature({ onChange }) {
  const canvasRef = useRef(null)
  const dessin = useRef(false)

  const pret = () => {
    const c = canvasRef.current
    const ctx = c.getContext('2d')
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const w = c.clientWidth
    const h = c.clientHeight
    c.width = Math.round(w * ratio)
    c.height = Math.round(h * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#2a2420'
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    onChange(null)
  }

  useEffect(() => {
    pret()
    // Un seul cadrage : le panier a une largeur fixe une fois ouvert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const start = (e) => {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    dessin.current = true
    const p = pos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const move = (e) => {
    if (!dessin.current) return
    e.preventDefault()
    const p = pos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const end = (e) => {
    if (!dessin.current) return
    dessin.current = false
    e.preventDefault()
    const c = canvasRef.current
    const encre = canvasADeLencre(c)
    onChange(encre ? c.toDataURL('image/jpeg', 0.82) : null)
  }

  return (
    <div className="pad-signature-bloc">
      <div className="champ-label-row">
        <span>Signature (doigt ou stylet)</span>
        <button type="button" className="lien-effacer" onClick={pret}>
          Effacer
        </button>
      </div>
      <div className="pad-signature-wrap">
        <canvas
          ref={canvasRef}
          className="pad-signature"
          aria-label="Zone de signature"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
    </div>
  )
}

export default function Panier({ client, produits, panier, onChange, onClose, onValider }) {
  const company = useCompany()
  const lignes = produits.filter((p) => (panier[p.id] ?? 0) > 0)
  const totalCartons = lignes.reduce((s, p) => s + panier[p.id], 0)
  const tarifs = Object.fromEntries(lignes.map((p) => [p.id, tarifLigne(client, p, panier[p.id])]))
  const sousTotal = lignes.reduce((s, p) => s + tarifs[p.id].total, 0)
  const frais = fraisLivraisonHT(sousTotal)
  const totalPrix = Math.round((sousTotal + frais) * 100) / 100
  const economie = lignes.reduce((s, p) => s + (tarifs[p.id].pu * panier[p.id] - tarifs[p.id].total), 0)
  const [nom, setNom] = useState(client.nom ?? '')
  const [cgvOk, setCgvOk] = useState(false)
  const [trait, setTrait] = useState(null)
  const [mandatEnCours, setMandatEnCours] = useState(false)
  const mandatRequis = (client.modePaiement ?? 'sepa') === 'sepa' && company.paiementStripeActif && !client.sepaMandatOk

  const ouvrirMandat = async () => {
    setMandatEnCours(true)
    try {
      const { url } = await ClientsApi.mandatSepa()
      window.location.assign(url)
    } catch (e) {
      alert(e.message)
      setMandatEnCours(false)
    }
  }

  const apercuPdf = async () => {
    const { telechargerPDF } = await import('../pdf.js')
    await telechargerPDF('bon', {
      numero: 'BROUILLON',
      date: new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }),
      clientNom: client.nom,
      clientAdresse: client.adresse,
      clientVille: client.ville,
      clientTva: client.numeroTva,
      lignes: lignes.map((p) => ({
        id: p.id,
        nom: p.nom,
        qty: panier[p.id],
        prixCarton: tarifs[p.id].puFinal,
      })),
      total: totalPrix,
      fraisLivraisonHT: frais,
      signatureNom: nom.trim(),
      signatureImage: trait,
      cgvAccepteesLe: new Date().toISOString(),
    })
  }

  return (
    <>
      <Overlay onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-panier">
        <div className="sheet-header">
          <h2 id="titre-panier" className="sheet-title">Panier</h2>
          <button className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onClose} aria-label="Fermer le panier">
            <X size={22} />
          </button>
        </div>

        <div className="sheet-body">
          {lignes.length === 0 ? (
            <div className="empty">
              <p>Votre panier est vide.</p>
              <p style={{ fontSize: 14 }}>Ajoutez des cartons depuis le catalogue.</p>
            </div>
          ) : (
            lignes.map((p) => {
              const t = tarifs[p.id]
              return (
                <div key={p.id} className="ligne-panier">
                  {p.photo ? (
                    <img className="mini-photo" src={p.photo} alt="" />
                  ) : (
                    <span className="mini-photo mini-photo-vide" aria-hidden="true"><Package size={16} /></span>
                  )}
                  <div className="ligne-infos">
                    <p className="ligne-nom">{p.nom}</p>
                    <p className="ligne-detail">
                      {panier[p.id]} × {euros(t.puFinal)} = {euros(t.total)}
                    </p>
                    {t.remisePct > 0 && (
                      <p className="tag-remise">
                        <BadgePercent size={13} aria-hidden="true" />{' '}
                        {t.palierSeuil
                          ? `Tarif palier −${t.remisePct} % dès ${t.palierSeuil} cartons`
                          : `Remise −${t.remisePct} % appliquée`}
                      </p>
                    )}
                  </div>
                  <div className="stepper" style={{ padding: 2 }}>
                    <button aria-label={`Retirer un carton de ${p.nom}`} onClick={() => onChange(p, panier[p.id] - 1)}>
                      <Minus size={16} />
                    </button>
                    <span className="stepper-qty" style={{ minWidth: 32 }}>{panier[p.id]}</span>
                    <button
                      aria-label={`Ajouter un carton de ${p.nom}`}
                      onClick={() => onChange(p, panier[p.id] + 1)}
                      disabled={panier[p.id] >= (p.stock ?? Infinity)}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <button className="ligne-suppr" aria-label={`Supprimer ${p.nom} du panier`} onClick={() => onChange(p, 0)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              )
            })
          )}
          {lignes.length > 0 && !mandatRequis && (
            <div className="bloc-preuve-commande">
              <p className="cgv-box">{company.conditionsGenerales}</p>
              <label className="champ">
                <span>Votre nom</span>
                <input
                  type="text"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
              <PadSignature onChange={setTrait} />
              <label className="check-cgv">
                <input type="checkbox" checked={cgvOk} onChange={(e) => setCgvOk(e.target.checked)} />
                <span>J’ai lu le bon de commande et j’accepte les conditions générales.</span>
              </label>
              <button type="button" className="btn btn-secondary" onClick={() => void apercuPdf()}>
                <FileText size={18} aria-hidden="true" /> Lire le bon de commande (PDF)
              </button>
            </div>
          )}
        </div>

        {lignes.length > 0 && (
          <div className="sheet-footer">
            {economie > 0.004 && (
              <div className="total-row">
                <span>Économie remises</span>
                <span style={{ color: 'var(--green-600)', fontWeight: 600 }}>−{euros(economie)}</span>
              </div>
            )}
            <div className="total-row">
              <span>{totalCartons} {totalCartons > 1 ? 'cartons' : 'carton'}</span>
              <span>{euros(sousTotal)} HT</span>
            </div>
            <div className="total-row">
              <span>{frais === 0 ? 'Livraison' : 'Frais de livraison'}</span>
              <span>{frais === 0 ? 'offerts' : euros(frais)}</span>
            </div>
            <div className="total-row">
              <span>Total</span>
              <strong>{euros(totalPrix)} HT</strong>
            </div>
            <p className="ligne-detail">
              {(client.modePaiement ?? 'sepa') === 'stripe'
                ? TEXTE_PAIEMENT_STRIPE
                : (client.modePaiement ?? 'sepa') === 'virement'
                  ? TEXTE_PAIEMENT_VIREMENT
                  : client.sepaMandatOk
                    ? `${company.textePaiementSepa || TEXTE_PAIEMENT_SEPA} ${client.sepaCalendrierLibelle ? `(${client.sepaCalendrierLibelle})` : ''} IBAN ••••${client.sepaIbanLast4}.`
                    : (company.textePaiementSepa || TEXTE_PAIEMENT_SEPA)}
            </p>
            {mandatRequis && (
              <div className="alerte-min" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>
                  Signez le mandat SEPA (IBAN) une fois : ensuite ORIGO prélèvera
                  {client.sepaCalendrierLibelle ? ` ${client.sepaCalendrierLibelle}` : ' aux dates convenues'}.
                </span>
              </div>
            )}
            {mandatRequis ? (
              <button className="btn btn-primary" disabled={mandatEnCours} onClick={() => void ouvrirMandat()}>
                {mandatEnCours ? 'Redirection…' : 'Signer le mandat SEPA (IBAN)'}
              </button>
            ) : (
            <button
              className="btn btn-primary"
              disabled={!cgvOk || nom.trim().length < 2 || !trait}
              onClick={() => onValider({ nom: nom.trim(), acceptationCgv: true, image: trait })}
            >
              Signer et valider la commande
            </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
