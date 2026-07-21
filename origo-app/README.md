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
  scripts/             dev.ps1 · partager.ps1 · setup-db.ps1
  docker-compose.yml   API + Postgres
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

> Avant un vrai client : changer tous ces mots de passe. Les **nouveaux** clients créés via l’admin exigent **≥ 8** caractères.

## Déjà anticipé (pour ne pas mourir plus tard)

- Polling = commandes seules
- Photos → fichiers `/uploads` (pas base64 en DB)
- Listes API sans gros payloads photo
- JWT : secret obligatoire en prod, TTL court (`JWT_EXPIRES_IN`, défaut 12h en prod)
- Rate-limit login (anti brute-force)
- Migrations Prisma (`migrate deploy` en Docker)
- CORS refus `*` en production

## Avant Hetzner / 1er restaurant réel

1. `NODE_ENV=production` + `JWT_SECRET` fort (≥ 32 car.) + `CORS_ORIGIN` = ton domaine
2. Changer MDP seed / ne plus exposer le tunnel Cloudflare
3. Photos → R2/S3 (même API URL)
4. Simplifier l’écran création client (catalogue puis prix)
5. Pagination commandes si le volume augmente
