import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Change ce cacheId à chaque fois qu'un vieux téléphone reste coincé
        // sur l'ancienne PWA après un déploiement.
        cacheId: 'origo-20260829-suppr-produits',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
      },
      manifest: {
        name: 'ORIGO — Commande Pro',
        short_name: 'Origo',
        description: 'Fournitures pour restaurants : catalogue personnalisé et commandes',
        lang: 'fr',
        display: 'standalone',
        theme_color: '#E8804F',
        background_color: '#fdfaf5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    // Tunnels Cloudflare (partager.ps1) changent d’URL à chaque lancement
    allowedHosts: ['.trycloudflare.com', 'localhost'],
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
