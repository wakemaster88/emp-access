"""Musik unter einer Durchsage (Geburtstags-Ansage mit „Happy Birthday“)."""

import unittest

import support  # noqa: F401  (stubbt Fremdpakete, muss zuerst kommen)
from emp_audio import main as audio_main
from emp_audio import player


class FakeCache:
    def __init__(self, ok=True):
        self.ok = ok
        self.urls = []

    def ensure(self, url):
        self.urls.append(url)
        return "/tmp/bed.mp3" if self.ok else None


def audio(cache):
    p = audio_main.EmpAudio.__new__(audio_main.EmpAudio)
    p.cache = cache
    return p


class BedFilterTest(unittest.TestCase):
    def test_speech_is_padded_to_the_end_of_the_music(self):
        graph = player.bed_filter(18, 0.8, "speechnorm=p=0.95")
        # Ohne Auffüllen endet der Sidechain-Kompressor mit der Sprache.
        self.assertIn("apad=whole_dur=18.00", graph)
        self.assertIn("atrim=end=18.00", graph)
        self.assertIn("afade=t=out:st=15.50", graph)
        self.assertIn("speechnorm=p=0.95", graph)
        self.assertTrue(graph.endswith("[ao]"))

    def test_limits(self):
        self.assertIn("atrim=end=60.00", player.bed_filter(900, 5, None))
        self.assertIn("volume=1.00", player.bed_filter(900, 5, None))
        self.assertIn("atrim=end=4.00", player.bed_filter(1, 0, None))
        self.assertNotIn("speechnorm", player.bed_filter(10, 0.5, None))

    def test_lavfi_inner(self):
        self.assertEqual(player._lavfi_inner("lavfi=[dynaudnorm=f=150]"), "dynaudnorm=f=150")


class AnnounceBedTest(unittest.TestCase):
    def test_no_bed(self):
        cache = FakeCache()
        self.assertIsNone(audio(cache)._announce_bed(None)[0])
        self.assertIsNone(audio(cache)._announce_bed({"url": "http://x"})[0])
        self.assertEqual(cache.urls, [])

    def test_bed_loaded(self):
        path, until, level = audio(FakeCache())._announce_bed({"url": "http://x", "untilSec": 17.5, "level": 0.7})
        self.assertEqual((path, until, level), ("/tmp/bed.mp3", 17.5, 0.7))

    def test_download_failure_plays_without_music(self):
        self.assertIsNone(audio(FakeCache(ok=False))._announce_bed({"url": "http://x", "untilSec": 10})[0])


if __name__ == "__main__":
    unittest.main()
