"""
Automatic License Plate Recognition (ALPR) für die Doorbird-Cam.

Pipeline pro Tick:

    Doorbird-Snapshot (HTTP, Digest-Auth)
        │
        ▼
    open-image-models  →  bbox(es) für Plate-Regionen
        │
        ▼
    fast-plate-ocr     →  Text + Confidence pro bbox
        │
        ▼
    Whitelist-Check (normalisiert) + optionales Zeitfenster
        │
        ▼
    N-aus-N Confirmation (z.B. 3 Frames in Folge denselben Plate)
        │
        ▼
    Cooldown-Check pro Schild
        │
        ▼
    POST {appUrl}/api/doorbird/open  (Loopback)
        │
        ▼
    Audit-Event (in-memory + Snapshot-Cache)
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import shutil
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
import requests

log = logging.getLogger("alpr")

# Persistent-Storage-Root (überschreibbar über Env). Default: <repo>/logs/alpr.
# Hier landet `events.jsonl` (Append-Only) und das `snapshots/YYYY-MM-DD/`
# Verzeichnis mit den JPEGs. main.py setzt das via env, falls die Config
# woanders liegt — sonst wird vom Modul-Pfad aus relativ gerechnet.
def _default_history_root() -> Path:
    env = os.environ.get("WEBCAMS_ALPR_HISTORY_DIR")
    if env:
        return Path(env)
    # alpr.py liegt in tracker/, repo-root ist Parent.
    return Path(__file__).resolve().parent.parent / "logs" / "alpr"


HISTORY_ROOT = _default_history_root()
EVENTS_FILE = HISTORY_ROOT / "events.jsonl"
SNAPSHOTS_DIR = HISTORY_ROOT / "snapshots"

# Schreibe-Lock — die Worker-Loop schreibt sequenziell, aber falls jemals
# parallel test/persistence laufen wird, schadet ein Lock nicht.
_PERSIST_LOCK = threading.Lock()


def _ensure_history_dirs() -> None:
    HISTORY_ROOT.mkdir(parents=True, exist_ok=True)
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)


def _snapshot_path(snapshot_id: str, ts: float) -> Path:
    """Pfad pro Tag — verteilt die Inodes über Datums-Ordner, sonst
    werden's in einem einzelnen Verzeichnis schnell zehntausende."""
    day = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    return SNAPSHOTS_DIR / day / f"{snapshot_id}.jpg"

# Lazy: Modelle werden erst beim ersten Worker-Start geladen — sonst
# bezahlen wir die ~80 MB Speicher auch dann, wenn ALPR aus ist.
_lp_detector = None
_lp_ocr = None


def _load_models() -> None:
    global _lp_detector, _lp_ocr
    if _lp_detector is not None:
        return
    # Imports hier drinnen, damit Sidecar auch ohne diese Pakete startet
    # (sind dicke Deps mit ONNX-Runtime).
    from open_image_models import LicensePlateDetector  # type: ignore
    from fast_plate_ocr import LicensePlateRecognizer  # type: ignore

    log.info("loading ALPR models …")
    _lp_detector = LicensePlateDetector(
        detection_model="yolo-v9-t-384-license-plate-end2end"
    )
    # Dediziertes EU-Modell — speziell auf europäische Schilder trainiert,
    # liefert deutlich bessere Resultate für DE/AT/CH-Plates als das
    # generische Global-Modell.
    _lp_ocr = LicensePlateRecognizer("european-plates-mobile-vit-v2-model")
    log.info("ALPR models ready")


def _normalize_plate(s: str) -> str:
    """Vergleich nur in Großbuchstaben, ohne Whitespace und Trennzeichen.

    'B-AB 1234' und 'BAB1234' werden also als gleicher Plate gewertet.
    """
    return "".join(ch for ch in s.upper() if ch.isalnum())


# ---------------------------------------------------------------------------
# Datenstrukturen
# ---------------------------------------------------------------------------


