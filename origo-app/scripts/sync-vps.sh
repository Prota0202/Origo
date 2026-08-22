#!/usr/bin/env bash
# Envoie le code local vers le VPS (sans secrets ni node_modules) puis redéploie.
# Usage depuis origo-app/ : ./scripts/sync-vps.sh
set -euo pipefail

cd "$(dirname "$0")/.."
HOST="${ORIGO_VPS_HOST:-origo-vps}"

rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.prod \
  --exclude .env.odoo.local \
  --exclude .env.production \
  --exclude backups \
  --exclude 'server/uploads' \
  --exclude odoo-lab \
  --exclude .DS_Store \
  --exclude '*.sql.gz' \
  ./ "${HOST}:/opt/origo/"

ssh "$HOST" 'chmod +x /opt/origo/scripts/*.sh && cd /opt/origo && ./scripts/deploy.sh'
