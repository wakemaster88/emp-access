#!/bin/bash
set -e

# ─── EMP Access Scanner – Installation ───────────────────────────────────────

INSTALL_DIR="/opt/emp-scanner"
REPO_URL="https://github.com/YOUR_USER/emp-access.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════"
echo "  EMP Access Scanner – Installation"
echo "═══════════════════════════════════════"

# Must run as root
if [ "$EUID" -ne 0 ]; then
    echo "Bitte als root ausführen: sudo bash install.sh"
    exit 1
fi

# ─── System packages ─────────────────────────────────────────────────────────

echo ""
echo "→ System-Pakete installieren..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip git

# ─── Setup install directory ──────────────────────────────────────────────────

echo "→ Installationsverzeichnis: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Copy files (if running from cloned repo)
if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
    echo "→ Dateien kopieren..."
    cp -r "$SCRIPT_DIR/"* "$INSTALL_DIR/"
    cp -r "$SCRIPT_DIR/emp_scanner" "$INSTALL_DIR/"
    # Init git in install dir for auto-updates
    if [ -d "$SCRIPT_DIR/../.git" ]; then
        cd "$SCRIPT_DIR/.."
        REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
        if [ -n "$REMOTE" ]; then
            REPO_URL="$REMOTE"
        fi
    fi
fi

# ─── Python venv ──────────────────────────────────────────────────────────────

echo "→ Python Virtual Environment erstellen..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt"

# ─── Git setup for auto-updates ──────────────────────────────────────────────

if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo "→ Git-Repository für Auto-Updates einrichten..."
    cd "$INSTALL_DIR"
    git init -q
    git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
    echo "  Repository: $REPO_URL"
fi

# ─── Systemd services ────────────────────────────────────────────────────────

echo "→ Systemd-Services installieren..."
cp "$INSTALL_DIR/emp-scanner.service" /etc/systemd/system/
cp "$INSTALL_DIR/emp-updater.service" /etc/systemd/system/
cp "$INSTALL_DIR/emp-updater.timer" /etc/systemd/system/

systemctl daemon-reload
systemctl enable emp-scanner
systemctl enable emp-updater.timer

# ─── Start ────────────────────────────────────────────────────────────────────

echo "→ Services starten..."
systemctl start emp-scanner
systemctl start emp-updater.timer

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
