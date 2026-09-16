"""
Server communication for the audio player.

GET  /api/devices/audio?id=<deviceId>  – Zonenkonfiguration + offene Jobs
POST /api/devices/audio                – Heartbeat und Job-Statusmeldungen
GET  /api/devices/audio/live           – Ton einer Live-Durchsage

Auth läuft wie beim Scanner über das Account-API-Token.
"""
from __future__ import annotations

import logging
from typing import NamedTuple, Optional

import requests

logger = logging.getLogger("emp.audio.api")

TIMEOUT = 10


class LiveAudio(NamedTuple):
    """Antwort auf einen Live-Abruf."""

    state: str  # "LIVE" oder "ENDED" – ENDED erst, wenn alles ausgeliefert ist
    seq: int  # letztes geliefertes Stück, nächster `after`
    rate: int
    data: bytes  # rohes PCM, 16 Bit little-endian, mono


class ApiClient:
    def __init__(self, server_url: str, api_token: str, device_id: int):
        self.server_url = server_url
        self.device_id = device_id
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        })
        # Eigene Verbindung für Live-Ton: der fragt mehrmals pro Sekunde und soll
        # weder auf den Job-Poll warten noch ihn aufhalten.
        self._live_session = requests.Session()
        self._live_session.headers.update({"Authorization": f"Bearer {api_token}"})

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

    def fetch_live(self, session_id: int, after: Optional[int]) -> Optional[LiveAudio]:
        """
        Ton einer Live-Durchsage nach Stück `after`. Ohne `after` liefert der
        Server nur das neueste Stück – so steigt der Pi dort ein, wo gerade
        gesprochen wird. None bei Netz- oder Serverfehlern.
        """
        params = {"id": self.device_id, "session": session_id}
        if after is not None:
            params["after"] = after
        try:
            resp = self._live_session.get(
                f"{self.server_url}/api/devices/audio/live",
                params=params,
                timeout=TIMEOUT,
            )
        except Exception as e:
            logger.debug("Live-Abruf: %s", e)
            return None

        if resp.status_code == 404:
            # Sitzung gelöscht oder nicht für diese Zone – nichts mehr abzuspielen.
            return LiveAudio("ENDED", after or 0, 16000, b"")
        if resp.status_code != 200:
            logger.warning("Live-Abruf fehlgeschlagen: HTTP %d", resp.status_code)
            return None
        try:
            return LiveAudio(
                state=resp.headers.get("X-Live-State", "LIVE"),
                seq=int(resp.headers.get("X-Live-Seq", after or 0)),
                rate=int(resp.headers.get("X-Live-Rate", 16000)),
                data=resp.content,
            )
        except ValueError:
            logger.warning("Live-Abruf: unlesbare Antwort")
            return None

    def send_heartbeat(
        self,
        is_playing: bool,
        current_title: Optional[str],
        volume: Optional[int],
        system_info: Optional[dict] = None,
        job_reports: Optional[list] = None,
        external_source: Optional[dict] = None,
    ) -> bool:
        """Meldet Ist-Zustand und – falls vorhanden – erledigte Jobs."""
        body: dict = {
            "deviceId": self.device_id,
            "isPlaying": is_playing,
            "currentTitle": current_title,
            # Immer mitsenden, auch als null: der Server unterscheidet daran
            # "kein Sender mehr" von "ein älterer Abspieler meldet das nicht".
            "externalSource": external_source,
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
