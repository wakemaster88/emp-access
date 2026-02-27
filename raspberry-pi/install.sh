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

# ─── Buster-Repo automatisch auf Legacy umstellen (bei 404) ───────────────────

fix_buster_sources() {
    local codename
    codename=$(lsb_release -cs 2>/dev/null || grep -E '^VERSION_CODENAME=' /etc/os-release 2>/dev/null | cut -d= -f2 || echo "")
    if [ "$codename" != "buster" ]; then
        return 1
    fi
    if grep -q "raspbian.raspberrypi.org" /etc/apt/sources.list 2>/dev/null || \
       grep -q "raspbian.raspberrypi.org" /etc/apt/sources.list.d/raspi.list 2>/dev/null; then
        echo "  Buster erkannt, stelle Repo-Quellen auf legacy.raspbian.org um..."
        echo 'deb https://legacy.raspbian.org/raspbian/ buster main contrib non-free rpi' > /etc/apt/sources.list
        mkdir -p /etc/apt/sources.list.d
        echo 'deb http://archive.raspberrypi.org/debian buster main' > /etc/apt/sources.list.d/raspi.list
        return 0
    fi
    return 1
}

# ─── System packages ─────────────────────────────────────────────────────────

echo ""
echo "→ System-Pakete installieren..."
if ! apt-get update -qq 2>/dev/null; then
    echo "  Warnung: apt-get update fehlgeschlagen."
    if fix_buster_sources; then
        echo "  Führe apt-get update erneut aus..."
        apt-get update -qq || true
    fi
fi

PACKAGES="python3 python3-venv python3-pip python3-dev git swig build-essential"
if ! apt-get install -y -qq $PACKAGES 2>/dev/null; then
    echo "  Paketinstallation fehlgeschlagen, versuche automatische Repo-Korrektur für Buster..."
    if fix_buster_sources; then
        echo "  apt-get update und erneute Paketinstallation..."
        apt-get update -qq
        apt-get install -y -qq $PACKAGES || {
            echo ""
            echo "Fehler: Paketinstallation fehlgeschlagen (auch nach Repo-Umstellung)."
            echo "TeamViewer-Repo ggf. entfernen: sudo rm /etc/apt/sources.list.d/teamviewer.list"
            echo "Details: raspberry-pi/README.md → Fehlerbehebung"
            exit 1
        }
    else
        echo ""
        echo "Fehler: Paketinstallation fehlgeschlagen."
        echo "Bei Raspberry Pi OS Buster: Repo-Quellen manuell auf legacy.raspbian.org umstellen (siehe README)."
        echo "Weitere Ursachen: TeamViewer-Repo entfernen (siehe README Fehlerbehebung)."
        exit 1
    fi
fi

# liblgpio für Python-Paket lgpio (Build braucht -llgpio); unter Buster ggf. nicht verfügbar
if ! apt-get install -y -qq liblgpio-dev 2>/dev/null; then
    # Fallback: lg-Bibliothek aus Quellcode bauen (z.B. Buster ohne liblgpio-dev)
    if ! ldconfig -p 2>/dev/null | grep -q liblgpio; then
        echo "  liblgpio-dev nicht verfügbar, baue lg-Bibliothek aus Quellcode..."
        BUILD_DIR=$(mktemp -d)
        if ( apt-get install -y -qq wget unzip 2>/dev/null && \
             wget -q -O "$BUILD_DIR/lg.zip" "http://abyz.me.uk/lg/lg.zip" && \
             unzip -q -o "$BUILD_DIR/lg.zip" -d "$BUILD_DIR" && \
             cd "$BUILD_DIR/lg" && make && make install ) 2>/dev/null; then
            ldconfig 2>/dev/null || true
            echo "  lg-Bibliothek installiert."
        fi
        rm -rf "$BUILD_DIR"
      fi
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
        systemctl stop emp-scanner 2>/dev/null || true
        systemctl stop emp-updater.timer 2>/dev/null || true
        cd /
        rm -rf "$INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
else
    echo "→ Repository klonen..."
    systemctl stop emp-scanner 2>/dev/null || true
    systemctl stop emp-updater.timer 2>/dev/null || true
    rm -rf "$INSTALL_DIR" 2>/dev/null || true
    if [ -d "$INSTALL_DIR" ]; then
        echo "  Ordner wird belegt, verschiebe nach ${INSTALL_DIR}.old..."
        mv "$INSTALL_DIR" "${INSTALL_DIR}.old"
    fi
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ─── Python venv ──────────────────────────────────────────────────────────────

echo "→ Python Virtual Environment erstellen..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip

# lgpio-Build findet liblgpio in /usr/local (z. B. nach Quellcode-Build); Pfade setzen
export LDFLAGS="-L/usr/local/lib ${LDFLAGS:-}"
export CPPFLAGS="-I/usr/local/include ${CPPFLAGS:-}"
export LD_LIBRARY_PATH="/usr/local/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/raspberry-pi/requirements.txt" || {
    echo "  pip install fehlgeschlagen (evtl. lgpio). Erneuter Versuch mit expliziten Pfaden..."
    export LDFLAGS="-L/usr/local/lib -Wl,-rpath,/usr/local/lib ${LDFLAGS:-}"
    export CPPFLAGS="-I/usr/local/include ${CPPFLAGS:-}"
    export LD_LIBRARY_PATH="/usr/local/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    "$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/raspberry-pi/requirements.txt" || {
        echo ""
        echo "Fehler: Python-Abhängigkeiten (lgpio) konnten nicht gebaut werden."
        echo "Unter Buster: lg-Bibliothek wird aus Quellcode gebaut; LDFLAGS/CPPFLAGS sollten gesetzt sein."
        echo "Falls das Problem bleibt: Raspberry Pi OS auf Bullseye/Bookworm upgraden (dort ist liblgpio-dev verfügbar)."
        exit 1
    }
}

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
    if apt-get install -y -qq watchdog 2>/dev/null; then
        cat > /etc/watchdog.conf << 'WDCONF'
watchdog-device = /dev/watchdog
watchdog-timeout = 15
max-load-1 = 24
WDCONF
        systemctl enable watchdog
        systemctl start watchdog
        echo "  System-Watchdog konfiguriert (15s Timeout)"
    else
        echo "  Warnung: watchdog konnte nicht installiert werden (optional)."
    fi
fi

# ─── Systemd services ────────────────────────────────────────────────────────

echo "→ Systemd-Services installieren..."
# emp-scanner.service fest schreiben (vermeidet Tippfehler bei Kopie)
cat > /etc/systemd/system/emp-scanner.service << 'EMPSVC'
[Unit]
Description=EMP Access Scanner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/emp-scanner/raspberry-pi
ExecStart=/opt/emp-scanner/venv/bin/python -m emp_scanner.main
Restart=always
RestartSec=5
WatchdogSec=120
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EMPSVC
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
