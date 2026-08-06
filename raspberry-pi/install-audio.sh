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

# AirPlay und Bluetooth: Empfänger, über die ein Handy die Zone übernehmen darf.
# Die Wiedergabe schaltet das Dashboard erst frei, wenn der Abspieler die hier
# installierten Dienste im Heartbeat gemeldet hat.
USE_AIRPLAY=""
read -r -p "AirPlay-Empfang einrichten (Senden vom iPhone/Mac)? [j/N] " USE_AIRPLAY
if [[ "$USE_AIRPLAY" =~ ^[jJyY]$ ]]; then
    if apt-get install -y -qq shairport-sync; then
        # Der Dienst des Pakets brächte seine eigene Konfiguration mit und würde
        # sich die Soundkarte greifen. Gesteuert wird ausschließlich emp-airplay.
        systemctl disable --now shairport-sync 2>/dev/null || true
        USE_AIRPLAY="j"
    else
        echo "  Warnung: shairport-sync nicht verfügbar – AirPlay bleibt aus"
        USE_AIRPLAY=""
    fi
fi

USE_BLUETOOTH=""
read -r -p "Bluetooth-Empfang einrichten (Kopplung per Dashboard)? [j/N] " USE_BLUETOOTH
if [[ "$USE_BLUETOOTH" =~ ^[jJyY]$ ]]; then
    if apt-get install -y -qq bluez bluez-alsa-utils bluez-tools; then
        USE_BLUETOOTH="j"
    else
        echo "  Warnung: bluez-alsa-utils nicht verfügbar – Bluetooth bleibt aus"
        USE_BLUETOOTH=""
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

        # Karten mit mehreren Subdevices – die Klinke des Pi hat acht – mischen
        # im Treiber. dmix waere dort nicht nur unnoetig, es scheitert an den
        # Pufferparametern des bcm2835 ("unable to open slave").
        SUBDEVS="$(sed -nE 's/^subdevices_count: *([0-9]+).*/\1/p' \
            "/proc/asound/$AUDIO_CARD/pcm0p/info" 2>/dev/null | head -1)"
        SUBDEVS="${SUBDEVS:-1}"

        cat > /etc/asound.conf << ASOUNDHEAD
# emp-audio: Standardausgabe fuer Musik und Durchsagen.
# Von install-audio.sh erzeugt – Aenderungen gehen bei einer Neuinstallation verloren.
#
# Aufbau:
#   emp_out      – gemeinsamer Ausgang, auf dem alles zusammenlaeuft
#   !default     – Musik und Durchsagen (mpv)
#   emp_external – AirPlay und Bluetooth, mit regelbarem Pegel davor

ASOUNDHEAD

        if [ "$SUBDEVS" -gt 1 ]; then
            cat >> /etc/asound.conf << ASOUNDCONF
# Karte $AUDIO_CARD bietet $SUBDEVS Subdevices und mischt selbst – plug sorgt nur
# noch fuer die Umrechnung von Rate und Format.
pcm.emp_out {
    type hw
    card "$AUDIO_CARD"
    device 0
}
ASOUNDCONF
            echo "  Ausgabe auf Karte $AUDIO_CARD eingerichtet – sie mischt selbst ($SUBDEVS Subdevices)"
        else
            cat >> /etc/asound.conf << ASOUNDCONF
# Karte $AUDIO_CARD nimmt nur einen Strom an, deshalb mischt dmix davor.
# ipc_perm, damit auch ein Test als normaler Benutzer mitmischen darf.
pcm.emp_out {
    type dmix
    ipc_key 2748
    ipc_perm 0666
    slave {
        pcm "hw:CARD=$AUDIO_CARD,DEV=0"
        period_size 1024
        buffer_size 8192
        rate 48000
        channels 2
    }
}
ASOUNDCONF
            echo "  Mischgerät auf Karte $AUDIO_CARD eingerichtet (dmix, ein Subdevice)"
        fi

        cat >> /etc/asound.conf << ASOUNDEXT

pcm.!default {
    type plug
    slave.pcm "emp_out"
}

# AirPlay und Bluetooth geben hier aus. Der softvol-Regler ist der einzige
# Griff, mit dem sich ein fremder Prozess absenken laesst: einen Steuersocket
# wie mpv hat er nicht. Ohne ihn wuerde eine Durchsage im Sender untergehen.
#
# Der Regler entsteht erst, wenn das Geraet einmal geoeffnet wurde – vorher
# findet amixer ihn nicht. Darum die Stille weiter unten.
pcm.emp_external {
    type plug
    slave.pcm {
        type softvol
        slave.pcm "emp_out"
        control {
            name "EmpExternal"
            card "$AUDIO_CARD"
        }
        max_dB 0.0
    }
}

ctl.!default {
    type hw
    card $AUDIO_CARD
}
ASOUNDEXT

        # Regler anlegen und aufdrehen: ein Bruchteil Stille genuegt, um das
        # Geraet einmal zu oeffnen.
        head -c 8192 /dev/zero \
            | aplay -D emp_external -q -t raw -f S16_LE -r 48000 -c 2 > /dev/null 2>&1 || true
        if amixer -q sset EmpExternal 100% > /dev/null 2>&1; then
            echo "  Regelbarer Zweig emp_external eingerichtet (Ducking für AirPlay/Bluetooth)"
        else
            echo "  Warnung: Regler EmpExternal ließ sich nicht anlegen – Durchsagen"
            echo "           würden gegen AirPlay/Bluetooth untergehen (siehe README-audio.md)"
        fi

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

