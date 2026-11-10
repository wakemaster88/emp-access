"""
Configuration management.
Reads/writes config.json and supports initial setup via QR code.
"""

import json
import os
import logging
from urllib.parse import urlparse

logger = logging.getLogger("emp.config")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")

DEFAULT = {
    "server_url": "",
    "api_token": "",
    "device_id": 0,
    "relay_pin": 24,
    "relay_duration": 1.0,
    "led_green_pin": 27,
    "led_red_pin": 22,
    "buzzer_pin": 23,
    # Heartbeat (POST) schreibt jeden Tick lastUpdate/systemInfo in die DB.
    # 60 s reichen: das Dashboard betrachtet ein Geraet bis ~5 Minuten ohne
    # Heartbeat als online. Nicht unter 30 s ohne Not setzen.
    "heartbeat_interval": 60,
    # Task-Poll (GET, ETag/304) – beim Server kostet das ohne Statuswechsel
    # nichts. 10 s ist ein guter Kompromiss zwischen Reaktionszeit beim
    # Dashboard-Button und Function-Invocations. Nicht unter 5 s setzen.
    "task_poll_interval": 10,
    "update_check_interval": 300,
    "scanner_device": "auto",
    # Auto-Update nur auf GPG-signierte Commits (siehe README „Signierte Updates“).
    # Standard aus: ohne installierten Signaturschlüssel gäbe es sonst keine Updates mehr.
    "update_verify_signature": False,
}


def looks_like_config_qr(code: str) -> bool:
    """
    True, wenn ein gescannter Code wie ein Konfigurations-QR aussieht
    ({"url": ..., "token": ..., "id": ...}) – auch wenn er unvollständig gelesen wurde.
    Solche Codes enthalten ein API-Token und dürfen nie als Ticket zum Server gehen.
    """
    text = code.strip()
    return text.startswith("{") and '"url"' in text and '"token"' in text


class Config:
    def __init__(self):
        self._data = dict(DEFAULT)
        self.load()

    def load(self):
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r") as f:
                    stored = json.load(f)
                self._data.update(stored)
                logger.info("Konfiguration geladen: %s", CONFIG_PATH)
                self._restrict_permissions()
                self._migrate_polling_defaults(stored)
            except Exception as e:
                logger.error("Fehler beim Laden der Konfiguration: %s", e)

    def _migrate_polling_defaults(self, stored: dict) -> None:
        """
        Hebt die alten Polling-Defaults (heartbeat=30 s, task_poll=5 s) einmalig
        auf die neuen Defaults (60 s / 10 s) an. Nur wenn der Wert exakt dem
        alten Default entspricht – individuell gesetzte Werte werden NICHT
        ueberschrieben. Das spart Vercel-/DB-Last bei bestehenden Pis, ohne
        SSH-Eingriff.
        """
        migrated = False
        if stored.get("heartbeat_interval") == 30:
            self._data["heartbeat_interval"] = 60
            migrated = True
        if stored.get("task_poll_interval") == 5:
            self._data["task_poll_interval"] = 10
            migrated = True
        if migrated:
            logger.info(
                "Polling-Defaults migriert: heartbeat=%ss, task_poll=%ss",
                self._data["heartbeat_interval"],
                self._data["task_poll_interval"],
            )
            self.save()

    def save(self) -> bool:
        try:
            # config.json enthält das API-Token → nur für den Besitzer lesbar (0600).
            fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(self._data, f, indent=2)
            self._restrict_permissions()
            logger.info("Konfiguration gespeichert")
            return True
        except Exception as e:
            logger.error("Fehler beim Speichern: %s", e)
            return False

    def _restrict_permissions(self) -> None:
        """Bestehende config.json (früher 0644 angelegt) auf 0600 nachziehen."""
        try:
            os.chmod(CONFIG_PATH, 0o600)
        except OSError as e:
            logger.debug("chmod 0600 auf config.json fehlgeschlagen: %s", e)

    @property
    def is_configured(self) -> bool:
        return bool(self._data["server_url"] and self._data["api_token"] and self._data["device_id"])

    def apply_qr_config(self, qr_data: str) -> bool:
        """
        Parse a QR config JSON: {"url": "...", "token": "...", "id": 123}
        Returns True if successfully applied.

        Wird NUR angenommen, solange das Gerät noch nicht konfiguriert ist. Ein
        bereits konfigurierter Scanner lässt sich nicht per QR auf einen anderen
        Server umstellen – dafür ist ein bewusster Reset mit Shell-Zugang nötig
        (``python -m emp_scanner.main --reset-config``, siehe README).
        """
        if self.is_configured:
            if looks_like_config_qr(qr_data):
                logger.warning("Gerät ist bereits konfiguriert – Konfigurations-QR ignoriert")
            return False
        try:
            data = json.loads(qr_data)
        except ValueError as e:
            logger.debug("Kein gültiger Konfigurations-QR: %s", e)
            return False
        if not isinstance(data, dict) or not ("url" in data and "token" in data and "id" in data):
            return False

        url = data["url"]
        token = data["token"]
        device_id = data["id"]
        if not isinstance(url, str) or not isinstance(token, str) or not token.strip():
            logger.warning("Konfigurations-QR abgelehnt: url/token fehlen oder haben den falschen Typ")
            return False
        try:
            parsed = urlparse(url.strip())
        except ValueError:
            parsed = None
        if parsed is None or parsed.scheme not in ("http", "https") or not parsed.netloc:
            logger.warning("Konfigurations-QR abgelehnt: url ist keine http(s)-Adresse")
            return False
        # bool ist in Python ein int – ausdrücklich ausschließen.
        if isinstance(device_id, bool) or not isinstance(device_id, int) or device_id <= 0:
            logger.warning("Konfigurations-QR abgelehnt: id ist keine positive Ganzzahl")
            return False

        self._data["server_url"] = url.strip().rstrip("/")
        self._data["api_token"] = token.strip()
        self._data["device_id"] = device_id
        self.save()
        logger.info(
            "QR-Konfiguration angewendet: Server=%s, Device=%d",
            self._data["server_url"],
            self._data["device_id"],
        )
        return True

    def reset_server_config(self) -> bool:
        """
        Server-Zuordnung löschen (URL, Token, Geräte-ID); Pins und Intervalle bleiben.
        Danach wartet der Scanner wieder auf einen Konfigurations-QR.
        Returns True, wenn die geänderte config.json gespeichert werden konnte.
        """
        self._data["server_url"] = ""
        self._data["api_token"] = ""
        self._data["device_id"] = 0
        if not self.save():
            return False
        logger.warning("Server-Konfiguration zurückgesetzt – Gerät wartet auf neuen Konfigurations-QR")
        return True

    def __getattr__(self, name):
        if name.startswith("_"):
            return super().__getattribute__(name)
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(f"Config hat kein Feld '{name}'")

    def __setattr__(self, name, value):
        if name.startswith("_"):
            super().__setattr__(name, value)
        else:
            self._data[name] = value
