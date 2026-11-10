"""Konfiguration: Konfigurations-QR, Dateirechte, Reset."""

import json
import os
import stat
import unittest
from unittest import mock

import support
from support import OTHER_QR, VALID_QR, ScannerTestCase, config_mod


def file_mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


class ConfigQrTest(ScannerTestCase):
    def test_unconfigured_accepts_valid_qr(self):
        cfg = config_mod.Config()
        self.assertFalse(cfg.is_configured)

        self.assertTrue(cfg.apply_qr_config(VALID_QR))

        self.assertTrue(cfg.is_configured)
        self.assertEqual(cfg.server_url, "https://emp.example.com")  # ohne Slash am Ende
        self.assertEqual(cfg.api_token, "tok-123")
        self.assertEqual(cfg.device_id, 42)
        with open(self.config_path) as f:
            stored = json.load(f)
        self.assertEqual(stored["server_url"], "https://emp.example.com")

    def test_configured_rejects_qr(self):
        self.write_configured()
        cfg = config_mod.Config()
        self.assertTrue(cfg.is_configured)
        with open(self.config_path) as f:
            before = f.read()

        self.assertFalse(cfg.apply_qr_config(OTHER_QR))

        self.assertEqual(cfg.server_url, "https://emp.example.com")
        self.assertEqual(cfg.api_token, "tok-123")
        self.assertEqual(cfg.device_id, 42)
        with open(self.config_path) as f:
            self.assertEqual(f.read(), before)

    def test_second_qr_after_first_is_rejected(self):
        cfg = config_mod.Config()
        self.assertTrue(cfg.apply_qr_config(VALID_QR))
        self.assertFalse(cfg.apply_qr_config(OTHER_QR))
        self.assertEqual(cfg.server_url, "https://emp.example.com")

    def test_rejects_non_http_urls(self):
        for url in ("ftp://emp.example.com", "javascript:alert(1)", "emp.example.com",
                    "https://", "", "file:///etc/passwd", None, 5):
            with self.subTest(url=url):
                cfg = config_mod.Config()
                qr = json.dumps({"url": url, "token": "tok", "id": 1})
                self.assertFalse(cfg.apply_qr_config(qr))
                self.assertFalse(cfg.is_configured)
                self.assertFalse(os.path.exists(self.config_path))

    def test_accepts_plain_http(self):
        cfg = config_mod.Config()
        qr = json.dumps({"url": "http://localhost:3000", "token": "tok", "id": 1})
        self.assertTrue(cfg.apply_qr_config(qr))
        self.assertEqual(cfg.server_url, "http://localhost:3000")

    def test_rejects_non_int_id(self):
        for device_id in ("42", 4.2, True, 0, -3, None, [1]):
            with self.subTest(device_id=device_id):
                cfg = config_mod.Config()
                qr = json.dumps({"url": "https://emp.example.com", "token": "tok", "id": device_id})
                self.assertFalse(cfg.apply_qr_config(qr))
                self.assertFalse(cfg.is_configured)

    def test_rejects_bad_token(self):
        for token in ("", "   ", None, 123):
            with self.subTest(token=token):
                cfg = config_mod.Config()
                qr = json.dumps({"url": "https://emp.example.com", "token": token, "id": 1})
                self.assertFalse(cfg.apply_qr_config(qr))
                self.assertFalse(cfg.is_configured)

    def test_rejects_non_config_input(self):
        cfg = config_mod.Config()
        for code in ("TICKET-123456", "{kaputt", "[1, 2, 3]", '"text"', "{}",
                     '{"url": "https://emp.example.com", "token": "tok"}'):
            with self.subTest(code=code):
                self.assertFalse(cfg.apply_qr_config(code))
        self.assertFalse(cfg.is_configured)

    def test_looks_like_config_qr(self):
        self.assertTrue(config_mod.looks_like_config_qr(VALID_QR))
        self.assertTrue(config_mod.looks_like_config_qr("  " + OTHER_QR))
        # unvollständig gelesen – enthält trotzdem ein Token
        self.assertTrue(config_mod.looks_like_config_qr(VALID_QR[:-5]))
        self.assertFalse(config_mod.looks_like_config_qr("TICKET-123456"))
        self.assertFalse(config_mod.looks_like_config_qr('{"ticket": "abc"}'))
        self.assertFalse(config_mod.looks_like_config_qr("https://emp.example.com/t/abc"))


class ConfigFileTest(ScannerTestCase):
    def test_save_creates_file_with_0600(self):
        cfg = config_mod.Config()
        self.assertTrue(cfg.apply_qr_config(VALID_QR))
        self.assertEqual(file_mode(self.config_path), 0o600)

    def test_save_tightens_existing_file(self):
        self.write_config(relay_pin=5)
        os.chmod(self.config_path, 0o644)
        cfg = config_mod.Config()
        os.chmod(self.config_path, 0o644)
        self.assertTrue(cfg.save())
        self.assertEqual(file_mode(self.config_path), 0o600)

    def test_load_tightens_existing_file(self):
        self.write_configured()
        os.chmod(self.config_path, 0o644)
        config_mod.Config()
        self.assertEqual(file_mode(self.config_path), 0o600)

    def test_save_reports_failure(self):
        cfg = config_mod.Config()
        with mock.patch.object(
            config_mod, "CONFIG_PATH", os.path.join(self.tmpdir, "gibt", "es", "nicht.json")
        ):
            self.assertFalse(cfg.save())

    def test_reset_clears_server_config_only(self):
        self.write_configured(relay_pin=5, relay_duration=2.5)
        cfg = config_mod.Config()

        self.assertTrue(cfg.reset_server_config())

        self.assertFalse(cfg.is_configured)
        reloaded = config_mod.Config()
        self.assertFalse(reloaded.is_configured)
        self.assertEqual(reloaded.server_url, "")
        self.assertEqual(reloaded.api_token, "")
        self.assertEqual(reloaded.device_id, 0)
        self.assertEqual(reloaded.relay_pin, 5)
        self.assertEqual(reloaded.relay_duration, 2.5)
        # nach dem Reset wird ein Konfigurations-QR wieder angenommen
        self.assertTrue(reloaded.apply_qr_config(OTHER_QR))
        self.assertEqual(reloaded.server_url, "https://evil.example.org")

    def test_signature_check_is_off_by_default(self):
        self.assertIs(config_mod.DEFAULT["update_verify_signature"], False)


if __name__ == "__main__":
    unittest.main()
