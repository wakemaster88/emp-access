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

# ─── Audioausgang ─────────────────────────────────────────────────────────────
#
# Der Dienst laeuft als root und erreicht PipeWire nicht: das laeuft in der
# Sitzung des angemeldeten Benutzers. Ohne Mixer bleibt eine Durchsage stumm,
# solange Musik laeuft, weil zwei mpv-Prozesse gleichzeitig auf die Karte
# wollen. Darum wird hier ein ALSA-Mischgeraet (dmix) als Standardausgabe
# eingerichtet – das funktioniert ohne jede Sitzung.

echo ""
echo "→ Audioausgang einrichten..."

# Die Klinke des Pi erscheint nur mit aktiviertem Onboard-Audio.
BOOT_CFG="/boot/firmware/config.txt"
[ ! -f "$BOOT_CFG" ] && BOOT_CFG="/boot/config.txt"
if ! aplay -l 2>/dev/null | grep -q "Headphones" && [ -f "$BOOT_CFG" ]; then
    if ! grep -q "^dtparam=audio=on" "$BOOT_CFG"; then
        echo "dtparam=audio=on" >> "$BOOT_CFG"
        echo "  Onboard-Audio in $BOOT_CFG aktiviert – die Klinke gibt es erst nach einem Neustart."
    fi
fi

# Kartennamen aus `aplay -l`: "card 1: Headphones [bcm2835 Headphones], ..."
CARD_LIST=$(aplay -l 2>/dev/null \
    | sed -nE 's/^card ([0-9]+): ([^ ]+) \[([^]]*)\].*/\2|\3/p' \
    | awk -F'|' '!seen[$1]++' || true)

if [ -z "$CARD_LIST" ]; then
    echo "  Keine Soundkarte gefunden – Ausgang später von Hand einrichten (siehe README-audio.md)."
else
    echo "  Gefundene Soundkarten:"
    CARD_NAMES=()
    USB_INDEX=""
    JACK_INDEX=""
    while IFS='|' read -r short long; do
        [ -z "$short" ] && continue
        CARD_NAMES+=("$short")
        echo "    ${#CARD_NAMES[@]}) $short – $long"
        # Vorauswahl: eine USB-Karte klingt besser als die Klinke, HDMI ist für
        # eine Beschallungszone dagegen fast immer die falsche Wahl. Die usbid
        # unter /proc gibt es nur bei USB-Karten – im Namen steht "USB" oft nicht.
        if [ -e "/proc/asound/$short/usbid" ] && [ -z "$USB_INDEX" ]; then
            USB_INDEX="${#CARD_NAMES[@]}"
        fi
        [ "$short" = "Headphones" ] && JACK_INDEX="${#CARD_NAMES[@]}"
    done <<< "$CARD_LIST"

    DEFAULT_INDEX="${USB_INDEX:-${JACK_INDEX:-1}}"

    read -r -p "  Welche Karte soll die Zone bespielen? [$DEFAULT_INDEX, 0 = nichts ändern] " CARD_CHOICE
    CARD_CHOICE="${CARD_CHOICE:-$DEFAULT_INDEX}"

    if [ "$CARD_CHOICE" = "0" ]; then
        echo "  Audioausgang unverändert gelassen."
    elif [[ "$CARD_CHOICE" =~ ^[0-9]+$ ]] && [ "$CARD_CHOICE" -le "${#CARD_NAMES[@]}" ]; then
        AUDIO_CARD="${CARD_NAMES[$(( CARD_CHOICE - 1 ))]}"

        if [ -f /etc/asound.conf ] && ! grep -q "emp-audio" /etc/asound.conf; then
            cp /etc/asound.conf /etc/asound.conf.bak
            echo "  Bisherige /etc/asound.conf gesichert als /etc/asound.conf.bak"
        fi

        # ipc_perm, damit auch ein Test als normaler Benutzer mitmischen darf.
        cat > /etc/asound.conf << ASOUNDCONF
# emp-audio: Mischgeraet, damit Musik und Durchsage gleichzeitig laufen.
# Von install-audio.sh erzeugt – Aenderungen gehen bei einer Neuinstallation verloren.

pcm.!default {
    type plug
    slave.pcm "emp_mix"
}

pcm.emp_mix {
    type dmix
    ipc_key 2748
    ipc_perm 0666
    slave {
        pcm "hw:CARD=$AUDIO_CARD,DEV=0"
        rate 48000
        channels 2
    }
}

ctl.!default {
    type hw
    card $AUDIO_CARD
}
ASOUNDCONF
        echo "  Mischgerät auf Karte $AUDIO_CARD eingerichtet (/etc/asound.conf)"

        # Frisch aufgesetzte Pis haben den Ausgang oft stumm oder auf null.
        for CTL in Headphone PCM Master Speaker Digital; do
            if amixer -c "$AUDIO_CARD" sget "$CTL" > /dev/null 2>&1; then
                amixer -c "$AUDIO_CARD" sset "$CTL" 90% unmute > /dev/null 2>&1 \
                    && echo "  Regler $CTL auf 90 % und laut geschaltet"
                break
            fi
        done
        alsactl store > /dev/null 2>&1 || true

        # mpv fest auf ALSA nageln: sonst versucht es zuerst PipeWire, das als
        # root nicht erreichbar ist, und landet je nach Fallback woanders.
        if [ -f "$CONFIG_FILE" ]; then
            "$INSTALL_DIR/venv/bin/python" - "$CONFIG_FILE" << 'PYAUDIO'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
data["audio_device"] = "alsa/default"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print("  audio_device auf alsa/default gesetzt")
PYAUDIO
        fi
    else
        echo "  Eingabe nicht verstanden – Audioausgang unverändert gelassen."
    fi
fi

# PipeWire einer Desktop-Sitzung kann die Karte belegen, dann bekommt der Dienst
# sie nicht auf. Auf einem reinen Beschallungs-Pi braucht es PipeWire nicht.
DESKTOP_USER="$(id -nu 1000 2>/dev/null || true)"
if [ -n "$DESKTOP_USER" ] && pgrep -u "$DESKTOP_USER" -x pipewire > /dev/null 2>&1; then
    echo ""
    echo "  Achtung: In der Sitzung von $DESKTOP_USER läuft PipeWire und kann die Karte belegen."
    read -r -p "  PipeWire dort abschalten? [j/N] " DISABLE_PW
    if [[ "$DISABLE_PW" =~ ^[jJyY]$ ]]; then
        PW_UID="$(id -u "$DESKTOP_USER")"
        runuser -u "$DESKTOP_USER" -- env "XDG_RUNTIME_DIR=/run/user/$PW_UID" \
            systemctl --user mask --now \
            pipewire.socket pipewire.service pipewire-pulse.socket pipewire-pulse.service \
            wireplumber.service > /dev/null 2>&1 \
            && echo "  PipeWire abgeschaltet" \
            || echo "  Warnung: PipeWire ließ sich nicht abschalten – siehe README-audio.md"
    fi
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
echo "  Ton testen:      speaker-test -c2 -twav -l1"
echo "  Ausgang ändern:  Skript erneut ausführen (richtet /etc/asound.conf neu ein)"
echo ""
