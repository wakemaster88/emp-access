"""API-Client: Dashboard-Öffnung, reservierte Codes, Offline-Verhalten."""

import unittest
from unittest import mock

import support
from support import (
    FakeConnectionError,
    FakeConnectTimeout,
    FakeResponse,
    FakeTimeout,
    api_mod,
    fake_time,
)


class ApiClientTestCase(unittest.TestCase):
    def setUp(self):
        self.client = api_mod.ApiClient("https://emp.example.com", "tok-123", 42)
        self.session = self.client._session
        # Wiederholungs-Pause nicht wirklich abwarten
        self.sleep = mock.Mock()
        patcher = mock.patch.object(api_mod, "time", fake_time(sleep=self.sleep))
        patcher.start()
        self.addCleanup(patcher.stop)


class DashboardOpenTest(ApiClientTestCase):
    def test_payload_contains_event_field(self):
        self.assertTrue(self.client.report_dashboard_open())

        self.assertEqual(len(self.session.posts), 1)
        post = self.session.posts[0]
        self.assertEqual(post["url"], "https://emp.example.com/api/devices/pi/scan")
        self.assertEqual(post["json"], {
            "event": "dashboard_open",
            "code": "__DASHBOARD_OPEN__",  # bleibt für ältere Server-Stände
            "deviceId": 42,
        })

    def test_failure_returns_false(self):
        self.session.post_results = [FakeConnectionError("down")]
        self.assertFalse(self.client.report_dashboard_open())


class ReservedCodeTest(ApiClientTestCase):
    def test_is_reserved_code(self):
        for code in ("__DASHBOARD_OPEN__", "__X__", "____", "  __FOO__  "):
            with self.subTest(code=code):
                self.assertTrue(api_mod.is_reserved_code(code))
        for code in ("TICKET-123456", "__", "___", "__FOO", "FOO__", "_FOO_", ""):
            with self.subTest(code=code):
                self.assertFalse(api_mod.is_reserved_code(code))

    def test_reserved_code_is_never_sent(self):
        result = self.client.validate_scan("__DASHBOARD_OPEN__")

        self.assertFalse(result["granted"])
        self.assertEqual(self.session.posts, [])

    def test_scan_never_carries_event_field(self):
        self.session.post_results = [FakeResponse(200, {"granted": True})]
        self.client.validate_scan("TICKET-123456")
        self.assertNotIn("event", self.session.posts[0]["json"])


class ValidateScanTest(ApiClientTestCase):
    def test_success_passes_server_answer_through(self):
        self.session.post_results = [FakeResponse(200, {"granted": True, "message": "ok"})]

        result = self.client.validate_scan("TICKET-123456", direction="IN")

        self.assertEqual(result, {"granted": True, "message": "ok"})
        self.assertEqual(self.session.posts[0]["json"],
                         {"code": "TICKET-123456", "deviceId": 42, "direction": "IN"})
        self.assertEqual(self.session.posts[0]["timeout"], api_mod.TIMEOUT_SCAN)

    def test_connection_error_is_retried_once_then_succeeds(self):
        self.session.post_results = [
            FakeConnectionError("stale keep-alive"),
            FakeResponse(200, {"granted": True, "message": "ok"}),
        ]

        result = self.client.validate_scan("TICKET-123456")

        self.assertTrue(result["granted"])
        self.assertNotIn("offline", result)
        self.assertEqual(len(self.session.posts), 2)
        self.assertEqual(self.session.posts[0]["json"], self.session.posts[1]["json"])
        self.sleep.assert_called_once_with(api_mod.SCAN_RETRY_DELAY)

    def test_two_connection_errors_fail_closed_as_offline(self):
        self.session.post_results = [FakeConnectionError("down"), FakeConnectionError("down")]

        result = self.client.validate_scan("TICKET-123456")

        self.assertIs(result["granted"], False)
        self.assertIs(result["offline"], True)
        self.assertEqual(len(self.session.posts), 2)  # genau ein Wiederholungsversuch

    def test_timeout_is_not_retried(self):
        for exc in (FakeTimeout("read timeout"), FakeConnectTimeout("connect timeout")):
            with self.subTest(exc=type(exc).__name__):
                del self.session.posts[:]
                self.session.post_results = [exc, FakeResponse(200, {"granted": True})]

                result = self.client.validate_scan("TICKET-123456")

                self.assertIs(result["granted"], False)
                self.assertIs(result["offline"], True)
                self.assertEqual(len(self.session.posts), 1)

    def test_http_error_fails_closed_without_retry(self):
        self.session.post_results = [FakeResponse(500), FakeResponse(200, {"granted": True})]

        result = self.client.validate_scan("TICKET-123456")

        self.assertIs(result["granted"], False)
        self.assertIs(result["offline"], True)
        self.assertEqual(len(self.session.posts), 1)

    def test_unexpected_error_fails_closed(self):
        self.session.post_results = [RuntimeError("boom")]

        result = self.client.validate_scan("TICKET-123456")

        self.assertIs(result["granted"], False)
        self.assertIs(result["offline"], True)
        self.assertEqual(len(self.session.posts), 1)


if __name__ == "__main__":
    unittest.main()
