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
# Laplace-Varianz (auf 112 px), ab der ein Gesicht als voll scharf gilt.
SHARP_REF = float(os.environ.get("FACE_SHARP_REF", "120"))
MAX_BODY_BYTES = int(os.environ.get("FACE_MAX_BODY", str(32 * 1024 * 1024)))
# Kleine Gesichter (Rescue-Zoom, Notloesung, ROI-Zoom) aus dem Originalbild der
# Kamera rechnen statt aus dem auf MAX_EDGE verkleinerten Bild: Eine 4K-Kamera
# liefert je Kante doppelt so viele Pixel, wie die Suche sieht.
#   on     – (Standard) `embedding` ist das Merkmal aus dem Original, das aus
#            dem verkleinerten Bild kommt als `embedding_scaled` mit. Findet
#            der Weg ueber das Original kein Gesicht oder scheitert er, gilt
#            fuer das Bild der Weg ueber das verkleinerte.
#   shadow – beide Wege; `embedding` bleibt das Merkmal aus dem verkleinerten
#            Bild, das aus dem Original kommt als `embedding_native` mit
#   off    – nur der Weg ueber das verkleinerte Bild
# In shadow und on wertet der Hub beide Merkmale gegen die Galerie und haelt
# Abweichungen fest (`compared` nennt den zweiten Weg des Bildes). Beide Wege
# laufen fuer jedes Bild ueber MAX_EDGE, in dem die Suche kein direkt
# brauchbares Gesicht findet, auch ohne jeden Kandidaten (dann die zwei
# ROI-Zooms je Weg einmal).
# `upscaled` (strengere Schwelle am Hub) bleibt in allen Stufen gesetzt.
# Abschalten auch mit 0, false, aus, no oder nein, Einschalten auch mit 1,
# true, an, ein, ja oder yes (wie bei den anderen Schaltern in hub/.env).
# Leer ergibt den Standard, ein unbekannter Wert ebenfalls, mit einer Zeile
# im Log.
NATIVE_OFF_WORDS = ("0", "false", "aus", "no", "nein")
NATIVE_ON_WORDS = ("1", "true", "an", "ein", "ja", "yes")


def native_mode(value: str | None) -> tuple[str, str | None]:
    """Stufe aus dem Wert von FACE_NATIVE; dazu eine Log-Zeile, wenn der
    Wert unbekannt ist."""
    raw = (value or "").strip()
    v = raw.lower()
    if not v:
        return "on", None
    if v in NATIVE_OFF_WORDS:
        return "off", None
    if v in NATIVE_ON_WORDS:
        return "on", None
    if v in ("off", "shadow", "on"):
        return v, None
    return "on", f"[face] FACE_NATIVE={raw} unbekannt – es gilt on (möglich: on, shadow, off)"


NATIVE_MODE, _native_note = native_mode(os.environ.get("FACE_NATIVE"))
if _native_note:
    print(_native_note, flush=True)

