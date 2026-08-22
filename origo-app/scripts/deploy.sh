#!/usr/bin/env bash
# Déploiement / mise à jour de la stack production.
# Usage sur le serveur : ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILES=(-f docker-compose.prod.yml)

[[ -f "$ENV_FILE" ]] || {
  echo "$ENV_FILE manquant. Copie .env.prod.example et remplis-le." >&2
  exit 1
}

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

WITH_ODOO="${WITH_ODOO:-0}"

if [[ "$WITH_ODOO" == "1" ]]; then
  COMPOSE_FILES+=(-f docker-compose.odoo.yml)
fi
if [[ -n "${BACKUP_OFFSITE_HOST_DIR:-}" ]]; then
  COMPOSE_FILES+=(-f docker-compose.prod.offsite.yml)
  if [[ "$WITH_ODOO" == "1" ]]; then
    COMPOSE_FILES+=(-f docker-compose.odoo.offsite.yml)
  fi
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}")

echo "→ Vérification de la configuration"
erreurs=0
verifier() {
  local nom="$1" valeur="${2:-}" min="${3:-1}"
  if [[ -z "$valeur" ]]; then
    echo "  MANQUANT : $nom" >&2; erreurs=1
  elif (( ${#valeur} < min )); then
    echo "  TROP COURT : $nom (≥ $min caractères)" >&2; erreurs=1
  fi
}
verifier POSTGRES_USER "${POSTGRES_USER:-}"
verifier POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}" 16
verifier POSTGRES_DB "${POSTGRES_DB:-}"
verifier JWT_SECRET "${JWT_SECRET:-}" 32
verifier SITE_ADDRESS "${SITE_ADDRESS:-}"
verifier CORS_ORIGIN "${CORS_ORIGIN:-}"

if printf '%s' "${POSTGRES_PASSWORD:-}" | grep -Eq '[@:/?#%[:space:]]'; then
  echo "  POSTGRES_PASSWORD contient un caractère interdit (@ : / ? # espace). Utilise : openssl rand -hex 24" >&2
  erreurs=1
fi

case "${JWT_SECRET:-}" in
  *change-moi*|*dev-origo*) echo "  JWT_SECRET est encore un placeholder" >&2; erreurs=1 ;;
esac
if [[ "${SEED_ON_START:-0}" == "1" ]]; then
  echo "  SEED_ON_START=1 effacerait toutes les données : à retirer en production" >&2
  erreurs=1
fi
if [[ "${CORS_ORIGIN:-}" == *localhost* && "${SITE_ADDRESS:-}" != :* ]]; then
  echo "  CORS_ORIGIN pointe vers localhost alors que le site est public" >&2
  erreurs=1
fi
if [[ "${SITE_ADDRESS:-}" != :* && "${CORS_ORIGIN:-}" != https://* ]]; then
  echo "  CORS_ORIGIN doit être en https:// (même origine que SITE_ADDRESS)" >&2
  erreurs=1
fi
if [[ "${SITE_ADDRESS:-}" != :* && -z "${ACME_EMAIL:-}" ]]; then
  echo "  ACME_EMAIL manquant (Let's Encrypt envoie l'expiration du certificat là)" >&2
  erreurs=1
fi
if [[ "${BOOTSTRAP_ADMIN:-0}" == "1" ]]; then
  verifier ADMIN_PASSWORD "${ADMIN_PASSWORD:-}" 12
  case "${ADMIN_PASSWORD:-}" in
    admin2026|prepa2026|livreur2026|1234|password|admin|origo)
      echo "  ADMIN_PASSWORD est un mot de passe de démo" >&2
      erreurs=1
      ;;
  esac
fi

if [[ "$WITH_ODOO" == "1" ]]; then
  verifier ODOO_SITE_ADDRESS "${ODOO_SITE_ADDRESS:-}"
  verifier ODOO_PG_PASSWORD "${ODOO_PG_PASSWORD:-}" 16
  verifier ODOO_DB "${ODOO_DB:-}"
  if printf '%s' "${ODOO_PG_PASSWORD:-}" | grep -Eq '[@:/?#%[:space:]]'; then
    echo "  ODOO_PG_PASSWORD contient un caractère interdit. Utilise : openssl rand -hex 24" >&2
    erreurs=1
  fi
  if [[ "${ODOO_URL:-}" == *origo.odoo.com* ]]; then
    echo "  WITH_ODOO=1 (Odoo sur ce VPS) mais ODOO_URL pointe vers origo.odoo.com — un seul Odoo, pas les deux." >&2
    erreurs=1
  fi
if [[ -z "${ODOO_URL:-}" ]]; then
    echo "  ODOO_URL vide : mets http://odoo:8069 (réseau Docker interne)" >&2
    erreurs=1
  fi
  verifier ODOO_ADMIN_PASSWORD "${ODOO_ADMIN_PASSWORD:-}" 12
fi

(( erreurs == 0 )) || { echo "Déploiement annulé." >&2; exit 1; }
echo "  OK"

if [[ -z "${BACKUP_OFFSITE_HOST_DIR:-}" && "${SITE_ADDRESS:-}" != :* ]]; then
  echo
  echo "  ATTENTION : BACKUP_OFFSITE_HOST_DIR est vide."
  echo "  Les dumps restent sur CE serveur. Filet : snapshots Contabo + pull-backups.sh vers le Mac."
  echo
fi

mkdir -p backups

echo "→ Build et démarrage"
"${COMPOSE[@]}" up -d --build

echo "→ Attente de l'API"
for i in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:3001/api/v1/ready >/dev/null 2>&1; then
    echo "  API prête (DB connectée)"
    break
  fi
  if (( i == 60 )); then
    echo "  L'API ne répond pas — logs :" >&2
    "${COMPOSE[@]}" logs --tail 50 api >&2
    exit 1
  fi
  sleep 2
done

echo "→ Vérification du reverse proxy"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/ || echo 000)
case "$code" in
  200|301|302|308) echo "  Caddy répond (HTTP $code)" ;;
  *)
    echo "  Caddy ne répond pas sur le port 80 (HTTP $code) — logs :" >&2
    "${COMPOSE[@]}" logs --tail 30 web >&2
    exit 1
    ;;
