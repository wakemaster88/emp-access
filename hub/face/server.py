#!/usr/bin/env python3
"""Lokaler Face-Embedding-Service fuer den EMP-Access-Hub (InsightFace buffalo_l)."""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

PORT = int(os.environ.get("FACE_PORT", "8790"))
HOST = os.environ.get("FACE_HOST", "127.0.0.1")
MODEL_ROOT = Path(os.environ.get("FACE_MODEL_ROOT", Path(__file__).resolve().parent / ".models"))
# Filter: zu streng blockiert echte Gesichter auf Weitwinkel; zu locker → leere Snaps.
MIN_DET_SCORE = float(os.environ.get("FACE_MIN_DET_SCORE", "0.50"))
MIN_FACE_SIZE = int(os.environ.get("FACE_MIN_SIZE", "48"))
# Anteil an der (ggf. skalierten) Bildkante – nicht an 4K-Vollauflösung.
MIN_FACE_FRAC = float(os.environ.get("FACE_MIN_FRAC", "0.03"))
# Vor der Erkennung skalieren (bessere Detektion + weniger RAM als Roh-4K/Panorama).
MAX_EDGE = int(os.environ.get("FACE_MAX_EDGE", "1920"))
DET_SIZE = int(os.environ.get("FACE_DET_SIZE", "960"))
MAX_BODY_BYTES = int(os.environ.get("FACE_MAX_BODY", str(32 * 1024 * 1024)))

_app = None
_lock = threading.Lock()


def get_app():
    global _app
    if _app is not None:
        return _app
    with _lock:
        if _app is not None:
            return _app
        from insightface.app import FaceAnalysis

        MODEL_ROOT.mkdir(parents=True, exist_ok=True)
        app = FaceAnalysis(
            name="buffalo_l",
            root=str(MODEL_ROOT),
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _app = app
        print(f"[face] buffalo_l bereit (models={MODEL_ROOT}, det={DET_SIZE})", flush=True)
        return _app


def decode_jpeg(data: bytes):
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def downscale(img):
    """Lange Kante auf MAX_EDGE – InsightFace sieht sonst bei 4K kaum kleine Gesichter."""
    ih, iw = img.shape[:2]
    m = max(ih, iw)
    if m <= MAX_EDGE:
        return img, 1.0
    scale = MAX_EDGE / m
    out = cv2.resize(img, (int(iw * scale), int(ih * scale)), interpolation=cv2.INTER_AREA)
    return out, scale


def detect_on(app, region, min_side: int, ox: int, oy: int, scale: float):
    """Gesichter in einer Bildregion finden; BBox auf Originalkoordinaten mappen."""
    faces = app.get(region) or []
    out = []
    rejected = []
    for f in faces:
        bbox = [float(x) for x in f.bbox.tolist()]
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        det = float(getattr(f, "det_score", 0.0) or 0.0)
        if det < MIN_DET_SCORE or min(w, h) < min_side:
            rejected.append({"det_score": det, "size": round(min(w, h), 1), "need": min_side})
            continue
        emb = f.normed_embedding
        if emb is None:
            continue
        # Region-Offset + Downscale zurück auf Original.
        mapped = [
            (bbox[0] + ox) / scale,
            (bbox[1] + oy) / scale,
            (bbox[2] + ox) / scale,
            (bbox[3] + oy) / scale,
        ]
        out.append(
            {
                "embedding": [float(x) for x in emb.tolist()],
                "bbox": mapped,
                "det_score": det,
                "size": round(min(w, h) / scale if scale else min(w, h), 1),
            }
        )
    return out, rejected


def embed_jpeg(data: bytes) -> dict:
    img = decode_jpeg(data)
    if img is None:
        return {"ok": False, "error": "Kein gültiges JPEG", "faces": []}

    orig_h, orig_w = img.shape[:2]
    img, scale = downscale(img)
    app = get_app()
    ih, iw = img.shape[:2]
    min_side = max(MIN_FACE_SIZE, int(min(iw, ih) * MIN_FACE_FRAC))

    # Mehrere ROIs: Vollbild + Zoom-Crops (Weitwinkel/Eingang – Gesicht oft klein).
    regions: list[tuple[str, object, int, int]] = [("full", img, 0, 0)]
    # Zentrum 50% → effektiver 2×-Zoom
    cw, ch = int(iw * 0.50), int(ih * 0.50)
    cx0, cy0 = (iw - cw) // 2, (ih - ch) // 2
    regions.append(("center_zoom", img[cy0 : cy0 + ch, cx0 : cx0 + cw], cx0, cy0))
    # Oberes Mittelfeld (hoch montierte Kameras, Blick nach unten)
    uw, uh = int(iw * 0.70), int(ih * 0.55)
    ux0, uy0 = (iw - uw) // 2, int(ih * 0.05)
    regions.append(("upper", img[uy0 : uy0 + uh, ux0 : ux0 + uw], ux0, uy0))
    # Links/rechts im Gehweg-Bereich
    sw, sh = int(iw * 0.55), int(ih * 0.70)
    sy0 = (ih - sh) // 2
    regions.append(("left", img[sy0 : sy0 + sh, 0:sw], 0, sy0))
    regions.append(("right", img[sy0 : sy0 + sh, iw - sw : iw], iw - sw, sy0))

    all_rejected = []
    used_region = "full"
    out = []
    for name, region, ox, oy in regions:
        if region is None or getattr(region, "size", 0) == 0:
            continue
        found, rejected = detect_on(app, region, min_side, ox, oy, scale)
        all_rejected.extend(rejected)
        if found:
            out = found
            used_region = name
            break

    out.sort(key=lambda x: x["det_score"], reverse=True)
    return {
        "ok": True,
        "model": "buffalo_l",
        "faces": out,
        "rejected": all_rejected[:8],
        "region": used_region,
        "image": {
            "w": orig_w,
            "h": orig_h,
            "scaled_w": iw,
            "scaled_h": ih,
            "min_side": min_side,
        },
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/health", "/"):
            ready = _app is not None
            self._json(200, {"ok": True, "ready": ready, "model": "buffalo_l"})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            self._json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(
                400,
                {
                    "ok": False,
                    "error": f"Ungültige Body-Größe ({length} bytes, max {MAX_BODY_BYTES})",
                    "faces": [],
                },
            )
            return
        data = self.rfile.read(length)
        try:
            result = embed_jpeg(data)
            self._json(200 if result.get("ok") else 400, result)
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e), "faces": []})


def main():
    # Modell beim Start laden (erster Request sonst sehr langsam).
    try:
        get_app()
    except Exception as e:
        print(f"[face] Modell-Load fehlgeschlagen: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[face] listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
