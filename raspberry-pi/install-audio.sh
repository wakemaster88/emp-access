#!/bin/bash
set -e

# ─── EMP Access Audio Player – Installation ──────────────────────────────────

INSTALL_DIR="/opt/emp-audio"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════"
echo "  EMP Access Audio – Installation"
echo "═══════════════════════════════════════"

if [ "$EUID" -ne 0 ]; then
    echo "Bitte als root ausführen: sudo bash install-audio.sh"
    exit 1
fi

# ─── System packages ─────────────────────────────────────────────────────────

echo ""
echo "→ System-Pakete installieren..."
apt-get update -qq || echo "  Warnung: apt-get update fehlgeschlagen, fahre fort..."

PACKAGES="python3 python3-venv python3-pip git mpv alsa-utils"
if ! apt-get install -y -qq $PACKAGES; then
    echo ""
    echo "Fehler: Paketinstallation fehlgeschlagen."
    echo "mpv ist zwingend erforderlich – bitte manuell installieren: sudo apt install mpv"
    exit 1
fi

# Snapcast nur für Zonen, die sich akustisch überlappen und synchron laufen müssen.
read -r -p "Synchrone Wiedergabe über Snapcast nutzen? [j/N] " USE_SNAPCAST
SNAPSERVER_HOST=""
if [[ "$USE_SNAPCAST" =~ ^[jJyY]$ ]]; then
    apt-get install -y -qq snapclient || echo "  Warnung: snapclient nicht verfügbar"
    read -r -p "  Hostname oder IP des Snapservers: " SNAPSERVER_HOST
fi

# ─── Detect repo URL from parent git ─────────────────────────────────────────

REPO_URL=""
if [ -d "$SCRIPT_DIR/../.git" ]; then
    REPO_URL=$(git -C "$SCRIPT_DIR/.." remote get-url origin 2>/dev/null || echo "")
fi
if [ -z "$REPO_URL" ]; then
    REPO_URL="https://github.com/wakemaster88/emp-access.git"
fi
echo "  Repository: $REPO_URL"

# ─── Clone or update repo ────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
    echo "→ Bestehendes Repository aktualisieren..."
    cd "$INSTALL_DIR"
    git remote set-url origin "$REPO_URL"
    if git fetch origin && git reset --hard origin/main; then
        : # Update OK
    else
        echo "  Update fehlgeschlagen, versuche Neuinstallation..."
        systemctl stop emp-audio 2>/dev/null || true
        systemctl stop emp-audio-updater.timer 2>/dev/null || true
        cd /
        rm -rf "$INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
else
    echo "→ Repository klonen..."
    systemctl stop emp-audio 2>/dev/null || true
    systemctl stop emp-audio-updater.timer 2>/dev/null || true
    rm -rf "$INSTALL_DIR" 2>/dev/null || true
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ─── Python venv ──────────────────────────────────────────────────────────────

echo "→ Python Virtual Environment erstellen..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/raspberry-pi/requirements-audio.txt"

# ─── Cache-Verzeichnis ────────────────────────────────────────────────────────

echo "→ Cache-Verzeichnis anlegen..."
mkdir -p /var/lib/emp-audio/cache

# ─── Konfiguration ────────────────────────────────────────────────────────────

CONFIG_FILE="$INSTALL_DIR/raspberry-pi/audio-config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo "→ Konfiguration"
    echo "  Das JSON steht im Dashboard unter Gerätedetails (gleicher Inhalt wie der QR-Code)."
    read -r -p "  Konfigurations-JSON: " SETUP_JSON
    if [ -n "$SETUP_JSON" ]; then
        ( cd "$INSTALL_DIR/raspberry-pi" && \
          "$INSTALL_DIR/venv/bin/python" -m emp_audio.setup "$SETUP_JSON" ) || \
          echo "  Konfiguration fehlgeschlagen – später nachholen (siehe unten)."
    fi
fi

# Snapserver-Host nachtragen, ohne die restliche Konfiguration zu überschreiben.
if [ -n "$SNAPSERVER_HOST" ] && [ -f "$CONFIG_FILE" ]; then
    "$INSTALL_DIR/venv/bin/python" - "$CONFIG_FILE" "$SNAPSERVER_HOST" << 'PYCFG'
import json, sys
path, host = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data["snapserver_host"] = host
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print(f"  Snapserver eingetragen: {host}")
PYCFG
fi

# ─── Systemd services ────────────────────────────────────────────────────────

echo "→ Systemd-Services installieren..."
cp "$INSTALL_DIR/raspberry-pi/emp-audio.service" /etc/systemd/system/
cp "$INSTALL_DIR/raspberry-pi/emp-audio-updater.service" /etc/systemd/system/
cp "$INSTALL_DIR/raspberry-pi/emp-audio-updater.timer" /etc/systemd/system/

systemctl daemon-reload
systemctl enable emp-audio
systemctl enable emp-audio-updater.timer

# ─── Start ────────────────────────────────────────────────────────────────────

echo "→ Services starten..."
systemctl restart emp-audio
systemctl restart emp-audio-updater.timer

echo ""
echo "═══════════════════════════════════════"
echo "  Installation abgeschlossen!"
echo "═══════════════════════════════════════"
echo ""
echo "  Audio-Service:  systemctl status emp-audio"
echo "  Logs ansehen:   journalctl -u emp-audio -f"
echo ""
if [ ! -f "$CONFIG_FILE" ]; then
    echo "  Noch nicht konfiguriert! Nachholen mit:"
    echo "    cd $INSTALL_DIR/raspberry-pi"
    echo "    sudo $INSTALL_DIR/venv/bin/python -m emp_audio.setup '<JSON>'"
    echo "    sudo systemctl restart emp-audio"
    echo ""
fi
echo "  Audioausgabe testen: speaker-test -c2 -twav"
echo "  Ausgabegerät wählen: audio_device in audio-config.json (z. B. alsa/hw:1,0)"
echo ""
