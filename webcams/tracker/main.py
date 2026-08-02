"""
Webcams People-Tracker Sidecar
==============================

Pro Cam mit ``peopleCounter.mode == "crossing"`` läuft hier ein Worker-Thread,
der den RTSP-Substream der Kamera liest, Personen mit YOLOv8 erkennt, sie
über ByteTrack (in Ultralytics integriert) per Track-ID stabil hält und
zählt, wenn der Schwerpunkt (cx, cy) eine konfigurierte Linie überquert.

Die Linie kommt als zwei normierte Punkte (0..1) aus ``config.json`` —
Auflösungs-/Profil-Wechsel der Cam beeinflussen die Konfiguration nicht.

HTTP-API (für die Next-App):

    GET  /health                  – { ok, workers }
    GET  /counters                – alle Cams: { in, out, delta, fps, lastUpdate, lastError }
    GET  /counters/{cam_id}       – einzelne Cam
    POST /counters/{cam_id}/reset – setzt in/out auf 0
    POST /reload                  – liest Config neu, syncht Worker

Der Sidecar nutzt dieselbe ``config.json`` wie die Next-App und liest sie
bei jedem ``/reload`` neu ein. Die Next-App ruft ``/reload`` nach jedem
Config-Save auf (siehe ``app/api/config/route.ts``).
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from datetime import datetime, timedelta

import cv2
import numpy as np
import supervision as sv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from ultralytics import YOLO

from alpr import (  # type: ignore
    AlprState,
    alpr_worker_loop,
    get_persisted_snapshot,
    list_history,
)
from ptz import (  # type: ignore
    ManualOverride,
    PtzAutoState,
    PtzHttpClient,
    follow_loop,
    patrol_loop,
)
from people_history import (  # type: ignore
    aggregate_days,
    cleanup_all_in_root,
    cleanup_snapshots,
    list_recent_events,
    load_today_counts,
    record_crossing,
    reset_today,
    save_context_snapshot,
    save_crossing_snapshot,
    snapshot_file,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("tracker")

CONFIG_PATH = Path(
    os.environ.get(
        "WEBCAMS_CONFIG_PATH",
        Path(__file__).resolve().parent.parent / "config.json",
    )
)
YOLO_MODEL = os.environ.get("WEBCAMS_TRACKER_MODEL", "yolov8n.pt")

# Streams optional über go2rtc statt direkt von der Kamera beziehen.
#
# Auf macOS verweigert die „Lokales Netzwerk"-Sperre einem per launchd
# gestarteten Prozess den Zugriff auf die Kameras — RTSP scheitert dann mit
# „No route to host", obwohl dieselbe URL aus einer Shell funktioniert.
# go2rtc hat die Freigabe bereits und veröffentlicht jeden Stream unter
# ``<camId>_sub`` auf Loopback, das von der Sperre ausgenommen ist.
# Nebeneffekt: die Kamera muss den Substream nur einmal ausliefern.
RTSP_BASE = os.environ.get("WEBCAMS_TRACKER_RTSP_BASE", "").rstrip("/")

# Breite der Totzone beidseits der Zähllinie, als Anteil der Bildhöhe.
# Siehe ``HysteresisLineCounter``: zu klein und Wartende erzeugen Zittern,
# zu groß und ein kurzer Durchgang wird nicht mehr registriert.
LINE_MARGIN_RATIO = float(os.environ.get("WEBCAMS_TRACKER_LINE_MARGIN", "0.08"))

# ---------------------------------------------------------------------------
# Config-Reader mit mtime-Cache — analog zu `lib/config.ts` der Next-App.
# Spart das JSON-Parsing pro Tick (Sync, ALPR, PTZ lesen alle die Config).
# ---------------------------------------------------------------------------

_config_cache: dict[str, Any] = {"mtime": None, "data": None}
_config_lock = threading.Lock()


def read_config() -> dict[str, Any]:
    """Liest config.json mit mtime-Cache. Leeres Dict wenn nicht vorhanden."""
    with _config_lock:
        try:
            mtime = CONFIG_PATH.stat().st_mtime_ns
        except FileNotFoundError:
            _config_cache["mtime"] = None
            _config_cache["data"] = None
            return {}
        if _config_cache["mtime"] == mtime and _config_cache["data"] is not None:
            return _config_cache["data"]
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("config.json nicht lesbar: %s", exc)
            return _config_cache["data"] or {}
        _config_cache["mtime"] = mtime
        _config_cache["data"] = data
        return data


def admin_pin() -> str:
    """Admin-PIN der Next-App — dient als Shared Secret in beide Richtungen."""
    settings = read_config().get("settings") or {}
    return str(settings.get("adminPin") or "")


def app_auth_headers() -> dict[str, str]:
    """Header für Sidecar→Next-Aufrufe (PTZ, Tür öffnen, Notify)."""
    pin = admin_pin()
    return {"x-admin-token": pin} if pin else {}


def _autodetect_device() -> str:
    """Wählt das beste verfügbare Inferenz-Gerät.

    Auf Apple Silicon (M1/M2/M3/M4) ist MPS deutlich schneller als CPU —
    drückt auf einem M4 die Inferenz-Latenz pro Frame um ~3-5x. Wenn der
    User explizit ``WEBCAMS_TRACKER_DEVICE`` setzt, wird dem nie
    widersprochen (nützlich um zu debuggen, wenn MPS-Bugs auftreten).

    Reihenfolge:
        1. ENV ``WEBCAMS_TRACKER_DEVICE`` wenn gesetzt
        2. CUDA wenn verfügbar
        3. MPS wenn verfügbar (Apple Silicon)
        4. CPU als Fallback
    """
    env = os.environ.get("WEBCAMS_TRACKER_DEVICE", "").strip()
    if env:
        return env
    try:
        import torch  # late import — schwere Dep, schon eh geladen via ultralytics

        if torch.cuda.is_available():
            return "cuda"
        if (
            hasattr(torch.backends, "mps")
            and torch.backends.mps.is_available()
            and torch.backends.mps.is_built()
        ):
            return "mps"
    except Exception:
        pass
    return "cpu"


DEVICE = _autodetect_device()
FRAME_STRIDE = int(os.environ.get("WEBCAMS_TRACKER_FRAME_STRIDE", "2"))  # jede N-te Frame
CONF_THRESHOLD = float(os.environ.get("WEBCAMS_TRACKER_CONF", "0.3"))
# Inferenz-Auflösung. 480 ist eine gute Balance — 25-40% schneller als
# Default 640 bei vernachlässigbarem Recall-Verlust für Personen-Detection
# auf Sub-Stream-Auflösungen (640x352 / 720x480).
INFER_IMGSZ = int(os.environ.get("WEBCAMS_TRACKER_IMGSZ", "480"))
# YOLO postprocesst sonst max 300 Detections pro Frame. Wir wollen
# höchstens eine Handvoll Personen — kappen spart NMS-Zeit.
INFER_MAX_DET = int(os.environ.get("WEBCAMS_TRACKER_MAX_DET", "20"))
# Wie lange Crossing-Events auf Disk bleiben. 0 = unbegrenzt.
PEOPLE_HISTORY_RETENTION_DAYS = int(
    os.environ.get("WEBCAMS_PEOPLE_HISTORY_RETENTION_DAYS", "180")
)
# Bild je Durchgang mitschreiben — Beleg für Durchgänge ohne Scan.
CROSSING_SNAPSHOTS = os.environ.get("WEBCAMS_TRACKER_CROSSING_SNAPSHOTS", "1") != "0"
# Deutlich kürzer als die Ereigniszeilen: Die sind winzig, die Bilder nicht.
CROSSING_SNAPSHOT_RETENTION_DAYS = int(
    os.environ.get("WEBCAMS_TRACKER_SNAPSHOT_RETENTION_DAYS", "30")
)

log.info("inference: device=%s imgsz=%d max_det=%d", DEVICE, INFER_IMGSZ, INFER_MAX_DET)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------


@dataclass
class CamCounter:
    cam_id: str
    in_count: int = 0
    out_count: int = 0
    last_update: float = 0.0
    last_error: str | None = None
    fps: float = 0.0
    # Konfig-Snapshot für Diff-Vergleich (Hot-Reload)
    config_hash: str = ""
    # Worker-Steuerung
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    # Letzter annotierter JPEG-Buffer (für /debug-Endpoint)
    last_jpeg: bytes | None = None
    last_person_count: int = 0


def _hash_config(cam: dict[str, Any]) -> str:
    """Stabile Repräsentation der trackerrelevanten Config-Felder."""
    pc = cam.get("peopleCounter", {})
    return json.dumps(
        {
            "ip": cam.get("ip"),
            "rtspPort": cam.get("rtspPort"),
            "username": cam.get("username"),
            "password": cam.get("password"),
            "streamSub": cam.get("streamSub"),
            "channel": cam.get("channel"),
            "line": pc.get("line"),
            "direction": pc.get("direction", "ab"),
        },
        sort_keys=True,
    )


def build_rtsp_url(cam: dict[str, Any]) -> str:
    """Baut die RTSP-URL für den Substream."""
    if RTSP_BASE:
        return f"{RTSP_BASE}/{cam['id']}_sub"
    user = cam["username"]
    pw = cam["password"]
    ip = cam["ip"]
    port = cam.get("rtspPort", 554)
    stream = cam.get("streamSub", "h264Preview_01_sub")
    return f"rtsp://{user}:{pw}@{ip}:{port}/{stream}"


def _resolve_line(
    line_norm: list[list[float]],
    direction: str,
    width: int,
    height: int,
) -> tuple[sv.Point, sv.Point]:
    """Wandelt normierte Linie in Pixel-Punkte um.

    `supervision.LineZone` zählt als „in", wenn ein Objekt die Linie in der
    Richtung der Normalen vom Start- zum Endpunkt überquert (Right-Hand-Rule).
    Dadurch invertiert ein Vertauschen der Punkte das Vorzeichen — genau
    das nutzen wir für `direction: "ba"`.
    """
    p1, p2 = line_norm
    x1, y1 = int(p1[0] * width), int(p1[1] * height)
    x2, y2 = int(p2[0] * width), int(p2[1] * height)
    if direction == "ba":
        x1, y1, x2, y2 = x2, y2, x1, y1
    return sv.Point(x1, y1), sv.Point(x2, y2)


class HysteresisLineCounter:
    """Zählt Linienüberquerungen mit Totzone.

    ``supervision.LineZone`` schaltet exakt an der Linie um. An einem
    Drehkreuz warten die Leute aber genau dort, und dann reicht ein Pixel
    Rauschen im Fußpunkt, damit dieselbe Person im Sekundentakt zwischen
    „rein" und „raus" springt — ein einzelner Wartender hat hier schon
    zweistellige Zählerstände erzeugt.

    Deshalb gilt eine Seite erst als eingenommen, wenn der Fußpunkt weiter
    als ``margin`` Pixel von der Linie entfernt ist. Innerhalb des Bandes
    bleibt der zuletzt eingenommene Stand stehen, gezählt wird allein der
    Wechsel von einer eingenommenen Seite auf die andere. Wer davor auf und
    ab geht, ohne wirklich durchzugehen, zählt damit gar nicht.

    Gezählt wird nur zwischen den beiden Endpunkten. Neben der Linie
    vorbeizugehen ist sonst dasselbe wie hindurchzugehen — am Drehkreuz
    liegt direkt daneben das Tor für den Tageseingang, und jeder, der es
    benutzt, landete als ungedeckter Durchgang im Alarm.
    """

    def __init__(
        self,
        start: sv.Point,
        end: sv.Point,
        margin: float,
        ttl: float = 60.0,
    ) -> None:
        self.start = start
        self.end = end
        self.margin = margin
        self.ttl = ttl
        self.in_count = 0
        self.out_count = 0
        self._side: dict[int, int] = {}
        self._seen: dict[int, float] = {}

    def _project(self, x: float, y: float) -> tuple[float, float]:
        """Abstand zur Linie (mit Vorzeichen) und Lage entlang der Linie.

        Die Lage ist 0 am Startpunkt und 1 am Endpunkt; alles ausserhalb
        liegt neben der Linie, nicht davor oder dahinter.
        """
        dx = self.end.x - self.start.x
        dy = self.end.y - self.start.y
        length_sq = dx * dx + dy * dy
        if length_sq == 0:
            return 0.0, 0.0
        px = x - self.start.x
        py = y - self.start.y
        dist = (px * dy - py * dx) / math.sqrt(length_sq)
        along = (px * dx + py * dy) / length_sq
        return dist, along

    def trigger(self, detections: sv.Detections) -> list[tuple[int, str, float]]:
        """Verarbeitet einen Frame, gibt die neuen Überquerungen zurück.

        Je Überquerung ``(Track-Id, Richtung, Lage entlang der Linie)``. Die
        Lage steht im Protokoll, damit sich beim Nachziehen der Linie ablesen
        laesst, an welcher Stelle gezaehlt wurde.
        """
        ids = detections.tracker_id
        if ids is None or len(detections) == 0:
            return []

        now = time.time()
        crossings: list[tuple[int, str, float]] = []
        for i, raw_id in enumerate(ids):
            tid = int(raw_id)
            self._seen[tid] = now

            x1, _y1, x2, y2 = detections.xyxy[i]
            # Fußpunkt statt Boxmitte: die Füße stehen auf der Bodenebene,
            # in der auch die Linie gemeint ist.
            dist, along = self._project((float(x1) + float(x2)) / 2.0, float(y2))
            # Neben der Linie: Seite gar nicht erst merken. Sonst zaehlt der
            # erste Schritt zurueck in den Bereich als Wechsel.
            if along < 0.0 or along > 1.0:
                continue
            if abs(dist) < self.margin:
                continue

            side = 1 if dist > 0 else -1
            prev = self._side.get(tid)
            self._side[tid] = side
            if prev is None or prev == side:
                continue

            if side > 0:
                self.in_count += 1
                crossings.append((tid, "in", along))
            else:
                self.out_count += 1
                crossings.append((tid, "out", along))

        for tid, last in list(self._seen.items()):
            if now - last > self.ttl:
                self._seen.pop(tid, None)
                self._side.pop(tid, None)

        return crossings


def annotate_frame(
    frame: Any,
    detections: Any,
    start_pt: sv.Point,
    end_pt: sv.Point,
    margin_px: float,
    in_count: int,
    out_count: int,
    box_annotator: Any,
    label_annotator: Any,
    stamp: str | None = None,
) -> Any:
    """Zeichnet Zähllinie, Totzone, Boxen und Zählerstand ins Bild.

    Wird sowohl für den /debug-Endpoint benutzt als auch für den Schnappschuss
    beim Durchgang — der ist als Beleg nur brauchbar, wenn man sieht, wer wo
    über die Linie ging.
    """
    annotated = frame.copy()
    # Totzone als Band um die Linie — beim Justieren muss man sehen, wo
    # nicht gezählt wird.
    ldx = end_pt.x - start_pt.x
    ldy = end_pt.y - start_pt.y
    llen = math.hypot(ldx, ldy) or 1.0
    ox = int(round(-ldy / llen * margin_px))
    oy = int(round(ldx / llen * margin_px))
    for sign in (1, -1):
        cv2.line(
            annotated,
            (start_pt.x + sign * ox, start_pt.y + sign * oy),
            (end_pt.x + sign * ox, end_pt.y + sign * oy),
            (120, 120, 120),
            1,
        )
    cv2.line(
        annotated,
        (start_pt.x, start_pt.y),
        (end_pt.x, end_pt.y),
        (255, 220, 60),
        2,
    )
    # Endkappen quer zur Linie: Ausserhalb wird nicht gezählt, und beim
    # Justieren muss man sehen, wo genau Schluss ist.
    for pt in (start_pt, end_pt):
        cv2.line(
            annotated,
            (pt.x - ox, pt.y - oy),
            (pt.x + ox, pt.y + oy),
            (255, 220, 60),
            2,
        )
    # Pfeilspitze in der Mitte: zeigt Richtung „rein"
    mx = (start_pt.x + end_pt.x) // 2
    my = (start_pt.y + end_pt.y) // 2
    cv2.arrowedLine(
        annotated,
        (start_pt.x, start_pt.y),
        (mx, my),
        (255, 220, 60),
        2,
        tipLength=0.3,
    )
    annotated = box_annotator.annotate(scene=annotated, detections=detections)
    if detections.tracker_id is not None and len(detections) > 0:
        labels = [f"#{tid}" for tid in detections.tracker_id]
        annotated = label_annotator.annotate(
            scene=annotated, detections=detections, labels=labels
        )
    cv2.putText(
        annotated,
        f"in {in_count}  out {out_count}  delta {in_count - out_count}",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    if stamp:
        # Zeitstempel unten mit Balken dahinter: Ein Beleg, den jemand
        # weiterreicht, muss ohne die Dateiablage lesbar bleiben.
        h, w = annotated.shape[:2]
        cv2.rectangle(annotated, (0, h - 26), (w, h), (0, 0, 0), -1)
        cv2.putText(
            annotated,
            stamp,
            (8, h - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
    return annotated


def app_base_url() -> str:
    cfg = read_config()
    settings = (cfg.get("settings") or {}) if cfg else {}
    tracker_settings = settings.get("tracker") or {}
    return str(tracker_settings.get("appUrl") or "http://127.0.0.1:3000").rstrip("/")


def context_cam_ids(cam_id: str) -> list[str]:
    """Weitere Blickwinkel laut Config.

    Wird bei jedem Durchgang frisch gelesen (die Config hängt an einem
    mtime-Cache, kostet also praktisch nur ein `stat`). So greift eine
    Änderung im Admin sofort, statt einen Stream-Neustart zu erzwingen —
    für eine Kameraliste wären ein paar Sekunden Blindheit ein schlechter
    Tausch.
    """
    for cam in read_config().get("cams") or []:
        if cam.get("id") == cam_id:
            ids = (cam.get("tailgate") or {}).get("contextCamIds") or []
            return [str(c) for c in ids if c and c != cam_id]
    return []


def grab_context_snapshots(cam_id: str, ts: float, src_cam_ids: list[str]) -> None:
    """Zieht Bilder weiterer Kameras zum Zeitpunkt eines Durchgangs.

    Läuft in einem eigenen Thread: Der Abruf dauert rund eine Viertelsekunde
    und würde die Inferenz sonst bei jedem Durchgang ausbremsen — bei einer
    Gruppe am Drehkreuz mehrfach hintereinander.

    Geholt wird über die App, nicht direkt von der Kamera: Ein per launchd
    gestarteter Prozess kommt unter macOS nicht ohne Weiteres ins lokale
    Netz, die App hat die Freigabe bereits.
    """
    import requests

    base = app_base_url()
    for src in src_cam_ids:
        if not src or src == cam_id:
            continue
        try:
            r = requests.get(
                f"{base}/api/cams/{src}/snapshot",
                headers=app_auth_headers(),
                timeout=6.0,
            )
            if r.ok and r.content:
                save_context_snapshot(cam_id, ts, src, r.content)
            else:
                log.warning(
                    "context snapshot %s: HTTP %s", src, getattr(r, "status_code", "?")
                )
        except Exception as exc:
            log.warning("context snapshot %s failed: %s", src, exc)


def next_local_midnight(now: float) -> float:
    """Zeitstempel des nächsten lokalen Mitternachtswechsels.

    ``mktime`` mit ``tm_isdst=-1`` lässt die Zeitzone selbst entscheiden,
    damit die Umstellung auf Sommer-/Winterzeit den Tageswechsel nicht um
    eine Stunde verschiebt.
    """
    lt = time.localtime(now)
    tomorrow = datetime(lt.tm_year, lt.tm_mon, lt.tm_mday) + timedelta(days=1)
    return time.mktime(
        (tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0, 0, 0, -1)
    )


def worker_loop(cam: dict[str, Any], counter: CamCounter) -> None:
    """Endlosschleife: liest Stream, trackt, zählt. Reconnect bei Fehlern.

    Persistenz: jeder erkannte Crossing-Event wird in eine JSONL-Datei
    pro Cam pro Tag geschrieben (siehe ``people_history.py``). Die
    angezeigten Zähler entsprechen der heutigen Tagessumme — beim
    Sidecar-Start lesen wir die heutige Datei und seeden den Zähler,
    damit Restarts den User-View nicht auf 0 werfen. Läuft der Worker über
    Mitternacht durch, wird zum Tageswechsel neu aus der (dann frischen)
    Tagesdatei geseedet, sonst schleppt die Anzeige den Vortag mit.
    """
    cam_id = cam["id"]
    rtsp = build_rtsp_url(cam)
    line_norm = cam["peopleCounter"]["line"]
    direction = cam["peopleCounter"].get("direction", "ab")

    log.info("worker[%s] start (rtsp=%s)", cam_id, rtsp.replace(cam["password"], "***"))

    # Heutige Tagessumme aus Disk laden — nach Sidecar-Restart bleibt der
    # Counter sichtbar wo er war. Wenn die Datei leer/fehlt: 0/0.
    seeded = load_today_counts(cam_id)
    counter.in_count = seeded["in"]
    counter.out_count = seeded["out"]
    if seeded["in"] or seeded["out"]:
        log.info(
            "worker[%s] hydrated from disk: in=%d out=%d",
            cam_id,
            seeded["in"],
            seeded["out"],
        )

    day_ends_at = next_local_midnight(time.time())

    backoff = 2.0
    # Eigenes Modell pro Cam (ByteTrack-State bleibt isoliert), aber EINMAL
    # pro Worker geladen — nicht pro RTSP-Reconnect. Sonst leakt jeder
    # Reconnect bei instabilen Streams Modell-Gewichte in RAM/GPU.
    model = YOLO(YOLO_MODEL)
    while not counter.stop_event.is_set():
        try:
            # Erste Frame: Auflösung lernen, Linie umrechnen
            cap = cv2.VideoCapture(rtsp, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            ok, frame = cap.read()
            if not ok or frame is None:
                cap.release()
                raise RuntimeError("RTSP-Stream konnte nicht geöffnet werden")
            h, w = frame.shape[:2]
            cap.release()

            start_pt, end_pt = _resolve_line(line_norm, direction, w, h)
            # Totzone relativ zur Bildhöhe, damit sie bei anderen
            # Substream-Auflösungen gleich breit bleibt.
            margin_px = max(6.0, LINE_MARGIN_RATIO * h)
            line_zone = HysteresisLineCounter(start_pt, end_pt, margin_px)

            track_kwargs: dict[str, Any] = {
                "source": rtsp,
                "stream": True,
                "persist": True,
                "classes": [0],  # COCO: 0 = person
                "conf": CONF_THRESHOLD,
                "imgsz": INFER_IMGSZ,
                "max_det": INFER_MAX_DET,
                "verbose": False,
                "tracker": "bytetrack.yaml",
            }
            if DEVICE:
                track_kwargs["device"] = DEVICE

            results = model.track(**track_kwargs)

            box_annotator = sv.BoxAnnotator(thickness=2)
            label_annotator = sv.LabelAnnotator(text_scale=0.5, text_thickness=1)

            frame_idx = 0
            t0 = time.time()
            counter.last_error = None
            backoff = 2.0  # nach erfolgreichem (Re-)Start zurücksetzen

            for result in results:
                if counter.stop_event.is_set():
                    break

                frame_idx += 1
                if FRAME_STRIDE > 1 and frame_idx % FRAME_STRIDE != 0:
                    continue

                # Tageswechsel: Anzeige auf den neuen Tag stellen. Neu aus
                # der Datei lesen statt hart auf 0 zu setzen — hat der Rechner
                # über Mitternacht geschlafen, sind womöglich schon Durchgänge
                # des neuen Tages verbucht.
                now = time.time()
                if now >= day_ends_at:
                    fresh = load_today_counts(cam_id)
                    counter.in_count = fresh["in"]
                    counter.out_count = fresh["out"]
                    day_ends_at = next_local_midnight(now)
                    log.info(
                        "worker[%s] Tageswechsel: Zähler auf in=%d out=%d gesetzt",
                        cam_id,
                        fresh["in"],
                        fresh["out"],
                    )

                detections = sv.Detections.from_ultralytics(result)

                # nur getrackte Personen ans LineZone — alles andere
                # erzeugt sonst keine sinnvollen Crossings
                if detections.tracker_id is not None and len(detections) > 0:
                    crossed = line_zone.trigger(detections)
                    new_in = sum(1 for _, d, _a in crossed if d == "in")
                    new_out = len(crossed) - new_in

                    if crossed:
                        ts_now = time.time()
                        log.info(
                            "worker[%s] CROSSING %s total in=%d out=%d",
                            cam_id,
                            ", ".join(
                                f"#{tid} {d} bei {a:.2f}" for tid, d, a in crossed
                            ),
                            counter.in_count + new_in,
                            counter.out_count + new_out,
                        )
                        # Pro neuem Crossing eine Zeile auf Disk —
                        # Append-Only-JSONL, ein write() pro Event.
                        for _ in range(max(0, new_in)):
                            try:
                                record_crossing(cam_id, "in", ts_now)
                            except Exception as exc:
                                log.warning("persist in[%s] failed: %s", cam_id, exc)
                        for _ in range(max(0, new_out)):
                            try:
                                record_crossing(cam_id, "out", ts_now)
                            except Exception as exc:
                                log.warning("persist out[%s] failed: %s", cam_id, exc)
                        counter.in_count += new_in
                        counter.out_count += new_out

                        # Beleg für den Moment festhalten. Ob der Durchgang
                        # gedeckt war, weiß erst das Dashboard, und dann ist
                        # die Szene längst eine andere.
                        if CROSSING_SNAPSHOTS:
                            frame = result.orig_img
                            if frame is not None:
                                try:
                                    richtung = ", ".join(
                                        sorted(
                                            {
                                                "rein" if d == "in" else "raus"
                                                for _, d, _a in crossed
                                            }
                                        )
                                    )
                                    shot = annotate_frame(
                                        frame,
                                        detections,
                                        start_pt,
                                        end_pt,
                                        margin_px,
                                        counter.in_count,
                                        counter.out_count,
                                        box_annotator,
                                        label_annotator,
                                        stamp=(
                                            time.strftime(
                                                "%d.%m.%Y %H:%M:%S",
                                                time.localtime(ts_now),
                                            )
                                            + f"  {cam_id}  {richtung}"
                                        ),
                                    )
                                    ok, buf = cv2.imencode(
                                        ".jpg", shot, [cv2.IMWRITE_JPEG_QUALITY, 80]
                                    )
                                    if ok:
                                        save_crossing_snapshot(
                                            cam_id, ts_now, buf.tobytes()
                                        )
                                except Exception as exc:
                                    log.warning(
                                        "snapshot[%s] failed: %s", cam_id, exc
                                    )
                            ctx_cams = context_cam_ids(cam_id)
                            if ctx_cams:
                                threading.Thread(
                                    target=grab_context_snapshots,
                                    args=(cam_id, ts_now, ctx_cams),
                                    name=f"ctx-snap-{cam_id}",
                                    daemon=True,
                                ).start()

                counter.last_person_count = len(detections)
                counter.last_update = time.time()

                # Heartbeat-Log alle ~30 Frames (etwa alle 4 s bei stride=2 / 7 fps)
                if frame_idx % 60 == 0 and detections.tracker_id is not None:
                    log.info(
                        "worker[%s] frame=%d persons=%d ids=%s in=%d out=%d fps=%.1f",
                        cam_id,
                        frame_idx,
                        len(detections),
                        list(detections.tracker_id),
                        counter.in_count,
                        counter.out_count,
                        counter.fps,
                    )

                # Annotiertes Debug-JPEG seltener bauen — der /debug-Endpoint
                # ist nur fürs Admin-UI. Bei 15 Frames Stride und 4-8 fps
                # Inferenz ergibt das ~1 JPEG alle 2-4s, völlig ausreichend
                # zum Linien-Justieren. JPEG-Encoding (cv2.imencode + Box-
                # Drawing) ist zwar billig, summiert sich aber bei drei
                # parallelen Workern.
                if frame_idx % 15 == 0:
                    frame = result.orig_img
                    if frame is not None:
                        annotated = annotate_frame(
                            frame,
                            detections,
                            start_pt,
                            end_pt,
                            margin_px,
                            counter.in_count,
                            counter.out_count,
                            box_annotator,
                            label_annotator,
                        )
                        ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        if ok:
                            counter.last_jpeg = buf.tobytes()

                if frame_idx % 30 == 0:
                    dt = counter.last_update - t0
                    if dt > 0:
                        counter.fps = round(frame_idx / dt, 2)

            # Generator zu Ende (Stream-Ende oder stop_event)
            if counter.stop_event.is_set():
                break

        except Exception as exc:  # broad, weil Stream-Probleme vielfältig sind
            counter.last_error = str(exc)
            counter.last_update = time.time()
            log.warning("worker[%s] error: %s — reconnect in %.1fs", cam_id, exc, backoff)
            if counter.stop_event.wait(backoff):
                break
            backoff = min(backoff * 1.5, 30.0)

    log.info("worker[%s] stopped", cam_id)


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------


class TrackerManager:
    def __init__(self) -> None:
        self.counters: dict[str, CamCounter] = {}
        self._lock = threading.Lock()
        # Doorbird-ALPR: ein Worker, lebt parallel zu den Crossing-Workern.
        # `alpr` ist immer angelegt, der Worker schläft wenn ALPR/Doorbird
        # ausgeschaltet ist.
        self.alpr = AlprState()
        self._app_url: str = "http://127.0.0.1:3000"
        # PTZ-Auto: pro Cam ein Worker (patrol/follow/combo). Sync läuft
        # zusammen mit Crossing-Counter-Sync — gleicher Idempotenz-Mechanismus.
        self.ptz_states: dict[str, PtzAutoState] = {}
        self.manual_override = ManualOverride()
        self._ptz_client: PtzHttpClient | None = None

    def _wanted_cams(self) -> list[dict[str, Any]]:
        cfg = read_config()
        if not cfg:
            log.warning("config.json nicht gefunden: %s", CONFIG_PATH)
            return []
        cams = cfg.get("cams", [])
        out: list[dict[str, Any]] = []
        for cam in cams:
            if not cam.get("enabled"):
                continue
            pc = cam.get("peopleCounter") or {}
            if not pc.get("enabled"):
                continue
            if pc.get("mode") != "crossing":
                continue
            line = pc.get("line")
            if not line or len(line) != 2:
                continue
            out.append(cam)
        return out

    def _wanted_ptz(self) -> list[dict[str, Any]]:
        """Cams mit aktivem PTZ-Auto-Modus (patrol/follow/combo)."""
        cfg = read_config()
        if not cfg:
            return []
        out: list[dict[str, Any]] = []
        for cam in cfg.get("cams", []):
            if not cam.get("enabled"):
                continue
            ptz = cam.get("ptzAuto") or {}
            if ptz.get("mode", "off") == "off":
                continue
            out.append(cam)
        return out

    def _ptz_get_app_url(self) -> str:
        cfg = read_config()
        if not cfg:
            return self._app_url
        settings = cfg.get("settings") or {}
        tracker_settings = settings.get("tracker") or {}
        return tracker_settings.get("appUrl") or self._app_url

    def _ensure_ptz_client(self) -> PtzHttpClient:
        url = self._ptz_get_app_url()
        if self._ptz_client is None or self._ptz_client.app_url.rstrip("/") != url.rstrip("/"):
            self._ptz_client = PtzHttpClient(url)
        # PIN kann sich zur Laufzeit ändern — Header pro Sync aktualisieren.
        self._ptz_client.set_auth_token(admin_pin())
        return self._ptz_client

    def _ptz_get_cam_cfg(self, cam_id: str) -> dict[str, Any] | None:
        """Frische Cam-Config (für PTZ-Worker, jeden Tick neu)."""
        cfg = read_config()
        if not cfg:
            return None
        for cam in cfg.get("cams", []):
            if cam.get("id") == cam_id and cam.get("enabled"):
                return cam
        return None

    def sync(self) -> dict[str, Any]:
        """Bringt Worker mit Config in Einklang. Idempotent."""
        with self._lock:
            wanted = {cam["id"]: cam for cam in self._wanted_cams()}
            wanted_hash = {cid: _hash_config(cam) for cid, cam in wanted.items()}

            # 1) Worker stoppen, die nicht mehr gewollt sind oder sich geändert haben
            for cam_id in list(self.counters.keys()):
                counter = self.counters[cam_id]
                if cam_id not in wanted or counter.config_hash != wanted_hash[cam_id]:
                    log.info("stopping worker[%s]", cam_id)
                    counter.stop_event.set()
                    if counter.thread:
                        counter.thread.join(timeout=5)
                    del self.counters[cam_id]

            # 2) neue Worker starten
            started: list[str] = []
            for cam_id, cam in wanted.items():
                if cam_id in self.counters:
                    continue
                counter = CamCounter(cam_id=cam_id, config_hash=wanted_hash[cam_id])
                t = threading.Thread(
                    target=worker_loop,
                    args=(cam, counter),
                    name=f"tracker-{cam_id}",
                    daemon=True,
                )
                counter.thread = t
                self.counters[cam_id] = counter
                t.start()
                started.append(cam_id)

            # 3) PTZ-Auto-Worker mit gleicher Logik
            ptz_started, ptz_stopped = self._sync_ptz()

            return {
                "active": list(self.counters.keys()),
                "started": started,
                "ptzActive": list(self.ptz_states.keys()),
                "ptzStarted": ptz_started,
                "ptzStopped": ptz_stopped,
            }

    def _sync_ptz(self) -> tuple[list[str], list[str]]:
        """Erwartet, dass `self._lock` bereits gehalten wird."""
        wanted_cams = {cam["id"]: cam for cam in self._wanted_ptz()}
        wanted_hash = {
            cid: json.dumps(cam.get("ptzAuto"), sort_keys=True)
            for cid, cam in wanted_cams.items()
        }

        stopped: list[str] = []
        started: list[str] = []

        for cam_id in list(self.ptz_states.keys()):
            st = self.ptz_states[cam_id]
            if cam_id not in wanted_cams or st.config_hash != wanted_hash[cam_id]:
                log.info("stopping ptz-auto[%s]", cam_id)
                st.stop_event.set()
                if st.thread:
                    st.thread.join(timeout=5)
                del self.ptz_states[cam_id]
                stopped.append(cam_id)

        client = self._ensure_ptz_client()

        for cam_id, cam in wanted_cams.items():
            if cam_id in self.ptz_states:
                continue
            mode = cam["ptzAuto"]["mode"]
            st = PtzAutoState(
                cam_id=cam_id,
                mode=mode,
                config_hash=wanted_hash[cam_id],
            )

            def make_get_cfg(cid: str):
                return lambda: self._ptz_get_cam_cfg(cid)

            if mode == "patrol":
                t = threading.Thread(
                    target=patrol_loop,
                    args=(cam_id, st, make_get_cfg(cam_id), client, self.manual_override),
                    name=f"ptz-patrol-{cam_id}",
                    daemon=True,
                )
            else:  # "follow" oder "patrol+follow"
                t = threading.Thread(
                    target=follow_loop,
                    args=(
                        cam_id,
                        st,
                        make_get_cfg(cam_id),
                        client,
                        self.manual_override,
                        YOLO_MODEL,
                        build_rtsp_url,
                        DEVICE,
                        FRAME_STRIDE,
                        CONF_THRESHOLD,
                        INFER_IMGSZ,
                        INFER_MAX_DET,
                    ),
                    name=f"ptz-follow-{cam_id}",
                    daemon=True,
                )
            st.thread = t
            self.ptz_states[cam_id] = st
            t.start()
            started.append(cam_id)
            log.info("started ptz-auto[%s] mode=%s", cam_id, mode)

        return started, stopped

    def stop_all(self) -> None:
        with self._lock:
            for counter in self.counters.values():
                counter.stop_event.set()
            for counter in self.counters.values():
                if counter.thread:
                    counter.thread.join(timeout=5)
            self.counters.clear()
            for st in self.ptz_states.values():
                st.stop_event.set()
            for st in self.ptz_states.values():
                if st.thread:
                    st.thread.join(timeout=5)
            self.ptz_states.clear()
        self.alpr.stop_event.set()
        if self.alpr.thread:
            self.alpr.thread.join(timeout=5)

    def ensure_history_cleanup(self) -> None:
        """Startet einen Daemon-Thread, der einmal pro Stunde alte
        People-History-Dateien wegwirft. Wir machen das nicht inline im
        Worker, weil Cleanup zwar billig ist, aber bei langer Retention
        trotzdem ein paar zehn Files anfasst."""
        if getattr(self, "_history_cleanup_thread", None) is not None:
            return

        def _loop() -> None:
            while True:
                try:
                    cleanup_all_in_root(PEOPLE_HISTORY_RETENTION_DAYS)
                except Exception as exc:
                    log.warning("people history cleanup error: %s", exc)
                try:
                    # Eigene Frist: Die Bilder wiegen deutlich mehr als die
                    # Ereigniszeilen und dürfen früher weg.
                    gone = cleanup_snapshots([], CROSSING_SNAPSHOT_RETENTION_DAYS)
                    if gone:
                        log.info("removed %d snapshot day folders", gone)
                except Exception as exc:
                    log.warning("snapshot cleanup error: %s", exc)
                time.sleep(3600.0)

        t = threading.Thread(
            target=_loop,
            name="people-history-cleanup",
            daemon=True,
        )
        t.start()
        self._history_cleanup_thread = t

    def ensure_alpr_worker(self) -> None:
        """Legt den ALPR-Worker beim ersten Start an.

        Der Worker entscheidet selbst (anhand der Config bei jedem Tick), ob
        er aktiv arbeitet oder kurz schläft — wir spawnen ihn also einmal
        und lassen ihn da. Spart Reconnect-Logik bei Whitelist-Edits.
        """
        if self.alpr.thread is not None and self.alpr.thread.is_alive():
            return
        log.info("starting ALPR worker")
        self.alpr.thread = threading.Thread(
            target=alpr_worker_loop,
            args=(
                self.alpr,
                lambda: self._alpr_snapshot_config(),
                lambda plate, owner: self._alpr_open_door(plate, owner),
                lambda kind, ev: self._alpr_notify(kind, ev),
            ),
            name="alpr",
            daemon=True,
        )
        self.alpr.thread.start()

    def _alpr_snapshot_config(self) -> dict[str, Any] | None:
        cfg = read_config()
        if not cfg:
            return None
        doorbird = cfg.get("doorbird") or {}
        alpr = doorbird.get("alpr") or {}
        settings = cfg.get("settings") or {}
        tracker_settings = settings.get("tracker") or {}
        # AppUrl pro Tick aktualisieren — User kann's umstellen ohne Restart
        self._app_url = tracker_settings.get("appUrl") or self._app_url
        return {"doorbird": doorbird, "alpr": alpr}

    def _alpr_open_door(self, plate: str, owner: str) -> None:
        """Ruft die Next-Route auf — Tür geht physisch über die existierende
        `/api/doorbird/open`-Logik auf, inklusive Audit-Log."""
        import requests

        url = f"{self._app_url.rstrip('/')}/api/doorbird/open"
        r = requests.post(
            url,
            json={"source": "alpr", "plate": plate, "owner": owner},
            headers=app_auth_headers(),
            timeout=5.0,
        )
        if not r.ok:
            raise RuntimeError(f"open-door HTTP {r.status_code}: {r.text[:200]}")

    def _alpr_notify(self, kind: str, ev: Any) -> None:
        """Pingt die Next-App, dass ein ALPR-Event passiert ist, damit dort
        ggf. ein Telegram-Push rausgeht. Best-effort — Fehler werden geschluckt,
        damit der Worker nicht hängen bleibt wenn Next gerade restartet."""
        import requests

        url = f"{self._app_url.rstrip('/')}/api/notify/alpr-event"
        try:
            requests.post(
                url,
                json={
                    "kind": kind,
                    "plate": ev.plate_raw,
                    "plateNorm": ev.plate_norm,
                    "owner": ev.owner,
                    "confidence": ev.confidence,
                    "snapshotId": ev.snapshot_id,
                    "doorOpened": ev.door_opened,
                    "matched": ev.matched,
                    "cooldown": ev.cooldown,
                },
                headers=app_auth_headers(),
                timeout=4.0,
            )
        except Exception as exc:
            log.debug("alpr notify failed: %s", exc)

    def snapshot(self) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        with self._lock:
            for cam_id, c in self.counters.items():
                out[cam_id] = {
                    "in": c.in_count,
                    "out": c.out_count,
                    "delta": c.in_count - c.out_count,
                    "lastUpdate": int(c.last_update * 1000) if c.last_update else 0,
                    "lastError": c.last_error,
                    "fps": c.fps,
                    "personsVisible": c.last_person_count,
                }
        return out

    def get_jpeg(self, cam_id: str) -> bytes | None:
        with self._lock:
            counter = self.counters.get(cam_id)
            return counter.last_jpeg if counter else None

    def reset(self, cam_id: str, *, clear_today: bool = True) -> bool:
        """Setzt die Live-Anzeige auf 0.

        Wenn ``clear_today`` (Default), wird auch die heutige JSONL-Datei
        gelöscht — sonst bleibt sie und das nächste Crossing zählt ab 0
        weiter (alte Events sind dann nur noch in der Aggregat-Statistik
        sichtbar, was selten gewünscht ist). Im Zweifel komplett bereinigen.
        """
        with self._lock:
            counter = self.counters.get(cam_id)
            if not counter:
                return False
            counter.in_count = 0
            counter.out_count = 0
        if clear_today:
            try:
                stats = reset_today(cam_id)
                if stats["removed"]:
                    log.info(
                        "reset[%s]: cleared today's history (in=%d out=%d)",
                        cam_id,
                        stats["in"],
                        stats["out"],
                    )
            except Exception as exc:
                log.warning("reset_today[%s] failed: %s", cam_id, exc)
        return True


manager = TrackerManager()


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("starting tracker (config=%s, model=%s)", CONFIG_PATH, YOLO_MODEL)
    manager.sync()
    manager.ensure_alpr_worker()
    manager.ensure_history_cleanup()
    yield
    log.info("shutting down")
    manager.stop_all()


app = FastAPI(title="webcams-tracker", lifespan=lifespan)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Shared-Secret-Auth: wenn in der Next-App eine Admin-PIN gesetzt ist,
    müssen alle Aufrufe (bis auf /health) den Header ``x-admin-token``
    mitschicken. Die Next-App und der Sidecar teilen sich die config.json,
    brauchen also keinen extra Schlüsselaustausch."""
    if request.url.path != "/health":
        pin = admin_pin()
        if pin and request.headers.get("x-admin-token") != pin:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "workers": list(manager.counters.keys()),
        "model": YOLO_MODEL,
    }


