"""Fehler eines Zähl-Workers: Fehlertext ja, Zeitpunkt des letzten Bilds bleibt."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from worker_state import note_worker_error  # noqa: E402


class NoteWorkerErrorTest(unittest.TestCase):
    def test_fehler_laesst_last_update_stehen(self):
        counter = SimpleNamespace(last_update=1_700_000_000.5, last_error=None, occupancy=2)
        text = note_worker_error(counter, RuntimeError("RTSP-Stream abgebrochen"))
        self.assertEqual(text, "RTSP-Stream abgebrochen")
        self.assertEqual(counter.last_error, "RTSP-Stream abgebrochen")
        self.assertEqual(counter.last_update, 1_700_000_000.5)
        self.assertEqual(counter.occupancy, 2)

    def test_noch_kein_bild(self):
        counter = SimpleNamespace(last_update=0.0, last_error=None)
        note_worker_error(counter, "RTSP-Stream konnte nicht geöffnet werden")
        self.assertEqual(counter.last_update, 0.0)
        self.assertEqual(counter.last_error, "RTSP-Stream konnte nicht geöffnet werden")


if __name__ == "__main__":
    unittest.main()
