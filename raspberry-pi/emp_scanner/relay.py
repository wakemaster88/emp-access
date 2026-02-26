"""
GPIO relay and PWM buzzer control.
Pin assignments and buzzer frequencies match the original pi-alt system.

Original pin mapping:
  - Relais:  GPIO 24 (BCM)
  - Buzzer:  GPIO 23 (BCM) – PWM-driven piezo speaker
  - LED grün: GPIO 27 (BCM)
  - LED rot:  GPIO 22 (BCM)

Buzzer tone patterns (from pi-alt/python_files):
  - startup:  500 → 1000 → 1500 Hz  (aufsteigend, je 0.3s)
  - scan:     500 → 1500 Hz          (kurz, je 0.2s)
  - valid:    1000 → 1500 → 2000 Hz  (aufsteigend, je 0.2s)
  - invalid:  2000 → 1500 → 1000 Hz  (absteigend, je 0.2s)
"""

import threading
import logging
import time

logger = logging.getLogger("emp.relay")

try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    HAS_GPIO = True
except (ImportError, RuntimeError):
    HAS_GPIO = False
    logger.warning("RPi.GPIO nicht verfügbar – GPIO-Simulation aktiv")


class RelayController:
    def __init__(self, relay_pin: int, led_green: int, led_red: int, buzzer_pin: int, duration: float = 1.0):
        self.relay_pin = relay_pin
        self.led_green = led_green
        self.led_red = led_red
        self.buzzer_pin = buzzer_pin
        self.duration = duration
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._pwm = None

        if HAS_GPIO:
            GPIO.setup(relay_pin, GPIO.OUT, initial=GPIO.LOW)
            GPIO.setup(led_green, GPIO.OUT, initial=GPIO.LOW)
            GPIO.setup(led_red, GPIO.OUT, initial=GPIO.LOW)
            GPIO.setup(buzzer_pin, GPIO.OUT, initial=GPIO.LOW)
            logger.info(
                "GPIO initialisiert (Relay=%d, Green=%d, Red=%d, Buzzer=%d)",
                relay_pin, led_green, led_red, buzzer_pin,
            )

    # ─── Public actions ───────────────────────────────────────────────────────

    def startup_sound(self):
        """Play startup melody: 500 → 1000 → 1500 Hz"""
        self._buzzer_pattern([(500, 0.3), (1000, 0.3), (1500, 0.3)])

    def grant(self):
        """Open relay + valid sound (1000 → 1500 → 2000 Hz) + green LED."""
        with self._lock:
            self._cancel_timer()
            self._set(self.relay_pin, True)
            self._set(self.led_green, True)
            self._set(self.led_red, False)
            logger.info("GRANTED – Relais geöffnet für %.1fs", self.duration)

        self._buzzer_pattern([(1000, 0.2), (1500, 0.2), (2000, 0.2)])

        with self._lock:
            self._timer = threading.Timer(self.duration, self._close_relay)
            self._timer.daemon = True
            self._timer.start()

    def deny(self):
        """Deny sound (2000 → 1500 → 1000 Hz) + red LED, no relay."""
        with self._lock:
            self._set(self.led_red, True)
            self._set(self.led_green, False)
            logger.info("DENIED – Relais bleibt geschlossen")

        self._buzzer_pattern([(2000, 0.2), (1500, 0.2), (1000, 0.2)])

        with self._lock:
            self._timer = threading.Timer(1.5, self._reset_leds)
            self._timer.daemon = True
            self._timer.start()

    def scan_beep(self):
        """Short scan acknowledgement beep: 500 → 1500 Hz"""
        self._buzzer_pattern([(500, 0.2), (1500, 0.2)])

    def emergency_open(self):
        """Permanent open – emergency mode (NOT-AUF)."""
        with self._lock:
            self._cancel_timer()
            self._set(self.relay_pin, True)
            self._set(self.led_green, True)
            self._set(self.led_red, True)
            logger.warning("NOT-AUF – Relais dauerhaft geöffnet")

    def close(self):
        """Close relay and reset LEDs."""
        with self._lock:
            self._cancel_timer()
            self._close_relay()

    # ─── PWM Buzzer ───────────────────────────────────────────────────────────

    def _buzzer_pattern(self, steps: list[tuple[int, float]]):
        """
        Play a sequence of (frequency_hz, duration_sec) on the buzzer.
        Runs in a background thread to not block the caller.
        """
        def _play():
            if not HAS_GPIO:
                return
            try:
                pwm = GPIO.PWM(self.buzzer_pin, steps[0][0])
                pwm.start(50)
                time.sleep(steps[0][1])
                for freq, dur in steps[1:]:
                    pwm.ChangeFrequency(freq)
                    time.sleep(dur)
                pwm.stop()
            except Exception as e:
                logger.debug("Buzzer-Fehler: %s", e)

        threading.Thread(target=_play, daemon=True).start()

    # ─── Internal ─────────────────────────────────────────────────────────────

    def _close_relay(self):
        self._set(self.relay_pin, False)
        self._reset_leds()

    def _reset_leds(self):
        self._set(self.led_green, False)
        self._set(self.led_red, False)

    def _cancel_timer(self):
        if self._timer and self._timer.is_alive():
            self._timer.cancel()
        self._timer = None

    def _set(self, pin: int, state: bool):
        if HAS_GPIO:
            GPIO.output(pin, GPIO.HIGH if state else GPIO.LOW)

    def cleanup(self):
        self._cancel_timer()
        if HAS_GPIO:
            GPIO.cleanup()
            logger.info("GPIO aufgeräumt")
