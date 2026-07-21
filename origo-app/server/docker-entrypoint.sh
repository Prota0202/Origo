#!/bin/sh
set -e
echo "Prisma migrate deploy..."
npx prisma migrate deploy
if [ "$SEED_ON_START" = "1" ]; then
  echo "Seed..."
  npx tsx prisma/seed.ts || true
fi
echo "Starting API..."
exec node dist/index.js
