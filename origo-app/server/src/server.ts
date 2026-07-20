import express from 'express'
import { calculerStockDisponible, calculerStockDisponibleTousProduits } from './services/stock.js'
import { validerCommande, StockInsuffisantError } from './services/commandes.js'
import { cocherLigne } from './services/preparation.js'
import { annulerCommande } from './services/annulation.js'
import { listerAlertesStock, listerNotificationsNonLues, marquerNotificationLue } from './services/alertes.js'

const app = express()
app.use(express.json())

// ---------- Client ----------

app.get('/produits/:id/stock', async (req, res) => {
  const stock = await calculerStockDisponible(Number(req.params.id))
  res.json(stock)
})

app.get('/produits/stock', async (_req, res) => {
  res.json(await calculerStockDisponibleTousProduits())
})

app.post('/commandes', async (req, res) => {
  try {
    const commande = await validerCommande(req.body)
    res.status(201).json(commande)
  } catch (err) {
    if (err instanceof StockInsuffisantError) {
      // Erreur "propre" et exploitable côté client : le 2e resto qui clique
      // trop tard reçoit ce message précis plutôt qu'un 500 générique.
      res.status(409).json({
        erreur: 'STOCK_INSUFFISANT',
        message: err.message,
        productId: err.productId,
        disponible: err.disponible,
        demande: err.demande,
      })
      return
    }
    res.status(400).json({ erreur: 'COMMANDE_INVALIDE', message: (err as Error).message })
  }
})

app.post('/commandes/:id/annuler', async (req, res) => {
  try {
    const commande = await annulerCommande(Number(req.params.id), req.body.motif ?? '', req.body.adminId)
    res.json(commande)
  } catch (err) {
    res.status(400).json({ erreur: 'ANNULATION_IMPOSSIBLE', message: (err as Error).message })
  }
})

// ---------- Préparateur ----------

app.post('/lignes-commande/:id/cocher', async (req, res) => {
  const resultat = await cocherLigne(Number(req.params.id), req.body.preparateurId)
  res.json(resultat)
})

// ---------- Admin ----------

app.get('/admin/alertes-stock', async (_req, res) => {
  res.json(await listerAlertesStock())
})

app.get('/admin/notifications', async (_req, res) => {
  res.json(await listerNotificationsNonLues())
})

app.post('/admin/notifications/:id/lue', async (req, res) => {
  res.json(await marquerNotificationLue(Number(req.params.id)))
})

const port = Number(process.env.PORT) || 3001
app.listen(port, () => console.log(`API ORIGO démarrée sur http://localhost:${port}`))
