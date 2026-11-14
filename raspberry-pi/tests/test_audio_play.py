"""Audio-Abspieler: manuelles Play gegen die Musik-Automatik."""

import threading
import time
import unittest
from datetime import datetime, timezone

import support  # noqa: F401  (stubbt Fremdpakete, muss zuerst kommen)
from emp_audio import main as audio_main


class FakeMusic:
    def __init__(self):
        self.volume = 50
        self.streams = []
        self.is_playing = False

    def set_volume(self, volume):
        self.volume = volume

    def play_stream(self, url):
        self.streams.append(url)
        self.is_playing = True


def blocked_zone():
    """Fenster zu, nächster Beginn in einer Stunde."""
    until = datetime.fromtimestamp(time.time() + 3600, tz=timezone.utc).isoformat()
    return {"isActive": True, "music": {"allowed": False, "until": until}}


def player():
    p = audio_main.EmpAudio.__new__(audio_main.EmpAudio)
    p.music = FakeMusic()
    p._off_hours = False
    p._zone_lock = threading.Lock()
    return p


class ManualPlayTest(unittest.TestCase):
    def test_blocked_play_is_reported_not_swallowed(self):
        p = player()
        with self.assertRaises(RuntimeError) as ctx:
            p._do_play({"kind": "STREAM", "url": "http://radio"}, blocked_zone())
        self.assertIn("Musikzeit", str(ctx.exception))
        self.assertEqual(p.music.streams, [])
        self.assertTrue(p._off_hours)

    def test_manual_play_overrides_stale_window(self):
        p = player()
        p._off_hours = True
        p._do_play({"kind": "STREAM", "url": "http://radio", "manual": True}, blocked_zone())
        self.assertEqual(p.music.streams, ["http://radio"])
        self.assertFalse(p._off_hours)


if __name__ == "__main__":
    unittest.main()