@app.get("/counters")
def counters() -> dict[str, Any]:
    return {"counters": manager.snapshot()}


@app.get("/counters/{cam_id}")
def counter(cam_id: str) -> dict[str, Any]:
    snap = manager.snapshot()
    if cam_id not in snap:
        raise HTTPException(status_code=404, detail="cam not tracked")
    return snap[cam_id]


@app.post("/counters/{cam_id}/reset")
def reset(cam_id: str, clear_history: bool = True) -> dict[str, Any]:
    """Setzt die heutige Tagessumme auf 0.

    Query: ``clear_history=false`` belässt die JSONL-Datei in Ruhe — der
    nächste Crossing-Event wird neu eingetragen, bestehende Einträge
    bleiben aber Teil der Aggregat-Statistik. Default ist ``true``, weil
    User „auf 0" üblicherweise auch im Tagesverlauf erwarten.
    """
    if not manager.reset(cam_id, clear_today=clear_history):
        raise HTTPException(status_code=404, detail="cam not tracked")
    return {"ok": True, "clearedHistory": clear_history}


@app.get("/counters/{cam_id}/history")
def counter_history(cam_id: str, days: int = 7) -> dict[str, Any]:
    """Tagesweise Aggregate für die letzten ``days`` Tage.

    Auch verfügbar, wenn der Worker für die Cam gar nicht (mehr) läuft —
    so kann das UI Statistiken alter Cams anzeigen.
    """
    days = max(1, min(365, days))
    return {
        "camId": cam_id,
        "days": aggregate_days(cam_id, days),
    }


