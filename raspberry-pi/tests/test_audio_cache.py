"""Audio-Abspieler: Dateicache bricht übergroße Downloads ab."""

import os
import tempfile
import unittest
from unittest import mock

import support  # noqa: F401  (stubbt Fremdpakete, muss zuerst kommen)
from emp_audio import cache as cache_mod


class FakeDownload:
    def __init__(self, chunks):
        self.status_code = 200
        self._chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def iter_content(self, chunk_size=None):
        yield from self._chunks


class CacheDownloadLimitTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cache = cache_mod.FileCache(cache_dir=self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _get(self, chunks):
        return mock.patch.object(
            cache_mod.requests, "get", create=True, return_value=FakeDownload(chunks)
        )

    def test_kleine_datei_landet_im_cache(self):
        with self._get([b"a" * 1000, b"b" * 1000]):
            path = self.cache.ensure("http://example.invalid/titel.mp3")
        self.assertIsNotNone(path)
        self.assertEqual(os.path.getsize(path), 2000)

    def test_zu_grosser_download_wird_abgebrochen_und_aufgeraeumt(self):
        with mock.patch.object(cache_mod, "MAX_DOWNLOAD_BYTES", 1500), self._get([b"a" * 1000, b"b" * 1000]):
            path = self.cache.ensure("http://example.invalid/endlos.mp3")
        self.assertIsNone(path)
        self.assertEqual(os.listdir(self._tmp.name), [])


if __name__ == "__main__":
    unittest.main()
