#!/usr/bin/env python3
"""Wo auf der Zaehllinie wird gezaehlt — und was davon war gedeckt?

Zum Justieren der Linie: Durchgaenge, zu denen ein Scan passt, liegen auf
echten Drehkreuz-Spuren. Haeufen sich ungedeckte Durchgaenge an einem Ende,
reicht die Linie in einen Nachbardurchgang hinein und sollte dort enden.

Gelesen wird das Protokoll des Trackers (Position je Durchgang) und das
lokale Scan-Archiv. Gepaart wird wie in `lib/tailgate-pairing.ts`.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, date
from pathlib import Path

LOG = Path.home() / "Library/Logs/webcams/tracker.err"
SCANS = Path(__file__).resolve().parents[2] / "logs" / "scans"

# Muss zu lib/tailgate-pairing.ts passen, sonst zeigt der Bericht etwas
# anderes an als die Auswertung im Admin.
MAX_LAG_MS = 30_000
MAX_LEAD_MS = 3_000

LINE_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3}).*worker\[(?P<cam>[^\]]+)\] CROSSING (?P<body>.*?) total"
)
EVENT_RE = re.compile(r"#(?P<tid>\d+) (?P<dir>in|out) bei (?P<along>[\d.]+)")


def read_crossings(cam_id: str, direction: str) -> list[tuple[int, float]]:
    """(Zeitstempel in ms, Lage entlang der Linie) je gezaehltem Durchgang."""
    out: list[tuple[int, float]] = []
    if not LOG.exists():
        return out
    with LOG.open(errors="replace") as fh:
        for line in fh:
            m = LINE_RE.match(line)
            if not m or m.group("cam") != cam_id:
                continue
            stamp = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
            ts = int(stamp.timestamp() * 1000) + int(m.group(2))
            for ev in EVENT_RE.finditer(m.group("body")):
                if ev.group("dir") != direction:
                    continue
                out.append((ts, float(ev.group("along"))))
    return out


def read_scans(day: date, device_ids: set[int]) -> list[dict]:
    path = SCANS / f"{day.isoformat()}.jsonl"
    if not path.exists():
        return []
    rows = []
    with path.open() as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("result") != "GRANTED":
                continue
            if row.get("deviceId") not in device_ids:
                continue
            rows.append(row)
    rows.sort(key=lambda r: r["ts"])
    return rows


def pair(crossings, scans):
    """Gibt (Lage, gedeckt) je Durchgang zurueck — wie tailgate-pairing.ts."""
    used: set[int] = set()
    result = []
    for ts, along in sorted(crossings):
        match = None
        best = float("inf")
        for s in scans:
            if s["id"] in used:
                continue
            if s["ts"] > ts + MAX_LEAD_MS:
                break
            lag = ts - s["ts"]
            if lag > MAX_LAG_MS:
                continue
            score = lag if lag >= 0 else MAX_LAG_MS + abs(lag)
            if score < best:
                best, match = score, s
        if match:
            used.add(match["id"])
        result.append((along, match is not None))
    return result


def histogram(values: list[float], buckets: int = 20) -> list[int]:
    counts = [0] * buckets
    for v in values:
        idx = min(buckets - 1, max(0, int(v * buckets)))
        counts[idx] += 1
    return counts


def main() -> int:
    cam_id = sys.argv[1] if len(sys.argv) > 1 else "cam-drehkreuz"
    direction = sys.argv[2] if len(sys.argv) > 2 else "in"
    device_ids = {49, 51, 53}
    today = date.today()

    crossings = [c for c in read_crossings(cam_id, direction) if
                 datetime.fromtimestamp(c[0] / 1000).date() == today]
    scans = read_scans(today, device_ids)
    paired = pair(crossings, scans)

    mit = [a for a, ok in paired if ok]
    ohne = [a for a, ok in paired if not ok]
    print(f"{cam_id} · Richtung {direction} · heute")
    print(f"  Durchgaenge: {len(paired)}  mit Scan: {len(mit)}  ohne: {len(ohne)}")
    if not paired:
        return 0

    print("\n  Lage entlang der Linie (0 = Start, 1 = Ende)")
    print("  Bereich        mit Scan            ohne Scan")
    hm, ho = histogram(mit), histogram(ohne)
    for i in range(20):
        lo, hi = i / 20, (i + 1) / 20
        if hm[i] == 0 and ho[i] == 0:
            continue
        print(
            f"  {lo:.2f}-{hi:.2f}  {'#' * hm[i]:<18} {'#' * ho[i]:<18}"
            f" {hm[i]:>3} / {ho[i]:>3}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
