"""Audio-Abspieler: Zonen-Poll mit ETag/If-None-Match."""

import unittest

import support  # noqa: F401  (stubbt Fremdpakete, muss zuerst kommen)
from support import FakeConnectionError, FakeResponse
from emp_audio import api_client as audio_api

ZONE = {"id": 3, "isActive": True, "volume": 40, "sourceKind": "STREAM"}
JOB = {"id": 11, "kind": "ANNOUNCEMENT"}


class RecordingSession:
    """Zeichnet GETs auf; `get_results` wird der Reihe nach abgearbeitet."""

    def __init__(self):
        self.headers = {}
        self.gets = []
        self.get_results = []

    def get(self, url, params=None, timeout=None, headers=None, **kwargs):
        self.gets.append({"url": url, "params": params, "headers": headers})
        result = self.get_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class AudioStatePollTest(unittest.TestCase):
    def setUp(self):
        self.client = audio_api.ApiClient("https://emp.example.com", "tok-123", 42)
        self.session = RecordingSession()
        self.client._session = self.session

    def sent_etag(self, index):
        headers = self.session.gets[index]["headers"] or {}
        return headers.get("If-None-Match")

    def test_200_with_etag_then_304_reuses_last_zone(self):
        self.session.get_results = [
            FakeResponse(200, {"zone": ZONE, "jobs": []}, {"ETag": 'W/"abc"'}),
            FakeResponse(304, None, {"ETag": 'W/"abc"'}),
        ]
        first = self.client.fetch_state()
        second = self.client.fetch_state()

        self.assertEqual(first, {"zone": ZONE, "jobs": []})
        self.assertIsNone(self.sent_etag(0), "erster Abruf ohne If-None-Match")
        self.assertEqual(self.sent_etag(1), 'W/"abc"')
        self.assertEqual(second, {"zone": ZONE, "jobs": []})

    def test_304_never_repeats_jobs(self):
        self.session.get_results = [
            FakeResponse(200, {"zone": ZONE, "jobs": [JOB]}, {"ETag": 'W/"mitjob"'}),
            FakeResponse(304),
        ]
        self.assertEqual(self.client.fetch_state()["jobs"], [JOB])
        self.assertEqual(self.client.fetch_state(), {"zone": ZONE, "jobs": []})

    def test_200_without_etag_sends_no_header(self):
        self.session.get_results = [
            FakeResponse(200, {"zone": ZONE, "jobs": []}, {"ETag": 'W/"abc"'}),
            FakeResponse(200, {"zone": ZONE, "jobs": []}),
            FakeResponse(200, {"zone": ZONE, "jobs": []}),
        ]
        for _ in range(3):
            self.assertEqual(self.client.fetch_state(), {"zone": ZONE, "jobs": []})
        self.assertEqual(self.sent_etag(1), 'W/"abc"')
        self.assertIsNone(self.sent_etag(2), "ETag fehlte in der letzten Antwort")

    def test_304_without_remembered_answer(self):
        # z. B. Neustart des Pi: nichts gemerkt, also kein If-None-Match.
        self.session.get_results = [
            FakeResponse(304),
            FakeResponse(200, {"zone": ZONE, "jobs": []}),
        ]
        self.assertIsNone(self.client.fetch_state())
        self.assertEqual(self.client.fetch_state(), {"zone": ZONE, "jobs": []})
        self.assertIsNone(self.sent_etag(0))
        self.assertIsNone(self.sent_etag(1))

    def test_error_then_recovery(self):
        self.session.get_results = [
            FakeResponse(200, {"zone": ZONE, "jobs": []}, {"ETag": 'W/"abc"'}),
            FakeConnectionError("down"),
            FakeResponse(500),
            FakeResponse(304),
            FakeResponse(200, {"zone": {**ZONE, "volume": 60}, "jobs": [JOB]}, {"ETag": 'W/"neu"'}),
        ]
        self.assertIsNotNone(self.client.fetch_state())
        self.assertIsNone(self.client.fetch_state(), "Netzfehler")
        self.assertIsNone(self.client.fetch_state(), "Serverfehler")
        self.assertEqual(self.client.fetch_state(), {"zone": ZONE, "jobs": []})
        self.assertEqual(self.sent_etag(3), 'W/"abc"')
        latest = self.client.fetch_state()
        self.assertEqual(latest["zone"]["volume"], 60)
        self.assertEqual(latest["jobs"], [JOB])

    def test_zone_removed_forgets_etag(self):
        self.session.get_results = [
            FakeResponse(200, {"zone": ZONE, "jobs": []}, {"ETag": 'W/"abc"'}),
            FakeResponse(404),
            FakeResponse(200, {"zone": ZONE, "jobs": []}),
        ]
        self.client.fetch_state()
        self.assertIsNone(self.client.fetch_state())
        self.client.fetch_state()
        self.assertIsNone(self.sent_etag(2))

    def test_unreadable_answer_returns_none(self):
        class BrokenJson(FakeResponse):
            def json(self):
                raise ValueError("kein JSON")

        self.session.get_results = [BrokenJson(200, None, {"ETag": 'W/"x"'})]
        self.assertIsNone(self.client.fetch_state())
        self.assertIsNone(self.client._state_etag)


if __name__ == "__main__":
    unittest.main()
