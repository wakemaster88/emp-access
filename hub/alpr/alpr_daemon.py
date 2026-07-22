#!/usr/bin/env python3
"""
fast-alpr Daemon für den Hub.

Liest JSON-Zeilen von stdin: {"id": 1, "path": "/tmp/frame.jpg"}
Schreibt JSON-Zeilen nach stdout: {"id": 1, "candidates": [{"text": "BOQC626E", "ocrConf": 0.98, "detConf": 0.41, "tiled": false}]}

Erst Vollbild-Detektion; wenn nichts gefunden, überlappende Kacheln (3×2)
für weit entfernte / kleine Kennzeichen.
"""
import json
import sys
import traceback

import cv2
import numpy as np
from fast_alpr import ALPR

DETECTOR = "yolo-v9-t-640-license-plate-end2end"
OCR = "global-plates-mobile-vit-v2-model"
TILE_COLS, TILE_ROWS, TILE_OVERLAP = 3, 2, 0.15


def mean_conf(c) -> float:
    try:
        return float(np.mean(c))
    except Exception:
        try:
            return float(c)
        except Exception:
            return 0.0


def predict(alpr: ALPR, frame) -> list[dict]:
    out = []
    for r in alpr.predict(frame):
        text = (r.ocr.text or "").strip().upper().replace("_", "")
        if len(text) < 4:
            continue
        out.append(
            {
                "text": text,
                "ocrConf": round(mean_conf(r.ocr.confidence), 3),
                "detConf": round(float(r.detection.confidence), 3),
            }
        )
    return out


def tiles(frame):
    h, w = frame.shape[:2]
    tw, th = w // TILE_COLS, h // TILE_ROWS
    for row in range(TILE_ROWS):
        for col in range(TILE_COLS):
            x0 = max(0, int(col * tw - tw * TILE_OVERLAP))
            y0 = max(0, int(row * th - th * TILE_OVERLAP))
            x1 = min(w, int((col + 1) * tw + tw * TILE_OVERLAP))
            y1 = min(h, int((row + 1) * th + th * TILE_OVERLAP))
            yield frame[y0:y1, x0:x1]


def handle(alpr: ALPR, path: str) -> list[dict]:
    frame = cv2.imread(path)
    if frame is None:
        raise ValueError(f"cannot read image: {path}")
    candidates = predict(alpr, frame)
    if not candidates:
        seen = set()
        for tile in tiles(frame):
            for c in predict(alpr, tile):
                key = (c["text"], c["ocrConf"])
                if key not in seen:
                    seen.add(key)
                    c["tiled"] = True
                    candidates.append(c)
    candidates.sort(key=lambda c: c["ocrConf"], reverse=True)
    return candidates


def main() -> None:
    alpr = ALPR(
        detector_model=DETECTOR,
        ocr_model=OCR,
        detector_providers=["CPUExecutionProvider"],
        ocr_providers=["CPUExecutionProvider"],
    )
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            candidates = handle(alpr, req["path"])
            print(json.dumps({"id": req_id, "candidates": candidates}), flush=True)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({"id": req_id, "error": str(e), "candidates": []}), flush=True)


if __name__ == "__main__":
    main()
