"""
Persistente Historie für die Crossing-Counter.

Layout auf Disk::

    logs/people/<cam_id>/<YYYY-MM-DD>.jsonl   ← eine Zeile pro Crossing-Event
        {"t": 1715361234567, "d": "in"}
        {"t": 1715361234890, "d": "out"}
        ...

Wir partitionieren pro Tag, damit Retention (alte Tage löschen) und schnelle
"heute"-Reads trivial sind. Das Format ist absichtlich kurz — bei 100 Events
am Tag sind das ~3 kB pro Cam.

Die Persistierung läuft synchron im Worker-Thread. Der Append ist ein
einzelner write() auf eine Append-Only-Datei und unkritisch (~ms).

Nichts hier ist Crash-frei wenn man mitten in einem Write den Saft zieht —
worst case verliert man das letzte Event. Atomar zu schreiben würde rename
pro Event verlangen, was hier overkill ist.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

log = logging.getLogger("people_history")


def _default_root() -> Path:
    env = os.environ.get("WEBCAMS_PEOPLE_HISTORY_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "logs" / "people"


HISTORY_ROOT = _default_root()

# Locks pro Cam — verhindert Race-Conditions zwischen Worker-Append und
# Reset/Read. Locks werden lazy angelegt.
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(cam_id: str) -> threading.Lock:
    with _LOCKS_GUARD:
        lk = _LOCKS.get(cam_id)
        if lk is None:
            lk = threading.Lock()
            _LOCKS[cam_id] = lk
        return lk


def _cam_dir(cam_id: str) -> Path:
    return HISTORY_ROOT / cam_id


def _file_for(cam_id: str, ts: float | None = None) -> Path:
    when = datetime.fromtimestamp(ts) if ts is not None else datetime.now()
    day = when.strftime("%Y-%m-%d")
    return _cam_dir(cam_id) / f"{day}.jsonl"


def record_crossing(cam_id: str, direction: str, ts: float | None = None) -> None:
    """Hängt einen Crossing-Event an die heutige Datei an.

    `direction` ist "in" oder "out". Andere Werte werden zugelassen, falls
    wir mal mehr Richtungen brauchen.
    """
    if not cam_id:
        return
    when = ts if ts is not None else time.time()
    path = _file_for(cam_id, when)
    line = json.dumps({"t": int(when * 1000), "d": direction}, ensure_ascii=False)
    lk = _lock_for(cam_id)
    with lk:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def _snap_dir(cam_id: str, ts_ms: int) -> Path:
    day = datetime.fromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d")
    return _cam_dir(cam_id) / "snaps" / day


def save_crossing_snapshot(cam_id: str, ts: float, jpeg: bytes) -> None:
    """Legt das Bild ab, in dem ein Durchgang erkannt wurde.

    Ob ein Durchgang gedeckt war, stellt sich erst Minuten später heraus —
    dann ist die Szene längst eine andere. Deshalb wird zum Zeitpunkt des
    Durchgangs gespeichert und erst hinterher entschieden, welches Bild man
    braucht.

    Der Dateiname ist der Zeitstempel des Events, damit sich Bild und Zeile
    in der JSONL ohne Zusatzindex zuordnen lassen. Gehen mehrere Personen im
    selben Frame über die Linie, teilen sie sich das Bild — es ist ja dasselbe.
    """
    if not cam_id or not jpeg:
        return
    ts_ms = int(ts * 1000)
    path = _snap_dir(cam_id, ts_ms) / f"{ts_ms}.jpg"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(jpeg)
    except Exception as exc:
        log.warning("snapshot %s failed: %s", path, exc)


def snapshot_file(cam_id: str, ts_ms: int) -> Path | None:
    path = _snap_dir(cam_id, ts_ms) / f"{ts_ms}.jpg"
    return path if path.is_file() else None


def _snapshot_stamps(cam_id: str, days: int) -> set[int]:
    """Vorhandene Bild-Zeitstempel der letzten Tage.

    Ein Verzeichnis-Listing pro Tag statt einer Existenzprüfung pro Event —
    bei mehreren hundert Durchgängen macht das den Unterschied.
    """
    out: set[int] = set()
    today = datetime.now().date()
    for offset in range(max(1, days)):
        day = (today - timedelta(days=offset)).isoformat()
        d = _cam_dir(cam_id) / "snaps" / day
        if not d.is_dir():
            continue
        for f in d.iterdir():
            if f.suffix == ".jpg" and f.stem.isdigit():
                out.add(int(f.stem))
    return out


def cleanup_snapshots(cam_ids: list[str], retention_days: int) -> int:
    """Löscht Bild-Tagesordner älter als `retention_days`.

    Getrennt von der Aufbewahrung der Ereigniszeilen: Die JSONL sind winzig
    und dürfen lange liegen, die Bilder sind es nicht.
    """
    if retention_days <= 0:
        return 0
    cutoff = (datetime.now().date() - timedelta(days=retention_days)).isoformat()
    removed = 0
    roots = [_cam_dir(c) / "snaps" for c in cam_ids] if cam_ids else []
    if not roots and HISTORY_ROOT.exists():
        roots = [d / "snaps" for d in HISTORY_ROOT.iterdir() if d.is_dir()]
    for root in roots:
        if not root.is_dir():
            continue
        for d in root.iterdir():
            if d.is_dir() and d.name < cutoff:
                try:
                    shutil.rmtree(d)
                    removed += 1
                except Exception as exc:
                    log.warning("cleanup %s failed: %s", d, exc)
    return removed


def _read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.exists():
        return
    try:
        with path.open("r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    yield json.loads(raw)
                except Exception:
                    # kaputte Zeilen ignorieren — passieren bei abrupter
                    # Sidecar-Beendigung mitten im Append (sehr selten)
                    continue
    except Exception as exc:  # pragma: no cover — disk-error
        log.warning("read %s failed: %s", path, exc)


def load_today_counts(cam_id: str) -> dict[str, int]:
    """Liest die heutige Datei und liefert {in, out}-Summe.

    Wird beim Worker-Start aufgerufen, damit der Counter nach Sidecar-Restart
    die heutige Tagessumme zeigt statt bei 0 anzufangen.
    """
    path = _file_for(cam_id)
    in_count = 0
    out_count = 0
    lk = _lock_for(cam_id)
    with lk:
        for ev in _read_jsonl(path):
            d = ev.get("d")
            if d == "in":
                in_count += 1
            elif d == "out":
                out_count += 1
    return {"in": in_count, "out": out_count}


def aggregate_days(cam_id: str, days: int = 7) -> list[dict[str, Any]]:
    """Liefert pro Tag {date, in, out, delta} der letzten `days` Tage.

    Der heutige Tag ist der letzte Eintrag, fehlende Tage tauchen mit
    in=0/out=0 auf. So kann das UI bequem eine Sparkline rendern.
    """
    days = max(1, min(365, days))
    out: list[dict[str, Any]] = []
    today = datetime.now().date()
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        path = _cam_dir(cam_id) / f"{d.isoformat()}.jsonl"
        in_c = 0
        out_c = 0
        for ev in _read_jsonl(path):
            di = ev.get("d")
            if di == "in":
                in_c += 1
            elif di == "out":
                out_c += 1
        out.append(
            {
                "date": d.isoformat(),
                "in": in_c,
                "out": out_c,
                "delta": in_c - out_c,
            }
        )
    return out


def reset_today(cam_id: str) -> dict[str, int]:
    """Löscht die heutige Datei. Returnt was gelöscht wurde, damit der
    Caller sein Reset-Audit-Log füllen kann."""
    path = _file_for(cam_id)
    lk = _lock_for(cam_id)
    with lk:
        if not path.exists():
            return {"in": 0, "out": 0, "removed": 0}
        in_c = 0
        out_c = 0
        for ev in _read_jsonl(path):
            di = ev.get("d")
            if di == "in":
                in_c += 1
            elif di == "out":
                out_c += 1
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return {"in": in_c, "out": out_c, "removed": in_c + out_c}


def cleanup_history(cam_ids: list[str], retention_days: int) -> int:
    """Löscht Tagesdateien älter als `retention_days`.

    Bei `retention_days <= 0` keine Bereinigung — z.B. wenn der User die
    Historie unbegrenzt halten will. Returnt Anzahl gelöschter Dateien.
    """
    if retention_days <= 0:
        return 0
    cutoff = (datetime.now().date() - timedelta(days=retention_days)).isoformat()
    removed = 0
    for cam_id in cam_ids:
        cam_dir = _cam_dir(cam_id)
        if not cam_dir.exists():
            continue
        for f in cam_dir.iterdir():
            if not f.is_file() or not f.name.endswith(".jsonl"):
                continue
            day = f.stem  # "2026-04-30"
            if day < cutoff:
                try:
                    f.unlink()
                    removed += 1
                except Exception as exc:
                    log.warning("cleanup %s failed: %s", f, exc)
    if removed:
        log.info("people history: removed %d files older than %s", removed, cutoff)
    return removed


def list_recent_events(
    cam_id: str, limit: int = 100, snapshot_days: int = 30
) -> list[dict[str, Any]]:
    """Letzte N Events (heute zuerst, dann gestern, …) — für Debug/UI.

    Erzeugt `[{ts, dir, snap}, ...]`. `snap` sagt, ob zu dem Event ein Bild
    vorliegt; die Bilder werden kürzer aufbewahrt als die Zeilen. Bricht ab
    sobald `limit` erreicht ist; durchwühlt also nicht das ganze Archiv.
    """
    cam_dir = _cam_dir(cam_id)
    if not cam_dir.exists():
        return []
    files = sorted(
        (f for f in cam_dir.iterdir() if f.is_file() and f.name.endswith(".jsonl")),
        reverse=True,
    )
    stamps = _snapshot_stamps(cam_id, snapshot_days)
    out: list[dict[str, Any]] = []
    for f in files:
        events = list(_read_jsonl(f))
        for ev in reversed(events):
            ts = ev.get("t", 0)
            out.append({"ts": ts, "dir": ev.get("d", ""), "snap": ts in stamps})
            if len(out) >= limit:
                return out
    return out


def cleanup_all_in_root(retention_days: int) -> int:
    """Variante von `cleanup_history`, ohne Liste — putzt einfach was
    auf der Platte ist. Wird vom Worker periodisch aufgerufen, ohne dass
    er die aktuelle Cam-Liste kennen muss."""
    if retention_days <= 0:
        return 0
    if not HISTORY_ROOT.exists():
        return 0
    cutoff = (datetime.now().date() - timedelta(days=retention_days)).isoformat()
    removed = 0
    for cam_dir in HISTORY_ROOT.iterdir():
        if not cam_dir.is_dir():
            continue
        for f in cam_dir.iterdir():
            if not f.is_file() or not f.name.endswith(".jsonl"):
                continue
            day = f.stem
            if day < cutoff:
                try:
                    f.unlink()
                    removed += 1
                except Exception as exc:
                    log.warning("cleanup %s failed: %s", f, exc)
        # Leere Cam-Ordner können wir gleich auch wegräumen.
        try:
            if cam_dir.exists() and not any(cam_dir.iterdir()):
                shutil.rmtree(cam_dir)
        except Exception:
            pass
    if removed:
        log.info(
            "people history: removed %d files older than %s",
            removed,
            cutoff,
        )
    return removed