@dataclass
class WhitelistEntry:
    plate: str
    plate_norm: str
    owner: str = ""
    enabled: bool = True
    weekdays: list[int] = field(default_factory=list)
    from_hhmm: str | None = None
    to_hhmm: str | None = None
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "WhitelistEntry":
        return cls(
            plate=d.get("plate", ""),
            plate_norm=_normalize_plate(d.get("plate", "")),
            owner=d.get("owner", "") or "",
            enabled=bool(d.get("enabled", True)),
            weekdays=list(d.get("weekdays") or []),
            from_hhmm=d.get("from"),
            to_hhmm=d.get("to"),
            notes=d.get("notes", "") or "",
        )

    def is_active_now(self, now: datetime) -> bool:
        if not self.enabled:
            return False
        # Schema speichert weekdays in JS-Konvention (0=So, 1=Mo, …, 6=Sa).
        # Python `weekday()` ist 0=Mo, 6=So → einmal sauber konvertieren.
        if self.weekdays:
            js_weekday = (now.weekday() + 1) % 7
            if js_weekday not in self.weekdays:
                return False
        if self.from_hhmm and self.to_hhmm:
            cur = now.strftime("%H:%M")
            if self.from_hhmm <= self.to_hhmm:
                if not (self.from_hhmm <= cur <= self.to_hhmm):
                    return False
            else:
                # Übernacht-Slot, z.B. 22:00 → 06:00
                if not (cur >= self.from_hhmm or cur <= self.to_hhmm):
                    return False
        return True


@dataclass
class AlprEvent:
    ts: float
    plate_raw: str
    plate_norm: str
    confidence: float
    owner: str | None
    matched: bool
    cooldown: bool
    door_opened: bool
    door_open_error: str | None
    snapshot_id: str  # SHA-1 der JPEG-Bytes, für /alpr/snapshot/{id}


