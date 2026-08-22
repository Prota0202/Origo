# Architecture hybride ORIGO + Odoo

Décision : **Odoo devient le back-office** (stock, facturation Peppol, comptabilité) et
**la PWA ORIGO reste l'interface de commande** des restaurants.

Raison : la valeur d'ORIGO est l'expérience client (catalogue par restaurant, prix
négociés, paliers, écrans préparation/livreur). Rien de tout cela n'est mieux fait par
Odoo. En revanche, la facturation électronique Peppol est une **obligation légale belge
depuis le 1er janvier 2026** (un PDF n'est plus une facture valable en B2B), et la
comptabilité belge n'est pas un terrain où réécrire quoi que ce soit.

---

## 1. Schéma cible

```
   PWA React (JWT ORIGO, inchangé)
        │  HTTPS
        ▼
   Fastify BFF ──── auth restaurant, catalogue restreint, règles métier
        │           cache lecture (catalogue, prix, stock)
        │  1 clé API, 1 compte bot
        ▼
   Odoo 19 Community ──── stock, sale.order, factures, Peppol, compta
```

Deux règles non négociables :

1. **La PWA ne parle jamais à Odoo directement.** Une clé API dans du JavaScript
   navigateur est une clé publique.
2. **Un seul système propriétaire du stock : Odoo.** ORIGO lit (en cache), n'écrit
   jamais dans `stock.quant`. Deux systèmes qui écrivent le même stock finissent
   toujours par diverger.

## 2. Ce qui est vérifié sur cette machine

Installation d'une base Odoo 19 **Community** vierge (`odoo-lab/docker-compose.yml`) :

| Module | État | Licence |
|---|---|---|
| `account_peppol` | **installé** | LGPL-3 |
| `account_edi_ubl_cii` | installé | LGPL-3 |
| `l10n_be` | installé | LGPL-3 |
| `account_reports` | **inexistant en Community** | — |
| `l10n_be_reports` | **inexistant en Community** | — |
| `account_accountant` | **inexistant en Community** | — |

Conclusions directes :

- Peppol **n'est pas** réservé à l'édition Enterprise. Le module s'installe sans aucun
  contrôle d'abonnement, et expose bien ses champs de configuration (`peppol_eas`,
  `peppol_endpoint`, `account_peppol_proxy_state`, `peppol_external_provider`).
- En revanche, **les déclarations TVA belges automatisées sont Enterprise** : le module
  qui les fournit n'existe pas en Community. C'est le vrai facteur de décision sur la
  licence, plus que Peppol.

Reproduire :

```bash
docker compose -f odoo-lab/docker-compose.yml up -d odoo-db
docker compose -f odoo-lab/docker-compose.yml run --rm --no-deps odoo \
  odoo -d origo_lab -i base,account,l10n_be,account_peppol --stop-after-init
docker compose -f odoo-lab/docker-compose.yml up -d      # http://localhost:8069
```

## 3. Répartition des responsabilités