# ─── AirPlay-Empfang ──────────────────────────────────────────────────────────
#
# Bewusst ein eigener Dienst mit eigener Konfiguration statt dem des Pakets: der
# Name muss der Zone folgen, und die Sitzungs-Hooks brauchen wir, um eine
# Uebernahme zu bemerken – ueber die Kommandozeile sind sie nicht setzbar.
# /etc/emp-airplay.conf schreibt der Abspieler selbst, sobald eine Zone AirPlay
# einschaltet. Darum wird der Dienst hier nicht aktiviert.

if [ "$USE_AIRPLAY" = "j" ]; then
    echo ""
    echo "→ AirPlay-Empfang einrichten..."

    cat > /usr/local/bin/emp-airplay-state << 'AIRSTATE'
#!/bin/sh
# Von install-audio.sh erzeugt. shairport-sync ruft das Skript bei Beginn und
# Ende einer Sitzung auf; der Abspieler erkennt daran, dass ein Sender die Zone
# uebernommen hat.
STATE_FILE=/run/emp-audio/airplay.active
mkdir -p /run/emp-audio
case "$1" in
    active) : > "$STATE_FILE" ;;
    *)      rm -f "$STATE_FILE" ;;
esac
AIRSTATE
    chmod 755 /usr/local/bin/emp-airplay-state

    cat > /etc/systemd/system/emp-airplay.service << 'AIRUNIT'
[Unit]
Description=EMP Access AirPlay-Empfang
# Ohne Avahi ist der Empfaenger im Netz nicht zu sehen.
After=network-online.target sound.target avahi-daemon.service
Wants=network-online.target avahi-daemon.service

[Service]
ExecStart=/usr/bin/shairport-sync -c /etc/emp-airplay.conf
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
AIRUNIT
    echo "  Dienst emp-airplay eingerichtet – startet, sobald eine Zone AirPlay einschaltet"
fi

# ─── Bluetooth-Empfang ────────────────────────────────────────────────────────

if [ "$USE_BLUETOOTH" = "j" ]; then
    echo ""
    echo "→ Bluetooth-Empfang einrichten..."

    # Der Dienstname wechselte zwischen den Fassungen von bluez-alsa.
    BLUEALSA_BIN="$(command -v bluealsad || command -v bluealsa || true)"
    if [ -z "$BLUEALSA_BIN" ]; then
        echo "  Warnung: bluealsa nicht gefunden – Bluetooth-Empfang bleibt aus"
    else
        cat > /etc/systemd/system/emp-bluealsa.service << BLUEUNIT
[Unit]
Description=EMP Access Bluetooth-Audio (A2DP-Senke)
After=bluetooth.service
Requires=bluetooth.service

[Service]
ExecStart=$BLUEALSA_BIN -p a2dp-sink
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
BLUEUNIT

        # Zweiter Dienst, weil die Verbindung allein keinen Ton macht: dieser
        # schiebt ihn auf den regelbaren Zweig, damit Durchsagen durchkommen.
        cat > /etc/systemd/system/emp-bluealsa-aplay.service << 'BLUEAPLAY'
[Unit]
Description=EMP Access Bluetooth-Audio auf die Soundkarte
After=emp-bluealsa.service
Requires=emp-bluealsa.service

[Service]
ExecStart=/usr/bin/bluealsa-aplay -D emp_external
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
BLUEAPLAY

        # Nimmt die Kopplung ohne PIN an. Ungefaehrlich, weil die Zone nur
        # waehrend des Kopplungsfensters aus dem Dashboard sichtbar ist.
        cat > /etc/systemd/system/emp-bt-agent.service << 'BTAGENT'
[Unit]
Description=EMP Access Bluetooth-Kopplung annehmen
After=bluetooth.service
Requires=bluetooth.service

[Service]
ExecStart=/usr/bin/bt-agent -c NoInputNoOutput
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
BTAGENT

        BT_CONF="/etc/bluetooth/main.conf"
        if [ -f "$BT_CONF" ]; then
            # Ohne Geraeteklasse zeigen Handys die Zone als "Sonstiges" statt als
            # Lautsprecher an und bieten sie fuer Musik nicht an.
            if ! grep -qE '^[[:space:]]*Class[[:space:]]*=' "$BT_CONF"; then
                sed -i 's/^\[General\]/[General]\nClass = 0x200414/' "$BT_CONF"
                echo "  Geräteklasse Lautsprecher in $BT_CONF eingetragen"
            fi
            # Die Voreinstellung von BlueZ beendet die Sichtbarkeit nach 180 s –
            # das Fenster aus dem Dashboard laeuft laenger. Wann Schluss ist,
            # entscheidet der Abspieler.
            if ! grep -qE '^[[:space:]]*DiscoverableTimeout[[:space:]]*=' "$BT_CONF"; then
                sed -i 's/^\[General\]/[General]\nDiscoverableTimeout = 0\nPairableTimeout = 0/' "$BT_CONF"
            fi
            systemctl restart bluetooth 2>/dev/null || true
        fi

        systemctl daemon-reload
        systemctl enable --now emp-bt-agent.service 2>/dev/null \
            || echo "  Warnung: bt-agent ließ sich nicht starten (Paket bluez-tools?)"
        echo "  Dienste eingerichtet – Kopplung wird im Dashboard freigegeben"
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
if [ "$USE_AIRPLAY" = "j" ] || [ "$USE_BLUETOOTH" = "j" ]; then
    echo ""
    echo "  AirPlay/Bluetooth noch im Dashboard einschalten:"
    echo "    Audio → Zonen → Zone bearbeiten"
    echo "  Die Schalter erscheinen, sobald der erste Heartbeat durch ist (bis 60 s)."
fi
echo ""
