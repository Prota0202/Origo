import { useEffect } from 'react'

let verrous = 0
let ySauve = 0

function bloquerSiHorsFeuille(e) {
  if (e.target.closest?.('.sheet')) return
  e.preventDefault()
}

/** Empêche le fond de défiler tant qu’une feuille (panier, document…) est ouverte. */
export function useVerrouDefilement() {
  useEffect(() => {
    verrous += 1
    if (verrous === 1) {
      ySauve = window.scrollY
      document.documentElement.classList.add('verrou-defilement')
      const body = document.body
      body.style.position = 'fixed'
      body.style.top = `-${ySauve}px`
      body.style.left = '0'
      body.style.right = '0'
      body.style.width = '100%'
      document.addEventListener('touchmove', bloquerSiHorsFeuille, { passive: false })
      document.addEventListener('wheel', bloquerSiHorsFeuille, { passive: false })
    }
    return () => {
      verrous = Math.max(0, verrous - 1)
      if (verrous > 0) return
      document.removeEventListener('touchmove', bloquerSiHorsFeuille)
      document.removeEventListener('wheel', bloquerSiHorsFeuille)
      document.documentElement.classList.remove('verrou-defilement')
      const body = document.body
      body.style.position = ''
      body.style.top = ''
      body.style.left = ''
      body.style.right = ''
      body.style.width = ''
      window.scrollTo(0, ySauve)
    }
  }, [])
}