esac

if [[ "$WITH_ODOO" == "1" ]]; then
  echo "→ Attente d'Odoo"
  for i in $(seq 1 90); do
    if "${COMPOSE[@]}" exec -T odoo python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8069/web/health', timeout=5).status==200 else 1)" >/dev/null 2>&1; then
      echo "  Odoo répond"
      break
    fi
    if (( i == 90 )); then
      echo "  Odoo ne répond pas — logs :" >&2
      "${COMPOSE[@]}" logs --tail 50 odoo >&2
      exit 1
    fi
    sleep 2
  done

  echo "→ Base Odoo"
  existe=$("${COMPOSE[@]}" exec -T odoo-db psql -U "${ODOO_PG_USER:-odoo}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${ODOO_DB}'" 2>/dev/null || true)
  if [[ "$existe" != "1" ]]; then
    echo "  Première initialisation (quelques minutes)…"
    "${COMPOSE[@]}" run --rm --no-deps odoo odoo \
      -d "$ODOO_DB" \
      -i base,sale_management,stock,account,l10n_be,account_peppol \
      --stop-after-init \
      --without-demo=all \
      --load-language=fr_FR
    echo "  Base $ODOO_DB créée."
    if [[ -n "${ODOO_ADMIN_PASSWORD:-}" ]]; then
      echo "  Mot de passe admin Odoo…"
      "${COMPOSE[@]}" exec -T -e NEW_PWD="$ODOO_ADMIN_PASSWORD" odoo \
        odoo shell -d "$ODOO_DB" --no-http <<'PY'
import os
env['res.users'].browse(2).write({'password': os.environ['NEW_PWD']})
env.cr.commit()
print('ok')
PY
    else
      echo "  ATTENTION : login Odoo = admin / admin — change-le tout de suite sur ${ODOO_SITE_ADDRESS}"
    fi
  else
    echo "  Base $ODOO_DB déjà là"
  fi
fi

echo "→ Premier dump Postgres"
for i in $(seq 1 30); do
  if [[ -f backups/origo.last_ok ]]; then
    echo "  Dump OK ($(cat backups/origo.last_ok))"
    break
  fi
  if [[ -f backups/origo.last_fail ]]; then
    echo "  Le dump initial a échoué — logs backup :" >&2
    "${COMPOSE[@]}" logs --tail 30 backup >&2
    exit 1
  fi
  if (( i == 30 )); then
    echo "  Pas encore de marqueur dump (le job démarre). Vérifie : docker compose logs backup" >&2
  fi
  sleep 2
done

"${COMPOSE[@]}" ps

echo
echo "Déployé."
echo "  ORIGO : ${SITE_ADDRESS}"
if [[ "$WITH_ODOO" == "1" ]]; then
  echo "  Odoo  : ${ODOO_SITE_ADDRESS}"
  if [[ -z "${ODOO_API_KEY:-}" ]]; then
    echo "  Ensuite : connecte-toi à Odoo, crée une clé API (compte système, sans expiration),"
    echo "  mets ODOO_API_KEY dans $ENV_FILE, relance ./scripts/deploy.sh — puis Tableau de bord → Envoyer le catalogue."
  fi
fi
if [[ "${BOOTSTRAP_ADMIN:-0}" == "1" ]]; then
  echo "IMPORTANT : remets BOOTSTRAP_ADMIN=0 dans $ENV_FILE, sinon le mot de passe direction est réécrit à chaque redémarrage."
fi
echo "Logs      : docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} logs -f"
echo "Backups   : ./backups"
if [[ -n "${BACKUP_OFFSITE_HOST_DIR:-}" ]]; then
  echo "Offsite   : $BACKUP_OFFSITE_HOST_DIR"
fi
