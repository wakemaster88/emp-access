"""Ausschnitt für /classify: Angaben lesen, Ausschnitt in Pixeln, Boxen zurück auf das ganze Bild."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from classify_roi import (  # noqa: E402
    MAX_IMGSZ,
    box_to_full,
    parse_imgsz,
    parse_roi,
    roi_pixels,
    shrink_size,
)

FULL = (3840, 2160)


def forward(box_norm, rect, seen):
    """Bekannte Box im ganzen Bild (normiert) → Pixel im gesehenen Ausschnitt (wie YOLO sie liefert)."""
    x, y, w, h = box_norm
    fw, fh = FULL
    x0, y0, x1, y1 = rect
    kx = seen[0] / (x1 - x0)
    ky = seen[1] / (y1 - y0)
    return (
        (x * fw - x0) * kx,
        (y * fh - y0) * ky,
        ((x + w) * fw - x0) * kx,
        ((y + h) * fh - y0) * ky,
    )


class ParseTest(unittest.TestCase):
    def test_without_values_nothing_changes(self):
        self.assertIsNone(parse_roi(None))
        self.assertIsNone(parse_imgsz(None))
        self.assertIsNone(parse_imgsz(""))

    def test_roi_is_read_and_clamped(self):
        self.assertEqual(parse_roi("0.5,0.1,0.4,0.5"), (0.5, 0.1, 0.4, 0.5))
        x, y, w, h = parse_roi("-0.1,0.8,0.5,0.5")
        self.assertEqual((x, y), (0.0, 0.8))
        self.assertAlmostEqual(w, 0.4)
        self.assertAlmostEqual(h, 0.2)

    def test_unusable_roi_is_ignored(self):
        for raw in ("", "0.1,0.2,0.3", "a,b,c,d", "1.2,0,0.3,0.3", "0.2,0.2,0,0.3", "nan,0,0.3,0.3", "inf,0,1,1"):
            self.assertIsNone(parse_roi(raw), raw)

    def test_imgsz_multiple_of_32_up_to_1280(self):
        self.assertEqual(MAX_IMGSZ, 1280)
        self.assertEqual(parse_imgsz("1280"), 1280)
        self.assertEqual(parse_imgsz("4000"), 1280)
        self.assertEqual(parse_imgsz("1000"), 992)
        self.assertEqual(parse_imgsz("10"), 32)
        self.assertIsNone(parse_imgsz("0"))
        self.assertIsNone(parse_imgsz("abc"))


class GeometryTest(unittest.TestCase):
    def test_roi_pixels_stay_in_image(self):
        self.assertEqual(roi_pixels((0.0, 0.0, 1.0, 1.0), *FULL), (0, 0, 3840, 2160))
        x0, y0, x1, y1 = roi_pixels((0.474, 0.073, 0.526, 0.627), *FULL)
        self.assertEqual((x0, y0), (1820, 157))
        self.assertLessEqual(x1, 3840)
        self.assertLessEqual(y1, 2160)
        tiny = roi_pixels((0.9999, 0.9999, 0.0001, 0.0001), *FULL)
        self.assertGreater(tiny[2], tiny[0])
        self.assertGreater(tiny[3], tiny[1])

    def test_shrink_like_before(self):
        self.assertEqual(shrink_size(3840, 2160), (1280, 720))
        self.assertEqual(shrink_size(1000, 700), (1000, 700))
        self.assertEqual(shrink_size(2020, 1354), (1280, 857))

    def test_box_back_to_full_image_within_one_percent(self):
        # Fläche am Eingang plus Rand, ein Pkw mit rund 0,7 % Bildfläche darin.
        rect = roi_pixels((0.474, 0.073, 0.526, 0.627), *FULL)
        seen = shrink_size(rect[2] - rect[0], rect[3] - rect[1])
        for car in ((0.62, 0.40, 0.12, 0.06), (0.90, 0.60, 0.09, 0.05), (0.48, 0.08, 0.05, 0.04)):
            got = box_to_full(forward(car, rect, seen), rect, seen, FULL)
            for key, want in zip(("x", "y", "w", "h"), car):
                self.assertAlmostEqual(got[key], want, delta=0.01 * max(want, 0.01), msg=f"{car} {key}")

    def test_box_without_shrinking(self):
        rect = roi_pixels((0.6, 0.3, 0.2, 0.3), *FULL)
        seen = (rect[2] - rect[0], rect[3] - rect[1])
        self.assertEqual(seen, (768, 648))
        got = box_to_full((0.0, 0.0, 768.0, 648.0), rect, seen, FULL)
        self.assertEqual(got, {"x": 0.6, "y": 0.3, "w": 0.2, "h": 0.3})

    def test_whole_image_as_roi_matches_the_old_normalization(self):
        # Ganzes Bild als Ausschnitt, verkleinert auf 1280 × 720: dieselben
        # Zahlen wie die bisherige Rechnung x / Breite des gesehenen Bilds.
        rect = (0, 0, 3840, 2160)
        seen = shrink_size(3840, 2160)
        box = (640.0, 360.0, 800.0, 450.0)
        got = box_to_full(box, rect, seen, FULL)
        old = {
            "x": round(box[0] / seen[0], 4),
            "y": round(box[1] / seen[1], 4),
            "w": round((box[2] - box[0]) / seen[0], 4),
            "h": round((box[3] - box[1]) / seen[1], 4),
        }
        self.assertEqual(got, old)


if __name__ == "__main__":
    unittest.main()
