#!/usr/bin/env bash
# Installe le pull des dumps VPS → ce Mac (toutes les 20 min).
# Usage : ./scripts/install-pull-backups-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COPIE="$HOME/.origo/bin/pull-backups.sh"
DEST_DIR="${ORIGO_BACKUP_DEST:-$HOME/.origo/backups}"
PLIST="$HOME/Library/LaunchAgents/be.origo.pull-backups.plist"
LABEL="be.origo.pull-backups"

mkdir -p "$DEST_DIR" "$HOME/.origo/bin" "$HOME/Library/LaunchAgents"
cp "$ROOT/scripts/pull-backups.sh" "$COPIE"
chmod +x "$COPIE"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${COPIE}</string>
  </array>
  <key>StartInterval</key>
  <integer>1200</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.origo/pull-backups.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.origo/pull-backups.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>ORIGO_BACKUP_DEST</key>
    <string>${DEST_DIR}</string>
    <key>ORIGO_VPS_HOST</key>
    <string>${ORIGO_VPS_HOST:-origo-vps}</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Tâche Mac installée : dumps VPS → ${DEST_DIR} toutes les 20 min."
echo "Logs : ~/.origo/pull-backups.log"
