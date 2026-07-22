"""
PTZ-Auto-Pilot pro Cam.

Drei Modi laut `cam.ptzAuto.mode`:

    "patrol"        Cycle durch eine Preset-Liste, je `dwellSec` Sekunden.
                    Kein YOLO nötig — leichter Worker.
    "follow"        YOLO+ByteTrack auf dem Stream, Target-Mittelpunkt
                    zentriert halten via Left/Right/Up/Down Pulses,
                    optional Zoom.
    "patrol+follow" Patrol läuft als Default; sobald YOLO ein Target sieht
                    übernimmt Follow. Nach `returnHomeAfterSec` ohne
                    Target → Patrol resumen.

Reolink-Consumer-Cams haben **keine absolute Position-API**. Wir bewegen
mit kurzen Pulses: `Left` → kurz warten → `Stop`. Min-Abstand zwischen
Pulses, sonst beschwert sich die Firmware mit „timeout".

Manual-Override: Wenn der User per UI manuell PTZ steuert, ruft die
Next-Route `/ptz/manual-override` auf den Sidecar. Wir pausieren dann
für `MANUAL_OVERRIDE_SEC` Sekunden — sonst kämpft der Auto-Pilot gegen
den User.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import cv2
import numpy as np
import requests

log = logging.getLogger("ptz")

# Pause nach manuellem Eingriff. Großzügig, weil der User ja typisch ein
# bisschen rumprobiert.
MANUAL_OVERRIDE_SEC = 90.0

# Minimaler Abstand zwischen zwei PtzCtrl-Calls auf derselben Cam, sonst
# schmeißt Reolink "timeout"-Errors.
MIN_PULSE_GAP_S = 0.35

# COCO-IDs der Klassen, die wir verfolgen können.
COCO_CLASSES = {
    "person": [0],
    "car": [1, 2, 3, 5, 7],  # bicycle, car, motorbike, bus, truck
    "any": [0, 1, 2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],  # +Tiere
}


# ---------------------------------------------------------------------------
# PTZ-HTTP-Client (ruft die Next-App-Routes auf)
# ---------------------------------------------------------------------------


class PtzHttpClient:
    """Thin Wrapper um die Next-Routes /api/cams/<id>/ptz und /preset.

    Wir nutzen die Next-Routes statt direkt Reolink — so haben wir Audit-Log
    und Rechte-Checks an einer Stelle.

    Reolink-PtzCtrl ist eine "press-and-hold"-Logik: ein `Left`-Befehl bewegt
    die Cam kontinuierlich bis zum nächsten `Stop`. Wir nutzen das für den
    `continuous`-Modus, der dadurch deutlich glatter läuft als Pulse-Spam.
    """

    def __init__(self, app_url: str) -> None:
        self.app_url = app_url.rstrip("/")
        self._session = requests.Session()
        self._last_call: dict[str, float] = {}
        self._lock = threading.Lock()

    def set_auth_token(self, token: str) -> None:
        """Admin-PIN der Next-App als Shared Secret (Header ``x-admin-token``)."""
        if token:
            self._session.headers["x-admin-token"] = token
        else:
            self._session.headers.pop("x-admin-token", None)

    def _throttle(self, cam_id: str) -> None:
        with self._lock:
            last = self._last_call.get(cam_id, 0.0)
            wait = MIN_PULSE_GAP_S - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            self._last_call[cam_id] = time.time()

    def start(self, cam_id: str, op: str, speed: int) -> bool:
        """Bewegung starten — nicht warten, nicht stoppen.

        Reolink fährt dann weiter, bis explizit `stop()` kommt. Liefert True
        bei HTTP 2xx. Wir loggen Fehler, werfen aber nicht — Auto-Pilot soll
        nicht crashen wenn die Cam mal kurz weg ist.
        """
        self._throttle(cam_id)
        try:
            r = self._session.post(
                f"{self.app_url}/api/cams/{cam_id}/ptz",
                json={"op": op, "speed": int(speed), "_source": "ptz-auto"},
                timeout=4.0,
            )
            return r.ok
        except Exception as exc:
            log.warning("ptz start[%s] %s failed: %s", cam_id, op, exc)
            return False

    def stop(self, cam_id: str) -> bool:
        self._throttle(cam_id)
        try:
            r = self._session.post(
                f"{self.app_url}/api/cams/{cam_id}/ptz",
                json={"op": "Stop", "_source": "ptz-auto"},
                timeout=4.0,
            )
            return r.ok
        except Exception as exc:
            log.warning("ptz stop[%s] failed: %s", cam_id, exc)
            return False

    def pulse(self, cam_id: str, op: str, speed: int, duration_ms: int) -> None:
        """Klassisches Pulse-Verfahren: start → sleep → stop. Wird nur noch
        im "pulse"-Mode benutzt (z.B. für Zoom-Korrekturen)."""
        if not self.start(cam_id, op, speed):
            return
        time.sleep(max(0.05, duration_ms / 1000.0))
        self.stop(cam_id)

    def preset(self, cam_id: str, preset_id: int) -> None:
        self._throttle(cam_id)
        try:
            r = self._session.post(
                f"{self.app_url}/api/cams/{cam_id}/preset",
                json={"op": "ToPos", "presetId": int(preset_id), "_source": "ptz-auto"},
                timeout=5.0,
            )
            if not r.ok:
                log.warning(
                    "ptz preset[%s -> %d] HTTP %d: %s",
                    cam_id,
                    preset_id,
                    r.status_code,
                    r.text[:200],
                )
        except Exception as exc:
            log.warning("ptz preset[%s -> %d] failed: %s", cam_id, preset_id, exc)


# ---------------------------------------------------------------------------
# Auto-Pilot-State
# ---------------------------------------------------------------------------


@dataclass
class PtzAutoState:
    cam_id: str
    mode: str = "off"
    sub_state: str = "idle"  # "patrol" | "follow" | "homing" | "paused"
    last_target_at: float = 0.0
    last_target_id: int | None = None
    last_action: str = ""
    last_error: str | None = None
    last_update: float = 0.0
    patrol_idx: int = 0
    fps: float = 0.0
    config_hash: str = ""
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


# Globale Manual-Override-Tabelle. Next-Routes schreiben hier rein, Worker
# lesen.
class ManualOverride:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._until: dict[str, float] = {}

    def touch(self, cam_id: str, hold_sec: float = MANUAL_OVERRIDE_SEC) -> None:
        with self._lock:
            self._until[cam_id] = time.time() + hold_sec

    def is_active(self, cam_id: str) -> bool:
        with self._lock:
            t = self._until.get(cam_id, 0.0)
        return t > time.time()

    def remaining(self, cam_id: str) -> float:
        with self._lock:
            t = self._until.get(cam_id, 0.0)
        return max(0.0, t - time.time())


# ---------------------------------------------------------------------------
# Schedule-Helpers
# ---------------------------------------------------------------------------


def _patrol_active_now(schedule: dict[str, Any] | None) -> bool:
    """Prüft ob laut `schedule` (weekdays + from/to HH:MM) gerade Patrol-Zeit ist."""
    if not schedule:
        return True
    now = datetime.now()
    weekdays = schedule.get("weekdays") or []
    if weekdays:
        # Schema: 0=So, 1=Mo, …, 6=Sa (JS-Konvention)
        js_weekday = (now.weekday() + 1) % 7
        if js_weekday not in weekdays:
            return False
    f = schedule.get("from")
    t = schedule.get("to")
    if f and t:
        cur = now.strftime("%H:%M")
        if f <= t:
            return f <= cur <= t
        return cur >= f or cur <= t  # Übernacht
    return True


# ---------------------------------------------------------------------------
# Patrol-only Worker (kein YOLO)
# ---------------------------------------------------------------------------


def patrol_loop(
    cam_id: str,
    state: PtzAutoState,
    get_cfg: "callable",
    ptz: PtzHttpClient,
    manual: ManualOverride,
) -> None:
    log.info("patrol[%s] start", cam_id)
    last_move = 0.0
    while not state.stop_event.is_set():
        cam = get_cfg()
        if cam is None or cam["ptzAuto"]["mode"] != "patrol":
            # Modus-Wechsel oder Cam weg → Worker beendet sich
            break

        if manual.is_active(cam_id):
            state.sub_state = "paused"
            state.last_action = f"manual-override {manual.remaining(cam_id):.0f}s"
            if state.stop_event.wait(2.0):
                break
            continue

        patrol = cam["ptzAuto"]["patrol"]
        presets = patrol.get("presetIds") or []
        dwell = float(patrol.get("dwellSec", 20))
        sched = patrol.get("schedule")

        if not presets:
            state.sub_state = "idle"
            state.last_error = "Keine Presets"
            if state.stop_event.wait(5.0):
                break
            continue
        state.last_error = None

        if not _patrol_active_now(sched):
            state.sub_state = "paused"
            state.last_action = "außerhalb des Zeitfensters"
            if state.stop_event.wait(30.0):
                break
            continue

        state.sub_state = "patrol"
        if state.patrol_idx >= len(presets):
            state.patrol_idx = 0
        target = presets[state.patrol_idx]

        if time.time() - last_move >= dwell:
            log.info("patrol[%s] -> preset %d", cam_id, target)
            ptz.preset(cam_id, target)
            state.last_action = f"preset {target}"
            state.last_update = time.time()
            last_move = time.time()
            state.patrol_idx = (state.patrol_idx + 1) % len(presets)

        if state.stop_event.wait(0.5):
            break

    state.sub_state = "stopped"
    log.info("patrol[%s] stopped", cam_id)


# ---------------------------------------------------------------------------
# Follow-Worker (YOLO+ByteTrack)
# ---------------------------------------------------------------------------


def _pick_target(
    detections,
    target_classes: list[int],
    sticky_id: int | None,
) -> tuple[int, float, float, float, float, int | None] | None:
    """Wählt das beste Target aus.

    Heuristik:
        1. Wenn `sticky_id` noch im Bild ist → nimm den (Stabilität).
        2. Sonst: größte Bounding-Box (= näheste Person).
    """
    if detections is None or len(detections) == 0:
        return None
    if detections.tracker_id is None:
        return None

    boxes = detections.xyxy
    classes = detections.class_id
    track_ids = detections.tracker_id

    candidates = []
    for i in range(len(detections)):
        cls = int(classes[i])
        if cls not in target_classes:
            continue
        x1, y1, x2, y2 = (float(v) for v in boxes[i])
        area = (x2 - x1) * (y2 - y1)
        candidates.append((i, x1, y1, x2, y2, area, int(track_ids[i])))

    if not candidates:
        return None

    if sticky_id is not None:
        for c in candidates:
            if c[6] == sticky_id:
                _, x1, y1, x2, y2, _, tid = c
                return (1, x1, y1, x2, y2, tid)

    candidates.sort(key=lambda c: c[5], reverse=True)
    _, x1, y1, x2, y2, _, tid = candidates[0]
    return (0, x1, y1, x2, y2, tid)


def _direction_from_offset(
    dx: float, dy: float, inner: float
) -> str | None:
    """Mappt normalisierte Offsets auf Reolink-PTZ-Op.

    `inner` ist die innere Deadband — Achsen mit |offset| <= inner werden
    nicht berücksichtigt. So entstehen automatisch Diagonalen, wenn beide
    Achsen "ausreichend" off sind.
    """
    use_x = abs(dx) > inner
    use_y = abs(dy) > inner
    if not use_x and not use_y:
        return None
    if use_x and use_y:
        if dx > 0 and dy > 0:
            return "RightDown"
        if dx > 0 and dy < 0:
            return "RightUp"
        if dx < 0 and dy > 0:
            return "LeftDown"
        return "LeftUp"
    if use_x:
        return "Right" if dx > 0 else "Left"
    return "Down" if dy > 0 else "Up"


def _proportional_speed(
    offset: float, smin: int, smax: int
) -> int:
    """Skaliert Speed linear vom Min bis Max anhand des normalisierten
    Offsets. Vollgas erreicht die Cam ab ~50 % vom Frame-Rand — das fühlt
    sich natürlich an, ohne übersteuern."""
    norm = min(1.0, abs(offset) / 0.5)
    return int(round(smin + (smax - smin) * norm))


def _speed_bucket(speed: int) -> int:
    """Reolink lässt sich Speed-Updates während laufender Bewegung nicht
    sauber zuschicken — wir würden für jede Mini-Speed-Änderung Stop+Start
    brauchen. Daher gruppieren wir in 4er-Buckets, wechseln nur bei echtem
    Bucket-Wechsel."""
    return speed // 8


def follow_loop(
    cam_id: str,
    state: PtzAutoState,
    get_cfg: "callable",
    ptz: PtzHttpClient,
    manual: ManualOverride,
    yolo_model: str,
    rtsp_builder: "callable",
    device: str,
    frame_stride: int,
    conf_threshold: float,
    imgsz: int = 480,
    max_det: int = 20,
    idle_frame_stride: int = 6,
    idle_after_sec: float = 30.0,
) -> None:
    """Endlosschleife mit YOLO-Tracking + smoother PTZ-Steuerung.

    Pipeline pro Frame:
        1. YOLO+ByteTrack → Detections
        2. Sticky-Pick: bevorzugt das Target von letztem Frame
        3. EMA-Glättung von (cx, cy) → Wackler raus
        4. Velocity aus Differenz zur letzten Position
        5. Latenz-Vorhersage: aim-ahead um latencyCompMs
        6. Hysterese: in der inneren Deadband Stop, erst nach Verlassen der
           äußeren Deadband wieder Bewegung
        7. Diagonal-Op (LeftUp/RightDown/…) wenn beide Achsen aus-Toleranz
        8. Proportionale Speed (speedMin..speedMax)
        9. Continuous-Mode: Reolink fährt durchgehend, bis Stop oder
           Richtungs-/Speed-Bucket-Wechsel

    Pulse-Mode (Legacy) ist als `controlMode: "pulse"` weiter verfügbar."""
    from ultralytics import YOLO  # late import — ist die teure Dep

    log.info("follow[%s] start", cam_id)
    backoff = 2.0

    while not state.stop_event.is_set():
        cam = get_cfg()
        if cam is None or cam["ptzAuto"]["mode"] not in ("follow", "patrol+follow"):
            break

        try:
            rtsp = rtsp_builder(cam)
            cap = cv2.VideoCapture(rtsp, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            ok, frame = cap.read()
            if not ok or frame is None:
                cap.release()
                raise RuntimeError("RTSP konnte nicht gelesen werden")
            h, w = frame.shape[:2]
            cap.release()

            model = YOLO(yolo_model)

            track_kwargs: dict[str, Any] = {
                "source": rtsp,
                "stream": True,
                "persist": True,
                "conf": conf_threshold,
                "imgsz": imgsz,
                "max_det": max_det,
                "verbose": False,
                "tracker": "bytetrack.yaml",
            }
            if device:
                track_kwargs["device"] = device

            results = model.track(**track_kwargs)

            frame_idx = 0
            t0 = time.time()
            patrol_idx = 0
            patrol_last_move = 0.0
            state.last_error = None

            # Continuous-Mode-State (lokal pro Stream-Connection)
            current_op: str | None = None      # aktuell laufende Bewegung
            current_speed_bucket: int = -1
            last_op_change: float = 0.0
            last_zoom_at: float = 0.0
            # Glättung
            cx_smooth: float | None = None
            cy_smooth: float | None = None
            # Velocity in normierten Koordinaten/sec
            vx: float = 0.0
            vy: float = 0.0
            last_smooth_t: float = 0.0
            # Wieviele Frames in Folge ohne Target — dient als Stop-Debouncer
            no_target_streak: int = 0

            import supervision as sv  # late import

            def stop_motion(reason: str = "") -> None:
                """Stoppt aktuell laufende Bewegung, falls eine läuft."""
                nonlocal current_op, current_speed_bucket
                if current_op is not None:
                    if reason:
                        log.info("follow[%s] STOP (%s)", cam_id, reason)
                    ptz.stop(cam_id)
                    current_op = None
                    current_speed_bucket = -1

            for result in results:
                if state.stop_event.is_set():
                    break

                cam = get_cfg()
                if cam is None or cam["ptzAuto"]["mode"] not in (
                    "follow",
                    "patrol+follow",
                ):
                    stop_motion("config change")
                    break

                ptz_cfg = cam["ptzAuto"]
                follow_cfg = ptz_cfg["follow"]
                target_classes = COCO_CLASSES.get(
                    follow_cfg.get("targetClass", "person"), COCO_CLASSES["person"]
                )

                frame_idx += 1
                # Adaptive Frame-Rate: solange ein Target verfolgt wird,
                # zählt jeder Frame (`frame_stride`). Wenn längere Zeit
                # kein Target gesehen wurde, droppt das auf
                # `idle_frame_stride` — wir brauchen keine 8 fps Inferenz
                # nur um zu prüfen "ist da was?". Das halbiert die
                # CPU-Last in Patrol/Idle-Phasen drastisch.
                idle_now = (
                    state.last_target_at > 0
                    and (time.time() - state.last_target_at) > idle_after_sec
                )
                effective_stride = (
                    idle_frame_stride if idle_now else frame_stride
                )
                if effective_stride > 1 and frame_idx % effective_stride != 0:
                    continue

                state.last_update = time.time()
                dt = state.last_update - t0
                if dt > 0:
                    state.fps = round(frame_idx / dt, 2)

                if manual.is_active(cam_id):
                    stop_motion("manual override")
                    state.sub_state = "paused"
                    state.last_action = (
                        f"manual-override {manual.remaining(cam_id):.0f}s"
                    )
                    cx_smooth = cy_smooth = None
                    continue

                detections = sv.Detections.from_ultralytics(result)
                if detections.class_id is not None and len(detections) > 0:
                    keep = np.isin(detections.class_id, np.array(target_classes))
                    detections = detections[keep]

                target = _pick_target(detections, target_classes, state.last_target_id)

                # Config-Werte
                inner = float(follow_cfg.get("deadbandPct", 0.06))
                outer = float(follow_cfg.get("outerDeadbandPct", 0.10))
                if outer < inner:
                    outer = inner
                control_mode = follow_cfg.get("controlMode", "continuous")
                speed_min = int(follow_cfg.get("speedMin", 6))
                speed_max = int(follow_cfg.get("speedMax", 40))
                alpha = float(follow_cfg.get("smoothingAlpha", 0.45))
                lookahead_s = float(follow_cfg.get("latencyCompMs", 300)) / 1000.0
                max_pulse_ms = int(follow_cfg.get("maxPulseMs", 200))

                if target is not None:
                    no_target_streak = 0
                    _, x1, y1, x2, y2, tid = target
                    if state.last_target_id != tid:
                        # Sticky-ID-Wechsel → EMA reseten, sonst springt's
                        cx_smooth = cy_smooth = None
                        vx = vy = 0.0
                    state.last_target_id = tid
                    state.last_target_at = time.time()
                    state.sub_state = "follow"

                    cx_raw = (x1 + x2) / 2.0 / w  # 0..1
                    cy_raw = (y1 + y2) / 2.0 / h
                    box_h = y2 - y1

                    now = time.time()
                    # 1) EMA-Glättung
                    if cx_smooth is None or cy_smooth is None:
                        cx_smooth, cy_smooth = cx_raw, cy_raw
                    else:
                        cx_prev, cy_prev = cx_smooth, cy_smooth
                        cx_smooth = alpha * cx_raw + (1 - alpha) * cx_smooth
                        cy_smooth = alpha * cy_raw + (1 - alpha) * cy_smooth
                        # 2) Velocity aus zwei aufeinanderfolgenden EMA-Werten
                        if last_smooth_t > 0:
                            d_t = max(1e-3, now - last_smooth_t)
                            # Velocity selbst auch glätten, sonst springt sie
                            # bei Frame-Aussetzern
                            vx_new = (cx_smooth - cx_prev) / d_t
                            vy_new = (cy_smooth - cy_prev) / d_t
                            vx = 0.5 * vx_new + 0.5 * vx
                            vy = 0.5 * vy_new + 0.5 * vy
                    last_smooth_t = now

                    # 3) Latenz-Vorhersage (cap auf ±0.4, sonst überschießt's)
                    cx_pred = cx_smooth + max(-0.4, min(0.4, vx * lookahead_s))
                    cy_pred = cy_smooth + max(-0.4, min(0.4, vy * lookahead_s))

                    # 4) Normierte Offsets (-1..+1, vom Frame-Mittelpunkt)
                    dx = (cx_pred - 0.5) * 2.0
                    dy = (cy_pred - 0.5) * 2.0
                    offset_mag = max(abs(dx), abs(dy))

                    # 5) Hysterese-State-Machine
                    #    - Wenn aktuell bewegt: erst stoppen, wenn Target im
                    #      INNEREN Deadband
                    #    - Wenn aktuell Stop: erst wieder starten, wenn Target
                    #      die äußere Deadband verlässt
                    if current_op is not None:
                        if abs(dx) <= inner and abs(dy) <= inner:
                            stop_motion("inside inner deadband")
                            state.last_action = "deadband"
                            continue
                    else:
                        if abs(dx) <= outer and abs(dy) <= outer:
                            # Im Hysterese-Bereich, kein Move starten
                            state.sub_state = "follow"
                            state.last_action = "hold"
                            # Trotzdem Zoom regeln (s.u.)
                        # else: weiter unten Bewegung berechnen

                    # 6) Wunschrichtung
                    wanted_op = _direction_from_offset(dx, dy, inner)
                    wanted_speed = _proportional_speed(
                        offset_mag, speed_min, speed_max
                    )
                    wanted_bucket = _speed_bucket(wanted_speed)

                    if wanted_op is None:
                        # Innerhalb innerer Deadband
                        stop_motion("no-op")
                    elif control_mode == "pulse":
                        # Klassisches Pulse-Verhalten
                        if (
                            time.time() - last_op_change
                            >= MIN_PULSE_GAP_S
                        ):
                            log.info(
                                "follow[%s] tid=%d dx=%+.2f dy=%+.2f vx=%+.2f vy=%+.2f -> %s @s=%d (pulse)",
                                cam_id,
                                tid,
                                dx,
                                dy,
                                vx,
                                vy,
                                wanted_op,
                                wanted_speed,
                            )
                            ptz.pulse(
                                cam_id, wanted_op, wanted_speed, max_pulse_ms
                            )
                            state.last_action = (
                                f"{wanted_op} ({max_pulse_ms}ms @{wanted_speed})"
                            )
                            last_op_change = time.time()
                    else:
                        # CONTINUOUS-Mode
                        # Wenn Op oder Speed-Bucket sich ändern → Stop+Start
                        op_changed = wanted_op != current_op
                        bucket_changed = wanted_bucket != current_speed_bucket
                        if op_changed or bucket_changed:
                            if current_op is not None:
                                ptz.stop(cam_id)
                            ok = ptz.start(cam_id, wanted_op, wanted_speed)
                            if ok:
                                current_op = wanted_op
                                current_speed_bucket = wanted_bucket
                                last_op_change = time.time()
                                state.last_action = (
                                    f"{wanted_op} @{wanted_speed} (cont.)"
                                )
                                log.info(
                                    "follow[%s] tid=%d dx=%+.2f dy=%+.2f vx=%+.2f vy=%+.2f -> %s @s=%d",
                                    cam_id,
                                    tid,
                                    dx,
                                    dy,
                                    vx,
                                    vy,
                                    wanted_op,
                                    wanted_speed,
                                )

                    # 7) Optional Zoom (immer Pulse, weil Zoom nicht durchgehend
                    #    auf Geschwindigkeit angepasst werden muss)
                    if follow_cfg.get("zoomEnabled"):
                        target_ratio = float(follow_cfg.get("zoomTargetRatio", 0.4))
                        cur_ratio = box_h / float(h)
                        # Zoom nur ungestört regeln wenn keine Bewegung läuft
                        # — sonst kämpft Zoom gegen Pan
                        if (
                            current_op is None
                            and time.time() - last_zoom_at >= 0.8
                        ):
                            zoom_pulse = 200
                            zoom_speed = max(8, speed_min)
                            if cur_ratio < target_ratio * 0.75:
                                ptz.pulse(cam_id, "ZoomInc", zoom_speed, zoom_pulse)
                                last_zoom_at = time.time()
                            elif cur_ratio > target_ratio * 1.25:
                                ptz.pulse(cam_id, "ZoomDec", zoom_speed, zoom_pulse)
                                last_zoom_at = time.time()

                else:
                    # Kein Target im Bild
                    no_target_streak += 1
                    age = time.time() - state.last_target_at
                    return_after = float(follow_cfg.get("returnHomeAfterSec", 15))

                    # Bewegung nach 2 Frames ohne Target stoppen — robuster
                    # gegen kurze YOLO-Aussetzer (Person hinter Hindernis)
                    if no_target_streak >= 2:
                        stop_motion("target lost")
                        cx_smooth = cy_smooth = None
                        vx = vy = 0.0

                    if state.last_target_id is not None and age >= return_after:
                        log.info("follow[%s] target lost", cam_id)
                        state.last_target_id = None

                    if ptz_cfg["mode"] == "patrol+follow":
                        if state.last_target_id is None and age >= return_after:
                            patrol = ptz_cfg["patrol"]
                            presets = patrol.get("presetIds") or []
                            dwell = float(patrol.get("dwellSec", 20))
                            sched = patrol.get("schedule")
                            if presets and _patrol_active_now(sched):
                                state.sub_state = "patrol"
                                if patrol_idx >= len(presets):
                                    patrol_idx = 0
                                if time.time() - patrol_last_move >= dwell:
                                    target_p = presets[patrol_idx]
                                    log.info(
                                        "follow[%s] (patrol-fallback) -> preset %d",
                                        cam_id,
                                        target_p,
                                    )
                                    ptz.preset(cam_id, target_p)
                                    state.last_action = f"preset {target_p}"
                                    patrol_last_move = time.time()
                                    patrol_idx = (patrol_idx + 1) % len(presets)
                            else:
                                state.sub_state = "idle"
                    else:
                        home = follow_cfg.get("homePresetId")
                        if (
                            home is not None
                            and age >= return_after
                            and state.sub_state != "homing"
                        ):
                            log.info("follow[%s] homing -> preset %d", cam_id, home)
                            ptz.preset(cam_id, home)
                            state.last_action = f"home preset {home}"
                            state.sub_state = "homing"
                        else:
                            state.sub_state = "idle" if age > 2.0 else "follow"

            # Stream-Iter zu Ende → laufende Bewegung definitiv stoppen
            stop_motion("stream end")
            backoff = 2.0
            if state.stop_event.is_set():
                break
        except Exception as exc:
            state.last_error = str(exc)
            log.warning(
                "follow[%s] error: %s — reconnect in %.1fs", cam_id, exc, backoff
            )
            # Bei Crash: laufende Bewegung sicherheitshalber stoppen
            try:
                ptz.stop(cam_id)
            except Exception:
                pass
            if state.stop_event.wait(backoff):
                break
            backoff = min(backoff * 1.5, 30.0)

    # Sauber stoppen, falls Worker beendet wird
    try:
        ptz.stop(cam_id)
    except Exception:
        pass
    state.sub_state = "stopped"
    log.info("follow[%s] stopped", cam_id)
