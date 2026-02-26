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