| Domaine | Où | Modèle Odoo |
|---|---|---|
| Compte et connexion restaurant | **ORIGO** | — (le client n'est pas un utilisateur Odoo) |
| Fiche restaurant | Odoo | `res.partner` (`vat` obligatoire pour Peppol) |
| Produits | Odoo | `product.product` / `product.template` |
| Stock | Odoo (autorité) | `stock.quant`, `stock.move.line` |
| Prix négociés et paliers | Odoo (autorité) | `product.pricelist.item` (`min_quantity`) |
| **Catalogue restreint par client** | **ORIGO** | inexistant dans Odoo |
| Commande | Odoo | `sale.order` + `sale.order.line` |
| Livraison, livraison partielle, retours | Odoo | `stock.picking` (backorder natif) |
| Facture + envoi Peppol | Odoo | `account.move` |
| Favoris, notes par produit, demandes produit | **ORIGO** | inexistants dans Odoo |
| Minimum de cartons par client | **ORIGO** | inexistant dans Odoo |
| Photos de livraison | **ORIGO** (fichiers) | ne PAS mettre dans `ir.attachment` |

Sur les photos : Odoo stocke les pièces jointes en base64, souvent en base. À 30
livraisons/jour avec photo, la base gonfle, les sauvegardes deviennent lourdes et les
migrations de version interminables. Garder les fichiers côté ORIGO, ne transmettre
qu'une URL.

## 4. Prix par client — le point technique central

Le besoin est couvert nativement : une `product.pricelist` par restaurant, rattachée via
`res.partner.property_product_pricelist`, contenant des `product.pricelist.item` avec
`min_quantity` croissants. Odoo trie par `min_quantity` décroissant et prend la première
règle applicable, donc les paliers fonctionnent exactement comme dans ORIGO.

**Le piège** : toutes les méthodes de calcul de prix d'Odoo sont privées (préfixe `_`) et
Odoo refuse les méthodes privées en RPC. Les tutoriels qui appellent `get_product_price`
décrivent Odoo 14 et ne marchent plus.

Trois voies, à utiliser à des moments différents :

- **Affichage du catalogue** → lire les règles en masse (`search_read` sur
  `product.pricelist.item`), les mettre en cache dans Postgres, et appliquer la
  résolution des paliers dans le BFF. Un appel par produit est exclu : 400 produits =
  400 appels.
- **Validation du panier** → créer une `sale.order` brouillon avec ses lignes imbriquées
  en **un seul appel**. Odoo calcule `price_unit`, `discount` et `amount_total` tout
  seul. C'est ce prix qui fait foi.
- `get_contextual_price` existe et est publique, mais traite un produit à la fois et
  n'est pas documentée. À isoler derrière une seule fonction du BFF si on l'utilise.

**Garde-fou à mettre dès le départ** : journaliser l'écart entre le prix affiché (cache)
et le prix calculé par Odoo à la validation. Si le compteur reste à zéro un mois, la
dette est éteinte. S'il monte, on le saura avant le restaurant.

### Vérifié sur le labo, pas supposé

`odoo-lab/verifier-prix.mjs` monte des scénarios réels dans Odoo 19 et compare le
`price_unit` d'une ligne de devis à **la fonction `tarifLigne` d'ORIGO importée depuis
`server/dist`** — pas à une réécriture de la règle, sans quoi le test ne prouverait que la
cohérence de deux copies. Résultat : 24 points de quantité sur 5 scénarios, aucun écart
avec la règle retenue ci-dessous.

```bash
docker compose -f odoo-lab/docker-compose.yml up -d
npm --prefix server run build
node odoo-lab/verifier-prix.mjs
```

**Deux réglages qui font se tromper Odoo en silence**, constatés sur une base neuve. Aucun
des deux ne lève d'erreur : le prix est simplement faux.

1. Sans le groupe **« Listes de prix »** (`product.group_product_pricelist`), écrire
   `property_product_pricelist` sur un client **ne prend pas** : le champ relit `false` et
   Odoo facture le prix catalogue à tout le monde. À activer dans Ventes → Configuration.
2. **L'euro est inactif** sur une base neuve et la société est en dollars. Les listes de
   prix créées héritent alors de l'USD. À corriger avant toute création de tarif.

**La règle de synchronisation retenue : ORIGO ne délègue aucun calcul de prix à Odoo.**
Pour chaque client et chaque produit, il écrit uniquement des règles `fixed`, aux
quantités de rupture de sa propre grille, avec le prix que `tarifLigne` renvoie à cette
quantité. Odoo devient une table de correspondance.

Pourquoi : transposer la remise catalogue en règle `percentage` **donne un prix faux**. Une
règle en pourcentage s'applique à la base de la règle — le prix catalogue — alors qu'ORIGO
applique la remise au prix négocié du client. Mesuré : prix catalogue 30 €, prix négocié
22 €, remise 5 % à partir de 10 cartons.

| Quantité | ORIGO | Odoo, règle `percentage` | Odoo, règle retenue |
|---|---|---|---|
| 9 | 22,00 € | 22,00 € | 22,00 € |
| 10 | **20,90 €** | **28,50 €** | **20,90 €** |

Soit 7,60 € de trop par carton, sur une facture légale, sans aucun message d'erreur.
`tarifLigne` étant une fonction en escalier de la quantité, les points de rupture
suffisent à la reproduire exactement — c'est ce que vérifie le scénario
« paliers + remise » du script.

## 5. Authentification : aucun utilisateur Odoo pour les restaurants

Les « portal users » Odoo sont gratuits et illimités (c'est écrit dans le contrat de
licence Enterprise), mais **il ne faut en créer aucun**. Les restaurants se connectent à
la PWA, pas à Odoo. En créer reviendrait à synchroniser deux systèmes d'identité et à
gérer les mots de passe en double.

Côté Odoo : **un seul compte bot**, une clé API, appelée uniquement depuis Fastify. Le
lien se fait par un champ sur la table clients d'ORIGO qui stocke l'`id` du `res.partner`
(plus une référence de secours pour la réconciliation, car Odoo sait fusionner des
contacts et ferait pointer l'`id` dans le vide).

### Durée de la clé API : la limite de 90 jours est contournable

Vérifié dans le code d'Odoo 19 (`addons/base/models/res_users.py`) :

```python
def _check_expiration_date(self, date):
    if self.env.is_system():
        return
    if not date:
        raise ValidationError(_("The API key must have an expiration date"))
    max_duration = max(group.api_key_duration for group in self.env.user.all_group_ids) or 1.0
    if date > datetime.datetime.now() + datetime.timedelta(days=max_duration):
        raise ValidationError(_("You cannot exceed %(duration)s days."))
```

Les 90 jours viennent du champ `api_key_duration` porté par le groupe `base.group_user`
(`base/security/base_groups.xml`). Deux conséquences :

- **Un utilisateur membre de `base.group_system` (Administration / Paramètres) peut créer
  une clé sans date d'expiration.** Le `return` en tête de fonction court-circuite tout
  le contrôle. C'est écrit noir sur blanc dans `_generate` : « For a persistent key
  (infinite duration), no value for expiration date. »
- `api_key_duration` est un champ modifiable, `max()` sur les groupes de l'utilisateur.
  On peut donc créer un groupe dédié au bot avec une durée longue et garder le bot
  non-administrateur.

**Solution retenue** : groupe dédié `ORIGO Integration` avec `api_key_duration` élevé
(champ visible en mode développeur uniquement), et clé sans expiration créée en tant
qu'administrateur. Pas de cron de rotation à écrire.

La rotation programmatique existe (`res.users.apikeys.generate()` / `revoke()`, avec le
paramètre système `base.enable_programmatic_api_keys` et une limite
`base.programmatic_api_keys_limit`), mais elle n'est nécessaire que si l'on tient à des
clés courtes.

**À faire quand même** : une sonde qui appelle Odoo au démarrage et périodiquement, et
qui alerte si l'authentification échoue. Une clé peut être révoquée à la main par erreur.

## 6. Points à trancher avant d'écrire du code

1. **Activation Peppol sur base Community.** Le module s'installe (vérifié), mais
   l'activation s'enregistre auprès du proxy d'Odoo SA en transmettant l'identifiant de
   la base. Impossible de savoir sans essayer avec le vrai numéro d'entreprise si ce
   proxy accepte une base Community non abonnée. Test à faire en mode `test`
   (paramètre système `account_peppol.edi.mode`), avec le numéro BCE et un mobile.
   EAS belge = `0208`.
   *Repli si refus* : Odoo génère quand même l'UBL BIS 3.0 conforme
   (`account_edi_ubl_cii`, présent en Community) et le champ `peppol_external_provider`
   existe → passer par un access point belge tiers (~20–50 €/mois).
   En Community (choix retenu, § 7) : tester en mode `test` avant le premier envoi réel.
   Si le proxy Odoo SA refuse une base non abonnée → access point belge tiers
   (~20–50 €/mois) ou bascule Enterprise plus tard.
2. ~~**Déclarations TVA / licence.**~~ Tranché : Community maintenant ; les déclarations
   TVA belges automatiques (`l10n_be_reports`) attendront Enterprise. Le comptable
   travaille sur export en attendant. Voir § 7.
3. ~~**Tarif / budget.**~~ Auto-hébergement Enterprise = **paiement annuel obligatoire**
   (~720–900 € pour 2 users). Hors budget aujourd'hui → Community à 0 €.

## 7. Licence : décision prise — Enterprise Custom **Online**, paiement mensuel

**Retenu : https://origo.odoo.com** (Odoo Online / hébergement cloud standard).
Paiement au mois : l'auto-hébergement est annuel uniquement, donc hors jeu tant
que le budget n'est pas en annuel.

Configuré sur la base (août 2026) :

- Société **Origo**, pays Belgique, devise **EUR**
- Apps : Ventes, Inventaire, Comptabilité, `l10n_be`, `l10n_be_reports`, Peppol
- **Listes de prix** activées (sinon Odoo facture le prix catalogue en silence)
- Utilisateur robot `origo-bot@origo.odoo.com` : Admin Ventes + Inventaire + Comptabilité
- Clé API : créée, rattachée au compte direction (uid 2). Le robot
  `origo-bot@origo.odoo.com` existe pour plus tard (droits plus étroits).

À remplir à la main : n° TVA / BCE de la société — **début septembre**.
Peppol : ne pas activer avant d'avoir ce numéro, et seulement en mode `test`
sur cette instance. Un essai trop tôt enregistre ORIGO auprès du proxy Odoo SA
sans identifiant valide.

Risques assumés d'Online : quotas d'API, mises à jour forcées, pas de bac de test
sur cette base. Mitigation : cache + un `sale.order` par commande + retry ; labo
Community local pour les essais.

### Ce que Community donne / ne donne pas

| | Community | Enterprise Custom (plus tard) |
|---|---|---|
| Prix licence | **0 €** | ~37 €/user/mois en annuel |
| API externe | oui | oui |
| Peppol / UBL | oui (vérifié) | oui |
| Déclarations TVA belges auto | **non** | oui (`l10n_be_reports`) |
| Auto-hébergement | oui | oui |

Le comptable reçoit un export tant qu'on n'a pas Enterprise. Ce n'est pas bloquant pour
facturer en Peppol si l'activation Community passe (à tester en mode `test`).

### Passage Community → Enterprise : sans repartir de zéro

Même serveur, même base Postgres. On dépose les addons du dépôt privé
`github.com/odoo/enterprise` (branche `19.0`) dans `odoo/enterprise/`, on rebuild
l'image, on saisit le code d'abonnement. L'intégration ORIGO ne change pas.

L'image Docker publique `odoo:19` **est** Community — c'est exactement ce qu'on utilise
aujourd'hui. Le dossier `odoo/enterprise/` reste vide jusqu'à l'abonnement ; le
`Dockerfile` et `addons_path` sont déjà prêts pour le jour J.

### Quand prendre Enterprise

Quand il y a du chiffre pour payer l'année (~720 € pour 2 users en annuel) **et** que le
comptable exige les rapports Odoo plutôt qu'un export. Pas avant.

À ce moment-là : plan **Personnalisé**, hébergement **Auto-hébergement**, mise en œuvre
**self-service**, facturation **annuelle**, **2 users** (toi + robot dédié ; 1 user suffit
au début si le bot réutilise ta clé API).

## 7 bis. Comparaison des plans (pour mémoire)

| | Community self-hosted | Enterprise **Custom** | Enterprise Standard |
|---|---|---|---|
| Prix | 0 € | ~29,90 €/utilisateur/mois (annuel) | ~19,90 € |
| API externe | oui, sans limite | oui | **non** |
| Auto-hébergement | oui | oui | **non, Odoo Online only** |
| Peppol | oui (vérifié) | oui | oui |
| Déclarations TVA belges | **non** | oui | oui |
| Odoo Studio, multi-sociétés | non | oui | non |

**Le plan Standard est éliminé d'office** : sans API externe, l'architecture hybride est
impossible. La doc officielle est explicite — « Access to data via the external API is
only available on Custom Odoo pricing plans. » Standard impose aussi Odoo Online, donc
pas d'auto-hébergement.

Le prix est **par utilisateur, pas par application** : toutes les apps sont incluses, il
n'y a pas d'« options » à choisir. On installe Ventes, Inventaire et Comptabilité.

## 8. Étapes proposées

### Toi (humain)

1. Commander un **CX43** (ORIGO + Odoo Community sur la même machine) — voir DEPLOY.md.
2. DNS **deux** enregistrements A vers l'IP : `commande.*` et `odoo.*`, **avant** le déploiement.
3. `./scripts/deploy.sh` (WITH_ODOO=1 par défaut). Ne pas faire tourner origo.odoo.com
   **et** Odoo sur le VPS en parallèle (deux comptas).
4. Garder numéro BCE + mobile pour Peppol (mode `test` d'abord, une seule fois sur
   l'instance finale — pas sur un essai jetable).

### Technique (en cours / à venir)

1. ~~Client Odoo dans Fastify~~ (fait : `server/src/lib/odoo/`, tests contre le labo).
2. ~~Stack prod Community~~ (fait : `docker-compose.odoo.yml`, dossier `enterprise/` vide).
3. ~~Poussée catalogue ORIGO → Odoo~~ (produits, partenaires, tarifs `fixed`).
4. ~~Création de commande → `sale.order` Odoo~~ (arrière-plan, `client_order_ref`
   = numéro ORIGO). Confirmation du devis à la prise de commande ; validation
   du picking **à la livraison ORIGO**. ORIGO reste la source de vérité PWA :
   Odoo down ≠ resto bloqué. Pas de facture / Peppol tant que le n° TVA manque.
5. Écrans préparation / livreur : UI ORIGO, état dans Odoo.
6. Facturation + Peppol depuis Odoo, **après le n° TVA (début septembre)** :
   mode `test` d'abord, une seule fois sur origo.odoo.com. Arrêt du PDF « facture ».
7. Plus tard, quand le budget le permet : déposer Enterprise, saisir le code, installer
   `l10n_be_reports`.

Pendant toute la transition, ORIGO reste la source de vérité **pour le restaurant**.
Le stock Odoo bouge via les `sale.order` / pickings, **pas** par un inventaire
à chaque vente. Un « Envoyer le catalogue » avec stock réécrirait `stock.quant`
par-dessus les livraisons déjà validées : ce n'est plus le défaut.

## 9. Pièges connus

| Piège | Conséquence | Quand traiter |
|---|---|---|
| Clé API à 90 jours par défaut | intégration morte sans prévenir | créer la clé sans expiration (compte système) dès l'installation |
| Un appel API par produit | 400 appels par catalogue ; 429 sur Odoo Online (1 appel/s) | dès le premier écran catalogue |
| Chaque appel = sa propre transaction | commande créée sans ses lignes | créer la commande et ses lignes en un seul appel |
| `SerializationFailure` sur `stock.quant` | échec quand deux restaurants commandent le même produit | retry avec backoff dans le client Odoo |
| Noms de champs changeant entre versions | mapping cassé à la montée de version | constantes centralisées + test `fields_get` |
| Liste de prix ≠ catalogue | un produit hors liste de prix reste visible et commandable | garder la restriction dans ORIGO et la valider côté serveur |
| API externe absente du plan Standard | il faut Custom sur Odoo Online (gratuit en Community self-hosted) | au choix de la licence |
