"""
Server communication for the audio player.

GET  /api/devices/audio?id=<deviceId>  – Zonenkonfiguration + offene Jobs
POST /api/devices/audio                – Heartbeat und Job-Statusmeldungen

Auth läuft wie beim Scanner über das Account-API-Token.
"""
from __future__ import annotations

import logging
from typing import Optional

import requests

logger = logging.getLogger("emp.audio.api")

TIMEOUT = 10


class ApiClient:
    def __init__(self, server_url: str, api_token: str, device_id: int):
        self.server_url = server_url
        self.device_id = device_id
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        })

    def fetch_state(self) -> Optional[dict]:
        """
        Holt Zonenkonfiguration und offene Jobs. Der Server markiert die
        gelieferten Jobs sofort als SENT – sie werden also nur einmal
        ausgeliefert und müssen hier zuverlässig verarbeitet werden.
        Returns: {"zone": {...}, "jobs": [...]} oder None.
        """
        try:
            resp = self._session.get(
                f"{self.server_url}/api/devices/audio",
                params={"id": self.device_id},
                timeout=TIMEOUT,
            )
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                logger.warning("Keine Zone für Gerät #%d hinterlegt", self.device_id)
            else:
                logger.warning("Statusabruf fehlgeschlagen: HTTP %d", resp.status_code)
        except requests.ConnectionError:
            logger.warning("Server nicht erreichbar")
        except Exception as e:
            logger.warning("Statusabruf: %s", e)
        return None

    def send_heartbeat(
        self,
        is_playing: bool,
        current_title: Optional[str],
        volume: Optional[int],
        system_info: Optional[dict] = None,
        job_reports: Optional[list] = None,
    ) -> bool:
        """Meldet Ist-Zustand und – falls vorhanden – erledigte Jobs."""
        body: dict = {
            "deviceId": self.device_id,
            "isPlaying": is_playing,
            "currentTitle": current_title,
        }
        if volume is not None:
            body["volume"] = volume
        if system_info:
            body["systemInfo"] = system_info
        if job_reports:
            body["jobs"] = job_reports

        try:
            resp = self._session.post(
                f"{self.server_url}/api/devices/audio",
                json=body,
                timeout=TIMEOUT,
            )
            return resp.status_code == 200
        except requests.ConnectionError:
            logger.warning("Heartbeat: Server nicht erreichbar")
        except Exception as e:
            logger.warning("Heartbeat-Fehler: %s", e)
        return False

    def report_jobs(self, job_reports: list) -> bool:
        """
        Statusmeldung direkt nach dem Abspielen – sonst würde der Verlauf im
        Dashboard bis zum nächsten Heartbeat auf „läuft" stehen bleiben.
        """
        if not job_reports:
            return True
        try:
            resp = self._session.post(
                f"{self.server_url}/api/devices/audio",
                json={"deviceId": self.device_id, "jobs": job_reports},
                timeout=TIMEOUT,
            )
            return resp.status_code == 200
        except Exception as e:
            logger.warning("Job-Rückmeldung fehlgeschlagen: %s", e)
            return False

    def test_connection(self) -> bool:
        try:
            resp = self._session.get(
                f"{self.server_url}/api/devices/audio",
                params={"id": self.device_id},
                timeout=5,
            )
            return resp.status_code == 200
        except Exception:
            return False
