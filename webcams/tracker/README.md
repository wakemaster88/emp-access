# Webcams People-Tracker (Sidecar)

Python-Service, der gerichtetes Personenzählen (rein/raus) für die Cams im
Hauptprojekt liefert. Läuft als eigener Prozess neben dem Next-Server.

Architektur:

```
                       config.json
                         │
                         ▼
  ┌─────────────┐    ┌──────────┐    ┌────────────┐
  │ Next-App    │◀──▶│ Sidecar  │───▶│ RTSP-Cams  │
  │ /api/...    │HTTP│ FastAPI  │RTSP│ (substream)│
  └─────────────┘    └──────────┘    └────────────┘
                       │
                       ▼ YOLOv8 + ByteTrack + supervision.LineZone
```

Die Konfiguration kommt aus derselben `config.json` wie für die Next-App:
für jede Cam mit `peopleCounter.mode == "crossing"` und einer definierten
`line` startet der Sidecar einen Worker-Thread.

## Setup

```bash
cd tracker
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

# Erststart (lädt YOLOv8n Gewichte ~6 MB)
python main.py            # Achtung: nutzt uvicorn unten als Default
# Empfohlen, mit Logs sichtbar:
uvicorn main:app --host 127.0.0.1 --port 8088
```

Auf Apple Silicon läuft YOLO auf MPS (Metal). Falls das instabil ist
(Ultralytics-Issue je nach Version), CPU erzwingen:

```bash
WEBCAMS_TRACKER_DEVICE=cpu uvicorn main:app --host 127.0.0.1 --port 8088
```

## Umgebungsvariablen

| Variable                       | Default              | Bedeutung                                   |
| ------------------------------ | -------------------- | ------------------------------------------- |
| `WEBCAMS_CONFIG_PATH`          | `../config.json`     | Pfad zur Haupt-Config                       |
| `WEBCAMS_TRACKER_MODEL`        | `yolov8n.pt`         | YOLO-Gewichtdatei (n/s/m/l/x)               |
| `WEBCAMS_TRACKER_DEVICE`       | (auto)               | `mps`, `cpu`, `0`, …                        |
| `WEBCAMS_TRACKER_FRAME_STRIDE` | `2`                  | Jede N-te Frame verarbeiten (entlastet GPU) |
| `WEBCAMS_TRACKER_CONF`         | `0.4`                | Confidence-Schwelle für Personen            |
| `WEBCAMS_TRACKER_RTSP_BASE`    | (aus)                | Streams von hier statt direkt von der Cam   |
| `WEBCAMS_TRACKER_LINE_MARGIN`  | `0.08`               | Totzone um die Zähllinie (Anteil Bildhöhe)  |
| `WEBCAMS_TRACKER_CROSSING_SNAPSHOTS` | `1`            | Bild je Durchgang mitschreiben (`0` = aus)  |
| `WEBCAMS_TRACKER_SNAPSHOT_RETENTION_DAYS` | `30`      | Aufbewahrung dieser Bilder in Tagen         |

### Streams über go2rtc beziehen

Auf macOS verweigert die Sperre „Lokales Netzwerk" einem per launchd
gestarteten Prozess den Zugriff auf die Kameras — RTSP scheitert mit
„No route to host", obwohl dieselbe URL aus einer Shell funktioniert.
go2rtc hat die Freigabe und veröffentlicht jeden Stream unter `<camId>_sub`
auf Loopback, das von der Sperre ausgenommen ist:

```bash
WEBCAMS_TRACKER_RTSP_BASE=rtsp://127.0.0.1:8554
```

Nebeneffekt: Die Kamera muss den Substream nur einmal ausliefern, egal wie
viele Verbraucher es gibt.

### Totzone um die Zähllinie

Gezählt wird mit Hysterese: Eine Seite der Linie gilt erst als eingenommen,
wenn der Fußpunkt weiter als `WEBCAMS_TRACKER_LINE_MARGIN × Bildhöhe` von ihr
entfernt ist. Ohne das erzeugt eine einzelne wartende Person — an einem
Drehkreuz der Normalfall — im Sekundentakt Wechsel zwischen „rein" und
„raus". Zu große Werte verschlucken dagegen kurze Durchgänge.

### Bild je Durchgang

Zu jedem erkannten Durchgang wird der annotierte Frame nach
`logs/people/<cam>/snaps/<Tag>/<Zeitstempel>.jpg` geschrieben, samt
eingebranntem Zeitstempel. Ob ein Durchgang durch einen Scan gedeckt war,
stellt sich erst Minuten später im Dashboard heraus — dann zeigt die Kamera
längst eine andere Szene. Deshalb wird im Moment des Durchgangs gespeichert
und erst hinterher entschieden, welches Bild man braucht.

Gehen mehrere Personen im selben Frame über die Linie, teilen sich die
Ereignisse ein Bild. Bei rund 50 kB pro Bild und einigen hundert Durchgängen
am Tag reichen 30 Tage Aufbewahrung für weniger als ein Gigabyte.

## Endpunkte

```
GET  /health
GET  /counters
GET  /counters/{cam_id}
POST /counters/{cam_id}/reset
POST /reload
```

`/reload` muss nach jedem Speichern der `config.json` aufgerufen werden
— die Next-App tut das in `app/api/config/route.ts`.

## LaunchAgent (macOS)

Beispiel-Plist liegt in `infra/com.local.webcams-tracker.example.plist`.
Installation analog zu `com.local.webcams`:

```bash
cp infra/com.local.webcams-tracker.example.plist \
   ~/Library/LaunchAgents/com.local.webcams-tracker.plist
launchctl load ~/Library/LaunchAgents/com.local.webcams-tracker.plist
```
