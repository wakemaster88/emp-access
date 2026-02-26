"""
USB HID scanner input handler.
Ein USB-Scanner liest sowohl QR-Codes als auch RFID-Karten (HID-Modus).
Scanner emulieren Tastatureingaben und senden Enter nach jedem Code.
Fallback auf stdin für Entwicklung/Test ohne Hardware.
"""

import logging
import threading
import time
from typing import Callable, Optional

logger = logging.getLogger("emp.scanner")

try:
    import evdev
    from evdev import InputDevice, categorize, ecodes
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False

# HID keycode → character mapping
KEY_MAP = {
    2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8", 10: "9", 11: "0",
    12: "-", 13: "=", 16: "q", 17: "w", 18: "e", 19: "r", 20: "t", 21: "y", 22: "u",
    23: "i", 24: "o", 25: "p", 26: "[", 27: "]", 30: "a", 31: "s", 32: "d", 33: "f",
    34: "g", 35: "h", 36: "j", 37: "k", 38: "l", 39: ";", 40: "'", 44: "z", 45: "x",
    46: "c", 47: "v", 48: "b", 49: "n", 50: "m", 51: ",", 52: ".", 53: "/",
}
KEY_MAP_SHIFT = {
    2: "!", 3: "@", 4: "#", 5: "$", 6: "%", 7: "^", 8: "&", 9: "*", 10: "(", 11: ")",
    12: "_", 13: "+",
}


def find_scanner_device() -> Optional[str]:
    """Auto-detect USB HID scanner (QR + RFID combo device)."""
    if not HAS_EVDEV:
        return None

    for path in evdev.list_devices():
        try:
            dev = InputDevice(path)
            caps = dev.capabilities(verbose=False)
            if ecodes.EV_KEY not in caps:
                continue
            name_lower = dev.name.lower()
            scanner_keywords = ["barcode", "scanner", "reader", "rfid", "hid",
                                "symbol", "honeywell", "datalogic", "netum", "inateck"]
            if any(kw in name_lower for kw in scanner_keywords):
                logger.info("Scanner gefunden: %s (%s)", dev.name, path)
                return path
            # USB-HID-Geräte mit wenigen Keys = wahrscheinlich Scanner
            key_caps = caps.get(ecodes.EV_KEY, [])
            if len(key_caps) < 100 and dev.info.bustype == 3:
                logger.info("USB-HID als Scanner erkannt: %s (%s)", dev.name, path)
                return path
        except Exception:
            continue
    return None


class ScannerInput:
    """
    Liest QR-Codes und RFID-Karten von einem USB-HID-Scanner.
    Ruft on_scan(code) für jeden vollständigen Scan auf.
    """

    def __init__(self, on_scan: Callable[[str], None], device_path: str = "auto"):
        self.on_scan = on_scan
        self.device_path = device_path
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        self._running = True

        if HAS_EVDEV and self.device_path != "stdin":
            path = self.device_path if self.device_path != "auto" else find_scanner_device()
            if path:
                self._thread = threading.Thread(target=self._evdev_loop, args=(path,), daemon=True)
                self._thread.start()
                return
            logger.warning("Kein USB-Scanner gefunden – verwende stdin")

        self._thread = threading.Thread(target=self._stdin_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _evdev_loop(self, path: str):
        """Read from USB HID device with auto-reconnect on disconnect."""
        while self._running:
            try:
                dev = InputDevice(path)
                dev.grab()
                logger.info("Scanner verbunden: %s", dev.name)
                buffer = []
                shift = False

                for event in dev.read_loop():
                    if not self._running:
                        break
                    if event.type != ecodes.EV_KEY:
                        continue
                    key_event = categorize(event)

                    if key_event.keystate == 1:  # key down
                        code = key_event.scancode
                        if code in (42, 54):
                            shift = True
                            continue
                        if code == 28:  # Enter → Scan komplett
                            scanned = "".join(buffer).strip()
                            buffer.clear()
                            if scanned:
                                self.on_scan(scanned)
                            continue
                        char_map = KEY_MAP_SHIFT if shift else KEY_MAP
                        char = char_map.get(code)
                        if char:
                            buffer.append(char.upper() if shift else char)
                        shift = False
                    elif key_event.keystate == 0:
                        if key_event.scancode in (42, 54):
                            shift = False

            except OSError:
                logger.warning("Scanner getrennt – warte auf Wiederverbindung...")
                time.sleep(2)
            except Exception as e:
                logger.error("Scanner-Fehler: %s", e)
                time.sleep(1)

    def _stdin_loop(self):
        """Fallback: stdin für Entwicklung ohne Hardware."""
        logger.info("stdin-Modus: Codes eingeben + Enter")
        while self._running:
            try:
                code = input("> ").strip()
                if code:
                    self.on_scan(code)
            except EOFError:
                break
            except Exception:
                break
