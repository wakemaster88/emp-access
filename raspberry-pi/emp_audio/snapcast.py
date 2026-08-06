"""
Synchrone Wiedergabe über Snapcast.

Für Außenbereiche, die sich akustisch überlappen: Dort darf zwischen zwei
Lautsprechern kein hörbarer Versatz entstehen. Snapcast löst das, indem alle
Zonen denselben Stream vom Snapserver beziehen und zeitsynchron ausgeben.

In diesem Modus kommt die Musik vom Snapserver – PLAY/STOP steuert dann nicht
den lokalen mpv, sondern nur, ob dieser Client dem Stream zuhört. Durchsagen
laufen weiterhin lokal über mpv; fürs Ducking wird die Snapclient-Lautstärke
über die JSON-RPC-Schnittstelle des Servers abgesenkt.
"""
from __future__ import annotations

import json
import logging
import socket
import subprocess
from typing import Optional

logger = logging.getLogger("emp.audio.snapcast")

CONTROL_PORT = 1705
CONTROL_TIMEOUT = 3


class SnapcastMusic:
    """Musikquelle über Snapcast – gleiche Schnittstelle wie MusicPlayer."""

    def __init__(self, host: str, client_id: str, soundcard: str = ""):
        self.host = host
        self.client_id = client_id
        # Snapclient erwartet einen Soundkarten-Namen oder -Index aus
        # `snapclient -l`, nicht die mpv-Schreibweise wie "alsa/hw:1,0".
        self.soundcard = soundcard
        self._process: Optional[subprocess.Popen] = None
        self._volume = 50
        self._duck_volume = 20
        self._ducked = False
        self._playing = False
        # Angehalten, weil ein externer Sender die Zone uebernommen hat.
        self._paused = False
        self._request_id = 0

    def start(self) -> bool:
        if self._process and self._process.poll() is None:
            return True

        cmd = ["snapclient", "-h", self.host, "--hostID", self.client_id]
        if self.soundcard:
            cmd += ["-s", self.soundcard]

        try:
            self._process = subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            logger.info("Snapclient verbunden mit %s", self.host)
            return True
        except FileNotFoundError:
            logger.error("snapclient ist nicht installiert – keine synchrone Wiedergabe")
            return False

    def _rpc(self, method: str, params: dict) -> Optional[dict]:
        self._request_id += 1
        request = {
            "id": self._request_id,
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
        try:
            with socket.create_connection((self.host, CONTROL_PORT), CONTROL_TIMEOUT) as conn:
                conn.settimeout(CONTROL_TIMEOUT)
                conn.sendall((json.dumps(request) + "\r\n").encode())
                buffer = b""
                while b"\n" not in buffer:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    buffer += chunk
                if buffer:
                    return json.loads(buffer.split(b"\n")[0])
        except Exception as e:
            logger.debug("Snapcast-RPC %s: %s", method, e)
        return None

    def _apply_volume(self, muted: bool = False) -> None:
        level = self._duck_volume if self._ducked else self._volume
        self._rpc(
            "Client.SetVolume",
            {"id": self.client_id, "volume": {"muted": muted, "percent": level}},
        )

    def set_volume(self, volume: int) -> None:
        self._volume = max(0, min(100, int(volume)))
        self._apply_volume()

    def duck(self, duck_volume: int) -> None:
        self._duck_volume = max(0, min(100, int(duck_volume)))
        self._ducked = True
        self._apply_volume()

    def unduck(self) -> None:
        self._ducked = False
        self._apply_volume()

    @property
    def volume(self) -> int:
        return self._volume

    def _set_muted(self, muted: bool) -> None:
        self._apply_volume(muted=muted)

    def play_files(self, paths: list[str], shuffle: bool = False) -> bool:
        """
        Die Titelauswahl trifft im Snapcast-Betrieb der Server. Der Client kann
        sich nur zuschalten – die Dateien liegen trotzdem im lokalen Cache, damit
        ein späterer Wechsel in den Standalone-Betrieb sofort funktioniert.
        """
        del paths, shuffle
        if not self.start():
            return False
        self._set_muted(False)
        self._playing = True
        logger.info("Snapcast-Wiedergabe aktiv")
        return True

    def play_stream(self, url: str) -> bool:
        del url
        if not self.start():
            return False
        self._set_muted(False)
        self._playing = True
        return True

    def stop(self) -> None:
        self._set_muted(True)
        self._playing = False
        self._paused = False
        logger.info("Snapcast-Wiedergabe stummgeschaltet")

    def pause(self) -> None:
        """Uebernahme durch einen externen Sender: Client stumm, aber verbunden."""
        if self._paused:
            return
        self._paused = True
        self._set_muted(True)

    def resume(self) -> None:
        if not self._paused:
            return
        self._paused = False
        if self._playing:
            self._set_muted(False)

    @property
    def is_playing(self) -> bool:
        return self._playing and not self._paused

    def current_title(self) -> Optional[str]:
        return None

    def cleanup(self) -> None:
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
