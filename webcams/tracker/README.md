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
