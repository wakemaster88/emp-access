"""Relais: Öffnen/Schließen, NOT-AUF darf von keinem Timer aufgehoben werden."""

import time
import unittest
from unittest import mock

import support
from support import LED_GREEN, LED_RED, RELAY_PIN, ScannerTestCase, gpio, wait_for

DURATION = 0.05
# deutlich länger als DURATION – jeder (fälschlich) gestartete Schließ-Timer wäre abgelaufen
SETTLE = 0.3


class RelayNormalTest(ScannerTestCase):
    def test_grant_opens_and_closes_after_duration(self):
        relay = self.make_relay(DURATION)

        relay.grant()

        self.assertEqual(gpio.last(RELAY_PIN), gpio.HIGH)
        self.assertEqual(gpio.last(LED_GREEN), gpio.HIGH)
        self.assertTrue(wait_for(lambda: gpio.last(RELAY_PIN) == gpio.LOW))
        self.assertEqual(gpio.last(LED_GREEN), gpio.LOW)

    def test_deny_never_touches_relay(self):
        relay = self.make_relay(DURATION)

        relay.deny()

        self.assertEqual(gpio.values(RELAY_PIN), [])
        self.assertEqual(gpio.last(LED_RED), gpio.HIGH)
        self.assertEqual(gpio.last(LED_GREEN), gpio.LOW)

    def test_offline_never_touches_relay_and_never_shows_green(self):
        relay = self.make_relay(DURATION)

        relay.offline()

        self.assertEqual(gpio.values(RELAY_PIN), [])
        self.assertEqual(gpio.last(LED_RED), gpio.HIGH)
        self.assertNotIn(gpio.HIGH, gpio.values(LED_GREEN))

    def test_offline_sound_differs_from_deny_and_grant(self):
        relay = self.make_relay(DURATION)
        patterns = {}
        for name in ("grant", "deny", "offline"):
            with mock.patch.object(relay, "_buzzer_pattern") as buzzer:
                getattr(relay, name)()
            buzzer.assert_called_once()
            patterns[name] = buzzer.call_args[0][0]
        relay.close()

        self.assertNotEqual(patterns["offline"], patterns["deny"])
        self.assertNotEqual(patterns["offline"], patterns["grant"])


class RelayEmergencyTest(ScannerTestCase):
    def assert_relay_stays_open(self):
        time.sleep(SETTLE)
        self.assertEqual(gpio.last(RELAY_PIN), gpio.HIGH)
        self.assertNotIn(gpio.LOW, gpio.values(RELAY_PIN))

    def test_emergency_open_holds_relay(self):
        relay = self.make_relay(DURATION)

        relay.emergency_open()

        self.assertIsNone(relay._timer)
        self.assert_relay_stays_open()

    def test_grant_during_emergency_schedules_no_close(self):
        relay = self.make_relay(DURATION)
        relay.emergency_open()

        relay.grant()

        self.assertIsNone(relay._timer)
        self.assert_relay_stays_open()

    def test_deny_and_offline_during_emergency_change_nothing(self):
        relay = self.make_relay(DURATION)
        relay.emergency_open()
        before = list(gpio.outputs)

        relay.deny()
        relay.offline()

        self.assertIsNone(relay._timer)
        time.sleep(SETTLE)
        self.assertEqual(gpio.outputs, before)

    def test_running_grant_timer_cannot_close_emergency(self):
        relay = self.make_relay(DURATION)
        relay.grant()  # Timer läuft

        relay.emergency_open()

        self.assert_relay_stays_open()

    def test_orphaned_grant_timer_cannot_close_emergency(self):
        # grant() → deny() überschreibt self._timer; der grant-Timer läuft unbemerkt
        # weiter und darf das Relais nach emergency_open() trotzdem nicht schließen.
        relay = self.make_relay(DURATION)
        relay.grant()
        relay.deny()

        relay.emergency_open()

        self.assert_relay_stays_open()

    def test_close_ends_emergency(self):
        relay = self.make_relay(DURATION)
        relay.emergency_open()

        relay.close()

        self.assertEqual(gpio.last(RELAY_PIN), gpio.LOW)
        # danach arbeitet grant() wieder normal: öffnen und nach Ablauf schließen
        gpio.reset()
        relay.grant()
        self.assertEqual(gpio.last(RELAY_PIN), gpio.HIGH)
        self.assertTrue(wait_for(lambda: gpio.last(RELAY_PIN) == gpio.LOW))

    def test_end_emergency_keeps_pins_but_reenables_grant(self):
        relay = self.make_relay(DURATION)
        relay.emergency_open()
        gpio.reset()

        relay.end_emergency()
        self.assertEqual(gpio.outputs, [])

        relay.grant()
        self.assertTrue(wait_for(lambda: gpio.last(RELAY_PIN) == gpio.LOW))


if __name__ == "__main__":
    unittest.main()
