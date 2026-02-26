"""
GPIO relay and PWM buzzer control.
GPIO errors are non-fatal – the scanner keeps running without hardware feedback.

Pin assignments (BCM):
  Relais:   GPIO 24
  Buzzer:   GPIO 23 (PWM)
  LED grün: GPIO 27
  LED rot:  GPIO 22

Buzzer patterns (from pi-alt):
  startup:  500 → 1000 → 1500 Hz (0.3s each)
  scan:     500 → 1500 Hz         (0.2s each)
  valid:    1000 → 1500 → 2000 Hz (0.2s each)
  invalid:  2000 → 1500 → 1000 Hz (0.2s each)
"""

import threading
import logging
import time

logger = logging.getLogger("emp.relay")

# Try to import GPIO – fail gracefully on non-Pi or unsupported hardware
GPIO = None
HAS_GPIO = False

try:
    import RPi.GPIO as _GPIO
    _GPIO.setmode(_GPIO.BCM)
    _GPIO.setwarnings(False)
    GPIO = _GPIO
    HAS_GPIO = True
    logger.info("RPi.GPIO geladen")
except Exception as e:
    logger.warning("RPi.GPIO nicht verfügbar (%s) – GPIO-Simulation aktiv", e)


class RelayController:
    def __init__(self, relay_pin: int, led_green: int, led_red: int,
                 buzzer_pin: int, duration: float = 1.0):
        self.relay_pin = relay_pin
        self.led_green = led_green
        self.led_red = led_red
        self.buzzer_pin = buzzer_pin
        self.duration = duration
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._gpio_ok = False

        if HAS_GPIO and GPIO is not None:
            try:
                GPIO.setup(relay_pin, GPIO.OUT, initial=GPIO.LOW)
                GPIO.setup(led_green, GPIO.OUT, initial=GPIO.LOW)
                GPIO.setup(led_red, GPIO.OUT, initial=GPIO.LOW)
                GPIO.setup(buzzer_pin, GPIO.OUT, initial=GPIO.LOW)
                self._gpio_ok = True
                logger.info(
                    "GPIO initialisiert (Relay=%d, Green=%d, Red=%d, Buzzer=%d)",
                    relay_pin, led_green, led_red, buzzer_pin,
                )
            except Exception as e:
                logger.error(
                    "GPIO-Setup fehlgeschlagen: %s – Scanner läuft ohne Relais/LED/Buzzer", e
                )

    # ─── Public actions ───────────────────────────────────────────────────────

    def startup_sound(self):
        """500 → 1000 → 1500 Hz"""
        self._buzzer_pattern([(500, 0.3), (1000, 0.3), (1500, 0.3)])

    def grant(self):
        """Open relay + valid sound + green LED."""
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
        """Red LED + invalid sound, no relay."""
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
        """Short scan acknowledgement: 500 → 1500 Hz"""
        self._buzzer_pattern([(500, 0.2), (1500, 0.2)])

    def emergency_open(self):
        """Permanent open – NOT-AUF."""
        with self._lock:
            self._cancel_timer()
            self._set(self.relay_pin, True)
            self._set(self.led_green, True)
            self._set(self.led_red, True)
            logger.warning("NOT-AUF – Relais dauerhaft geöffnet")

    def close(self):
        with self._lock:
            self._cancel_timer()
            self._close_relay()

    # ─── PWM buzzer ───────────────────────────────────────────────────────────

    def _buzzer_pattern(self, steps: list[tuple[int, float]]):
        if not self._gpio_ok or GPIO is None:
            return
        def _play():
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
        if self._gpio_ok and GPIO is not None:
            try:
                GPIO.output(pin, GPIO.HIGH if state else GPIO.LOW)
            except Exception as e:
                logger.debug("GPIO output Fehler (Pin %d): %s", pin, e)

    def cleanup(self):
        self._cancel_timer()
        if self._gpio_ok and GPIO is not None:
            try:
                GPIO.cleanup()
                logger.info("GPIO aufgeräumt")
            except Exception:
                pass
