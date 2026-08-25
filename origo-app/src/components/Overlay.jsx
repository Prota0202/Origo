import { useVerrouDefilement } from '../verrou-defilement.js'

export default function Overlay({ onClick }) {
  useVerrouDefilement()
  return <div className="overlay" onClick={onClick} aria-hidden="true" />
}
