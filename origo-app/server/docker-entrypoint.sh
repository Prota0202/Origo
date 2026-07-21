#!/bin/sh
set -e
echo "Prisma db push..."
npx prisma db push --skip-generate
if [ "$SEED_ON_START" = "1" ]; then
  echo "Seed..."
  npx tsx prisma/seed.ts || true
fi
echo "Starting API..."
exec node dist/index.js
