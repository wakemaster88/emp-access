"""Scan-Ablauf im Hauptprogramm: Konfigurations-QR, reservierte Codes, NOT-AUF, Offline, Watchdog."""

import time
import unittest
from unittest import mock

import support
from support import (
    OTHER_QR,
    RELAY_PIN,
    VALID_QR,
    ScannerTestCase,
    config_mod,
    fake_time,
    gpio,
    main_mod,
    wait_for,
)

DURATION = 0.05
SETTLE = 0.3


class FakeScanner:
    def __init__(self, alive=True):
        self.alive = alive
        self.started = False
        self.stopped = False

    def start(self):
        self.started = True

    def is_alive(self):
        return self.alive

    def stop(self):
        self.stopped = True


class MainTestCase(ScannerTestCase):
    def make_app(self, configured=True, real_relay=False):
        if configured:
            self.write_configured()
        app = main_mod.EmpScanner()
        app.relay = self.make_relay(DURATION) if real_relay else mock.Mock()
        if configured:
            app.api = mock.Mock()
            app.api.validate_scan.return_value = {"granted": False, "message": "Ungültig"}
        return app


class ConfigQrScanTest(MainTestCase):
    def test_configured_scanner_ignores_config_qr(self):
        app = self.make_app()
        with open(self.config_path) as f:
            before = f.read()

        with self.assertLogs("emp.main", level="WARNING"):
            app._process_scan(OTHER_QR)

        # nicht übernommen ...
        self.assertEqual(app.config.server_url, "https://emp.example.com")
        self.assertEqual(app.config.api_token, "tok-123")
        self.assertEqual(app.config.device_id, 42)
        with open(self.config_path) as f:
            self.assertEqual(f.read(), before)
        # ... nicht an den Server geschickt, normales Ablehn-Signal
        app.api.validate_scan.assert_not_called()
        app.relay.deny.assert_called_once_with()
        app.relay.grant.assert_not_called()

    def test_configured_scanner_does_not_forward_truncated_config_qr(self):
        app = self.make_app()

        app._process_scan(OTHER_QR[:-4])

        app.api.validate_scan.assert_not_called()
        app.relay.deny.assert_called_once_with()

    def test_unconfigured_scanner_accepts_config_qr(self):
        app = self.make_app(configured=False)
        self.assertFalse(app.config.is_configured)

        app._setup_scan(VALID_QR)

        self.assertTrue(app.config.is_configured)
        self.assertEqual(app.config.server_url, "https://emp.example.com")
        self.assertEqual(app.config.device_id, 42)
        # ein zweiter QR direkt danach wird nicht mehr angenommen
        app._setup_scan(OTHER_QR)
        self.assertEqual(app.config.server_url, "https://emp.example.com")

    def test_process_scan_never_exits_the_process(self):
        # Früher: sys.exit(0) im Scanner-Thread nach einem Konfigurations-QR.
        app = self.make_app()
        with mock.patch.object(main_mod.sys, "exit") as exit_mock:
            app._process_scan(OTHER_QR)
        exit_mock.assert_not_called()

    def test_reset_config_flag(self):
        self.write_configured(relay_pin=5)

        main_mod.main(["--reset-config"])

        cfg = config_mod.Config()
        self.assertFalse(cfg.is_configured)
        self.assertEqual(cfg.relay_pin, 5)


class ReservedCodeScanTest(MainTestCase):
    def test_reserved_code_is_denied_locally(self):
        app = self.make_app()

        app._process_scan("__DASHBOARD_OPEN__")

        app.api.validate_scan.assert_not_called()
        app.api.report_dashboard_open.assert_not_called()
        app.relay.deny.assert_called_once_with()
        app.relay.grant.assert_not_called()

    def test_any_reserved_marker_is_denied_locally(self):
        app = self.make_app()

        app._process_scan("__SOMETHING_ELSE__")

        app.api.validate_scan.assert_not_called()
        app.relay.deny.assert_called_once_with()


