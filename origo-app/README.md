# ORIGO — Commande Pro

App B2B restaurants (Belgique) : catalogue personnalisé, commandes, préparation, livraison.

## Stack

| Couche | Techno |
|--------|--------|
| Front | React + Vite (PWA) |
| API | Fastify + Prisma |
| DB | PostgreSQL 16 |
| Auth | JWT + bcrypt |

## Architecture

```
origo-app/
  src/                 Front React
    api/               Client HTTP
    components/        Écrans client
    components/admin/  Écrans staff (direction / prépa / livreur)
  server/
    src/modules/       Routes API (auth, products, clients, me, orders)
    prisma/            Schéma + seed
  scripts/             dev.ps1 · partager.ps1 · setup-db.ps1
  docker-compose.yml   API + Postgres
```

## Démarrage (Windows)

```powershell
# Postgres Windows déjà installé + server/.env configuré
cd server
npm run setup   # generate + push + seed (1ère fois)
npm run dev     # API :3001

# Autre terminal
cd ..
npm run dev     # Front :5173
```

Ou : `powershell -File scripts/dev.ps1`

## Partager à un pote (tunnel)

```powershell
# Front + API déjà lancés
powershell -File scripts/partager.ps1
```

## Docker (optionnel)

```bash
docker compose up -d --build
```

Si Postgres Windows occupe déjà le port 5432, arrête-le ou garde uniquement le Postgres Windows.

## Comptes seed

| Code | Mot de passe | Rôle |
|------|--------------|------|
| `ORIGO` | `admin2026` | Direction |
| `PREPA` | `prepa2026` | Préparation |
| `LIVREUR` | `livreur2026` | Livreur |
| `BOMBAY` | `1234` | Client |
| `MARCO` | `1234` | Client |

## Créer un client

Admin Direction → Clients → Nouveau client
