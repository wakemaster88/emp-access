#!/usr/bin/env bash
# Startet go2rtc im Vordergrund mit der aktuellen yaml.
# Beendet einen evtl. bereits laufenden go2rtc-Prozess.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO_DIR/bin/go2rtc"
YAML="$REPO_DIR/infra/go2rtc.yaml"

if [[ ! -x "$BIN" ]]; then
  echo "❌ $BIN nicht gefunden. Bitte zuerst ./scripts/setup.sh ausführen."
  exit 1
fi
if [[ ! -f "$YAML" ]]; then
  echo "ℹ️  Erstelle leere infra/go2rtc.yaml (kann durch /admin gefüllt werden)"
  cp "$REPO_DIR/infra/go2rtc.example.yaml" "$YAML"
fi

# Bestehenden go2rtc abräumen
pkill -f "$BIN" 2>/dev/null || true
sleep 0.3

echo "▶️  $BIN -config $YAML"
exec "$BIN" -config "$YAML"
