# ORIGO — Commande Pro

App B2B restaurants (Belgique) : catalogue personnalisé, commandes, préparation, livraison.

## Stack

| Couche | Techno |
|--------|--------|
| Front | React + Vite (PWA) |
| API | Fastify + Prisma |
| DB | PostgreSQL 16 |
| Auth | JWT + bcrypt + rate-limit |

## Architecture

```
origo-app/
  src/                 Front React
    api/               Client HTTP
    components/        Écrans client
    components/admin/  Écrans staff (direction / prépa / livreur)
  server/
    src/modules/       Routes API (auth, products, clients, me, orders)
    uploads/           Photos (gitignoré) — demain S3/R2
    prisma/            Schéma + migrations + seed
  scripts/             deploy.sh · sync-vps.sh · pull-backups.sh · restore-db.sh · dev.ps1
  docker-compose.yml       Dev : API + Postgres
  docker-compose.prod.yml  Prod : Caddy (HTTPS) + API + Postgres + backups
  Caddyfile                Reverse proxy, front statique, cache, HSTS
```

## Démarrage (macOS / Linux)

```bash
cp server/.env.example server/.env
docker compose up -d db          # Postgres :5432
npm install && npm --prefix server install
npm --prefix server run setup    # generate + migrate deploy + seed (1ère fois)

npm --prefix server run dev      # API :3001
npm run dev                      # Front :5173 (autre terminal)
```

## Démarrage (Windows)

```powershell
cd server
npm run setup   # generate + migrate deploy + seed (1ère fois)
npm run dev     # API :3001

# Autre terminal
cd ..
npm run dev     # Front :5173
```

Ou : `powershell -File scripts/dev.ps1`

## Partager à un pote (tunnel)

```powershell
powershell -File scripts/partager.ps1
```

## Docker (optionnel)

```bash
docker compose up -d --build
```

Si Postgres Windows occupe déjà le port 5432, arrête-le ou garde uniquement le Postgres Windows.

## Comptes seed (démo uniquement)

| Code | Mot de passe | Rôle |
|------|--------------|------|
| `ORIGO` | `admin2026` | Direction |
| `PREPA` | `prepa2026` | Préparation |
| `LIVREUR` | `livreur2026` | Livreur |
| `BOMBAY` | `1234` | Client |
| `MARCO` | `1234` | Client |

> Ces comptes n’existent qu’en dev : le seed refuse de tourner en production, et un déploiement
> ne crée que le compte direction (`ADMIN_PASSWORD`). Les clients créés via l’admin exigent **≥ 8**
> caractères (12 en production).

## Tests

```bash
docker compose up -d db
npm --prefix server test        # crée/migre origo_test puis lance vitest
```

Les tests tournent contre un vrai PostgreSQL et passent par l’API complète
(routing, auth, validation, service). Ils couvrent les scénarios qui
corrompaient stock et facturation : annulation, machine à états, réouverture
après livraison partielle, retours en double, concurrence sur le stock.

La base `origo_test` est créée une fois :

```bash
docker compose exec -T db psql -U origo -d postgres -c "CREATE DATABASE origo_test OWNER origo;"
```

### Tests Odoo

La traduction de la grille tarifaire en règles Odoo est testée sans Odoo. Les tests
de bout en bout ne tournent que si le bac à sable est lancé, sinon ils sont ignorés :

```bash
docker compose -f odoo-lab/docker-compose.yml up -d
npm --prefix server run build          # verifier-prix.mjs importe le tarif compilé
node odoo-lab/verifier-prix.mjs        # Odoo reproduit-il la grille d'ORIGO ?

ODOO_SYNC_TEST=1 ODOO_URL=http://127.0.0.1:8069 ODOO_DB=origo_lab \
  ODOO_USER=admin ODOO_API_KEY=admin npm --prefix server test
```

## Production 24/7

Voir **[DEPLOY.md](DEPLOY.md)**.

```bash
cp .env.prod.example .env.prod   # remplir les secrets
./scripts/deploy.sh
```

## Déjà anticipé (pour ne pas mourir plus tard)

- Polling = commandes seules
- Photos → fichiers `/uploads` (pas base64 en DB), sur volume Docker persistant
- Photos servies par **URL signée** (HMAC + expiration) et jamais en cache partagé :
  une photo de livraison montre les locaux d’un client identifié, elle ne peut pas
  être publique. Même modèle que les URLs présignées S3/R2, donc rien à réécrire
  le jour de la migration
- Listes API sans gros payloads photo
- JWT : secret obligatoire en prod, TTL court (`JWT_EXPIRES_IN`, défaut 16h en prod)
- Rate-limit login (anti brute-force), par IP réelle derrière le proxy (`TRUST_PROXY`)
- Migrations Prisma (`migrate deploy` au démarrage)
- CORS refus `*` en production ; en prod front et API sont même origine
- Seed destructif bloqué en production
- Dumps Postgres quotidiens + script de restauration testé
- Arrêt propre sur SIGTERM (pas de commande coupée en plein vol au redéploiement)

### Intégrité des commandes et du stock

- Machine à états des statuts : une commande livrée ne peut plus repartir en
  préparation, ni être confirmée deux fois
- Annulation uniquement via `POST /orders/:id/annuler` (direction). Le
  changement de statut n’accepte plus `ANNULEE` : un livreur pouvait annuler
  par ce biais en laissant le stock débité
- Annuler une commande **livrée** demande une décision explicite : la
  marchandise est-elle revenue ? Sinon on créait du stock inexistant
- Réouverture d’une livraison : les quantités et le stock des manquants sont
  réellement remis dans l’état d’avant livraison (`quantiteCommandee`)
- Mouvements de stock **atomiques en SQL** (`stock = stock + delta` avec
  condition `>= 0`) : plus de lecture-puis-écriture, donc plus de survente
  possible entre deux requêtes simultanées, quel que soit l’ordre d’exécution
- Contrainte `CHECK (stock >= 0)` en base, en second filet
- Retours : lignes agrégées par produit, impossible de rendre plus de cartons
  qu’il n’en a été livré
- Modification de commande bloquée dès la préparation (le montant d’une
  commande déjà partie ne peut plus être recalculé au tarif du jour)
- Suite de tests d’intégration sur tous ces scénarios (`npm --prefix server test`)

## Reste à faire (dette assumée)

1. **Facturation Peppol via Odoo** — n° TVA début septembre, mode `test` d’abord.
   Voir [ODOO.md](ODOO.md). En attendant : bon de commande dès confirmation,
   « facture » interne après livraison (pas un document Peppol).
2. **Fichiers `/uploads` orphelins hors remplacement** : remplacer une photo
   produit ou de livraison efface l’ancienne. Restent les fichiers d’un client
   effacé (droit à l’oubli) — à traiter avec le passage R2/S3.
3. Pagination des commandes et produits : la liste admin charge les **500**
   plus récentes (garde-fou). Une vraie pagination avant le volume.
4. Backups copiés **hors** du serveur applicatif : snapshots Contabo + `scripts/pull-backups.sh`
   vers le Mac. Un dump qui échoue est visible sur `/ready` et le tableau de bord.
   Un disque distant (`BACKUP_OFFSITE_HOST_DIR`) reste mieux si le Mac n’est pas allumé.
5. Photos → R2/S3 (même API URL).
6. Polices Google (RGPD) : self-host Inter/Poppins avant un gros volume.
