"""
Configuration management for the audio player.

Liegt bewusst in einer eigenen Datei (`audio-config.json`), damit ein Pi
theoretisch Scanner und Abspieler gleichzeitig betreiben kann, ohne dass sich
die beiden Konfigurationen ins Gehege kommen.
"""

import json
import os
import logging

logger = logging.getLogger("emp.audio.config")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "audio-config.json")

DEFAULT = {
    "server_url": "",
    "api_token": "",
    "device_id": 0,
    # Job-Poll: bestimmt, wie schnell eine Durchsage startet. Unter 3 s bringt
    # kaum noch etwas, kostet aber spuerbar Function-Invocations.
    "job_poll_interval": 5,
    # Heartbeat meldet Ist-Zustand und Systeminfos; 60 s reichen, das Dashboard
    # wertet bis ~5 Minuten ohne Heartbeat als online.
    "heartbeat_interval": 60,
    "update_check_interval": 300,
    # Ausgabegeraet fuer mpv. Leer bedeutet "alsa/default" und damit das
    # Mischgeraet aus /etc/asound.conf, das install-audio.sh anlegt. Nur
    # aendern, wenn mpv bewusst woanders ausgeben soll (siehe
    # `mpv --audio-device=help`).
    "audio_device": "",
    # Snapcast-Server fuer synchrone Wiedergabe mehrerer Zonen. Leer = aus;
    # die Zone spielt dann eigenstaendig ab.
    "snapserver_host": "",
    # Soundkarte fuer den Snapclient (Name oder Index aus `snapclient -l`).
    # Eigenes Feld, weil snapclient eine andere Schreibweise als mpv nutzt.
    "snapclient_soundcard": "",
    # Obergrenze des lokalen Dateicaches in MB.
    "cache_max_mb": 2048,
    # Hebt leise Durchsagen vor der Wiedergabe auf einen einheitlichen Pegel an.
    # Nur abschalten, wenn die Ansagen bereits ausgesteuert geliefert werden –
    # ohne das gehen TTS-Ansagen gegen gemasterte Musik hörbar unter.
    "speech_normalize": True,
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
        return bool(
            self._data["server_url"] and self._data["api_token"] and self._data["device_id"]
        )

    def apply_setup_json(self, raw: str) -> bool:
        """
        Übernimmt eine Setup-Konfiguration im Format des Geräte-QR-Codes:
        {"url": "...", "token": "...", "id": 123}
        """
        try:
            data = json.loads(raw)
            if "url" in data and "token" in data and "id" in data:
                self._data["server_url"] = str(data["url"]).rstrip("/")
                self._data["api_token"] = str(data["token"])
                self._data["device_id"] = int(data["id"])
                self.save()
                logger.info(
                    "Konfiguration übernommen: Server=%s, Gerät=%d",
                    self._data["server_url"],
                    self._data["device_id"],
                )
                return True
            logger.error("Setup-JSON unvollständig – erwartet url, token und id")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.error("Ungültiges Setup-JSON: %s", e)
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
