# ORIGO — Commande Pro

App B2B restaurants (Belgique) : catalogue personnalisé, commandes, préparation, livraison.

## Stack

| Couche | Techno |
|--------|--------|
| Front | React + Vite (PWA) |
| API | Fastify + Prisma |
| DB | **PostgreSQL 16** |
| Auth | JWT + bcrypt |
| Conteneurs | Docker Compose (après redémarrage WSL) |

## Prérequis installés sur cette machine

- Node.js
- **PostgreSQL 16** (service Windows `postgresql-x64-16`)
- **Docker Desktop** (installé — nécessite un **redémarrage PC** pour activer WSL2)

## Démarrage rapide (Windows)

```powershell
# Terminal 1 — API
cd server
npm run dev

# Terminal 2 — Front
cd ..
npm run dev
```

Ou : `powershell -File scripts/dev.ps1`

Front : http://localhost:5173 · API : http://localhost:3001

## Docker (API + Postgres)

Nécessite Docker Desktop **démarré** (redémarrage PC si WSL2 vient d’être installé) :

```bash
docker compose up -d --build
# Seed optionnel :
docker compose run -e SEED_ON_START=1 api
```

> Si Postgres Windows occupe déjà le port 5432, arrête le service `postgresql-x64-16` avant, ou garde uniquement le Postgres Windows (déjà configuré).


## Comptes seed

| Code | Mot de passe | Rôle |
|------|--------------|------|
| `ORIGO` | `admin2026` | Direction |
| `PREPA` | `prepa2026` | Préparation |
| `LIVREUR` | `livreur2026` | Livreur |
| `DEMO` | `demo2026` | Client test |

## Docker (après redémarrage PC)

WSL2 a été installé — **redémarre Windows une fois**, puis :

```bash
# Vérifier Docker
docker version

# Lancer Postgres via Docker (alternative au Postgres Windows)
cd origo-app
docker compose up -d

# Adapter server/.env si besoin (même URL localhost:5432)
cd server
npm run setup
npm run dev
```

> Si le Postgres Windows occupe déjà le port 5432, soit tu l’utilises tel quel (déjà OK), soit tu arrêtes le service et tu passes par Docker.

## Créer un client

Dans l’admin Direction → Clients → Nouveau client  
(ou `POST /api/v1/clients` avec Bearer token `ORIGO`)

## API principale

```
GET  /api/v1/health
POST /api/v1/auth/login
GET  /api/v1/auth/me
GET  /api/v1/products
GET  /api/v1/clients
POST /api/v1/clients
GET  /api/v1/me/orders
POST /api/v1/me/orders
PATCH /api/v1/orders/:id/statut
POST /api/v1/orders/:id/retours
```
