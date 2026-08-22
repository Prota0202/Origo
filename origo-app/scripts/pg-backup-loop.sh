#!/bin/sh
# Dump Postgres à intervalle régulier, avec rétention.
# Tourne dans un conteneur `restart: unless-stopped` : reprend après reboot du serveur.
#
# Sert aux deux bases :
#   - ORIGO       : BACKUP_PREFIX=origo (défaut)
#   - Odoo        : BACKUP_PREFIX=odoo + BACKUP_FILESTORE_DIR=/filestore
#
# Le filestore d'Odoo (pièces jointes, PDF de factures) n'est PAS dans Postgres.
# Un dump de base seul restaurerait une comptabilité dont tous les documents ont
# disparu : quand BACKUP_FILESTORE_DIR est renseigné, on l'archive avec le dump.
set -eu

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
PREFIX="${BACKUP_PREFIX:-origo}"
FILESTORE="${BACKUP_FILESTORE_DIR:-}"
UPLOADS="${BACKUP_UPLOADS_DIR:-}"
OFFSITE="${BACKUP_OFFSITE_DIR:-}"
DEST=/backups

mkdir -p "$DEST"
echo "[backup:$PREFIX] dump toutes les ${INTERVAL}s, rétention ${RETENTION} jours"
[ -n "$FILESTORE" ] && echo "[backup:$PREFIX] filestore inclus depuis $FILESTORE"
[ -n "$UPLOADS" ] && echo "[backup:$PREFIX] photos incluses depuis $UPLOADS"
[ -n "$OFFSITE" ] && echo "[backup:$PREFIX] copie offsite vers $OFFSITE"

while true; do
  horodatage=$(date -u +%Y%m%dT%H%M%SZ)
  cible="$DEST/$PREFIX-$horodatage.sql.gz"
  echec=0
  archive_uploads=""

  # --clean --if-exists : le dump peut être rejoué sur une base existante
  if pg_dump --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip >"$cible.partiel"; then
    mv "$cible.partiel" "$cible"
    echo "[backup:$PREFIX] OK $cible ($(du -h "$cible" | cut -f1))"
  else
    rm -f "$cible.partiel"
    echo "[backup:$PREFIX] ECHEC dump $horodatage" >&2
    echec=1
  fi

  if [ -n "$FILESTORE" ] && [ "$echec" -eq 0 ]; then
    archive="$DEST/$PREFIX-filestore-$horodatage.tar.gz"
    if tar -czf "$archive.partiel" -C "$FILESTORE" . 2>/dev/null; then
      mv "$archive.partiel" "$archive"
      echo "[backup:$PREFIX] OK $archive ($(du -h "$archive" | cut -f1))"
    else
      rm -f "$archive.partiel"
      echo "[backup:$PREFIX] ECHEC filestore $horodatage" >&2
      echec=1
    fi
  fi

  if [ -n "$UPLOADS" ] && [ -d "$UPLOADS" ] && [ "$echec" -eq 0 ]; then
    archive_uploads="$DEST/$PREFIX-uploads-$horodatage.tar.gz"
    if tar -czf "$archive_uploads.partiel" -C "$UPLOADS" .; then
      mv "$archive_uploads.partiel" "$archive_uploads"
      echo "[backup:$PREFIX] OK $archive_uploads ($(du -h "$archive_uploads" | cut -f1))"
    else
      rm -f "$archive_uploads.partiel"
      echo "[backup:$PREFIX] ECHEC photos $horodatage" >&2
      archive_uploads=""
      echec=1
    fi
  fi

  if [ -n "$OFFSITE" ] && [ "$echec" -eq 0 ]; then
    if [ ! -d "$OFFSITE" ]; then
      echo "[backup:$PREFIX] ECHEC offsite : $OFFSITE n'existe pas" >&2
      echec=1
    elif ! cp "$cible" "$OFFSITE/"; then
      echo "[backup:$PREFIX] ECHEC copie dump offsite" >&2
      echec=1
    else
      if [ -n "$archive_uploads" ] && ! cp "$archive_uploads" "$OFFSITE/"; then
        echo "[backup:$PREFIX] ECHEC copie photos offsite" >&2
        echec=1
      else
        echo "[backup:$PREFIX] OK copie offsite $OFFSITE"
      fi
    fi
  fi

  if [ "$echec" -eq 0 ]; then
    date -u +%Y-%m-%dT%H:%M:%SZ >"$DEST/${PREFIX}.last_ok"
  else
    date -u +%Y-%m-%dT%H:%M:%SZ >"$DEST/${PREFIX}.last_fail"
  fi

  find "$DEST" -name "$PREFIX-*.sql.gz" -type f -mtime "+$RETENTION" -delete
  find "$DEST" -name "$PREFIX-filestore-*.tar.gz" -type f -mtime "+$RETENTION" -delete
  find "$DEST" -name "$PREFIX-uploads-*.tar.gz" -type f -mtime "+$RETENTION" -delete
  find "$DEST" -name '*.partiel' -type f -mtime +1 -delete
  if [ -n "$OFFSITE" ] && [ -d "$OFFSITE" ]; then
    find "$OFFSITE" -name "$PREFIX-*.sql.gz" -type f -mtime "+$RETENTION" -delete
    find "$OFFSITE" -name "$PREFIX-uploads-*.tar.gz" -type f -mtime "+$RETENTION" -delete
  fi

  sleep "$INTERVAL"
done
