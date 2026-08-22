#!/bin/sh
set -e

echo "Prisma migrate deploy..."
npx prisma migrate deploy

# Compte direction : sûr en production (upsert, aucune suppression)
if [ "$BOOTSTRAP_ADMIN" = "1" ]; then
  echo "Bootstrap compte direction..."
  npx tsx prisma/bootstrap-admin.ts
fi

# Seed démo : EFFACE TOUT. Le script refuse de tourner en production sans
# SEED_FORCE_DESTRUCTIVE=1. On ne masque plus les erreurs (pas de `|| true`)
# pour ne pas démarrer sur une base à moitié initialisée.
if [ "$SEED_ON_START" = "1" ]; then
  echo "Seed démo (destructif)..."
  npx tsx prisma/seed.ts
fi

echo "Starting API..."
exec node dist/index.js