class ScanResultTest(MainTestCase):
    def test_granted_opens_relay(self):
        app = self.make_app()
        app.api.validate_scan.return_value = {"granted": True, "message": "ok"}

        app._process_scan("TICKET-123456")

        app.api.validate_scan.assert_called_once_with("TICKET-123456")
        app.relay.grant.assert_called_once_with()
        app.relay.deny.assert_not_called()
        app.relay.offline.assert_not_called()

    def test_denied_gives_deny_signal(self):
        app = self.make_app()

        app._process_scan("TICKET-123456")

        app.relay.deny.assert_called_once_with()
        app.relay.grant.assert_not_called()
        app.relay.offline.assert_not_called()

    def test_offline_is_fail_closed_with_own_signal(self):
        app = self.make_app()
        app.api.validate_scan.return_value = {
            "granted": False, "message": "Server nicht erreichbar", "offline": True,
        }

        with self.assertLogs("emp.main", level="ERROR") as logs:
            app._process_scan("TICKET-123456")

        app.relay.offline.assert_called_once_with()
        app.relay.grant.assert_not_called()
        app.relay.deny.assert_not_called()
        self.assertTrue(any("OFFLINE" in line for line in logs.output))

    def test_offline_never_opens_real_relay(self):
        app = self.make_app(real_relay=True)
        app.api.validate_scan.return_value = {"granted": False, "offline": True}

        app._process_scan("TICKET-123456")

        self.assertEqual(gpio.values(RELAY_PIN), [])

    def test_locked_device_denies_without_server(self):
        app = self.make_app()
        app._apply_task(3)
        app.relay.reset_mock()

        app._process_scan("TICKET-123456")

        app.api.validate_scan.assert_not_called()
        app.relay.deny.assert_called_once_with()

    def test_scan_log_does_not_contain_full_code(self):
        app = self.make_app()
        code = "SECRET-TICKET-CODE-0123456789"

        with self.assertLogs("emp", level="INFO") as logs:
            app._process_scan(code)

        joined = "\n".join(logs.output)
        self.assertNotIn(code, joined)
        self.assertNotIn(code[:8], joined)
        self.assertIn("SECR", joined)

    def test_mask_code(self):
        self.assertEqual(main_mod._mask_code("ABCDEFGHIJ"), "ABCD… (10 Zeichen)")
        # kurze Codes: höchstens die Hälfte zeigen
        self.assertEqual(main_mod._mask_code("1234"), "12… (4 Zeichen)")
        self.assertEqual(main_mod._mask_code("7"), "… (1 Zeichen)")


class EmergencyOpenTest(MainTestCase):
    def assert_relay_stays_open(self):
        time.sleep(SETTLE)
        self.assertEqual(gpio.last(RELAY_PIN), gpio.HIGH)
        self.assertNotIn(gpio.LOW, gpio.values(RELAY_PIN))

    def test_scan_during_emergency_schedules_no_relay_close(self):
        app = self.make_app(real_relay=True)
        app._apply_task(2)
        self.assertEqual(gpio.last(RELAY_PIN), gpio.HIGH)

        app._process_scan("TICKET-123456")
        app._process_scan("TICKET-654321")

        self.assertIsNone(app.relay._timer)
        app.api.validate_scan.assert_not_called()
        self.assert_relay_stays_open()

    def test_reserved_and_config_codes_during_emergency_keep_relay_open(self):
        app = self.make_app(real_relay=True)
        app._apply_task(2)

        app._process_scan("__DASHBOARD_OPEN__")
        app._process_scan(OTHER_QR)

        self.assertIsNone(app.relay._timer)
        self.assert_relay_stays_open()

    def test_grant_started_before_emergency_cannot_relock(self):
        app = self.make_app(real_relay=True)
        app.api.validate_scan.return_value = {"granted": True}
        app._process_scan("TICKET-123456")  # normaler Zutritt, Schließ-Timer läuft

        app._apply_task(2)

        self.assert_relay_stays_open()

    def test_emergency_ends_with_task_0(self):
        app = self.make_app(real_relay=True)
        app._apply_task(2)

        app._apply_task(0)

        self.assertEqual(gpio.last(RELAY_PIN), gpio.LOW)
        self.assertEqual(app._current_task, 0)

    def test_open_once_after_emergency_closes_again(self):
        app = self.make_app(real_relay=True)
        app._apply_task(2)

        app._apply_task(1)

        self.assertEqual(app._current_task, 0)
        self.assertTrue(wait_for(lambda: gpio.last(RELAY_PIN) == gpio.LOW))
        app.api.report_dashboard_open.assert_called_once_with()
        app.api.report_task_completed.assert_called_once_with(0)

    def test_open_once_pulses_relay(self):
        app = self.make_app(real_relay=True)

        app._apply_task(1)

        self.assertEqual(gpio.values(RELAY_PIN)[0], gpio.HIGH)
        self.assertTrue(wait_for(lambda: gpio.last(RELAY_PIN) == gpio.LOW))
        app.api.report_dashboard_open.assert_called_once_with()


