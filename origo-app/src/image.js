// Charge un fichier image et le redimensionne côté navigateur avant stockage
// (les photos sont gardées en base64 dans le localStorage avec le catalogue)

function chargerDepuisFichier(file) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader()
    lecteur.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image illisible'))
      img.src = lecteur.result
    }
    lecteur.onerror = () => reject(new Error('Fichier illisible'))
    lecteur.readAsDataURL(file)
  })
}

function redimensionnerVersDataUrl(img, maxLargeur, qualite) {
  const echelle = Math.min(1, maxLargeur / img.width)
  const largeur = Math.round(img.width * echelle)
  const hauteur = Math.round(img.height * echelle)
  const canvas = document.createElement('canvas')
  canvas.width = largeur
  canvas.height = hauteur
  canvas.getContext('2d').drawImage(img, 0, 0, largeur, hauteur)
  return canvas.toDataURL('image/jpeg', qualite)
}

// Compression directe, sans recadrage (utilisée si besoin ailleurs)
export async function redimensionnerImage(file, maxLargeur = 640, qualite = 0.72) {
  const img = await chargerDepuisFichier(file)
  return redimensionnerVersDataUrl(img, maxLargeur, qualite)
}

// Source de travail pour l'outil de recadrage : plus grande que le rendu final
// pour garder de la marge au zoom, sans conserver la photo brute (souvent
// plusieurs Mo en sortie d'appareil photo).
export async function chargerImagePourRecadrage(file, maxLargeur = 1600, qualite = 0.9) {
  const img = await chargerDepuisFichier(file)
  return redimensionnerVersDataUrl(img, maxLargeur, qualite)
}

// Charge une image déjà en mémoire (data URL) en HTMLImageElement, pour
// pouvoir la recadrer à nouveau (ex. photo déjà enregistrée qu'on réajuste).
export function chargerImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
}

// Fait pivoter une image de 90° dans le sens horaire et renvoie la nouvelle
// image pivotée (avec largeur/hauteur permutées), prête à être recadrée.
export function pivoterImage(img, qualite = 0.92) {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalHeight
  canvas.height = img.naturalWidth
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return chargerImage(canvas.toDataURL('image/jpeg', qualite))
}

// Découpe/zoome une image source selon un cadrage (en pixels source) et
// produit le rendu final destiné au stockage (aperçu catalogue en 4:3).
export function recadrerImage(img, crop, sortieLargeur = 800, sortieHauteur = 600, qualite = 0.85) {
  const canvas = document.createElement('canvas')
  canvas.width = sortieLargeur
  canvas.height = sortieHauteur
  canvas
    .getContext('2d')
    .drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, sortieLargeur, sortieHauteur)
  return canvas.toDataURL('image/jpeg', qualite)
}
