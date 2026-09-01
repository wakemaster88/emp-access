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
# Weitwinkel: erkanntes Mini-Gesicht ausschneiden und hochskalieren (ArcFace ~112 px).
ZOOM_TARGET = int(os.environ.get("FACE_ZOOM_TARGET", "112"))
MAX_ZOOM = float(os.environ.get("FACE_MAX_ZOOM", "8"))
# Nach dem Hochskalieren: niedrigere Schwellen – das Bild ist weichgezeichnet.
ZOOM_MIN_DET = float(os.environ.get("FACE_ZOOM_MIN_DET", "0.32"))
ZOOM_MIN_SIZE = int(os.environ.get("FACE_ZOOM_MIN_SIZE", "24"))
# Unter dieser Größe (skalierte px) kein Embedding-Fallback – zu unbrauchbar.
KEEP_MIN_SIZE = float(os.environ.get("FACE_KEEP_MIN_SIZE", "12"))
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
        # CoreML (Apple Neural Engine) wirft bei buffalo_l Shape-Fehler
        # (inferred vs. static rank) – CPU ist langsamer, aber stabil.
        app = FaceAnalysis(
            name="buffalo_l",
            root=str(MODEL_ROOT),
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _app = app
        print(f"[face] buffalo_l bereit (models={MODEL_ROOT}, det={DET_SIZE}, cpu)", flush=True)
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


def _mapped_bbox(bbox_scaled, scale: float):
    if scale:
        return [c / scale for c in bbox_scaled]
    return list(bbox_scaled)


def detect_on(
    app,
    region,
    min_side: int,
    ox: int,
    oy: int,
    scale: float,
    region_zoom: float = 1.0,
    min_det: float | None = None,
):
    """Gesichter in einer Bildregion finden; BBox auf Originalkoordinaten mappen."""
    faces = app.get(region) or []
    out = []
    rejected = []
    zoom = region_zoom if region_zoom else 1.0
    to_orig = (scale * zoom) if scale else zoom
    det_need = MIN_DET_SCORE if min_det is None else min_det
    for f in faces:
        bbox = [float(x) for x in f.bbox.tolist()]
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        det = float(getattr(f, "det_score", 0.0) or 0.0)
        # bbox_scaled: Koordinaten im herunterskalierten Vollbild (vor Digital-Zoom).
        bbox_scaled = [
            bbox[0] / zoom + ox,
            bbox[1] / zoom + oy,
            bbox[2] / zoom + ox,
            bbox[3] / zoom + oy,
        ]
        emb = f.normed_embedding
        emb_list = [float(x) for x in emb.tolist()] if emb is not None else None
        too_small = min(w, h) < min_side
        if det < det_need or too_small:
            rejected.append(
                {
                    "det_score": det,
                    "size": round(min(w, h) / zoom, 1),
                    "need": min_side,
                    "bbox_scaled": bbox_scaled,
                    "embedding": emb_list if det >= MIN_DET_SCORE and emb_list else None,
                }
            )
            continue
        if emb_list is None:
            continue
        out.append(
            {
                "embedding": emb_list,
                "bbox": _mapped_bbox(bbox_scaled, scale),
                "det_score": det,
                "size": round(min(w, h) / to_orig if to_orig else min(w, h), 1),
            }
        )
    return out, rejected


def rescue_zoom(app, img, bbox_scaled, scale: float, min_side: int):
    """Kleines Gesicht ausschneiden, hochskalieren, erneut erkennen."""
    ih, iw = img.shape[:2]
    x1, y1, x2, y2 = bbox_scaled
    fw, fh = max(1.0, x2 - x1), max(1.0, y2 - y1)
    face = min(fw, fh)
    zoom = min(MAX_ZOOM, max(1.0, ZOOM_TARGET / face))
    if zoom < 1.2:
        return [], zoom
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    half = max(fw, fh) * 1.4
    xa = int(max(0, cx - half))
    ya = int(max(0, cy - half))
    xb = int(min(iw, cx + half))
    yb = int(min(ih, cy + half))
    crop = img[ya:yb, xa:xb]
    if crop is None or getattr(crop, "size", 0) == 0:
        return [], zoom
    new_w = max(1, int(crop.shape[1] * zoom))
    new_h = max(1, int(crop.shape[0] * zoom))
    m = max(new_w, new_h)
    if m > MAX_EDGE:
        z2 = MAX_EDGE / m
        new_w = max(1, int(new_w * z2))
        new_h = max(1, int(new_h * z2))
        zoom *= z2
    up = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
    found, _ = detect_on(
        app,
        up,
        ZOOM_MIN_SIZE,
        xa,
        ya,
        scale,
        region_zoom=zoom,
        min_det=ZOOM_MIN_DET,
    )
    return found, zoom


def upscaled_roi(app, img, min_side: int, scale: float, frac: float, y_frac: float):
    """ROI hochskalieren (echter Digital-Zoom, nicht nur Crop)."""
    ih, iw = img.shape[:2]
    cw, ch = max(1, int(iw * frac)), max(1, int(ih * frac))
    ox = (iw - cw) // 2
    oy = int(ih * y_frac)
    oy = min(max(0, oy), max(0, ih - ch))
    crop = img[oy : oy + ch, ox : ox + cw]
    if crop is None or getattr(crop, "size", 0) == 0:
        return []
    m = max(crop.shape[0], crop.shape[1])
    zoom = min(MAX_ZOOM, MAX_EDGE / m) if m else 1.0
    if zoom < 1.5:
        return []
    up = cv2.resize(
        crop,
        (max(1, int(crop.shape[1] * zoom)), max(1, int(crop.shape[0] * zoom))),
        interpolation=cv2.INTER_LANCZOS4,
    )
    found, _ = detect_on(
        app, up, ZOOM_MIN_SIZE, ox, oy, scale, region_zoom=zoom, min_det=ZOOM_MIN_DET
    )
    return found


def embed_jpeg(data: bytes) -> dict:
    img = decode_jpeg(data)
    if img is None:
        return {"ok": False, "error": "Kein gültiges JPEG", "faces": []}

    orig_h, orig_w = img.shape[:2]
    img, scale = downscale(img)
    app = get_app()
    ih, iw = img.shape[:2]
    min_side = max(MIN_FACE_SIZE, int(min(iw, ih) * MIN_FACE_FRAC))

    # Mehrere ROIs: Vollbild + Crops (Weitwinkel). Echter Zoom erst in rescue_zoom.
    regions: list[tuple[str, object, int, int]] = [("full", img, 0, 0)]
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
    upscaled = False
    for name, region, ox, oy in regions:
        if region is None or getattr(region, "size", 0) == 0:
            continue
        found, rejected = detect_on(app, region, min_side, ox, oy, scale)
        all_rejected.extend(rejected)
        if found:
            out = found
            used_region = name
            break
        # Mini-Gesicht im Vollbild: Rest-Crops ohne Zoom überspringen, Rescue folgt.
        if name == "full" and any(
            r.get("det_score", 0) >= MIN_DET_SCORE and r.get("bbox_scaled") for r in rejected
        ):
            break

    if not out:
        candidates = [
            r
            for r in all_rejected
            if r.get("bbox_scaled") and r.get("det_score", 0) >= MIN_DET_SCORE
        ]
        candidates.sort(key=lambda r: (r.get("size", 0), r.get("det_score", 0)), reverse=True)
        for cand in candidates[:2]:
            found, zoom = rescue_zoom(app, img, cand["bbox_scaled"], scale, min_side)
            if found:
                out = found
                used_region = "rescue_zoom"
                upscaled = True
                print(
                    f"[face] zoom {cand.get('size')}px ×{zoom:.1f} → det={found[0]['det_score']:.2f}",
                    flush=True,
                )
                break
            print(f"[face] zoom miss {cand.get('size')}px ×{zoom:.1f}", flush=True)

    if not out:
        keep = [
            r
            for r in candidates
            if r.get("embedding") and float(r.get("size") or 0) >= KEEP_MIN_SIZE
        ]
        if keep:
            best = max(keep, key=lambda r: (float(r.get("size") or 0), r.get("det_score", 0)))
            out = [
                {
                    "embedding": best["embedding"],
                    "bbox": _mapped_bbox(best["bbox_scaled"], scale),
                    "det_score": best["det_score"],
                    "size": best["size"],
                }
            ]
            used_region = "small_keep"
            upscaled = True
            print(
                f"[face] keep small {best.get('size')}px det={best['det_score']:.2f}",
                flush=True,
            )

    if not out:
        for name, frac, y_frac in (("zoom_upper", 0.28, 0.06), ("zoom_center", 0.32, 0.22)):
            found = upscaled_roi(app, img, min_side, scale, frac, y_frac)
            if found:
                out = found
                used_region = name
                upscaled = True
                break

    out.sort(key=lambda x: x["det_score"], reverse=True)
    return {
        "ok": True,
        "model": "buffalo_l",
        "faces": out,
        "rejected": [
            {k: v for k, v in r.items() if k not in ("bbox_scaled", "embedding")}
            for r in all_rejected[:8]
        ],
        "region": used_region,
        "upscaled": upscaled,
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