# Zwei Funde gelten als dasselbe Gesicht, wenn sich ihre Boxen so weit decken.
PAIR_MIN_IOU = 0.3

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
        # Nur Erkennung und Merkmale laden: buffalo_l bringt sonst noch
        # Alter/Geschlecht und zwei Landmarken-Modelle mit, die je Gesicht
        # mitlaufen, hier aber nie gelesen werden (spart CPU je Bild).
        app = FaceAnalysis(
            name="buffalo_l",
            root=str(MODEL_ROOT),
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _app = app
        print(
            f"[face] buffalo_l bereit (models={MODEL_ROOT}, det={DET_SIZE}, cpu, native={NATIVE_MODE})",
            flush=True,
        )
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


def face_quality(region, bbox, kps) -> tuple[float, float]:
    """Wie frontal (0..1) und wie scharf (0..1) ist ein Gesicht?

    Frontal aus den fuenf Punkten des Detektors: Bei einem frontalen Gesicht
    liegt die Nase mittig zwischen den Augen; je weiter sie zur Seite
    rutscht, desto mehr ist der Kopf gedreht. Schaerfe als Varianz des
    Laplace-Filters auf dem Gesichtsausschnitt (Bewegungs- und
    Fokusunschaerfe druecken sie stark). Beides dient nur der Auswahl des
    besten Bildes einer Serie.
    """
    frontal = 1.0
    try:
        if kps is not None and len(kps) >= 3:
            le, re, nose = kps[0], kps[1], kps[2]
            eye_dx = float(re[0] - le[0])
            if abs(eye_dx) > 1e-3:
                mid = (float(le[0]) + float(re[0])) / 2.0
                off = abs(float(nose[0]) - mid) / abs(eye_dx)
                frontal = max(0.0, 1.0 - off * 2.0)
    except Exception:
        frontal = 1.0
    sharp = sharpness(region, bbox)
    return round(frontal, 3), round(1.0 if sharp is None else sharp, 3)


def sharpness(region, bbox, smooth: bool = False):
    """Schaerfe 0..1 eines Gesichtsausschnitts: Varianz des Laplace-Filters
    auf 112 px. None, wenn der Ausschnitt dafuer zu klein ist.

    `smooth`: Ausschnitte unter 112 px werden wie beim Rescue-Zoom glatt
    vergroessert (Lanczos). So ist der Wert eines Mini-Gesichts, das ohne
    zweite Suche uebernommen wird, mit dem eines vergroesserten vergleichbar.
    """
    try:
        x1, y1, x2, y2 = (int(round(v)) for v in bbox)
        h, w = region.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 - x1 < 8 or y2 - y1 < 8:
            return None
        crop = cv2.cvtColor(region[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
        enlarge = smooth and min(x2 - x1, y2 - y1) < 112
        crop = cv2.resize(
            crop, (112, 112), interpolation=cv2.INTER_LANCZOS4 if enlarge else cv2.INTER_AREA
        )
        var = float(cv2.Laplacian(crop, cv2.CV_64F).var())
        return min(1.0, var / SHARP_REF)
    except Exception:
        return None


def native_embedding(app, orig, kps, ox: int, oy: int, zoom: float, scale: float):
    """Merkmal aus dem Originalbild: die fuenf Punkte des Detektors auf das
    Original umrechnen, dort ausrichten (112 px) und das Erkennungsmodell
    einmal mehr laufen lassen. Eine zweite Suche ist dafuer nicht noetig.

    Ein Fehler wird weitergereicht: Er beendet den Weg ueber das Original fuer
    das ganze Bild (both_ways), damit kein Merkmal aus dem verkleinerten Bild
    als eines aus dem Original durchgeht.
    """
    from insightface.utils import face_align

    pts = (
        np.asarray(kps, dtype=np.float32) / float(zoom) + np.array([ox, oy], dtype=np.float32)
    ) / float(scale)
    aimg = face_align.norm_crop(orig, landmark=pts, image_size=112)
    feat = app.models["recognition"].get_feat(aimg).flatten()
    n = float(np.linalg.norm(feat))
    if not n > 0:
        raise ValueError("Merkmal aus dem Original ohne Länge")
    return [float(x) for x in (feat / n).tolist()]


def detect_on(
    app,
    region,
    min_side: int,
    ox: int,
    oy: int,
    scale: float,
    region_zoom: float = 1.0,
    min_det: float | None = None,
    shrink: float | None = None,
):
    """Gesichter in einer Bildregion finden; BBox auf Originalkoordinaten mappen.

    `size` zaehlt immer in Pixeln des Originalbilds, `size_scaled` in Pixeln
    des verkleinerten Vollbilds (darauf beziehen sich die Mindestgroessen).
    Stammt die Region schon aus dem Original, ist `scale` 1.0 und `shrink`
    nennt den Faktor vom Original zum verkleinerten Vollbild.
    """
    faces = app.get(region) or []
    out = []
    rejected = []
    zoom = region_zoom if region_zoom else 1.0
    to_orig = (scale * zoom) if scale else zoom
    to_scaled = 1.0 if shrink is None else shrink
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
        kps = getattr(f, "kps", None)
        frontal, sharp = face_quality(region, bbox, kps)
        size = round(min(w, h) / to_orig if to_orig else min(w, h), 1)
        size_scaled = round(min(w, h) / zoom * to_scaled, 1)
        if det < det_need or too_small:
            rejected.append(
                {
                    "det_score": det,
                    "size": size,
                    "size_scaled": size_scaled,
                    "need": min_side,
                    "bbox_scaled": bbox_scaled,
                    "embedding": emb_list if det >= MIN_DET_SCORE and emb_list else None,
                    # Die fuenf Punkte im verkleinerten Vollbild und der
                    # Frontal-Wert: fuer die Notloesung ohne zweite Suche.
                    "kps_scaled": (
                        np.asarray(kps, dtype=np.float32) / zoom
                        + np.array([ox, oy], dtype=np.float32)
                    )
                    if kps is not None
                    else None,
                    "frontal": frontal,
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
                "size": size,
                "size_scaled": size_scaled,
                "frontal": frontal,
                "sharp": sharp,
            }
        )
    return out, rejected


def rescue_zoom(app, img, bbox_scaled, scale: float, min_side: int, orig=None):
    """Kleines Gesicht ausschneiden, hochskalieren, erneut erkennen.

    Mit `orig` wird aus dem Originalbild geschnitten, wenn es mehr Pixel hat
    als das verkleinerte: Ein Gesicht, das eine 4K-Kamera mit 32 px liefert,
    wird dann aus 32 statt aus 16 px vergroessert.
    """
    native = orig is not None and bool(scale) and scale < 1.0
    src = orig if native else img
    s = scale if native else 1.0
    ih, iw = src.shape[:2]
    x1, y1, x2, y2 = (c / s for c in bbox_scaled)
    fw, fh = max(1.0, x2 - x1), max(1.0, y2 - y1)
    face = min(fw, fh)
    zoom = min(MAX_ZOOM, max(1.0, ZOOM_TARGET / face))
    if zoom < 1.2:
        if not native:
            return [], zoom
        # Im Original gross genug: nur ausschneiden, nichts hochrechnen.
        zoom = 1.0
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    half = max(fw, fh) * 1.4
    xa = int(max(0, cx - half))
    ya = int(max(0, cy - half))
    xb = int(min(iw, cx + half))
    yb = int(min(ih, cy + half))
    crop = src[ya:yb, xa:xb]
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
    up = crop if zoom == 1.0 else cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
    # Aus dem Original geschnitten sind xa/ya schon Original-Koordinaten.
    found, _ = detect_on(
        app,
        up,
        ZOOM_MIN_SIZE,
        xa,
        ya,
        1.0 if native else scale,
        region_zoom=zoom,
        min_det=ZOOM_MIN_DET,
        shrink=scale if native else None,
    )
    return found, zoom


def upscaled_roi(app, img, min_side: int, scale: float, frac: float, y_frac: float, orig=None):
    """ROI hochskalieren (echter Digital-Zoom, nicht nur Crop).

    Mit `orig` wie rescue_zoom aus dem Originalbild, wenn es mehr Pixel hat:
    Derselbe Ausschnitt fuellt die Suchgroesse dann mit echten statt mit
    hochgerechneten Pixeln.
    """
    native = orig is not None and bool(scale) and scale < 1.0
    src = orig if native else img
    ih, iw = src.shape[:2]
    cw, ch = max(1, int(iw * frac)), max(1, int(ih * frac))
    ox = (iw - cw) // 2
    oy = int(ih * y_frac)
    oy = min(max(0, oy), max(0, ih - ch))
    crop = src[oy : oy + ch, ox : ox + cw]
    if crop is None or getattr(crop, "size", 0) == 0:
        return []
    m = max(crop.shape[0], crop.shape[1])
    zoom = min(MAX_ZOOM, MAX_EDGE / m) if m else 1.0
    if zoom < 1.5 and not native:
        return []
    if zoom == 1.0:
        up = crop
    else:
        up = cv2.resize(
            crop,
            (max(1, int(crop.shape[1] * zoom)), max(1, int(crop.shape[0] * zoom))),
            interpolation=cv2.INTER_LANCZOS4 if zoom > 1.0 else cv2.INTER_AREA,
        )
    found, _ = detect_on(
        app,
        up,
        ZOOM_MIN_SIZE,
        ox,
        oy,
        1.0 if native else scale,
        region_zoom=zoom,
        min_det=ZOOM_MIN_DET,
        shrink=scale if native else None,
    )
    return found


def keep_small(app, img, scale: float, candidates, orig=None):
    """Notloesung ohne zweite Suche: das Merkmal des groessten Mini-Gesichts
    aus der ersten Suche uebernehmen.

    Mit `orig` wird das Merkmal aus dem Originalbild neu gerechnet (dieselben
    fuenf Punkte, dort ausgerichtet). Frontal-Wert aus der ersten Suche;
    Schaerfe an den Pixeln, aus denen das Merkmal stammt. Gelingt das Merkmal
    aus dem Original nicht, wirft die Funktion (der Weg ueber das Original
    gilt fuer das Bild als gescheitert, both_ways).
    """
    keep = [
        r
        for r in candidates
        if r.get("embedding") and float(r.get("size_scaled") or 0) >= KEEP_MIN_SIZE
    ]
    if not keep:
        return []
    best = max(keep, key=lambda r: (float(r.get("size_scaled") or 0), r.get("det_score", 0)))
    bbox = _mapped_bbox(best["bbox_scaled"], scale)
    native = None
    if orig is not None and bool(scale) and scale < 1.0:
        if best.get("kps_scaled") is None:
            raise ValueError("Notlösung ohne Detektorpunkte für das Merkmal aus dem Original")
        native = native_embedding(app, orig, best["kps_scaled"], 0, 0, 1.0, scale)
    sharp = (
        sharpness(orig, bbox, smooth=True)
        if native
        else sharpness(img, best["bbox_scaled"], smooth=True)
    )
    face = {
        "embedding": native or best["embedding"],
        "bbox": bbox,
        "det_score": best["det_score"],
        "size": best["size"],
        "size_scaled": best["size_scaled"],
        "frontal": best["frontal"],
    }
    if sharp is not None:
        face["sharp"] = round(sharp, 3)
    return [face]


def small_faces(app, img, scale: float, min_side: int, candidates, orig=None):
    """Kleine Gesichter, wenn die Suche im Bild kein brauchbares fand: erst
    Rescue-Zoom auf die zwei groessten Kandidaten, dann die Notloesung ohne
    zweite Suche, zuletzt zwei vergroesserte Bildausschnitte.

    Mit `orig` rechnen alle drei Schritte aus dem Originalbild. Liefert
    (Gesichter, Region); ohne Fund ([], None).
    """
    native = orig is not None and bool(scale) and scale < 1.0

    def way(cand) -> str:
        # Nur bei verkleinerten Bildern gibt es zwei Wege.
        if not scale or scale >= 1.0:
            return ""
        return " (Original)" if native else f" aus {cand['size_scaled']}px (verkleinert)"

    for cand in candidates[:2]:
        found, zoom = rescue_zoom(app, img, cand["bbox_scaled"], scale, min_side, orig=orig)
        if found:
            print(
                f"[face] zoom {cand['size']}px ×{zoom:.1f}{way(cand)} → det={found[0]['det_score']:.2f}",
                flush=True,
            )
            return found, "rescue_zoom"
        print(f"[face] zoom miss {cand['size']}px ×{zoom:.1f}{way(cand)}", flush=True)

    kept = keep_small(app, img, scale, candidates, orig=orig)
    if kept:
        print(
            f"[face] keep small {kept[0]['size']}px{way(kept[0])} det={kept[0]['det_score']:.2f}",
            flush=True,
        )
        return kept, "small_keep"

    for name, frac, y_frac in (("zoom_upper", 0.28, 0.06), ("zoom_center", 0.32, 0.22)):
        found = upscaled_roi(app, img, min_side, scale, frac, y_frac, orig=orig)
        if found:
            return found, name
    return [], None


def _iou(a, b) -> float:
    iw = min(a[2], b[2]) - max(a[0], b[0])
    ih = min(a[3], b[3]) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def attach_other(faces, others, key: str) -> None:
    """Jedem Gesicht das Merkmal desselben Gesichts vom anderen Rechenweg
    anhaengen. Dasselbe Gesicht heisst: gleiche Stelle im Originalbild; jeder
    Fund des anderen Wegs wird hoechstens einmal vergeben.
    """
    free = list(range(len(others)))
    for f in faces:
        best, best_iou = None, PAIR_MIN_IOU
        for i in free:
            v = _iou(f["bbox"], others[i]["bbox"])
            if v >= best_iou:
                best, best_iou = i, v
        if best is not None:
            f[key] = others[best]["embedding"]
            free.remove(best)


def both_ways(app, img, orig, scale: float, min_side: int, candidates, mode: str):
    """Kleine Gesichter auf beiden Rechenwegen (Stufen shadow und on).

    Verwendet wird in shadow der Weg ueber das verkleinerte Bild, in on der
    ueber das Original. Findet in on der Weg ueber das Original kein Gesicht
    oder scheitert er, gilt fuer dieses Bild der Weg ueber das verkleinerte
    (zweiter Weg ist dann "native", ohne Gesicht). Scheitert der zweite Weg,
    gibt es fuer das Bild keinen Vergleich (zweiter Weg None).

    Liefert (Gesichter, Region, zweiter Weg, dessen Gesichter, dessen Region,
    Weg ueber das Original gescheitert). Das Letzte geht als `native_error`
    an den Hub, der es zaehlt (face.native_error).
    """

    def scaled_way():
        return small_faces(app, img, scale, min_side, candidates)

    def native_way():
        return small_faces(app, img, scale, min_side, candidates, orig=orig)

    def second(run, name: str):
        try:
            return run()
        except Exception as e:
            print(f"[face] Weg über das {name} fehlgeschlagen: {e}", flush=True)
            return None

    if mode == "on":
        nat = second(native_way, "Originalbild")
        if nat is not None and nat[0]:
            old = second(scaled_way, "verkleinerte Bild")
            if old is None:
                return nat[0], nat[1], None, [], None, False
            attach_other(nat[0], old[0], "embedding_scaled")
            return nat[0], nat[1], "scaled", old[0], old[1], False
        # Wie bisher: Ein Fehler auf diesem Weg geht als Fehler an den Hub.
        faces, region = scaled_way()
        if nat is None:
            return faces, region, None, [], None, True
        return faces, region, "native", [], None, False

    faces, region = scaled_way()
    nat = second(native_way, "Originalbild")
    if nat is None:
        return faces, region, None, [], None, True
    attach_other(faces, nat[0], "embedding_native")
    return faces, region, "native", nat[0], nat[1], False


def embed_jpeg(data: bytes) -> dict:
    img = decode_jpeg(data)
    if img is None:
        return {"ok": False, "error": "Kein gültiges JPEG", "faces": []}

    orig_h, orig_w = img.shape[:2]
    orig = img
    img, scale = downscale(img)
    # Zwei Wege gibt es nur, wenn das Original mehr Pixel hat als das Suchbild.
    mode = NATIVE_MODE if scale < 1.0 else "off"
    if mode == "off":
        orig = None
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

    # Zweiter Rechenweg (Stufen shadow und on): welcher es ist und was er fand.
    compared = None
    other = []
    other_region = None
    native_failed = False
    if not out:
        candidates = [
            r
            for r in all_rejected
            if r.get("bbox_scaled") and r.get("det_score", 0) >= MIN_DET_SCORE
        ]
        # Reihenfolge und Mindestgroessen wie bisher im verkleinerten Bild.
        candidates.sort(
            key=lambda r: (r.get("size_scaled", 0), r.get("det_score", 0)), reverse=True
        )
        if mode == "off":
            out, region = small_faces(app, img, scale, min_side, candidates)
        else:
            out, region, compared, other, other_region, native_failed = both_ways(
                app, img, orig, scale, min_side, candidates, mode
            )
        if out:
            used_region = region
            upscaled = True

    out.sort(key=lambda x: x["det_score"], reverse=True)
    result = {
        "ok": True,
        "model": "buffalo_l",
        "faces": out,
        "rejected": [
            {k: r[k] for k in ("det_score", "size", "size_scaled", "need")}
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
    if native_failed:
        # Der Weg ueber das Original ist gescheitert (Zeile „Weg über das
        # Originalbild fehlgeschlagen“): Es gilt der bisherige, ohne Vergleich.
        result["native_error"] = True
    if compared:
        result["compared"] = compared
        result["other_region"] = other_region
        # Findet nur der zweite Weg ein Gesicht, geht es getrennt mit: Der Hub
        # verwendet es nicht, kann es aber zaehlen und gegen die Galerie werten.
        if not out and other:
            other.sort(key=lambda x: x["det_score"], reverse=True)
            result[f"faces_{compared}"] = other
    return result


class Handler(BaseHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        # Erfolgreiche Anfragen nicht protokollieren: /health und /embed kommen
        # bei jeder Person mehrfach und fuellten rund ein Fuenftel des Hub-Logs.
        # Fehler (ab 400) bleiben sichtbar.
        try:
            if int(code) < 400:
                return
        except (TypeError, ValueError):
            pass
        super().log_request(code, size)

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
            self._json(
                200, {"ok": True, "ready": ready, "model": "buffalo_l", "native": NATIVE_MODE}
            )
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