@app.get("/counters/{cam_id}/recent")
def counter_recent(cam_id: str, limit: int = 50) -> dict[str, Any]:
    """Letzte N Crossing-Events (für Debug/Live-Tail im UI)."""
    limit = max(1, min(2000, limit))
    return {
        "camId": cam_id,
        "events": list_recent_events(
            cam_id, limit=limit, snapshot_days=max(1, CROSSING_SNAPSHOT_RETENTION_DAYS)
        ),
    }


@app.get("/counters/{cam_id}/snapshot/{ts}.jpg")
def crossing_snapshot(cam_id: str, ts: int, src: str | None = None) -> Response:
    """Das Bild zum Durchgang — ohne `src` das der Zählkamera, sonst das
    einer weiteren Kamera aus demselben Moment."""
    path = snapshot_file(cam_id, ts, src)
    if path is None:
        raise HTTPException(status_code=404, detail="no snapshot")
    return Response(
        content=path.read_bytes(),
        media_type="image/jpeg",
        # Der Zeitstempel ist eindeutig, das Bild ändert sich nie mehr.
        headers={"Cache-Control": "private, max-age=86400"},
    )


@app.post("/reload")
def reload_config() -> dict[str, Any]:
    return manager.sync()


@app.get("/debug/{cam_id}/snapshot.jpg")
def debug_snapshot(cam_id: str) -> Response:
    jpeg = manager.get_jpeg(cam_id)
    if jpeg is None:
        raise HTTPException(status_code=404, detail="no frame yet")
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# ALPR-Endpoints
# ---------------------------------------------------------------------------


