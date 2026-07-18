#!/bin/zsh
# Installiert den EMP-Access-Hub als launchd-Dienst auf macOS.
# Aufruf aus dem hub/-Ordner:  ./install/install.sh
set -euo pipefail

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs"
PLIST_DST="$HOME/Library/LaunchAgents/com.emp-access.hub.plist"

if [[ ! -f "$HUB_DIR/.env" ]]; then
  echo "FEHLER: $HUB_DIR/.env fehlt. Bitte .env.example kopieren und ausfüllen."
  exit 1
fi

echo "1/4  npm install …"
(cd "$HUB_DIR" && npm install --no-audit --no-fund)

echo "2/4  launchd-Plist erzeugen …"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__HUB_DIR__|$HUB_DIR|g" -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$HUB_DIR/install/com.emp-access.hub.plist.template" > "$PLIST_DST"

echo "3/4  Dienst (neu) laden …"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "4/4  Fertig. Logs:"
echo "     tail -f $LOG_DIR/emp-hub.log"
