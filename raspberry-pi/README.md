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

**Update (erneut ausführen):** Einfach `sudo bash install.sh` nochmal aus dem gleichen Ordner starten – das Skript aktualisiert dann `/opt/emp-scanner`. Falls der Ordner blockiert ist, werden Scanner und Updater kurz gestoppt und der alte Stand ggf. nach `/opt/emp-scanner.old` verschoben.

**Raspberry Pi OS Buster (ältere Version):** Wenn `apt-get update` oder die Paketinstallation mit 404/„Release-Datei“ fehlschlägt, zuerst die Repo-Quellen auf **legacy.raspbian.org** umstellen (siehe Abschnitt „Fehlerbehebung“ unten), dann `sudo apt-get update` und `sudo bash install.sh` erneut ausführen.

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

Raspberry Pi OS **Buster** ist veraltet; die Repos liegen seit Dez. 2025 unter **legacy.raspbian.org**. Zwei Wege:

**Option A – Auf neueres OS upgraden (empfohlen)**  
- Neuinstallation mit [Raspberry Pi OS Bullseye oder Bookworm](https://www.raspberrypi.com/software/).

**Option B – Buster mit funktionierenden Quellen (legacy.raspbian.org)**

Diese Befehle nacheinander ausführen (ersetzen die bestehenden Repo-Zeilen; Backup empfohlen: `sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak`):

```bash
# Raspbian-Hauptquellen (Pakete wie swig, python3-dev)
echo 'deb https://legacy.raspbian.org/raspbian/ buster main contrib non-free rpi' | sudo tee /etc/apt/sources.list

# Raspberry-Pi-spezifische Pakete
echo 'deb http://archive.raspberrypi.org/debian buster main' | sudo tee /etc/apt/sources.list.d/raspi.list

sudo apt-get update
cd ~/emp-access/raspberry-pi
sudo bash install.sh
```

### „GPG-Fehler“ / „Depot … ist nicht signiert“ (TeamViewer o.ä.)

Falls ein anderes Repo (z. B. TeamViewer) den Update blockiert:

- **TeamViewer-Repo deaktivieren:**  
  `sudo rm /etc/apt/sources.list.d/teamviewer.list` (oder die Zeile in der Datei auskommentieren).  
  Danach: `sudo apt-get update` und `sudo bash install.sh` erneut ausführen.

- **Oder GPG-Schlüssel hinzufügen** (Beispiel TeamViewer):  
  `sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys EF9DBDC7387D1A07`

### „command 'swig' failed“ / „Failed building wheel for lgpio“ / „-llgpio nicht gefunden“

Das Paket `lgpio` wird aus Quellcode gebaut und braucht **swig**, Build-Tools und die **liblgpio**-C-Bibliothek. Das Install-Skript installiert automatisch:
- `swig`, `build-essential`, `python3-dev`
- `liblgpio-dev` (falls im Repo); unter Buster wird die lg-Bibliothek ggf. aus Quellcode (abyz.me.uk/lg) gebaut.

Falls du die Installation manuell nachziehst:

```bash
sudo apt-get install -y swig build-essential python3-dev liblgpio-dev
# danach im Repo: pip install -r raspberry-pi/requirements.txt
```

Unter Buster, wenn `liblgpio-dev` fehlt: `install.sh` baut die lg-Bibliothek automatisch aus Quellcode.

### emp-scanner.service: „Failed with result 'exit-code'“ / status=1/FAILURE

- **ExecStart prüfen:** In `systemctl status emp-scanner` muss stehen:  
  `/opt/emp-scanner/venv/bin/python -m emp_scanner.main`  
  Typische Tippfehler: `enp-scanner`→emp, `venu`/`vesu`→venv, `-n`→`-m`, `nain`→main. Sofort-Fix auf dem Pi:
  ```bash
  sudo sed -i -e 's|/enp-scanner/|/emp-scanner/|g' -e 's|/venu/|/venv/|g' -e 's|/vesu/|/venv/|g' -e 's|-n emp_scanner|-m emp_scanner|g' -e 's|\.nain|.main|g' /etc/systemd/system/emp-scanner.service
  sudo systemctl daemon-reload && sudo systemctl restart emp-scanner
  ```
  Oder: `cd ~/emp-access/raspberry-pi && git pull && sudo bash install.sh`
- **Logs ansehen:** `sudo journalctl -u emp-scanner -n 50 --no-pager` (zeigt Python-Fehler oder Traceback).

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
