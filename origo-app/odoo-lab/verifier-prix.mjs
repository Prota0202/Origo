/**
 * Le point technique central de l'architecture hybride (voir ../ODOO.md § 4) :
 * Odoo doit reproduire **exactement** la logique de prix d'ORIGO, sinon on
 * facturerait des montants différents de ceux affichés au restaurant.
 *
 * Ce script ne réimplémente pas la règle : il importe `tarifLigne` compilé
 * depuis le serveur ORIGO, et compare au prix qu'Odoo calcule réellement sur
 * une ligne de devis. Toute divergence est donc un vrai écart, pas un écart
 * entre deux copies de la règle.
 *
 *   docker compose -f odoo-lab/docker-compose.yml up -d
 *   npm --prefix server run build          # produit dist/lib/pricing.js
 *   node odoo-lab/verifier-prix.mjs
 */
import { tarifLigne } from '../server/dist/lib/pricing.js'

const URL_ODOO = process.env.ODOO_URL ?? 'http://127.0.0.1:8069'
const BASE = process.env.ODOO_DB ?? 'origo_lab'
const UTILISATEUR = process.env.ODOO_USER ?? 'admin'
const MOT_DE_PASSE = process.env.ODOO_PASSWORD ?? 'admin'

let uid

async function rpc(service, method, args) {
  const res = await fetch(`${URL_ODOO}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
  })
  const data = await res.json()
  if (data.error) {
    const d = data.error.data ?? {}
    throw new Error(`${d.name ?? data.error.message} — ${d.message ?? ''}`)
  }
  return data.result
}

const appel = (modele, methode, args = [], kwargs = {}) =>
  rpc('object', 'execute_kw', [BASE, uid, MOT_DE_PASSE, modele, methode, args, kwargs])

const creer = (modele, valeurs) => appel(modele, 'create', [valeurs])
const lire = (modele, ids, champs) => appel(modele, 'read', [ids, champs])
const chercher = (modele, domaine, limite = 1) =>
  appel(modele, 'search', [domaine], { limit: limite })

async function moduleInstalle(nom) {
  const ids = await chercher('ir.module.module', [['name', '=', nom], ['state', '=', 'installed']])
  return ids.length > 0
}

async function installer(nom) {
  const ids = await chercher('ir.module.module', [['name', '=', nom]])
  if (ids.length === 0) throw new Error(`Module ${nom} introuvable`)
  await appel('ir.module.module', 'button_immediate_install', [ids])
}

/** Prix réellement calculé par Odoo pour (client, produit, quantité). */
async function prixOdoo(partnerId, productId, qty) {
  const orderId = await creer('sale.order', { partner_id: partnerId })
  const ligneId = await creer('sale.order.line', {
    order_id: orderId,
    product_id: productId,
    product_uom_qty: qty,
  })
  const [ligne] = await lire('sale.order.line', [ligneId], ['price_unit', 'discount', 'price_subtotal'])
  await appel('sale.order', 'unlink', [[orderId]])

  // Selon la version et le réglage « remise par ligne », Odoo exprime la
  // réduction soit dans price_unit, soit dans discount. On compare l'effectif.
  const effectif = ligne.price_unit * (1 - (ligne.discount ?? 0) / 100)
  return { unitaire: Math.round(effectif * 100) / 100, sousTotal: ligne.price_subtotal }
}

const arrondi = (n) => Math.round(n * 100) / 100

/**
 * Deux réglages sans lesquels Odoo se trompe **en silence**, constatés sur une
 * base fraîche. Ils sont à refaire sur la base de production.
 */
async function prerequis() {
  // 1. Sans le groupe « Listes de prix », écrire property_product_pricelist sur un
  //    client ne prend pas : le champ relit `false` et Odoo facture le prix
  //    catalogue. Aucune erreur n'est levée, le prix est simplement faux.
  const groupes = await appel('res.users', 'read', [[uid], ['groups_id']]).catch(() => null)
  const idGroupe = await appel('ir.model.data', 'check_object_reference', [
    'product',
    'group_product_pricelist',
  ])
  const membres = await lire('res.groups', [idGroupe[1]], ['all_user_ids'])
  if (!membres[0].all_user_ids.includes(uid)) {
    const sid = await creer('res.config.settings', { group_product_pricelist: true })
    await appel('res.config.settings', 'execute', [[sid]])
    console.log('réglage activé : listes de prix (sinon les prix par client sont ignorés)')
  }
  void groupes
}

/** L'euro est inactif sur une base neuve : les prix atterriraient en dollars. */
async function deviseEuro() {
  const trouve = await appel('res.currency', 'search', [[['name', '=', 'EUR']]], {
    limit: 1,
    context: { active_test: false },
  })
  if (trouve.length === 0) throw new Error('Devise EUR introuvable')
  const [eur] = await lire('res.currency', trouve, ['active'])
  if (!eur.active) {
    await appel('res.currency', 'write', [trouve, { active: true }])
    console.log('devise activée : EUR')
  }

  const societeId = (await lire('res.users', [uid], ['company_id']))[0].company_id[0]
  const societe = (await lire('res.company', [societeId], ['currency_id', 'country_id']))[0]
  if (societe.currency_id[0] !== trouve[0]) {
    await appel('res.company', 'write', [[societeId], { currency_id: trouve[0] }])
    console.log(`devise de la société : ${societe.currency_id[1]} → EUR`)
  }
  return trouve[0]
}

async function main() {
  uid = await rpc('common', 'authenticate', [BASE, UTILISATEUR, MOT_DE_PASSE, {}])
  if (!uid) throw new Error(`Authentification refusée sur ${BASE}`)
  const version = await rpc('common', 'version', [])
  console.log(`Odoo ${version.server_version} · base ${BASE} · uid ${uid}\n`)

  for (const mod of ['sale_management', 'stock']) {
    if (!(await moduleInstalle(mod))) {
      console.log(`installation du module ${mod}…`)
      await installer(mod)
    }
  }

  await prerequis()
  const suffixe = Date.now().toString(36)
  const devise = await deviseEuro()
  let echecs = 0

  /**
   * Règle de synchronisation retenue : ORIGO ne délègue **aucun** calcul à Odoo.
   * Pour chaque quantité de rupture de sa propre grille, il écrit un prix fixe
   * obtenu par `tarifLigne`. La fonction de tarif d'ORIGO étant une fonction en
   * escalier de la quantité, ces points suffisent à la reproduire exactement,
   * et Odoo ne peut plus appliquer une remise sur une base inattendue.
   */
  function itemsDepuisOrigo(origo) {
    const ruptures = new Set([0])
    for (const p of origo.reste.paliers ?? []) ruptures.add(p.seuil)
    if (origo.reste.remiseSeuil != null) ruptures.add(origo.reste.remiseSeuil)

    return [...ruptures]
      .sort((a, b) => a - b)
      .map((minQty) => ({
        minQty,
        type: 'fixed',
        valeur: tarifLigne({ prixBase: origo.prixBase, qty: minQty, ...origo.reste }).puFinal,
      }))
  }

  /** Monte un scénario dans Odoo et le compare à tarifLigne pour chaque quantité. */
  async function scenario(nom, spec) {
    console.log(`\n=== ${nom} ===`)
    const items = spec.items ?? itemsDepuisOrigo(spec.origo)
    if (!spec.items) {
      console.log(
        `  règles générées : ${items.map((i) => `≥${i.minQty} → ${i.valeur.toFixed(2)} €`).join(' · ')}`,
      )
    }
    let ecarts = 0

    const productId = await creer('product.template', {
      name: `ORIGO ${nom} ${suffixe}`,
      list_price: spec.prixCatalogue,
      // Le carton est l'unité de vente : une commande porte des cartons entiers.
      uom_id: 1,
    })
    const [tmpl] = await lire('product.template', [productId], ['product_variant_id'])
    const variantId = tmpl.product_variant_id[0]

    const pricelistId = await creer('product.pricelist', {
      name: `Tarif ${nom} ${suffixe}`,
      currency_id: devise,
      item_ids: items.map((i) => [
        0,
        0,
        {
          applied_on: '1_product',
          product_tmpl_id: productId,
          min_quantity: i.minQty,
          compute_price: i.type,
          ...(i.type === 'fixed' ? { fixed_price: i.valeur } : { percent_price: i.valeur, base: 'list_price' }),
        },
      ]),
    })

    const partnerId = await creer('res.partner', {
      name: `Resto ${nom} ${suffixe}`,
      property_product_pricelist: pricelistId,
    })

    console.log('  qty | ORIGO      | Odoo       |')
    console.log('  ----|------------|------------|')
    for (const qty of spec.quantites) {
      const attendu = tarifLigne({ prixBase: spec.origo.prixBase, qty, ...spec.origo.reste })
      const obtenu = await prixOdoo(partnerId, variantId, qty)
      const ok = arrondi(attendu.puFinal) === obtenu.unitaire
      if (!ok) {
        echecs++
        ecarts++
      }
      console.log(
        `  ${String(qty).padStart(3)} | ${attendu.puFinal.toFixed(2).padStart(10)} | ${obtenu.unitaire.toFixed(2).padStart(10)} | ${ok ? 'ok' : spec.ecartAttendu ? 'écart attendu' : 'ECART'}`,
      )
    }
    return ecarts
  }

  // 1. Prix négocié + paliers de quantité : le cas courant chez ORIGO.
  await scenario('paliers', {
    prixCatalogue: 24.5,
    items: [
      { minQty: 0, type: 'fixed', valeur: 22.0 },
      { minQty: 20, type: 'fixed', valeur: 20.0 },
      { minQty: 50, type: 'fixed', valeur: 18.5 },
    ],
    origo: {
      prixBase: 22.0,
      reste: { paliers: [{ seuil: 20, prix: 20.0 }, { seuil: 50, prix: 18.5 }] },
    },
    quantites: [1, 5, 19, 20, 49, 50, 100],
  })

  // 2. Remise catalogue en pourcentage, sans prix négocié.
  await scenario('remise-pourcent', {
    prixCatalogue: 30.0,
    items: [{ minQty: 10, type: 'percentage', valeur: 5 }],
    origo: { prixBase: 30.0, reste: { remiseSeuil: 10, remisePourcent: 5 } },
    quantites: [9, 10, 25],
  })

  // 3. Le cas piégeux, transposé naïvement : prix négocié ET remise catalogue
  //    exprimée en pourcentage dans Odoo. ORIGO applique la remise au prix
  //    négocié ; Odoo l'applique à la base de la règle, le prix catalogue.
  //    Cet écart est ATTENDU : il justifie la règle de synchronisation du § 4.
  const attenduEnEchec = await scenario('negocie-plus-remise (transposition naïve)', {
    prixCatalogue: 30.0,
    items: [
      { minQty: 0, type: 'fixed', valeur: 22.0 },
      { minQty: 10, type: 'percentage', valeur: 5 },
    ],
    origo: { prixBase: 22.0, reste: { remiseSeuil: 10, remisePourcent: 5 } },
    quantites: [9, 10],
    ecartAttendu: true,
  })

  // 4. Le même cas, synchronisé selon la règle retenue : que des prix fixes,
  //    calculés par tarifLigne aux quantités de rupture. Odoo devient une table
  //    de correspondance et ne peut plus recalculer autrement.
  await scenario('negocie-plus-remise (règle retenue)', {
    prixCatalogue: 30.0,
    origo: { prixBase: 22.0, reste: { remiseSeuil: 10, remisePourcent: 5 } },
    quantites: [1, 9, 10, 25],
  })

  // 5. Le cas complet : paliers client ET remise catalogue, avec un seuil de
  //    remise situé sous le premier palier. C'est la combinaison la plus
  //    exposée à un écart d'arrondi ou de priorité.
  await scenario('paliers + remise (règle retenue)', {
    prixCatalogue: 24.5,
    origo: {
      prixBase: 22.0,
      reste: {
        paliers: [{ seuil: 20, prix: 20.0 }, { seuil: 50, prix: 18.5 }],
        remiseSeuil: 10,
        remisePourcent: 5,
      },
    },
    quantites: [1, 9, 10, 19, 20, 49, 50, 120],
  })

  const reels = echecs - attenduEnEchec
  console.log(
    reels === 0
      ? `\nConforme : ${attenduEnEchec} écart(s) attendu(s) sur la transposition naïve, 0 écart avec la règle retenue.`
      : `\n${reels} écart(s) NON attendu(s) : l'architecture hybride ne peut pas garantir le prix facturé.`,
  )
  process.exit(reels === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\nECHEC : ${e.message}`)
  process.exit(2)
})
