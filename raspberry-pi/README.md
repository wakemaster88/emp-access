# EMP Access – Raspberry Pi Scanner

Python-basierter Scanner-Client für Raspberry Pi zur Zugangs&shy;kontrolle über QR-Codes und RFID.

> Für Musik und Durchsagen gibt es einen eigenen Client: [README-audio.md](README-audio.md).

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
| Offline | 880 ↔ 440 Hz (Wechselton, 3×) | Server nicht erreichbar – Ticket wurde **nicht** geprüft, kein Zutritt |

Bei „Offline“ leuchtet wie bei „Invalid“ die rote LED; der Unterschied ist nur am Ton zu hören (mehr gibt die Hardware ohne zusätzliche Bauteile nicht her). Im Log steht `OFFLINE: Server nicht erreichbar`.

GPIO-Pins können in `config.json` angepasst werden.

## Installation

```bash
# Auf dem Raspberry Pi:
git clone https://github.com/wakemaster88/emp-access.git
cd emp-access/raspberry-pi
sudo bash install.sh
```

Das Skript installiert die System-Pakete (u. a. Python, swig, liblgpio-dev), aktualisiert die Python-Pakete (python3, python3-venv, …) auf die neueste im Repo verfügbare Version und richtet den Scanner ein. Eine höhere Python-Version (z. B. 3.9+) erfordert ein neueres Raspberry Pi OS (Bullseye/Bookworm).

**Update (erneut ausführen):** Einfach `sudo bash install.sh` nochmal aus dem gleichen Ordner starten – das Skript aktualisiert dann `/opt/emp-scanner`. Falls der Ordner blockiert ist, werden Scanner und Updater kurz gestoppt und der alte Stand ggf. nach `/opt/emp-scanner.old` verschoben.

**Raspberry Pi OS Buster (ältere Version):** Wenn `apt-get update` oder die Paketinstallation mit 404/„Release-Datei“ fehlschlägt, zuerst die Repo-Quellen auf **legacy.raspbian.org** umstellen (siehe Abschnitt „Fehlerbehebung“ unten), dann `sudo apt-get update` und `sudo bash install.sh` erneut ausführen.

## Ersteinrichtung

1. Im EMP Access Dashboard ein Raspberry-Pi-Gerät anlegen
2. Gerätedetails öffnen → QR-Code wird angezeigt
3. Den Konfigurations-QR-Code mit dem am Pi angeschlossenen Scanner scannen
4. Der Pi konfiguriert sich automatisch und beginnt mit dem Scannen

Der Konfigurations-QR muss eine `http(s)`-Adresse, ein Token und eine ganzzahlige Geräte-ID enthalten – sonst wird er abgelehnt.

### Gerät neu zuordnen (Reset)

Ein Konfigurations-QR wird **nur angenommen, solange der Scanner noch nicht konfiguriert ist**. Ein bereits eingerichteter Scanner ignoriert ihn (Warnung im Log, Ablehn-Signal) und schickt ihn auch nicht an den Server – sonst könnte jeder mit einem eigenen QR-Code das Drehkreuz auf einen fremden Server umstellen.

Soll ein Gerät einen anderen Server, ein neues Token oder eine andere Geräte-ID bekommen, ist ein bewusster Reset mit Shell-Zugang (SSH) nötig:

```bash
sudo systemctl stop emp-scanner
cd /opt/emp-scanner/raspberry-pi
sudo /opt/emp-scanner/venv/bin/python -m emp_scanner.main --reset-config
sudo systemctl start emp-scanner
# danach den neuen Konfigurations-QR scannen
```

`--reset-config` löscht nur `server_url`, `api_token` und `device_id`; Pins und Intervalle bleiben erhalten. Alternativ `config.json` komplett löschen (dann gelten wieder alle Standardwerte) und den Dienst neu starten.

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
  "heartbeat_interval": 60,
  "task_poll_interval": 10,
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
| `heartbeat_interval` | Sekunden zwischen Heartbeats (POST mit System-Info, inkl. aktueller Task vom Server). **Standard 60** (Dashboard wertet bis ~5 Min ohne Heartbeat als online). |
| `task_poll_interval` | Sekunden zwischen leichten GET-Abfragen nur für Task/Deaktivierung (Standard **10**, Minimum **5** – nutzt ETag/304, kostet beim Server ohne Statuswechsel nichts). |
| `scanner_device` | `auto`, `stdin` oder `/dev/input/eventX` |
| `update_verify_signature` | `true` = Auto-Update spielt nur GPG-signierte Commits ein (Standard `false`, siehe „Signierte Updates“) |

`config.json` enthält das API-Token und wird mit Dateirechten `0600` geschrieben (bestehende Dateien werden beim nächsten Start nachgezogen).

### API-Häufigkeit (z. B. Neon / Serverless-DB)

Der Pi nutzt zwei Hintergrund-Schleifen:

1. **Task-Poll:** `GET /api/devices/pi?id=…` alle `task_poll_interval` Sekunden (Standard 10, nie unter 5). Nutzt `If-None-Match`/ETag → der Server antwortet bei unverändertem State mit `304` ohne DB-Hit.
2. **Heartbeat:** `POST /api/devices/pi` alle `heartbeat_interval` Sekunden (Standard 60) – der Server liefert im POST die Gerätekonfiguration mit, sodass **kein zweiter GET** nötig ist.

