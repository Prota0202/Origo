import { useEffect, useRef, useState } from 'react'
import { Check, RotateCw, X, ZoomIn } from 'lucide-react'
import { chargerImage, pivoterImage, recadrerImage } from '../image.js'

const CADRE_RATIO = 4 / 3
const CADRE_LARGEUR = 320
const CADRE_HAUTEUR = CADRE_LARGEUR / CADRE_RATIO
const ZOOM_MAX = 3

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// Modale de recadrage : glisser pour repositionner, slider pour zoomer.
// Le rendu à l'écran (320×240) suit exactement la même géométrie que le
// rendu final exporté en canvas, donc ce que l'utilisateur voit est ce qui
// sera enregistré.
export default function AjusterPhoto({ src, onValider, onAnnuler }) {
  const [image, setImage] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [decalage, setDecalage] = useState({ x: 0, y: 0 }) // en pixels source
  const glisse = useRef(null)

  useEffect(() => {
    let annule = false
    chargerImage(src).then((img) => {
      if (!annule) setImage(img)
    })
    return () => {
      annule = true
    }
  }, [src])

  if (!image) {
    return (
      <>
        <div className="overlay" aria-hidden="true" />
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Chargement de la photo">
          <div className="sheet-body" style={{ textAlign: 'center', padding: 48, color: 'var(--gray-600)' }}>
            Chargement…
          </div>
        </div>
      </>
    )
  }

  const iw = image.naturalWidth
  const ih = image.naturalHeight
  const ratioImg = iw / ih

  // Cadrage le plus large possible (zoom = 1), équivalent à object-fit: cover
  const couvertureLargeur = ratioImg > CADRE_RATIO ? ih * CADRE_RATIO : iw
  const couvertureHauteur = ratioImg > CADRE_RATIO ? ih : iw / CADRE_RATIO

  const cropW = couvertureLargeur / zoom
  const cropH = couvertureHauteur / zoom
  const slackX = Math.max(0, (iw - cropW) / 2)
  const slackY = Math.max(0, (ih - cropH) / 2)
  const decalageX = clamp(decalage.x, -slackX, slackX)
  const decalageY = clamp(decalage.y, -slackY, slackY)
  const cropX = iw / 2 - cropW / 2 + decalageX
  const cropY = ih / 2 - cropH / 2 + decalageY

  // Échelle CSS px (dans le cadre d'aperçu) par pixel source
  const echelleAffichage = CADRE_LARGEUR / cropW
  const afficheLargeur = iw * echelleAffichage
  const afficheHauteur = ih * echelleAffichage
  const afficheLeft = -cropX * echelleAffichage
  const afficheTop = -cropY * echelleAffichage

  const demarrerGlisser = (e) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Certains environnements (ou événements simulés) refusent la capture ;
      // le glisser fonctionne quand même via les écouteurs pointermove/pointerup.
    }
    glisse.current = { x0: e.clientX, y0: e.clientY, depart: { x: decalageX, y: decalageY } }
  }
  const pendantGlisser = (e) => {
    if (!glisse.current) return
    const { x0, y0, depart } = glisse.current
    const dx = e.clientX - x0
    const dy = e.clientY - y0
    setDecalage({
      x: clamp(depart.x - dx / echelleAffichage, -slackX, slackX),
      y: clamp(depart.y - dy / echelleAffichage, -slackY, slackY),
    })
  }
  const arreterGlisser = () => {
    glisse.current = null
  }

  const valider = () => {
    const dataUrl = recadrerImage(image, { x: cropX, y: cropY, w: cropW, h: cropH })
    onValider(dataUrl)
  }

  // Pivoter change les dimensions de l'image (largeur/hauteur permutées) :
  // le cadrage précédent n'a plus de sens, on repart sur un cadrage centré.
  const pivoter = async () => {
    const nouvelleImage = await pivoterImage(image)
    setImage(nouvelleImage)
    setZoom(1)
    setDecalage({ x: 0, y: 0 })
  }

  return (
    <>
      <div className="overlay" onClick={onAnnuler} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="titre-ajuster-photo">
        <div className="sheet-header">
          <h2 id="titre-ajuster-photo" className="sheet-title">Ajuster la photo</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={pivoter} aria-label="Pivoter la photo">
              <RotateCw size={20} />
            </button>
            <button type="button" className="icon-btn" style={{ color: 'var(--gray-600)' }} onClick={onAnnuler} aria-label="Annuler">
              <X size={22} />
            </button>
          </div>
        </div>
        <div className="sheet-body">
          <p className="ligne-detail" style={{ marginBottom: 12 }}>
            Glissez la photo pour la repositionner, utilisez le curseur pour zoomer ou pivotez-la si besoin.
          </p>
          <div
            className="cadre-recadrage"
            style={{ width: CADRE_LARGEUR, height: CADRE_HAUTEUR }}
            onPointerDown={demarrerGlisser}
            onPointerMove={pendantGlisser}
            onPointerUp={arreterGlisser}
            onPointerLeave={arreterGlisser}
          >
            <img
              src={image.src}
              alt=""
              draggable={false}
              style={{
                width: afficheLargeur,
                height: afficheHauteur,
                left: afficheLeft,
                top: afficheTop,
              }}
            />
          </div>
          <label className="champ champ-zoom">
            <span>
              <ZoomIn size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Zoom
            </span>
            <input
              type="range"
              min="1"
              max={ZOOM_MAX}
              step="0.01"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn-primary" onClick={valider}>
            <Check size={18} aria-hidden="true" /> Valider le cadrage
          </button>
        </div>
      </div>
    </>
  )
}
