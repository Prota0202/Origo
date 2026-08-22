#!/usr/bin/env bash
# Restaure un dump dans la base de production.
# Usage : scripts/restore-db.sh backups/origo-20260809T020000Z.sql.gz
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:-}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

if [[ -z "$DUMP" ]]; then
  echo "Usage : $0 <fichier.sql.gz>" >&2
  echo "Dumps disponibles :" >&2
  ls -1t backups/*.sql.gz 2>/dev/null >&2 || echo "  (aucun)" >&2
  exit 1
fi
[[ -f "$DUMP" ]] || { echo "Fichier introuvable : $DUMP" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE introuvable" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

echo "Ceci REMPLACE le contenu de la base '$POSTGRES_DB' par $DUMP."
read -r -p "Taper RESTAURER pour confirmer : " reponse
[[ "$reponse" == "RESTAURER" ]] || { echo "Annulé."; exit 1; }

# L'API est arrêtée pendant la restauration : éviter qu'elle écrive
# dans une base à moitié remplacée.
echo "→ Arrêt de l'API"
"${COMPOSE[@]}" stop api

echo "→ Restauration"
gunzip -c "$DUMP" | "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "→ Redémarrage de l'API"
"${COMPOSE[@]}" start api

echo "Restauration terminée."