Ältere `config.json` mit `heartbeat_interval: 30` bzw. `task_poll_interval: 5` (alte Defaults) werden beim ersten Start nach dem Update automatisch auf 60/10 migriert. Individuell gesetzte Werte bleiben unverändert. Sehr kleine Werte (`task_poll_interval: 1`) erzeugen weiterhin fast jede Sekunde einen API-Call – für „Online“ im Dashboard reichen 5–15 s völlig (Dashboard wertet ohnehin mehrere Minuten als online).

## Version & Auto-Update

- **Scanner-Version:** `raspberry-pi/emp_scanner/__init__.py` → `VERSION` (z. B. `1.2.7`). Nach `git pull` + Neustart meldet der Pi diese Version im Heartbeat (`scanner_version` in den Systeminfos).
- **Dashboard „aktuell“:** Der Wert muss mit `src/lib/pi-version.ts` → `LATEST_PI_VERSION` übereinstimmen (beim Release beide anpassen).
- **API:** `GET/POST /api/devices/pi` liefert zusätzlich `latest_scanner_version` (gleicher Wert wie im Dashboard).

Auto-Update auf dem Pi läuft per **`git fetch` / `reset`** (siehe `emp_scanner/updater.py`), nicht über die Versionsnummer allein.

### Vorab-Prüfung und Rollback

Nach dem Einspielen eines neuen Stands prüft der Updater, bevor er den Dienst neu startet:

1. jede `.py`-Datei in `emp_scanner/` lässt sich kompilieren,
2. `emp_scanner.main` lässt sich in einem frischen Python-Prozess importieren.

Schlägt eine der Prüfungen fehl, setzt der Updater das Repository auf den vorherigen Commit zurück und startet **nicht** neu (Log: `Update … verworfen`). Der Versuch wiederholt sich beim nächsten Lauf, bis ein lauffähiger Stand auf `origin/main` liegt. Per `pip` nachinstallierte Pakete werden dabei nicht zurückgerollt.

Das gilt nur für den Scanner (`emp_scanner`); der Audio-Updater (`emp_audio/updater.py`) hat diese Prüfung nicht.

### Signierte Updates (optional, Standard: aus)

Ohne weitere Einstellung übernimmt der Pi jeden Commit von `origin/main`. Wer das Repository (oder den Zugang dazu) kontrolliert, kontrolliert damit die Geräte. Optional kann der Updater nur **GPG-signierte** Commits einspielen:

1. Öffentlichen Signaturschlüssel in den Schlüsselbund von `root` importieren (der Dienst läuft als root):
   ```bash
   sudo -H gpg --import release-key.asc
   ```
   Werden Pull Requests über die GitHub-Oberfläche gemergt, ist der Merge-Commit mit GitHubs `web-flow`-Schlüssel signiert – dann muss auch dieser importiert werden (`https://github.com/web-flow.gpg`).
2. Prüfung einschalten – entweder in `config.json`:
   ```json
   "update_verify_signature": true
   ```
   oder per Umgebungsvariable `EMP_UPDATE_VERIFY_SIGNATURE=1` (dann für **beide** Units setzen: `sudo systemctl edit emp-scanner` und `sudo systemctl edit emp-updater`, jeweils `[Service]` / `Environment=EMP_UPDATE_VERIFY_SIGNATURE=1`).
3. Dienst neu starten: `sudo systemctl restart emp-scanner`.

Ist die Prüfung aktiv, wird ein neuer Stand nur übernommen, wenn `git verify-commit` für den obersten Commit von `origin/main` erfolgreich ist **und** er ein Fast-Forward des installierten Stands ist (kein Zurückdrehen auf ältere Commits, kein Force-Push). Andernfalls bleibt der Pi auf dem alten Stand (Log: `Update abgelehnt`). Geprüft wird nur der oberste Commit, nicht jeder einzelne dazwischen.

**Achtung:** Erst einschalten, wenn der Schlüssel auf dem Gerät installiert ist und Commits tatsächlich signiert werden – sonst erhält der Pi keine Updates mehr.

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

**Scanner-Ausfall:** Endet der Lese-Thread (z. B. `scanner_device: "stdin"` unter systemd, wo stdin sofort geschlossen ist, oder fehlendes `evdev`), steht einmalig `Scanner-Thread läuft nicht mehr` im Log. Der Dienst läuft weiter, weil Öffnen per Dashboard, NOT-AUF und Sperren auch ohne Scanner funktionieren.

**NOT-AUF:** Solange NOT-AUF aktiv ist, bleibt das Relais dauerhaft offen; ein Scan gibt nur den Bestätigungston und schließt das Relais nicht wieder.

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

- **Server nicht erreichbar:** kein Zutritt (fail-closed, es gibt keine Offline-Freigabe). Ein Verbindungsfehler wird einmal kurz wiederholt, ein Timeout nicht. Danach rote LED + eigener „Offline“-Ton.
- **Reservierte Codes** (`__NAME__`, z. B. `__DASHBOARD_OPEN__`) und Konfigurations-QR-Codes werden lokal abgelehnt und nie an den Server gesendet.
- Im Log erscheint von jedem Scan nur ein kurzer Präfix, nicht der ganze Code.

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

### Tests

Die Tests laufen ohne Hardware und ohne installierte Pakete (`RPi.GPIO`, `requests`, `evdev` werden gestubbt):

```bash
# im Repository-Wurzelverzeichnis
python3 -m unittest discover -s raspberry-pi/tests -v
python3 -m compileall -q raspberry-pi
```
