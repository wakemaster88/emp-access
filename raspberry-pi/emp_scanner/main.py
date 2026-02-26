"""
EMP Access – Raspberry Pi Scanner Main Loop

Workflow:
1. Load config (or wait for config QR)
2. Play startup sound
3. Start scanner input (USB HID / Camera / stdin)
4. On scan → beep → validate with server → relay + valid/invalid sound
5. Background: heartbeat + task polling every 30s
6. Background: auto-update check every 5 min
"""

import signal
import sys
import time
import logging
import threading

from emp_scanner import VERSION
from emp_scanner.config import Config
from emp_scanner.scanner import ScannerInput
from emp_scanner.relay import RelayController
from emp_scanner.api_client import ApiClient
from emp_scanner.updater import check_and_update, restart_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("emp.main")


class EmpScanner:
    def __init__(self):
        self.config = Config()
        self.relay: RelayController | None = None
        self.api: ApiClient | None = None
        self.scanner: ScannerInput | None = None
        self._running = False
        self._current_task = 0
        self._scan_lock = threading.Lock()

    def start(self):
        logger.info("═══════════════════════════════════════")
        logger.info("  EMP Access Scanner v%s", VERSION)
        logger.info("═══════════════════════════════════════")

        self._running = True
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)

        # Init relay/buzzer/LEDs
        self.relay = RelayController(
            relay_pin=self.config.relay_pin,
            led_green=self.config.led_green_pin,
            led_red=self.config.led_red_pin,
            buzzer_pin=self.config.buzzer_pin,
            duration=self.config.relay_duration,
        )

        # Startup sound
        self.relay.startup_sound()
        time.sleep(1)

        if not self.config.is_configured:
            logger.info("Keine Konfiguration – warte auf Konfigurations-QR-Code...")
            self._wait_for_config()

        if not self.config.is_configured:
            logger.error("Keine Konfiguration vorhanden – beende")
            sys.exit(1)

        # Init API client
        self.api = ApiClient(
            server_url=self.config.server_url,
            api_token=self.config.api_token,
            device_id=self.config.device_id,
        )

        logger.info("Server: %s", self.config.server_url)
        logger.info("Gerät:  #%d", self.config.device_id)

        # Test connection
        if self.api.test_connection():
            logger.info("Serververbindung OK")
        else:
            logger.warning("Server nicht erreichbar – starte trotzdem")

        # Start scanner input (USB HID – QR + RFID über ein Gerät)
        self.scanner = ScannerInput(
            on_scan=self._handle_scan,
            device_path=self.config.scanner_device,
        )
        self.scanner.start()
        logger.info("Scanner bereit – warte auf Scans...")

        # Background threads
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        threading.Thread(target=self._update_loop, daemon=True).start()

        # Main thread keeps running
        try:
            while self._running:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self._cleanup()

    def _handle_scan(self, code: str):
        """Called by scanner thread when a complete code is read."""
        # Prevent overlapping scan handling
        if not self._scan_lock.acquire(blocking=False):
            return
        try:
            self._process_scan(code)
        finally:
            self._scan_lock.release()

    def _process_scan(self, code: str):
        logger.info("Scan: %s", code[:40] + ("..." if len(code) > 40 else ""))

        # Scan acknowledgement beep
        if self.relay:
            self.relay.scan_beep()
            time.sleep(0.5)

        # Check for config QR (JSON with url/token/id)
        if code.startswith("{") and self.config.apply_qr_config(code):
            logger.info("Neue Konfiguration übernommen – Neustart...")
            self._cleanup()
            sys.exit(0)  # systemd will restart us

        if not self.api:
            logger.warning("Nicht konfiguriert – Scan ignoriert")
            return

        # Emergency open mode – all scans bypass validation
        if self._current_task == 2:
            logger.info("NOT-AUF aktiv – Zutritt ohne Prüfung")
            if self.relay:
                self.relay.grant()
            return

        # Device deactivated
        if self._current_task == 3:
            logger.info("Gerät gesperrt – Scan abgelehnt")
            if self.relay:
                self.relay.deny()
            return

        # Validate with server
        result = self.api.validate_scan(code)
        granted = result.get("granted", False)
        message = result.get("message", "")

        if granted:
            logger.info("✓ GRANTED: %s", message)
            ticket = result.get("ticket", {})
            if ticket.get("firstName") or ticket.get("lastName"):
                logger.info("  Ticket: %s %s", ticket.get("firstName", ""), ticket.get("lastName", ""))
            if self.relay:
                self.relay.grant()
        else:
            logger.info("✗ DENIED: %s", message)
            if self.relay:
                self.relay.deny()

    def _heartbeat_loop(self):
        """Periodically send heartbeat and check for task changes."""
        while self._running:
            try:
                if self.api:
                    device_config = self.api.send_heartbeat(task=self._current_task)
                    if device_config:
                        new_task = device_config.get("pis_task", 0)
                        if new_task != self._current_task:
                            logger.info("Task geändert: %d → %d", self._current_task, new_task)
                            self._apply_task(new_task)
                        if device_config.get("pis_active") == 0 and self._current_task != 3:
                            logger.warning("Gerät vom Server deaktiviert")
                            self._apply_task(3)
            except Exception as e:
                logger.warning("Heartbeat-Fehler: %s", e)

            for _ in range(int(self.config.heartbeat_interval)):
                if not self._running:
                    return
                time.sleep(1)

    def _apply_task(self, task: int):
        """Apply a task command from the server."""
        self._current_task = task
        if not self.relay:
            return

        if task == 1:
            logger.info("Task: Einmal öffnen")
            self.relay.grant()
            self._current_task = 0
        elif task == 2:
            logger.warning("Task: NOT-AUF")
            self.relay.emergency_open()
        elif task == 3:
            logger.warning("Task: Deaktiviert")
            self.relay.close()
        elif task == 0:
            logger.info("Task: Reset/Idle")
            self.relay.close()

    def _update_loop(self):
        """Periodically check for software updates."""
        time.sleep(60)
        while self._running:
            try:
                if check_and_update():
                    logger.info("Update installiert – starte neu...")
                    restart_service()
                    return
            except Exception as e:
                logger.warning("Update-Prüfung fehlgeschlagen: %s", e)

            for _ in range(int(self.config.update_check_interval)):
                if not self._running:
                    return
                time.sleep(1)

    def _wait_for_config(self):
        """Start scanner in setup mode – wait for config QR code."""
        setup_scanner = ScannerInput(
            on_scan=self._setup_scan,
            device_path=self.config.scanner_device,
        )
        setup_scanner.start()

        timeout = 120
        for _ in range(timeout):
            if self.config.is_configured or not self._running:
                break
            time.sleep(1)

        setup_scanner.stop()

    def _setup_scan(self, code: str):
        """Handle scans during setup mode."""
        self.config.apply_qr_config(code)

    def _shutdown(self, signum, frame):
        logger.info("Shutdown-Signal empfangen")
        self._running = False

    def _cleanup(self):
        logger.info("Aufräumen...")
        if self.scanner:
            self.scanner.stop()
        if self.relay:
            self.relay.cleanup()
        logger.info("Beendet")


def main():
    app = EmpScanner()
    app.start()


if __name__ == "__main__":
    main()
