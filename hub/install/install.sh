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

echo "1/6  npm install …"
(cd "$HUB_DIR" && npm install --no-audit --no-fund)

echo "2/6  Face-Sidecar (InsightFace) …"
if [[ -x "$HUB_DIR/face/install.sh" ]]; then
  chmod +x "$HUB_DIR/face/install.sh"
  "$HUB_DIR/face/install.sh"
else
  echo "     WARNUNG: face/install.sh fehlt – Face-Matching nicht verfügbar"
fi

echo "3/6  ALPR (fast-alpr) …"
if [[ -x "$HUB_DIR/alpr/setup.sh" ]]; then
  chmod +x "$HUB_DIR/alpr/setup.sh"
  "$HUB_DIR/alpr/setup.sh"
else
  echo "     WARNUNG: alpr/setup.sh fehlt – Kennzeichen-Erkennung nicht verfügbar"
fi

echo "4/6  launchd-Plist erzeugen …"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__HUB_DIR__|$HUB_DIR|g" -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$HUB_DIR/install/com.emp-access.hub.plist.template" > "$PLIST_DST"

echo "5/6  Dienst (neu) laden …"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "6/6  Fertig. Logs:"
echo "     tail -f $LOG_DIR/emp-hub.log"
