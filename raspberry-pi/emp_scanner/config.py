"""
Configuration management.
Reads/writes config.json and supports initial setup via QR code.
"""

import json
import os
import logging

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
    "heartbeat_interval": 30,
    "task_poll_interval": 3,
    "update_check_interval": 300,
    "scanner_device": "auto",
}


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
            except Exception as e:
                logger.error("Fehler beim Laden der Konfiguration: %s", e)

    def save(self):
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump(self._data, f, indent=2)
            logger.info("Konfiguration gespeichert")
        except Exception as e:
            logger.error("Fehler beim Speichern: %s", e)

    @property
    def is_configured(self) -> bool:
        return bool(self._data["server_url"] and self._data["api_token"] and self._data["device_id"])

    def apply_qr_config(self, qr_data: str) -> bool:
        """
        Parse a QR config JSON: {"url": "...", "token": "...", "id": 123}
        Returns True if successfully applied.
        """
        try:
            data = json.loads(qr_data)
            if "url" in data and "token" in data and "id" in data:
                self._data["server_url"] = data["url"].rstrip("/")
                self._data["api_token"] = str(data["token"])
                self._data["device_id"] = int(data["id"])
                self.save()
                logger.info(
                    "QR-Konfiguration angewendet: Server=%s, Device=%d",
                    self._data["server_url"],
                    self._data["device_id"],
                )
                return True
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.debug("Kein gültiger Konfigurations-QR: %s", e)
        return False

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
