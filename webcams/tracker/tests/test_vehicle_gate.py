"""Tor-Automatik: Zählen immer, Öffnen nur bei ausdrücklicher Angabe."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vehicle_gate import (  # noqa: E402
    gate_mode,
    gate_mode_line,
    legacy_doorbird_ignored,
    opens_doorbird,
    should_open,
)

ZONE = [[0.55, 0.5], [0.82, 0.44], [0.94, 0.52], [0.9, 0.74]]


class ShouldOpenTest(unittest.TestCase):
    def test_voreinstellung_oeffnet_nicht(self):
        self.assertFalse(should_open({"enabled": True, "zone": ZONE}))
        self.assertFalse(should_open({"enabled": True, "zone": ZONE, "openDoorbird": False, "deviceIds": []}))
        self.assertFalse(should_open(None))
        self.assertFalse(should_open({}))

    def test_doorbird_nur_vom_kiosk_schalter(self):
        self.assertTrue(should_open({"enabled": True, "zone": ZONE, "openDoorbirdConfirmed": True}))
        self.assertTrue(should_open({"openDoorbird": True, "openDoorbirdConfirmed": True}))
        self.assertTrue(opens_doorbird({"openDoorbirdConfirmed": True}))

    def test_alte_einstellung_openDoorbird_oeffnet_nicht(self):
        # Frühere Voreinstellungen schrieben openDoorbird: true, ohne dass jemand es wählte.
        self.assertFalse(should_open({"enabled": True, "zone": ZONE, "openDoorbird": True}))
        self.assertFalse(should_open({"openDoorbird": True, "openDoorbirdConfirmed": False}))
        self.assertFalse(opens_doorbird({"openDoorbird": True}))
        self.assertTrue(legacy_doorbird_ignored({"openDoorbird": True}))
        self.assertFalse(legacy_doorbird_ignored({"openDoorbird": True, "openDoorbirdConfirmed": True}))
        self.assertFalse(legacy_doorbird_ignored({"openDoorbird": False}))

    def test_nur_wahr_zaehlt_als_ausdruecklich(self):
        for value in ("true", 1, "1", "ja", None):
            self.assertFalse(should_open({"openDoorbirdConfirmed": value}), value)
            self.assertFalse(should_open({"openDoorbirdConfirmed": value, "openDoorbird": True}), value)

    def test_geraete(self):
        self.assertTrue(should_open({"openDoorbird": False, "deviceIds": [7]}))
        self.assertTrue(should_open({"deviceIds": [3, 4]}))
        # Ausdrücklich gewählte Geräte öffnen auch neben einer alten openDoorbird-Einstellung.
        self.assertTrue(should_open({"openDoorbird": True, "deviceIds": [7]}))
        # Unbrauchbare Einträge zählen nicht als Gerät.
        self.assertFalse(should_open({"deviceIds": [0, -1, True, "5", 2.5]}))
        self.assertFalse(should_open({"deviceIds": "7"}))
        # 7.0 ist dieselbe Nummer (so liest sie auch die Kiosk-App).
        self.assertTrue(should_open({"deviceIds": [7.0]}))


class GateModeTest(unittest.TestCase):
    def test_zaehlt_nur(self):
        self.assertEqual(
            gate_mode({"enabled": True}),
            {
                "opens": False,
                "doorbird": False,
                "deviceIds": [],
                "legacyDoorbirdIgnored": False,
                "reason": "DoorBird öffnen aus, keine Geräte",
            },
        )
        self.assertEqual(gate_mode(None)["opens"], False)

    def test_alte_einstellung(self):
        mode = gate_mode({"openDoorbird": True})
        self.assertEqual([mode["opens"], mode["doorbird"], mode["legacyDoorbirdIgnored"]], [False, False, True])
        self.assertEqual(mode["reason"], "alte Einstellung openDoorbird ignoriert, im Kiosk ‚DoorBird öffnen‘ einschalten")

    def test_oeffnet(self):
        mode = gate_mode({"openDoorbirdConfirmed": True, "deviceIds": [3]})
        self.assertEqual([mode["opens"], mode["doorbird"], mode["deviceIds"]], [True, True, [3]])
        self.assertEqual(mode["reason"], "DoorBird (im Kiosk eingeschaltet) und Geräte 3")


class GateModeLineTest(unittest.TestCase):
    def test_zaehlt_nur(self):
        self.assertEqual(
            gate_mode_line("cam-halle-2", {"enabled": True}),
            "vehicle-gate[cam-halle-2] zählt nur, öffnet nicht (DoorBird öffnen aus, keine Geräte)",
        )
        self.assertEqual(
            gate_mode_line("cam-halle-2", {"enabled": True, "openDoorbird": False}),
            "vehicle-gate[cam-halle-2] zählt nur, öffnet nicht (DoorBird öffnen aus, keine Geräte)",
        )

    def test_alte_einstellung_mit_hinweis(self):
        self.assertEqual(
            gate_mode_line("cam-halle-2", {"enabled": True, "openDoorbird": True}),
            "vehicle-gate[cam-halle-2] zählt nur; alte Einstellung openDoorbird ignoriert, "
            "im Kiosk ‚DoorBird öffnen‘ einschalten",
        )
        self.assertEqual(
            gate_mode_line("cam-halle-2", {"openDoorbird": True, "deviceIds": [3]}),
            "vehicle-gate[cam-halle-2] zählt und öffnet bei Fahrzeug in der Fläche: Geräte 3; "
            "alte Einstellung openDoorbird ignoriert, im Kiosk ‚DoorBird öffnen‘ einschalten",
        )

    def test_oeffnet(self):
        self.assertEqual(
            gate_mode_line("cam-halle-2", {"openDoorbirdConfirmed": True, "deviceIds": [3]}),
            "vehicle-gate[cam-halle-2] zählt und öffnet bei Fahrzeug in der Fläche: "
            "DoorBird (im Kiosk eingeschaltet) und Geräte 3",
        )
        self.assertEqual(
            gate_mode_line("cam-halle-2", {"deviceIds": [3, 4]}),
            "vehicle-gate[cam-halle-2] zählt und öffnet bei Fahrzeug in der Fläche: Geräte 3, 4",
        )


if __name__ == "__main__":
    unittest.main()