@app.get("/alpr/status")
def alpr_status() -> dict[str, Any]:
    a = manager.alpr
    return {
        "enabled": a.enabled,
        "lastSeenPlate": a.last_seen_plate,
        "lastSeenAt": int(a.last_seen_at * 1000) if a.last_seen_at else 0,
        "lastTickAt": int(a.last_tick_at * 1000) if a.last_tick_at else 0,
        "lastError": a.last_error,
        "fps": a.fps,
        "cooldowns": {
            plate_norm: int(until * 1000)
            for plate_norm, until in a.cooldown_until.items()
            if until > time.time()
        },
    }


@app.get("/alpr/events")
def alpr_events(limit: int = 100) -> dict[str, Any]:
    return {"events": manager.alpr.list_events(limit=limit)}


@app.get("/alpr/snapshot/{snapshot_id}.jpg")
def alpr_snapshot(snapshot_id: str) -> Response:
    """In-Memory-Cache zuerst (heiß, neueste 200 Events), dann Disk-Fallback
    für historische Aufrufe."""
    jpeg = manager.alpr.get_snapshot(snapshot_id)
    if jpeg is None:
        jpeg = get_persisted_snapshot(snapshot_id)
    if jpeg is None:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=600"},
    )


@app.get("/alpr/history")
def alpr_history(
    from_ms: int | None = None,
    to_ms: int | None = None,
    plate: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Filterbare Historie aus der persistenten events.jsonl.

    Filter:
        from_ms / to_ms  – Zeitfenster (epoch ms)
        plate            – Substring-Match auf normalisiertem Plate
        status           – "opened" | "matched" | "unauthorized" | "all"
    """
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    return list_history(
        from_ms=from_ms,
        to_ms=to_ms,
        plate_substring=plate,
        status=status,
        limit=limit,
        offset=offset,
    )


# ---------------------------------------------------------------------------
# PTZ-Auto-Endpoints
# ---------------------------------------------------------------------------


@app.get("/ptz-auto/status")
def ptz_auto_status() -> dict[str, Any]:
    """Snapshot über alle aktiven PTZ-Auto-Worker."""
    out: dict[str, Any] = {}
    for cam_id, st in manager.ptz_states.items():
        out[cam_id] = {
            "mode": st.mode,
            "subState": st.sub_state,
            "lastAction": st.last_action,
            "lastError": st.last_error,
            "lastUpdate": int(st.last_update * 1000) if st.last_update else 0,
            "lastTargetAt": int(st.last_target_at * 1000) if st.last_target_at else 0,
            "lastTargetId": st.last_target_id,
            "patrolIdx": st.patrol_idx,
            "fps": st.fps,
            "manualOverrideRemaining": round(
                manager.manual_override.remaining(cam_id), 1
            ),
        }
    return {"ptz": out}


@app.post("/ptz-auto/manual-override")
def ptz_auto_manual_override(body: dict[str, Any]) -> dict[str, Any]:
    """Wird von der Next-App gerufen, wenn der User manuell PTZ steuert.

    Body: {"camId": "cam-shop", "holdSec": 90}  (holdSec optional)
    """
    cam_id = str(body.get("camId") or "").strip()
    if not cam_id:
        raise HTTPException(status_code=400, detail="camId required")
    hold = float(body.get("holdSec") or 90.0)
    manager.manual_override.touch(cam_id, hold_sec=hold)
    return {
        "ok": True,
        "camId": cam_id,
        "remaining": round(manager.manual_override.remaining(cam_id), 1),
    }


@app.post("/alpr/test")
def alpr_test() -> dict[str, Any]:
    """Holt sofort einen Doorbird-Snapshot und schickt ihn durch die
    Pipeline. Antwort: erkannte Plates + ob sie auf der Whitelist stünden.
    Öffnet die Tür **nicht** — pure Diagnose."""
    cfg = manager._alpr_snapshot_config()
    if cfg is None:
        raise HTTPException(status_code=400, detail="no config")
    if not cfg["doorbird"].get("enabled"):
        raise HTTPException(status_code=400, detail="doorbird disabled")

    from alpr import (  # type: ignore
        WhitelistEntry,
        _normalize_plate,
        detect_and_recognize,
        fetch_doorbird_snapshot,
    )

    try:
        jpeg = fetch_doorbird_snapshot(
            cfg["doorbird"]["ip"],
            cfg["doorbird"]["username"],
            cfg["doorbird"]["password"],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"doorbird: {exc}") from exc

    try:
        results = detect_and_recognize(jpeg)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"alpr: {exc}") from exc

    whitelist = [
        WhitelistEntry.from_dict(d) for d in cfg["alpr"].get("whitelist") or []
    ]
    by_norm = {w.plate_norm: w for w in whitelist}
    now = datetime.now()

    detected = []
    for text, conf, bbox in results:
        norm = _normalize_plate(text)
        entry = by_norm.get(norm)
        detected.append(
            {
                "plate": text,
                "plateNorm": norm,
                "confidence": round(conf, 3),
                "bbox": list(bbox),
                "matched": entry is not None and entry.is_active_now(now),
                "owner": entry.owner if entry else None,
            }
        )

    # Snapshot mit Boxen annotieren und unter eigener ID cachen
    img = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is not None:
        for d in detected:
            x1, y1, x2, y2 = d["bbox"]
            color = (60, 220, 60) if d["matched"] else (60, 60, 220)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            label = f"{d['plate']} {d['confidence']:.2f}"
            cv2.putText(
                img,
                label,
                (x1, max(15, y1 - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
                cv2.LINE_AA,
            )
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            jpeg = buf.tobytes()

    snapshot_id = f"test-{int(time.time() * 1000)}"
    manager.alpr.snapshots[snapshot_id] = jpeg
    manager.alpr.snapshots_order.append(snapshot_id)

    return {"snapshotId": snapshot_id, "detected": detected}
