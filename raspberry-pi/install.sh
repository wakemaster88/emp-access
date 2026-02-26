#!/bin/bash
set -e

# ─── EMP Access Scanner – Installation ───────────────────────────────────────

INSTALL_DIR="/opt/emp-scanner"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════"
echo "  EMP Access Scanner – Installation"
echo "═══════════════════════════════════════"

if [ "$EUID" -ne 0 ]; then
    echo "Bitte als root ausführen: sudo bash install.sh"
    exit 1
fi

# ─── System packages ─────────────────────────────────────────────────────────

echo ""
echo "→ System-Pakete installieren..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip git

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
    git fetch origin
    git reset --hard origin/main
else
    echo "→ Repository klonen..."
    rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ─── Python venv ──────────────────────────────────────────────────────────────

echo "→ Python Virtual Environment erstellen..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/raspberry-pi/requirements.txt"

# ─── Hardware Watchdog ────────────────────────────────────────────────────────

echo "→ Hardware-Watchdog aktivieren..."
if ! grep -q "dtparam=watchdog=on" /boot/firmware/config.txt 2>/dev/null && \
   ! grep -q "dtparam=watchdog=on" /boot/config.txt 2>/dev/null; then
    BOOT_CFG="/boot/firmware/config.txt"
    [ ! -f "$BOOT_CFG" ] && BOOT_CFG="/boot/config.txt"
    echo "dtparam=watchdog=on" >> "$BOOT_CFG"
    echo "  Hardware-Watchdog in $BOOT_CFG aktiviert"
fi

if [ ! -f /etc/watchdog.conf ] || ! grep -q "^watchdog-device" /etc/watchdog.conf; then
    apt-get install -y -qq watchdog
    cat > /etc/watchdog.conf << 'WDCONF'
watchdog-device = /dev/watchdog
watchdog-timeout = 15
max-load-1 = 24
WDCONF
    systemctl enable watchdog
    systemctl start watchdog
    echo "  System-Watchdog konfiguriert (15s Timeout)"
fi

# ─── Systemd services ────────────────────────────────────────────────────────

echo "→ Systemd-Services installieren..."
cp "$INSTALL_DIR/raspberry-pi/emp-scanner.service" /etc/systemd/system/
cp "$INSTALL_DIR/raspberry-pi/emp-updater.service" /etc/systemd/system/
cp "$INSTALL_DIR/raspberry-pi/emp-updater.timer" /etc/systemd/system/

systemctl daemon-reload
systemctl enable emp-scanner
systemctl enable emp-updater.timer

# ─── Start ────────────────────────────────────────────────────────────────────

echo "→ Services starten..."
systemctl restart emp-scanner
systemctl restart emp-updater.timer

echo ""
echo "═══════════════════════════════════════"
echo "  Installation abgeschlossen!"
echo "═══════════════════════════════════════"
echo ""
echo "  Scanner-Service:  systemctl status emp-scanner"
echo "  Logs ansehen:     journalctl -u emp-scanner -f"
echo "  Update-Timer:     systemctl status emp-updater.timer"
echo ""
echo "  Nächster Schritt: Konfigurations-QR-Code scannen"
echo "  (aus dem Dashboard unter Gerätedetails)"
echo ""
