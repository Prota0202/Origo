/**
 * Deux niveaux de tests.
 *
 * 1. La traduction de la grille ORIGO en règles Odoo, testable sans Odoo : c'est
 *    elle qui décide du prix facturé, elle doit être verrouillée.
 * 2. La boucle complète contre un vrai Odoo, ignorée si le labo n'est pas lancé :
 *
 *      docker compose -f odoo-lab/docker-compose.yml up -d
 *      ODOO_SYNC_TEST=1 ODOO_URL=http://127.0.0.1:8069 ODOO_DB=origo_lab \
 *      ODOO_USER=admin ODOO_API_KEY=admin npm --prefix server test
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { tarifLigne } from '../src/lib/pricing.js'
import { reglesDepuisGrille } from '../src/lib/odoo/tarifs.js'

describe('traduction de la grille ORIGO en règles Odoo', () => {
  it('produit une seule règle quand le prix ne dépend pas de la quantité', () => {
    expect(reglesDepuisGrille({ prixBase: 22 })).toEqual([{ quantiteMini: 0, prixFixe: 22 }])
  })

  it('place une règle à chaque palier', () => {
    expect(
      reglesDepuisGrille({
        prixBase: 22,
        paliers: [
          { seuil: 20, prix: 20 },
          { seuil: 50, prix: 18.5 },
        ],
      }),
    ).toEqual([
      { quantiteMini: 0, prixFixe: 22 },
      { quantiteMini: 20, prixFixe: 20 },
      { quantiteMini: 50, prixFixe: 18.5 },
    ])
  })

  it('applique la remise catalogue au prix négocié, pas au prix catalogue', () => {
    // Le bug qu'on évite : une règle Odoo en pourcentage aurait calculé
    // 5 % sur le prix catalogue (30 €) et facturé 28,50 € au lieu de 20,90 €.
    expect(reglesDepuisGrille({ prixBase: 22, remiseSeuil: 10, remisePourcent: 5 })).toEqual([
      { quantiteMini: 0, prixFixe: 22 },
      { quantiteMini: 10, prixFixe: 20.9 },
    ])
  })

  it('fait primer le palier sur la remise, comme ORIGO', () => {
    const regles = reglesDepuisGrille({
      prixBase: 22,
      paliers: [
        { seuil: 20, prix: 20 },
        { seuil: 50, prix: 18.5 },
      ],
      remiseSeuil: 10,
      remisePourcent: 5,
    })

    expect(regles).toEqual([
      { quantiteMini: 0, prixFixe: 22 },
      { quantiteMini: 10, prixFixe: 20.9 },
      { quantiteMini: 20, prixFixe: 20 },
      { quantiteMini: 50, prixFixe: 18.5 },
    ])
  })

  it('ne crée pas de règle qui ne change rien', () => {
    // Palier au même prix que la base : inutile, et Odoo relit toutes les
    // règles à chaque ligne de devis.
    expect(reglesDepuisGrille({ prixBase: 22, paliers: [{ seuil: 30, prix: 22 }] })).toEqual([
      { quantiteMini: 0, prixFixe: 22 },
    ])
  })

  it('reproduit tarifLigne sur toute la plage de quantités', () => {
    const grille = {
      prixBase: 22,
      paliers: [
        { seuil: 12, prix: 21 },
        { seuil: 20, prix: 20 },
        { seuil: 50, prix: 18.5 },
      ],
      remiseSeuil: 7,
      remisePourcent: 3,
    }
    const regles = reglesDepuisGrille(grille)

    // Résolution d'Odoo : la règle applicable de plus grande quantité minimale.
    const prixSelonRegles = (qty: number) =>
      regles.filter((r) => qty >= r.quantiteMini).sort((a, b) => b.quantiteMini - a.quantiteMini)[0]
        .prixFixe

    for (let qty = 1; qty <= 120; qty++) {
      expect(prixSelonRegles(qty), `quantité ${qty}`).toBe(tarifLigne({ ...grille, qty }).puFinal)
    }
  })
})

// ---------------------------------------------------------------------------

const labo = process.env.ODOO_SYNC_TEST === '1' && Boolean(process.env.ODOO_URL)

describe.skipIf(!labo)('boucle complète contre un vrai Odoo', () => {
  let odoo: typeof import('../src/lib/odoo/rpc.js')
  let tarifs: typeof import('../src/lib/odoo/tarifs.js')
  let deviseId: number

  beforeAll(async () => {
    odoo = await import('../src/lib/odoo/rpc.js')
    tarifs = await import('../src/lib/odoo/tarifs.js')

    const liaison = await odoo.verifierLiaison()
    expect(liaison.ok, `liaison Odoo : ${JSON.stringify(liaison)}`).toBe(true)

    const devises = await odoo.chercherLire<{ id: number }>(
      'res.currency',
      [['name', '=', 'EUR']],
      ['id'],
      { limit: 1, context: { active_test: false } },
    )
    deviseId = devises[0].id
  })

  /** Prix qu'Odoo calcule réellement, via une ligne de devis. */
  async function prixOdoo(partenaireId: number, varianteId: number, qty: number) {
    const devisId = await odoo.creer('sale.order', { partner_id: partenaireId })
    const ligneId = await odoo.creer('sale.order.line', {
      order_id: devisId,
      product_id: varianteId,
      product_uom_qty: qty,
    })
    const [ligne] = await odoo.lire('sale.order.line', [ligneId], ['price_unit', 'discount'])
    await odoo.supprimer('sale.order', [devisId])
    const effectif =
      (ligne.price_unit as number) * (1 - ((ligne.discount as number) ?? 0) / 100)
    return Math.round(effectif * 100) / 100
  }

  async function scenario(prixCatalogue: number) {
    const suffixe = Math.random().toString(36).slice(2, 8)
    const produitId = await odoo.creer('product.template', {
      name: `Test ORIGO ${suffixe}`,
      list_price: prixCatalogue,
    })
    const [tmpl] = await odoo.lire('product.template', [produitId], ['product_variant_id'])
    const partenaireId = await odoo.creer('res.partner', { name: `Resto ${suffixe}` })
    const tarifId = await tarifs.assurerTarifClient({
      partenaireId,
      nom: `Tarif ${suffixe}`,
      deviseId,
    })
    return {
      produitId,
      varianteId: (tmpl.product_variant_id as [number, string])[0],
      partenaireId,
      tarifId,
    }
  }

  it('signale les réglages Odoo qui faussent les prix en silence', async () => {
    const etat = await tarifs.verifierPrerequisTarifs()
    expect(etat, JSON.stringify(etat)).toEqual({ ok: true })
  })

  it('facture le prix attendu par ORIGO à chaque palier', async () => {
    const { produitId, varianteId, partenaireId, tarifId } = await scenario(30)
    const grille = {
      prixBase: 22,
      paliers: [{ seuil: 20, prix: 20 }],
      remiseSeuil: 10,
      remisePourcent: 5,
    }

    await tarifs.synchroniserReglesProduit({ tarifId, produitModeleId: produitId, grille })

    for (const qty of [1, 9, 10, 19, 20, 60]) {
      expect(await prixOdoo(partenaireId, varianteId, qty), `quantité ${qty}`).toBe(
        tarifLigne({ ...grille, qty }).puFinal,
      )
    }
  })

  it('fait disparaître un palier supprimé côté ORIGO', async () => {
    const { produitId, varianteId, partenaireId, tarifId } = await scenario(30)

    await tarifs.synchroniserReglesProduit({
      tarifId,
      produitModeleId: produitId,
      grille: { prixBase: 22, paliers: [{ seuil: 20, prix: 15 }] },
    })
    expect(await prixOdoo(partenaireId, varianteId, 25)).toBe(15)

    // Le palier disparaît de la grille : le prix doit revenir au tarif de base,
    // et non rester au palier obsolète encore présent dans Odoo.
    await tarifs.synchroniserReglesProduit({
      tarifId,
      produitModeleId: produitId,
      grille: { prixBase: 22 },
    })
    expect(await prixOdoo(partenaireId, varianteId, 25)).toBe(22)

    const restantes = await odoo.chercherLire(
      'product.pricelist.item',
      [
        ['pricelist_id', '=', tarifId],
        ['product_tmpl_id', '=', produitId],
      ],
      ['min_quantity', 'fixed_price'],
    )
    expect(restantes).toHaveLength(1)
  })

  it("n'écrit jamais de règle en pourcentage", async () => {
    const { produitId, tarifId } = await scenario(30)
    await tarifs.synchroniserReglesProduit({
      tarifId,
      produitModeleId: produitId,
      grille: { prixBase: 22, remiseSeuil: 10, remisePourcent: 5 },
    })

    const regles = await odoo.chercherLire<{ compute_price: string }>(
      'product.pricelist.item',
      [['pricelist_id', '=', tarifId]],
      ['compute_price'],
    )
    expect(regles.length).toBeGreaterThan(0)
    expect(regles.every((r) => r.compute_price === 'fixed')).toBe(true)
  })
})
