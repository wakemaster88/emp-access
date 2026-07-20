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
MIN_DET_SCORE = float(os.environ.get("FACE_MIN_DET_SCORE", "0.5"))
MIN_FACE_SIZE = int(os.environ.get("FACE_MIN_SIZE", "40"))

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
        app.prepare(ctx_id=-1, det_size=(640, 640))
        _app = app
        print(f"[face] buffalo_l bereit (models={MODEL_ROOT})", flush=True)
        return _app


def decode_jpeg(data: bytes):
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def embed_jpeg(data: bytes) -> dict:
    img = decode_jpeg(data)
    if img is None:
        return {"ok": False, "error": "Kein gültiges JPEG", "faces": []}

    app = get_app()
    faces = app.get(img) or []
    out = []
    for f in faces:
        bbox = [float(x) for x in f.bbox.tolist()]
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        det = float(getattr(f, "det_score", 0.0) or 0.0)
        if det < MIN_DET_SCORE or min(w, h) < MIN_FACE_SIZE:
            continue
        emb = f.normed_embedding
        if emb is None:
            continue
        out.append(
            {
                "embedding": [float(x) for x in emb.tolist()],
                "bbox": bbox,
                "det_score": det,
            }
        )

    out.sort(key=lambda x: x["det_score"], reverse=True)
    return {"ok": True, "model": "buffalo_l", "faces": out}


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
        if length <= 0 or length > 8 * 1024 * 1024:
            self._json(400, {"ok": False, "error": "Ungültige Body-Größe", "faces": []})
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
