#!/usr/bin/env bash
# Erste Einrichtung auf macOS. Idempotent.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "🎬 Webcams Dashboard – Setup"
echo "============================"
echo "Repo: $REPO_DIR"
echo ""

# 1) Voraussetzungen
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node fehlt. Installiere mit: brew install node"
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm fehlt. Installiere mit: brew install pnpm"
  exit 1
fi
if [[ ! -x "$REPO_DIR/bin/go2rtc" ]]; then
  echo "📥 go2rtc wird ins Repo geladen (bin/go2rtc) …"
  mkdir -p "$REPO_DIR/bin"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)  ASSET="go2rtc_mac_arm64.zip" ;;
    x86_64) ASSET="go2rtc_mac_amd64.zip" ;;
    *)
      echo "❌ Unbekannte Architektur: $ARCH. Bitte go2rtc manuell ablegen unter bin/go2rtc"
      exit 1
      ;;
  esac
  curl -sSL -o "$REPO_DIR/bin/go2rtc.zip" \
    "https://github.com/AlexxIT/go2rtc/releases/latest/download/$ASSET"
  (cd "$REPO_DIR/bin" && unzip -o go2rtc.zip && rm go2rtc.zip)
  chmod +x "$REPO_DIR/bin/go2rtc"
  echo "✅ go2rtc installiert: $($REPO_DIR/bin/go2rtc -version 2>&1 | head -1)"
else
  echo "✅ go2rtc bereits vorhanden: $($REPO_DIR/bin/go2rtc -version 2>&1 | head -1)"
fi

# 2) Dependencies
echo "📦 pnpm install …"
pnpm install --silent

# 3) Build
echo "🔨 next build …"
pnpm build

# 4) config.json bootstrappen
if [[ ! -f config.json ]]; then
  cat > config.json <<'EOF'
{
  "version": 1,
  "cams": [],
  "widgets": [
    {
      "id": "welcome-clock",
      "type": "clock",
      "title": "Uhrzeit",
      "format": "24h",
      "showSeconds": false,
      "showDate": true,
      "enabled": true,
      "showTitleBar": false
    }
  ],
  "layouts": [],
  "activeLayoutId": null,
  "doorbird": {
    "enabled": false,
    "ip": "",
    "username": "",
    "password": "",
    "webhookSecret": "",
    "ringWindowSec": 90,
    "autoHideSec": 60,
    "relayId": "1",
    "ringSoundUrl": ""
  },
  "settings": {
    "go2rtcUrl": "http://127.0.0.1:1984",
    "adminPin": "",
    "autoRotate": { "enabled": false, "intervalSec": 30, "order": "sequential" },
    "reloadIntervalMin": 0,
    "sirenCooldownSec": 60,
    "sirenMaxDurationSec": 30
  }
}
EOF
  echo "✅ config.json angelegt"
fi

# 5) go2rtc.yaml bootstrappen
if [[ ! -f infra/go2rtc.yaml ]]; then
  cp infra/go2rtc.example.yaml infra/go2rtc.yaml
  echo "✅ infra/go2rtc.yaml angelegt"
fi

echo ""
echo "✅ Setup abgeschlossen."
echo ""
echo "Nächste Schritte:"
echo "  1. Im Browser http://localhost:3000/admin öffnen und Cams + Doorbird konfigurieren."
echo "     Dev-Mode:        pnpm dev"
echo "     Production-Mode: pnpm start"
echo ""
echo "  2. (Optional) Auto-Start beim Login einrichten:"
echo "     ./scripts/install-launchagents.sh"
echo ""
echo "  3. (Optional) Dauerbetriebs-Energieoptionen setzen:"
echo "     ./scripts/energy-setup.sh"
