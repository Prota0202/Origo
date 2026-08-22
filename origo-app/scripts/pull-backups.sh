#!/usr/bin/env bash
# Copie les dumps + photos du VPS vers cette machine (autre disque, autre lieu).
# Usage : ./scripts/pull-backups.sh
# Installé en tâche Mac : ~/Library/LaunchAgents/be.origo.pull-backups.plist
set -euo pipefail

DEST="${ORIGO_BACKUP_DEST:-$HOME/.origo/backups}"
HOST="${ORIGO_VPS_HOST:-origo-vps}"
KEY="${ORIGO_SSH_KEY:-$HOME/.ssh/id_ed25519}"
mkdir -p "$DEST"

rsync -az --timeout=120 \
  -e "ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -i $KEY" \
  "${HOST}:/opt/origo/backups/" "$DEST/"

stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s\n' "$stamp" >"$DEST/origo.last_offsite"
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -i "$KEY" "$HOST" \
  "printf '%s\\n' '$stamp' > /opt/origo/backups/origo.last_offsite"

echo "OK $DEST ($(du -sh "$DEST" | cut -f1)) offsite $stamp"
