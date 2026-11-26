"""
Ausschnitt und Auflösung für ``POST /classify`` (reine Rechnung, ohne
numpy/OpenCV, testbar).

Der Hub kann zu einem Bild optional ``roi=x,y,w,h`` (normiert auf 0..1) und
``imgsz`` (höchstens 1280) mitschicken. Dann schneidet der Tracker den
Ausschnitt aus dem Originalbild, *bevor* er verkleinert, rechnet YOLO mit
``imgsz`` und gibt die Boxen normiert auf das ganze Bild zurück. So bleibt
für kleine, entfernte Fahrzeuge mehr Auflösung, und der Hub wertet die
Boxen genauso aus wie ohne Ausschnitt.

Ohne die Angaben ändert sich nichts: ``main.py`` nimmt dann den bisherigen
Weg (ganzes Bild auf 1280 px Kante verkleinert, YOLO-Standardauflösung).
"""

from __future__ import annotations

# Höchste Auflösung für die Erkennung im Ausschnitt.
MAX_IMGSZ = 1280
# Längste Kante, auf die der Tracker ein Bild vor der Erkennung verkleinert.
MAX_EDGE = 1280


def _clamp01(v: float) -> float:
    return min(1.0, max(0.0, v))


def parse_roi(raw: str | None) -> tuple[float, float, float, float] | None:
    """``"x,y,w,h"`` (normiert) → auf das Bild begrenztes Rechteck, sonst None.

    None bei fehlender, unlesbarer oder leerer Angabe: Der Tracker rechnet
    dann wie bisher auf dem ganzen Bild.
    """
    if raw is None:
        return None
    parts = [p.strip() for p in str(raw).split(",")]
    if len(parts) != 4:
        return None
    try:
        x, y, w, h = (float(p) for p in parts)
    except ValueError:
        return None
    if any(v != v or v in (float("inf"), float("-inf")) for v in (x, y, w, h)):
        return None
    x0, y0 = _clamp01(x), _clamp01(y)
    x1, y1 = _clamp01(x + w), _clamp01(y + h)
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        return None
    return (x0, y0, x1 - x0, y1 - y0)


def parse_imgsz(raw: str | None) -> int | None:
    """Auflösung für YOLO: Vielfaches von 32 zwischen 32 und MAX_IMGSZ, sonst None."""
    if raw is None or str(raw).strip() == "":
        return None
    try:
        n = float(str(raw).strip())
    except ValueError:
        return None
    if n != n or n <= 0 or n == float("inf"):
        return None
    return int(min(MAX_IMGSZ, max(32, round(n / 32) * 32)))


def roi_pixels(roi: tuple[float, float, float, float], width: int, height: int) -> tuple[int, int, int, int]:
    """Normierter Ausschnitt → Pixel ``(x0, y0, x1, y1)`` im Originalbild, mindestens 1 px groß."""
    x, y, w, h = roi
    x0 = min(width - 1, max(0, int(x * width)))
    y0 = min(height - 1, max(0, int(y * height)))
    x1 = min(width, max(x0 + 1, int(round((x + w) * width))))
    y1 = min(height, max(y0 + 1, int(round((y + h) * height))))
    return (x0, y0, x1, y1)


def shrink_size(width: int, height: int, max_edge: int = MAX_EDGE) -> tuple[int, int]:
    """Größe nach dem Verkleinern auf ``max_edge`` (wie bisher: ``int(seite * faktor)``)."""
    edge = max(width, height)
    if edge <= max_edge:
        return (width, height)
    z = max_edge / edge
    return (int(width * z), int(height * z))


def box_to_full(
    xyxy: tuple[float, float, float, float],
    rect: tuple[int, int, int, int],
    seen: tuple[int, int],
    full: tuple[int, int],
) -> dict[str, float]:
    """Box im Bild, das YOLO gesehen hat, → normiert auf das ganze Bild.

    ``xyxy``: Box in Pixeln des gesehenen Bilds (Ausschnitt, ggf. verkleinert).
    ``rect``: Ausschnitt ``(x0, y0, x1, y1)`` in Pixeln des Originalbilds.
    ``seen``: Breite und Höhe des gesehenen Bilds.
    ``full``: Breite und Höhe des Originalbilds.
    Gerundet auf vier Stellen wie die Boxen ohne Ausschnitt.
    """
    bx1, by1, bx2, by2 = xyxy
    x0, y0, x1, y1 = rect
    sw, sh = seen
    fw, fh = full
    kx = (x1 - x0) / sw
    ky = (y1 - y0) / sh
    left = x0 + bx1 * kx
    top = y0 + by1 * ky
    right = x0 + bx2 * kx
    bottom = y0 + by2 * ky
    return {
        "x": round(left / fw, 4),
        "y": round(top / fh, 4),
        "w": round((right - left) / fw, 4),
        "h": round((bottom - top) / fh, 4),
    }