@dataclass
class AlprState:
    enabled: bool = False
    last_seen_plate: str = ""
    last_seen_at: float = 0.0
    confirm_buffer: deque = field(default_factory=lambda: deque(maxlen=10))
    cooldown_until: dict[str, float] = field(default_factory=dict)
    events: deque = field(default_factory=lambda: deque(maxlen=200))
    snapshots: dict[str, bytes] = field(default_factory=dict)
    snapshots_order: deque = field(default_factory=lambda: deque(maxlen=200))
    last_error: str | None = None
    last_tick_at: float = 0.0
    fps: float = 0.0
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    config_hash: str = ""
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add_event(self, ev: AlprEvent, snapshot_jpeg: bytes | None) -> None:
        with self._lock:
            self.events.appendleft(ev)
            if snapshot_jpeg:
                self.snapshots[ev.snapshot_id] = snapshot_jpeg
                self.snapshots_order.append(ev.snapshot_id)
                # Auch die Snapshot-Tabelle deckeln (200 Einträge).
                while len(self.snapshots_order) > 200:
                    drop = self.snapshots_order.popleft()
                    self.snapshots.pop(drop, None)
        # Persistenz außerhalb des State-Locks — Disk-IO kann mal 50ms dauern,
        # solange wollen wir die anderen Reader nicht blockieren.
        if snapshot_jpeg:
            try:
                _persist_event(ev, snapshot_jpeg)
            except Exception as exc:
                log.warning("alpr persistence failed: %s", exc)

    def list_events(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            out: list[dict[str, Any]] = []
            for ev in list(self.events)[:limit]:
                out.append(_event_to_dict(ev))
            return out

    def get_snapshot(self, snapshot_id: str) -> bytes | None:
        with self._lock:
            return self.snapshots.get(snapshot_id)


# ---------------------------------------------------------------------------
# Persistenz: events.jsonl (append-only) + snapshots/YYYY-MM-DD/<id>.jpg
# ---------------------------------------------------------------------------


def _event_to_dict(ev: AlprEvent) -> dict[str, Any]:
    return {
        "ts": int(ev.ts * 1000),
        "plate": ev.plate_raw,
        "plateNorm": ev.plate_norm,
        "confidence": round(ev.confidence, 3),
        "owner": ev.owner,
        "matched": ev.matched,
        "cooldown": ev.cooldown,
        "doorOpened": ev.door_opened,
        "doorOpenError": ev.door_open_error,
        "snapshotId": ev.snapshot_id,
    }


def _persist_event(ev: AlprEvent, jpeg: bytes) -> None:
    """Schreibt JPEG nach <SNAPSHOTS_DIR>/<YYYY-MM-DD>/<id>.jpg und hängt
    eine JSON-Zeile an events.jsonl. Rein additiv — die Datei wird nie
    umgeschrieben, nur durch retention-cleanup gekürzt (siehe
    `cleanup_history`)."""
    with _PERSIST_LOCK:
        _ensure_history_dirs()
        path = _snapshot_path(ev.snapshot_id, ev.ts)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomar schreiben: erst .tmp, dann rename — verhindert halbe JPEGs
        # falls das Programm mitten im Write stirbt.
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(jpeg)
        os.replace(tmp, path)

        line = json.dumps(_event_to_dict(ev), ensure_ascii=False)
        with EVENTS_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def _read_all_events() -> list[dict[str, Any]]:
    """Lädt die komplette Historie (newest first). Bei nicht existierender
    Datei liefert wir `[]`, bei kaputten Zeilen werden die ignoriert."""
    if not EVENTS_FILE.exists():
        return []
    out: list[dict[str, Any]] = []
    with EVENTS_FILE.open("r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                out.append(json.loads(raw))
            except Exception:
                # Unleserliche Zeilen einfach skippen — kann z.B. passieren,
                # wenn die Datei mitten in einem Schreib-Vorgang aufgerufen
                # wird (sehr unwahrscheinlich, aber kein Grund zu crashen).
                continue
    out.reverse()
    return out


def list_history(
    *,
    from_ms: int | None = None,
    to_ms: int | None = None,
    plate_substring: str | None = None,
    status: str | None = None,  # "opened" | "matched" | "unauthorized" | "all"
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Filtert über die persistierten Events.

    `status`:
        - "opened"        – nur Events bei denen die Tür auch wirklich aufging
        - "matched"       – Whitelist-Treffer (egal ob Tür durch Cooldown blockiert war)
        - "unauthorized"  – erkannte Plates, die nicht auf der Whitelist sind
        - sonst           – alles
    """
    events = _read_all_events()
    plate_norm_query = (
        "".join(ch for ch in (plate_substring or "").upper() if ch.isalnum())
        if plate_substring
        else ""
    )

    filtered: list[dict[str, Any]] = []
    for ev in events:
        if from_ms is not None and ev.get("ts", 0) < from_ms:
            continue
        if to_ms is not None and ev.get("ts", 0) > to_ms:
            continue
        if plate_norm_query and plate_norm_query not in (ev.get("plateNorm") or ""):
            continue
        if status == "opened" and not ev.get("doorOpened"):
            continue
        if status == "matched" and not ev.get("matched"):
            continue
        if status == "unauthorized" and ev.get("matched"):
            continue
        filtered.append(ev)

    total = len(filtered)
    page = filtered[offset : offset + limit]
    return {"events": page, "total": total, "offset": offset, "limit": limit}


def get_persisted_snapshot(snapshot_id: str) -> bytes | None:
    """Sucht das JPEG zu einer Snapshot-ID auf der Platte.

    Wir wissen das Datum nicht zwingend (Frontend hat nur die ID), also
    probieren wir alle Datums-Ordner durch — kostet bei dreistelligen
    Tagen ~ms und ist deutlich einfacher als ein zusätzlicher Index.
    """
    if not SNAPSHOTS_DIR.exists():
        return None
    # Schnellpfad: heute / gestern zuerst, danach Rückwärtsiteration
    today = datetime.now()
    candidates = [
        SNAPSHOTS_DIR / (today - timedelta(days=d)).strftime("%Y-%m-%d") / f"{snapshot_id}.jpg"
        for d in range(0, 3)
    ]
    for p in candidates:
        if p.exists():
            return p.read_bytes()
    # Fallback: alle Tages-Ordner durchgehen
    for day_dir in sorted(SNAPSHOTS_DIR.iterdir(), reverse=True):
        if not day_dir.is_dir():
            continue
        p = day_dir / f"{snapshot_id}.jpg"
        if p.exists():
            return p.read_bytes()
    return None


def cleanup_history(retention_days: int) -> dict[str, int]:
    """Löscht Snapshot-Ordner, die älter als `retention_days` Tage sind.

    JSONL-Events bleiben erhalten — die sind klein und nützlich für
    Statistik. Wenn das Bild fehlt zeigt das Frontend halt einen
    Platzhalter.
    """
    if retention_days <= 0:
        return {"removedDirs": 0, "removedFiles": 0}
    if not SNAPSHOTS_DIR.exists():
        return {"removedDirs": 0, "removedFiles": 0}

    cutoff = datetime.now() - timedelta(days=retention_days)
    cutoff_str = cutoff.strftime("%Y-%m-%d")

    removed_dirs = 0
    removed_files = 0
    for day_dir in SNAPSHOTS_DIR.iterdir():
        if not day_dir.is_dir():
            continue
        if day_dir.name >= cutoff_str:
            continue
        try:
            n = sum(1 for _ in day_dir.iterdir())
            shutil.rmtree(day_dir)
            removed_dirs += 1
            removed_files += n
        except Exception as exc:
            log.warning("cleanup of %s failed: %s", day_dir, exc)
    if removed_dirs:
        log.info(
            "alpr retention: removed %d day-folders, %d snapshots (older than %s)",
            removed_dirs,
            removed_files,
            cutoff_str,
        )
    return {"removedDirs": removed_dirs, "removedFiles": removed_files}


# ---------------------------------------------------------------------------
# Doorbird-Snapshot (Digest-Auth)
# ---------------------------------------------------------------------------


_doorbird_session = requests.Session()


def fetch_doorbird_snapshot(ip: str, user: str, password: str, timeout: float = 4.0) -> bytes:
    """Holt ein JPEG vom Doorbird /bha-api/image.cgi.

    Nutzt requests.auth.HTTPDigestAuth — das wechselt automatisch von
    Basic auf Digest, je nach was die Doorbird-Firmware verlangt.
    """
    from requests.auth import HTTPDigestAuth

    url = f"http://{ip}/bha-api/image.cgi"
    r = _doorbird_session.get(url, auth=HTTPDigestAuth(user, password), timeout=timeout)
    if r.status_code == 401:
        # Fallback Basic
        from requests.auth import HTTPBasicAuth

        r = _doorbird_session.get(url, auth=HTTPBasicAuth(user, password), timeout=timeout)
    r.raise_for_status()
    return r.content


# ---------------------------------------------------------------------------
# Detection + OCR
# ---------------------------------------------------------------------------


def _decode_jpeg(buf: bytes) -> np.ndarray | None:
    arr = np.frombuffer(buf, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def detect_and_recognize(jpeg: bytes) -> list[tuple[str, float, tuple[int, int, int, int]]]:
    """Liefert Liste von (text, conf, bbox=(x1,y1,x2,y2)) je gefundenes Schild."""
    _load_models()
    assert _lp_detector is not None and _lp_ocr is not None

    img = _decode_jpeg(jpeg)
    if img is None:
        return []

    detections = _lp_detector.predict(img)
    out: list[tuple[str, float, tuple[int, int, int, int]]] = []
    h, w = img.shape[:2]

    for det in detections:
        # open_image_models gibt eine bbox-Klasse zurück mit .x1/.y1/.x2/.y2
        x1 = max(0, int(det.bounding_box.x1))
        y1 = max(0, int(det.bounding_box.y1))
        x2 = min(w, int(det.bounding_box.x2))
        y2 = min(h, int(det.bounding_box.y2))
        if x2 <= x1 or y2 <= y1:
            continue
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        # fast_plate_ocr 1.x: run() liefert eine Liste `PlatePrediction`s,
        # je mit `.plate` (str) und `.char_probs` (np.ndarray | None).
        # Wir rechnen die Mittel-Confidence aus den per-character Wahrsch.
        try:
            preds = _lp_ocr.run(crop, return_confidence=True)
        except Exception as exc:  # OCR kann einzelne Crops zerschießen
            log.debug("OCR error on crop: %s", exc)
            continue
        if not preds:
            continue
        pred = preds[0]
        text = (pred.plate or "").strip()
        if not text:
            continue
        if pred.char_probs is not None:
            try:
                # char_probs hat shape (chars, vocab) — pro Position das Max
                # ist die Confidence des gewählten Zeichens.
                conf = float(np.mean(np.max(pred.char_probs, axis=-1)))
            except Exception:
                conf = 0.5
        else:
            conf = 0.5
        out.append((text, conf, (x1, y1, x2, y2)))
    return out


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------


def _now_hash(b: bytes) -> str:
    return hashlib.sha1(b).hexdigest()[:16]


def alpr_worker_loop(
    state: AlprState,
    get_config_snapshot: "callable",
    open_door_callback: "callable",
    notify_callback: "callable | None" = None,
) -> None:
    """`get_config_snapshot` liefert bei jedem Tick einen frischen
    `(doorbird_dict, alpr_dict, app_url, config_hash)` — der Worker selbst
    bleibt also stehen, holt sich aktuelle Konfiguration aber jeden Tick.

    `open_door_callback(plate, owner)` ruft die Tür-Öffnen-Aktion auf.

    `notify_callback(kind, ev)` — optional. Wird nach dem Persist eines
    Events aufgerufen, mit `kind` aus {"matched", "unauthorized", "cooldown"}.
    Damit kann die Next-App per HTTP über Telegram-Toggles entscheiden,
    ob ein Push verschickt wird. Nicht-blockierend gehalten — Fehler
    werden geschluckt damit der Worker nicht stehen bleibt.
    """
    backoff = 1.0
    tick_count = 0
    t0 = time.time()
    next_cleanup_at = 0.0  # erstes Cleanup direkt im ersten aktiven Tick

    # Beim Start die letzten 200 persistierten Events ins In-Memory-State
    # spiegeln, damit die Live-Tab nach Sidecar-Restart nicht leer ist.
    # `list_history` liefert newest first → reversed iterieren + appendleft,
    # damit der neueste Eintrag am Ende wieder vorn liegt.
    try:
        recent = list_history(limit=200, offset=0).get("events", [])
        for ev_dict in reversed(recent):
            ev = AlprEvent(
                ts=ev_dict.get("ts", 0) / 1000.0,
                plate_raw=ev_dict.get("plate", ""),
                plate_norm=ev_dict.get("plateNorm", ""),
                confidence=float(ev_dict.get("confidence", 0.0)),
                owner=ev_dict.get("owner"),
                matched=bool(ev_dict.get("matched", False)),
                cooldown=bool(ev_dict.get("cooldown", False)),
                door_opened=bool(ev_dict.get("doorOpened", False)),
                door_open_error=ev_dict.get("doorOpenError"),
                snapshot_id=ev_dict.get("snapshotId", ""),
            )
            with state._lock:
                state.events.appendleft(ev)
        if recent:
            log.info("alpr worker: hydrated %d events from disk", len(recent))
    except Exception as exc:
        log.warning("alpr hydration failed: %s", exc)

    while not state.stop_event.is_set():
        try:
            cfg = get_config_snapshot()
        except Exception as exc:
            state.last_error = f"config: {exc}"
            if state.stop_event.wait(2.0):
                break
            continue

        # Defensiv lesen — Bestand-configs haben das alpr-Feld evtl. gar nicht.
        alpr_cfg = (cfg or {}).get("alpr") or {}
        doorbird_cfg = (cfg or {}).get("doorbird") or {}

        if (
            cfg is None
            or not alpr_cfg.get("enabled", False)
            or not doorbird_cfg.get("enabled", False)
        ):
            # ALPR oder Doorbird deaktiviert → schlafen, Worker nicht killen
            state.enabled = False
            if state.stop_event.wait(1.0):
                break
            continue

        state.enabled = True
        base_interval_s = float(alpr_cfg.get("intervalMs", 1500)) / 1000.0
        min_conf = float(alpr_cfg.get("minConfidence", 0.85))
        confirm_n = int(alpr_cfg.get("confirmFrames", 3))
        cooldown_s = int(alpr_cfg.get("cooldownSec", 300))
        retention_days = int(alpr_cfg.get("retentionDays", 60))

        # Adaptives Polling: Wenn länger nichts erkannt wurde, vergrößern
        # wir den Intervall stufenweise bis 5s. Sobald wieder was kommt,
        # zurück auf den konfigurierten Wert. Spart bei "leerer Einfahrt"
        # ~70% der Doorbird-Snapshots + ALPR-Inference.
        idle_for = (time.time() - state.last_seen_at) if state.last_seen_at else 9999
        if idle_for < 60:
            interval_s = base_interval_s
        elif idle_for < 300:
            interval_s = max(base_interval_s, 2.5)
        else:
            interval_s = max(base_interval_s, 5.0)

        # Retention-Cleanup einmal pro Stunde (oder beim ersten Tick)
        now_t = time.time()
        if now_t >= next_cleanup_at:
            try:
                cleanup_history(retention_days)
            except Exception as exc:
                log.warning("alpr retention cleanup failed: %s", exc)
            next_cleanup_at = now_t + 3600.0

        whitelist = [
            WhitelistEntry.from_dict(d) for d in alpr_cfg.get("whitelist") or []
        ]
        whitelist_norm = {w.plate_norm: w for w in whitelist}

        try:
            jpeg = fetch_doorbird_snapshot(
                doorbird_cfg.get("ip", ""),
                doorbird_cfg.get("username", ""),
                doorbird_cfg.get("password", ""),
            )
        except Exception as exc:
            state.last_error = f"doorbird: {exc}"
            log.warning("doorbird snapshot failed: %s — backoff %.1fs", exc, backoff)
            if state.stop_event.wait(backoff):
                break
            backoff = min(backoff * 1.5, 15.0)
            continue
        backoff = 1.0

        try:
            results = detect_and_recognize(jpeg)
        except Exception as exc:
            state.last_error = f"alpr: {exc}"
            log.warning("ALPR pipeline error: %s", exc)
            results = []

        state.last_tick_at = time.time()
        tick_count += 1
        dt = state.last_tick_at - t0
        if dt > 0:
            state.fps = round(tick_count / dt, 2)

        if not results:
            # Kein Plate → Confirmation-Buffer leeren, sonst zählt ein
            # Frame-Lücken-loser Plate-Wechsel als Confirmation.
            state.confirm_buffer.append("")
        else:
            # Bester Plate dieses Frames (höchste Confidence)
            best = max(results, key=lambda r: r[1])
            text, conf, _bbox = best
            text_norm = _normalize_plate(text)

            if conf < min_conf or not text_norm:
                state.confirm_buffer.append("")
            else:
                state.last_seen_plate = text
                state.last_seen_at = time.time()
                state.confirm_buffer.append(text_norm)

                # 2-aus-3 / N-aus-N: letzte N Frames müssen denselben Plate haben
                recent = list(state.confirm_buffer)[-confirm_n:]
                confirmed = (
                    len(recent) == confirm_n
                    and len(set(recent)) == 1
                    and recent[0] != ""
                    and recent[0] == text_norm
                )

                if confirmed:
                    entry = whitelist_norm.get(text_norm)
                    matched = entry is not None and entry.is_active_now(datetime.now())
                    cooldown_active = (
                        text_norm in state.cooldown_until
                        and time.time() < state.cooldown_until[text_norm]
                    )
                    door_opened = False
                    door_open_error: str | None = None

                    if matched and not cooldown_active:
                        try:
                            open_door_callback(text, entry.owner if entry else "")
                            door_opened = True
                            state.cooldown_until[text_norm] = time.time() + cooldown_s
                            log.info(
                                "ALPR OPEN plate=%s owner=%s conf=%.2f cooldown=%ds",
                                text,
                                entry.owner if entry else "",
                                conf,
                                cooldown_s,
                            )
                            # Confirm-Buffer leeren, sonst triggert's gleich nochmal
                            state.confirm_buffer.clear()
                        except Exception as exc:
                            door_open_error = str(exc)
                            log.error("door-open failed: %s", exc)

                    snapshot_id = _now_hash(jpeg)
                    ev = AlprEvent(
                        ts=time.time(),
                        plate_raw=text,
                        plate_norm=text_norm,
                        confidence=conf,
                        owner=(entry.owner if entry else None),
                        matched=matched,
                        cooldown=cooldown_active,
                        door_opened=door_opened,
                        door_open_error=door_open_error,
                        snapshot_id=snapshot_id,
                    )
                    state.add_event(ev, jpeg)

                    # Notify-Hook für Telegram & Co. Wir wählen genau eine
                    # Kategorie pro Event:
                    #   matched + door_opened  → "matched"
                    #   matched + cooldown     → "cooldown"
                    #   nicht matched          → "unauthorized"
                    # Door-Open-Notify selbst läuft schon über die Next-Route
                    # `/api/doorbird/open` — daher müssen wir „matched" nur
                    # senden, wenn der User explizit den Toggle dafür hat.
                    if notify_callback is not None:
                        if matched and door_opened:
                            kind = "matched"
                        elif matched and cooldown_active:
                            kind = "cooldown"
                        else:
                            kind = "unauthorized"
                        try:
                            notify_callback(kind, ev)
                        except Exception as exc:
                            log.debug("notify_callback error: %s", exc)

        if state.stop_event.wait(interval_s):
            break

    log.info("ALPR worker stopped")
