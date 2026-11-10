"""
Gemeinsame Test-Hilfen: Stubs für Hardware- und Fremdpakete.

Die Tests laufen auf einer normalen Linux-Maschine ohne Raspberry-Pi-Hardware und
ohne installierte Pakete. Deshalb werden `RPi.GPIO`, `requests` und `evdev` über
`sys.modules` ersetzt, BEVOR `emp_scanner` importiert wird. Dieses Modul muss in
jeder Testdatei als Erstes importiert werden.
"""

import json
import logging
import os
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

PI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PI_DIR not in sys.path:
    sys.path.insert(0, PI_DIR)


# ─── RPi.GPIO ────────────────────────────────────────────────────────────────

class FakePWM:
    def __init__(self, pin, freq):
        self.pin = pin

    def start(self, duty):
        pass

    def ChangeFrequency(self, freq):
        pass

    def stop(self):
        pass


class FakeGPIO(types.ModuleType):
    """Zeichnet alle Ausgaben auf: outputs = [(pin, 0|1), ...]."""

    BCM = "BCM"
    OUT = "OUT"
    LOW = 0
    HIGH = 1
    PWM = FakePWM

    def __init__(self):
        super().__init__("RPi.GPIO")
        self.outputs = []

    def setmode(self, mode):
        pass

    def setwarnings(self, flag):
        pass

    def setup(self, pin, mode, initial=None):
        pass

    def output(self, pin, value):
        self.outputs.append((pin, value))

    def cleanup(self):
        pass

    # Test-Helfer
    def reset(self):
        del self.outputs[:]

    def last(self, pin):
        """Letzter gesetzter Pegel eines Pins (None = nie gesetzt)."""
        for p, value in reversed(self.outputs):
            if p == pin:
                return value
        return None

    def values(self, pin):
        return [value for p, value in self.outputs if p == pin]


gpio = FakeGPIO()
_rpi = types.ModuleType("RPi")
_rpi.GPIO = gpio
sys.modules["RPi"] = _rpi
sys.modules["RPi.GPIO"] = gpio


# ─── requests ────────────────────────────────────────────────────────────────

class FakeRequestException(Exception):
    pass


class FakeConnectionError(FakeRequestException):
    pass


class FakeTimeout(FakeRequestException):
    pass


class FakeConnectTimeout(FakeConnectionError, FakeTimeout):
    """Wie in requests: ConnectTimeout ist ConnectionError UND Timeout."""


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = {} if payload is None else payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeSession:
    """
    Zeichnet POSTs auf. `post_results` wird der Reihe nach abgearbeitet:
    eine Exception wird geworfen, eine FakeResponse zurückgegeben.
    """

    def __init__(self):
        self.headers = {}
        self.posts = []
        self.post_results = []

    def post(self, url, json=None, timeout=None, **kwargs):
        self.posts.append({"url": url, "json": json, "timeout": timeout})
        if not self.post_results:
            return FakeResponse(200, {})
        result = self.post_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    def get(self, url, **kwargs):
        return FakeResponse(200, {})


_requests = types.ModuleType("requests")
_requests.Session = FakeSession
_requests.RequestException = FakeRequestException
_requests.ConnectionError = FakeConnectionError
_requests.Timeout = FakeTimeout
_requests.ConnectTimeout = FakeConnectTimeout
sys.modules["requests"] = _requests

# evdev: Import schlägt fehl → scanner.py läuft im stdin-Fallback (HAS_EVDEV = False)
sys.modules["evdev"] = None


# ─── emp_scanner importieren (erst jetzt!) ───────────────────────────────────

from emp_scanner import config as config_mod  # noqa: E402
from emp_scanner import relay as relay_mod  # noqa: E402
from emp_scanner import api_client as api_mod  # noqa: E402
from emp_scanner import updater as updater_mod  # noqa: E402
from emp_scanner import main as main_mod  # noqa: E402
from emp_scanner import repo_access as repo_access_mod  # noqa: E402

# Deploy-Key und Status nie nach /etc schreiben: alle Tests nutzen ein eigenes
# Verzeichnis (der Updater ruft repo_access bei jedem Lauf auf).
_REPO_ACCESS_DIR = tempfile.mkdtemp(prefix="emp-repo-access-")
repo_access_mod.KEY_DIR = _REPO_ACCESS_DIR
repo_access_mod.KEY_PATH = os.path.join(_REPO_ACCESS_DIR, "github_deploy_ed25519")
repo_access_mod.KNOWN_HOSTS_PATH = os.path.join(_REPO_ACCESS_DIR, "github_known_hosts")
repo_access_mod.STATUS_PATH = os.path.join(_REPO_ACCESS_DIR, "repo_access.json")

assert relay_mod.HAS_GPIO, "GPIO-Stub wurde nicht geladen"

# main.py richtet beim Import logging.basicConfig ein – Testausgabe ruhig halten.
logging.getLogger().handlers[:] = [logging.NullHandler()]

VALID_QR = json.dumps({"url": "https://emp.example.com/", "token": "tok-123", "id": 42})
OTHER_QR = json.dumps({"url": "https://evil.example.org", "token": "attacker", "id": 7})

RELAY_PIN = 24
LED_GREEN = 27
LED_RED = 22
BUZZER_PIN = 23


def wait_for(predicate, timeout=2.0):
    """Wartet, bis predicate() wahr ist (für Timer-Threads)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


def fake_time(sleep=None, monotonic=None):
    """
    Ersatz für das `time`-Modul EINES emp_scanner-Moduls
    (mock.patch.object(modul, "time", fake_time(...))). So bleibt time.sleep für
    alle anderen Threads (Buzzer, Timer) echt.
    """
    return types.SimpleNamespace(
        sleep=sleep if sleep is not None else (lambda _seconds: None),
        monotonic=monotonic if monotonic is not None else time.monotonic,
        time=time.time,
    )


class ScannerTestCase(unittest.TestCase):
    """Basis: jede Testmethode bekommt eine eigene, temporäre config.json."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmpdir = self._tmp.name
        self.config_path = os.path.join(self.tmpdir, "config.json")
        patcher = mock.patch.object(config_mod, "CONFIG_PATH", self.config_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        gpio.reset()

    def write_config(self, **values):
        with open(self.config_path, "w") as f:
            json.dump(values, f)

    def write_configured(self, **extra):
        values = {"server_url": "https://emp.example.com", "api_token": "tok-123", "device_id": 42}
        values.update(extra)
        self.write_config(**values)

    def make_relay(self, duration=0.05):
        relay = relay_mod.RelayController(
            relay_pin=RELAY_PIN, led_green=LED_GREEN, led_red=LED_RED,
            buzzer_pin=BUZZER_PIN, duration=duration,
        )
        self.addCleanup(relay.cleanup)
        gpio.reset()
        return relay
