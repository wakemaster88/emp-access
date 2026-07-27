#!/bin/zsh
# Einmal-Update des Hubs auf origin/main + Neustart.
# Auf dem iMac ausfuehren:  ~/repositories/emp-access/hub/install/update.sh
set -euo pipefail

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$HUB_DIR/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.emp-access.hub.plist"

echo "Repo: $REPO_DIR"
cd "$REPO_DIR"
git fetch origin main
git reset --hard origin/main
echo "HEAD: $(git rev-parse --short HEAD)"

echo "npm install …"
(cd "$HUB_DIR" && npm install --no-audit --no-fund)

if [[ -f "$PLIST" ]]; then
  echo "Hub neu starten …"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Fertig. Version sollte in ~30s im Dashboard stehen."
  echo "Logs: tail -f ~/Library/Logs/emp-hub.log"
else
  echo "WARNUNG: $PLIST fehlt – bitte ./install/install.sh ausfuehren."
fi
