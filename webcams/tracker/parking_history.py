"""
Parkplatz-Belegung über die Zeit.

    logs/parking/<cam_id>/<YYYY-MM-DD>.jsonl
        {"t": 1715361234567, "occ": 5, "tot": 12, "spots": {"p1": 1, "p2": 0, ...}}

Ein Sample pro Minute (oder wenn sich die Belegung ändert, gedrosselt).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

log = logging.getLogger("parking_history")


def _default_root() -> Path:
    env = os.environ.get("WEBCAMS_PARKING_HISTORY_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "logs" / "parking"


HISTORY_ROOT = _default_root()
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
    return _cam_dir(cam_id) / f"{when.strftime('%Y-%m-%d')}.jsonl"


def record_sample(
    cam_id: str,
    occupied: int,
    total: int,
    spots: dict[str, bool],
    ts: float | None = None,
) -> None:
    if not cam_id or total <= 0:
        return
    when = ts if ts is not None else time.time()
    path = _file_for(cam_id, when)
    line = json.dumps(
        {
            "t": int(when * 1000),
            "occ": int(occupied),
            "tot": int(total),
            "spots": {k: 1 if v else 0 for k, v in spots.items()},
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    lk = _lock_for(cam_id)
    with lk:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def _read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.is_file():
        return
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                yield json.loads(raw)
            except json.JSONDecodeError:
                continue


def summarize_days(cam_id: str, days: int = 7) -> list[dict[str, Any]]:
    """Pro Tag: Samples, Mittel/Peak belegt, Auslastung 0..1."""
    out: list[dict[str, Any]] = []
    today = datetime.now().date()
    for i in range(days - 1, -1, -1):
        day = today - timedelta(days=i)
        path = _cam_dir(cam_id) / f"{day.isoformat()}.jsonl"
        occs: list[int] = []
        tot = 0
        for ev in _read_jsonl(path):
            occs.append(int(ev.get("occ") or 0))
            tot = max(tot, int(ev.get("tot") or 0))
        if not occs:
            out.append(
                {
                    "date": day.isoformat(),
                    "samples": 0,
                    "avgOccupied": 0,
                    "peakOccupied": 0,
                    "total": tot,
                    "occupancy": 0,
                }
            )
            continue
        avg = sum(occs) / len(occs)
        peak = max(occs)
        out.append(
            {
                "date": day.isoformat(),
                "samples": len(occs),
                "avgOccupied": round(avg, 2),
                "peakOccupied": peak,
                "total": tot,
                "occupancy": round(avg / tot, 3) if tot else 0,
            }
        )
    return out


def hourly_today(cam_id: str) -> list[dict[str, Any]]:
    """Heute, 24 Stunden: mittlere Belegung je Stunde."""
    day = datetime.now().strftime("%Y-%m-%d")
    path = _cam_dir(cam_id) / f"{day}.jsonl"
    buckets: list[list[int]] = [[] for _ in range(24)]
    tot = 0
    for ev in _read_jsonl(path):
        t = int(ev.get("t") or 0)
        if t <= 0:
            continue
        hour = datetime.fromtimestamp(t / 1000).hour
        buckets[hour].append(int(ev.get("occ") or 0))
        tot = max(tot, int(ev.get("tot") or 0))
    hours = []
    for h, occs in enumerate(buckets):
        avg = sum(occs) / len(occs) if occs else 0
        hours.append(
            {
                "hour": h,
                "samples": len(occs),
                "avgOccupied": round(avg, 2),
                "total": tot,
                "occupancy": round(avg / tot, 3) if tot and occs else 0,
            }
        )
    return hours
