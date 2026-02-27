# EMP Access – Raspberry Pi Scanner

Python-basierter Scanner-Client für Raspberry Pi zur Zugangs&shy;kontrolle über QR-Codes und RFID.

## Funktionen

- **QR + RFID über einen USB-Scanner** – ein Kombi-Gerät liest QR-Codes und RFID-Karten (HID-Modus)
- **Relais-Steuerung** – GPIO-gesteuertes Relais für Drehkreuze/Türöffner
- **PWM-Buzzer** – verschiedene Tonmuster für Startup, Scan, Gültig, Ungültig
- **LED-Feedback** – Grün (Zutritt) / Rot (Abgelehnt)
- **Server-Validierung** – Echtzeit-Ticketprüfung über die EMP Access API
- **Heartbeat** – Regelmäßiger Status-Bericht an den Server (Online-Status)
- **Task-Empfang** – NOT-AUF, Einmal öffnen, Deaktivieren vom Dashboard aus
- **Auto-Update** – Automatische Software-Aktualisierung via Git (alle 5 Min.)
- **Auto-Start** – systemd-Service startet automatisch beim Booten

## Hardware

| Komponente | GPIO (BCM) | Beschreibung |
|---|---|---|
| Relais | 24 | Drehkreuz-/Türöffner (1s Impuls) |
| Buzzer | 23 | Piezo-Lautsprecher (PWM, verschiedene Töne) |
| LED Grün | 27 | Zutritt gewährt |
| LED Rot | 22 | Zutritt verweigert |
| Scanner | USB | QR + RFID Kombi-Scanner (HID) |

### Buzzer-Töne (PWM)

| Ereignis | Frequenzen | Beschreibung |
|---|---|---|
| Startup | 500 → 1000 → 1500 Hz | Aufsteigend, System bereit |
| Scan | 500 → 1500 Hz | Kurzer Bestätigungston |
| Valid | 1000 → 1500 → 2000 Hz | Aufsteigend, Zutritt gewährt |
| Invalid | 2000 → 1500 → 1000 Hz | Absteigend, Zutritt verweigert |

GPIO-Pins können in `config.json` angepasst werden.

## Installation

```bash
# Auf dem Raspberry Pi:
git clone https://github.com/wakemaster88/emp-access.git
cd emp-access/raspberry-pi
sudo bash install.sh
```

## Ersteinrichtung

1. Im EMP Access Dashboard ein Raspberry-Pi-Gerät anlegen
2. Gerätedetails öffnen → QR-Code wird angezeigt
3. Den Konfigurations-QR-Code mit dem am Pi angeschlossenen Scanner scannen
4. Der Pi konfiguriert sich automatisch und beginnt mit dem Scannen

## Konfiguration

Die Datei `config.json` wird beim ersten QR-Scan automatisch erstellt:

```json
{
  "server_url": "https://dein-server.vercel.app",
  "api_token": "clx1abc...",
  "device_id": 42,
  "relay_pin": 24,
  "relay_duration": 1.0,
  "led_green_pin": 27,
  "led_red_pin": 22,
  "buzzer_pin": 23,
  "heartbeat_interval": 30,
  "update_check_interval": 300,
  "scanner_device": "auto"
}
```

| Feld | Beschreibung |
|---|---|
| `server_url` | URL des EMP Access Servers |
| `api_token` | API-Token des Mandanten |
| `device_id` | Geräte-ID auf dem Server |
| `relay_pin` | GPIO-Pin für das Relais |
| `relay_duration` | Öffnungsdauer in Sekunden |
| `scanner_device` | `auto`, `stdin` oder `/dev/input/eventX` |

## Betrieb

```bash
# Status prüfen
sudo systemctl status emp-scanner

# Live-Logs anzeigen
sudo journalctl -u emp-scanner -f

# Manuell neustarten
sudo systemctl restart emp-scanner

# Update-Timer Status
sudo systemctl status emp-updater.timer
```

## Scan-Ablauf

```
Scanner → Code gelesen
   ↓
POST /api/devices/pi/scan  { code, deviceId }
   ↓
Server prüft:
  ✓ Ticket vorhanden?
  ✓ Status VALID?
  ✓ Datum gültig?
  ✓ Bereich erlaubt?
  ✓ Wiedereintritt?
   ↓
{ granted: true/false, message: "..." }
   ↓
Relais öffnen / LED rot + Buzzer
```

## Fehlerbehebung bei der Installation

### „Das Depot … enthält keine Release-Datei mehr“ (Raspbian Buster)

Raspberry Pi OS **Buster** ist veraltet; die Repos wurden ins Archiv verschoben. Zwei Wege:

**Option A – Auf neueres OS upgraden (empfohlen)**  
- Neuinstallation mit [Raspberry Pi OS Bullseye oder Bookworm](https://www.raspberrypi.com/software/).

**Option B – Buster mit Archiv-Quellen nutzen**

```bash
# Backup
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak
sudo cp /etc/apt/sources.list.d/raspi.list /etc/apt/sources.list.d/raspi.list.bak 2>/dev/null || true

# Alte URLs durch Archiv ersetzen
sudo sed -i 's|raspbian.raspberrypi.org/raspbian|archive.raspbian.org/raspbian|g' /etc/apt/sources.list
sudo sed -i 's|archive.raspberrypi.org/debian|archive.raspberrypi.org/debian|g' /etc/apt/sources.list.d/raspi.list 2>/dev/null || true
# In sources.list Zeile mit raspbian.raspberrypi.org ggf. manuell ersetzen durch:
# deb http://archive.raspbian.org/raspbian buster main contrib non-free rpi

sudo apt-get update
sudo bash install.sh
```

### „GPG-Fehler“ / „Depot … ist nicht signiert“ (TeamViewer o.ä.)

Falls ein anderes Repo (z. B. TeamViewer) den Update blockiert:

- **TeamViewer-Repo deaktivieren:**  
  `sudo rm /etc/apt/sources.list.d/teamviewer.list` (oder die Zeile in der Datei auskommentieren).  
  Danach: `sudo apt-get update` und `sudo bash install.sh` erneut ausführen.

- **Oder GPG-Schlüssel hinzufügen** (Beispiel TeamViewer):  
  `sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys EF9DBDC7387D1A07`

## Entwicklung (ohne Hardware)

```bash
# Auf dem Entwicklungsrechner (ohne GPIO):
cd raspberry-pi
python3 -m venv venv
source venv/bin/activate
pip install requests

# Starten im stdin-Modus (GPIO wird simuliert):
python -m emp_scanner.main
# Codes per Tastatur eingeben + Enter
```
