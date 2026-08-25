const DUREE_MS = 820
const TAILLE = 72

function ciblePanier() {
  return document.querySelector('[data-panier-cible]')
}

function fairePop(el) {
  if (!el) return
  el.classList.remove('panier-pop')
  void el.offsetWidth
  el.classList.add('panier-pop')
  window.setTimeout(() => el.classList.remove('panier-pop'), 620)
}

function element(tag, classe, texte) {
  const el = document.createElement(tag)
  el.className = classe
  el.setAttribute('aria-hidden', 'true')
  if (texte) el.textContent = texte
  return el
}

function retirer(el, ms) {
  window.setTimeout(() => el.remove(), ms)
}

/** Photo + halo + « +1 » + traînée, puis explosion sur le panier. */
export function volerVersPanier(sourceEl, photoUrl) {
  const cible = ciblePanier()
  const source = sourceEl ?? cible
  if (!cible || !source) return

  const carte = source.closest?.('.card')
  if (carte) {
    carte.classList.remove('carte-ajout')
    void carte.offsetWidth
    carte.classList.add('carte-ajout')
    window.setTimeout(() => carte.classList.remove('carte-ajout'), 500)
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fairePop(cible)
    return
  }

  try {
    navigator.vibrate?.(16)
  } catch {
    /* iOS ignore */
  }

  const from = source.getBoundingClientRect()
  const to = cible.getBoundingClientRect()
  const startX = from.left + from.width / 2 - TAILLE / 2
  const startY = from.top + from.height / 2 - TAILLE / 2
  const endX = to.left + to.width / 2 - TAILLE / 2
  const endY = to.top + to.height / 2 - TAILLE / 2
  const dx = endX - startX
  const dy = endY - startY
  const arcX = dx * 0.38
  const arcY = dy * 0.22 - 110

  const plus = element('div', 'vol-plus', '+1')
  plus.style.left = `${from.left + from.width / 2 - 22}px`
  plus.style.top = `${from.top + 8}px`
  document.body.appendChild(plus)
  plus.animate(
    [
      { transform: 'translateY(0) scale(0.6)', opacity: 0 },
      { transform: 'translateY(-10px) scale(1.15)', opacity: 1, offset: 0.22 },
      { transform: 'translateY(-46px) scale(1)', opacity: 0 },
    ],
    { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
  )
  retirer(plus, 640)

  const ghost = photoUrl ? element('img', 'vol-panier') : element('div', 'vol-panier', '+1')
  if (photoUrl) {
    ghost.src = photoUrl
    ghost.alt = ''
  }
  ghost.style.left = `${startX}px`
  ghost.style.top = `${startY}px`
  document.body.appendChild(ghost)

  const keyframes = [
    { transform: 'translate(0, 0) scale(1) rotate(-6deg)', opacity: 1, offset: 0 },
    {
      transform: `translate(${arcX}px, ${arcY}px) scale(1.08) rotate(8deg)`,
      opacity: 1,
      offset: 0.4,
    },
    {
      transform: `translate(${dx}px, ${dy}px) scale(0.18) rotate(14deg)`,
      opacity: 0.15,
      offset: 1,
    },
  ]

  for (let i = 0; i < 5; i++) {
    const etincelle = element('div', 'vol-etincelle')
    etincelle.style.left = `${startX + TAILLE / 2 - 5}px`
    etincelle.style.top = `${startY + TAILLE / 2 - 5}px`
    document.body.appendChild(etincelle)
    const delay = 50 + i * 55
    etincelle.animate(keyframes, {
      duration: DUREE_MS - 80,
      delay,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    })
    retirer(etincelle, DUREE_MS + delay)
  }

  const vol = ghost.animate(keyframes, {
    duration: DUREE_MS,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards',
  })

  const fin = () => {
    ghost.remove()
    const burst = element('div', 'vol-burst')
    burst.style.left = `${to.left + to.width / 2 - 36}px`
    burst.style.top = `${to.top + to.height / 2 - 36}px`
    document.body.appendChild(burst)
    retirer(burst, 520)
    fairePop(cible)
  }

  vol.finished.then(fin).catch(fin)
}
