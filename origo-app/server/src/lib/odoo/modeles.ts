/**
 * Tous les noms de modèles et de champs Odoo, à un seul endroit.
 *
 * Raison d'être : une montée de version d'Odoo qui renomme un champ doit se
 * corriger ici et nulle part ailleurs. Si ces chaînes se dispersent dans le
 * code métier, la prochaine version majeure devient une chasse au trésor.
 *
 * Relevé sur Odoo 19.0. Les écarts constatés par rapport aux versions
 * antérieures sont annotés, ce sont autant de pièges de migration.
 */

export const MODELES = {
  produitModele: 'product.template',
  produitVariante: 'product.product',
  produitCategorie: 'product.category',
  partenaire: 'res.partner',
  tarif: 'product.pricelist',
  tarifRegle: 'product.pricelist.item',
  devis: 'sale.order',
  devisLigne: 'sale.order.line',
  livraison: 'stock.picking',
  mouvement: 'stock.move',
  retourWizard: 'stock.return.picking',
  facture: 'account.move',
  stockDisponible: 'stock.quant',
  emplacement: 'stock.location',
  societe: 'res.company',
  devise: 'res.currency',
  pays: 'res.country',
  utilisateur: 'res.users',
  groupe: 'res.groups',
  module: 'ir.module.module',
  reglages: 'res.config.settings',
} as const

export const CHAMPS = {
  produit: {
    nom: 'name',
    reference: 'default_code',
    prixCatalogue: 'list_price',
    variante: 'product_variant_id',
    actif: 'active',
    type: 'type',
    stockable: 'is_storable',
    descriptionVente: 'description_sale',
    categorie: 'categ_id',
  },
  partenaire: {
    nom: 'name',
    /** Champ calculé avec inverse : l'écriture n'aboutit **que** si le groupe
     *  `product.group_product_pricelist` est actif. Sinon la relecture renvoie
     *  `false` sans erreur, et Odoo facture le prix catalogue. */
    tarif: 'property_product_pricelist',
    tva: 'vat',
    email: 'email',
    telephone: 'phone',
    rue: 'street',
    ville: 'city',
    reference: 'ref',
    societe: 'is_company',
    commentaire: 'comment',
    pays: 'country_id',
    actif: 'active',
  },
  stock: {
    produit: 'product_id',
    emplacement: 'location_id',
    quantite: 'quantity',
    inventaire: 'inventory_quantity',
  },
  tarifRegle: {
    tarif: 'pricelist_id',
    /** '0_product_variant' | '1_product' | '2_product_category' | '3_global' */
    portee: 'applied_on',
    produitModele: 'product_tmpl_id',
    quantiteMini: 'min_quantity',
    /** 'fixed' | 'percentage' | 'formula' — ORIGO n'écrit que 'fixed', voir ODOO.md § 4 */
    modeCalcul: 'compute_price',
    prixFixe: 'fixed_price',
    pourcentage: 'percent_price',
  },
  devis: {
    partenaire: 'partner_id',
    referenceClient: 'client_order_ref',
    origine: 'origin',
    etat: 'state',
    lignes: 'order_line',
    livraisons: 'picking_ids',
    tarif: 'pricelist_id',
  },
  devisLigne: {
    devis: 'order_id',
    produit: 'product_id',
    quantite: 'product_uom_qty',
    prixUnitaire: 'price_unit',
    remisePourcent: 'discount',
    sousTotal: 'price_subtotal',
  },
  livraison: {
    etat: 'state',
    type: 'picking_type_code',
    origine: 'origin',
    vente: 'sale_id',
  },
  mouvement: {
    livraison: 'picking_id',
    produit: 'product_id',
    demandee: 'product_uom_qty',
    faite: 'quantity',
  },
  groupe: {
    /** Odoo 19 a supprimé `users` sur res.groups au profit de ces deux champs. */
    membresDirects: 'user_ids',
    membresTous: 'all_user_ids',
  },
} as const

/** Références XML utilisées pour retrouver un enregistrement sans dépendre d'un id. */
export const REFERENCES = {
  groupeTarifs: ['product', 'group_product_pricelist'] as const,
}