class WatchdogTest(MainTestCase):
    def run_watchdog_once(self, app):
        """Lässt genau einen Durchlauf von _watchdog_loop laufen, liefert die sd_notify-Aufrufe."""
        app._running = True

        def stop(_seconds):
            app._running = False

        with mock.patch.object(main_mod, "_sd_notify") as notify, \
                mock.patch.object(main_mod, "time", fake_time(sleep=stop)):
            app._watchdog_loop()
        return [call[0][0] for call in notify.call_args_list]

    def test_pings_regardless_of_scanner_thread(self):
        # Der Dienst bedient auch ohne Scanner Tasks (Öffnen per Dashboard, NOT-AUF);
        # ein Watchdog-Neustart würde das Relais fallen lassen, ohne den Scanner
        # zurückzubringen.
        for scanner in (FakeScanner(alive=True), FakeScanner(alive=False), None):
            app = self.make_app()
            app.scanner = scanner
            self.assertEqual(self.run_watchdog_once(app), ["WATCHDOG=1"])

    def run_wait_for_config(self, scanner_alive):
        """Ein Durchlauf der Warteschleife auf den Konfigurations-QR; liefert die sd_notify-Aufrufe."""
        app = self.make_app(configured=False)
        app._running = True
        scanner = FakeScanner(alive=scanner_alive)

        def stop(_seconds):
            app._running = False

        with mock.patch.object(main_mod, "ScannerInput", return_value=scanner), \
                mock.patch.object(main_mod, "_sd_notify") as notify, \
                mock.patch.object(main_mod, "time", fake_time(sleep=stop)):
            app._wait_for_config()
        self.assertTrue(scanner.started)
        self.assertTrue(scanner.stopped)
        return [call[0][0] for call in notify.call_args_list]

    def test_setup_wait_keeps_pinging(self):
        self.assertEqual(self.run_wait_for_config(scanner_alive=True), ["WATCHDOG=1"])
        self.assertEqual(self.run_wait_for_config(scanner_alive=False), ["WATCHDOG=1"])

    def test_dead_scanner_is_logged_once_and_service_keeps_running(self):
        app = self.make_app()
        app.scanner = FakeScanner(alive=False)
        with self.assertLogs("emp.main", level="ERROR") as logs:
            app._check_scanner_health()
            app._check_scanner_health()
        self.assertEqual(len(logs.records), 1)
        self.assertIn("Scanner-Thread", logs.records[0].getMessage())

        # Lebt der Thread wieder, wird ein erneuter Ausfall wieder gemeldet.
        app.scanner.alive = True
        app._check_scanner_health()
        app.scanner.alive = False
        with self.assertLogs("emp.main", level="ERROR") as logs:
            app._check_scanner_health()
        self.assertEqual(len(logs.records), 1)


if __name__ == "__main__":
    unittest.main()
