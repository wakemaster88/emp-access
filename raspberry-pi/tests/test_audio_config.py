"""Konfiguration des Audio-Abspielers: Dateirechte."""

import json
import os
import stat
import tempfile
import unittest
from unittest import mock

import support  # noqa: F401  (stubbt Fremdpakete, muss zuerst kommen)
from emp_audio import config as audio_config


def file_mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


class AudioConfigPermissionTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.config_path = os.path.join(self._tmp.name, "audio-config.json")
        patcher = mock.patch.object(audio_config, "CONFIG_PATH", self.config_path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_save_writes_0600(self):
        cfg = audio_config.Config()
        self.assertTrue(cfg.apply_setup_json('{"url": "https://emp.example.com/", "token": "tok-123", "id": 7}'))
        self.assertEqual(file_mode(self.config_path), 0o600)
        with open(self.config_path) as f:
            stored = json.load(f)
        self.assertEqual(stored["api_token"], "tok-123")
        self.assertEqual(stored["server_url"], "https://emp.example.com")

    def test_load_tightens_existing_file(self):
        with open(self.config_path, "w") as f:
            json.dump({"server_url": "https://emp.example.com", "api_token": "tok-123", "device_id": 7}, f)
        os.chmod(self.config_path, 0o644)
        cfg = audio_config.Config()
        self.assertTrue(cfg.is_configured)
        self.assertEqual(file_mode(self.config_path), 0o600)

    def test_chmod_error_is_ignored(self):
        with open(self.config_path, "w") as f:
            json.dump({"server_url": "https://emp.example.com", "api_token": "tok-123", "device_id": 7}, f)
        with mock.patch.object(audio_config.os, "chmod", side_effect=PermissionError("nein")):
            cfg = audio_config.Config()
        self.assertTrue(cfg.is_configured)


if __name__ == "__main__":
    unittest.main()
