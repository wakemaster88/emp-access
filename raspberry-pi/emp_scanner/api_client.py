"""
Server communication – scan validation, heartbeat, config sync.
All requests use the account API token for authentication.
"""

import time
import logging
import requests
from typing import Optional

from emp_scanner.sysinfo import collect_system_info

logger = logging.getLogger("emp.api")

TIMEOUT_SCAN = 5
TIMEOUT_HEARTBEAT = 10


class ApiClient:
    def __init__(self, server_url: str, api_token: str, device_id: int):
        self.server_url = server_url
        self.api_token = api_token
        self.device_id = device_id
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        })
        # ETag/Last-State-Cache fuer GET /api/devices/pi. Reduziert Last
        # auf Vercel (Function-Invocations bleiben, sind aber 304 ohne
        # Body) und vor allem die DB-Hits durch den Token-Cache + 304-Pfad
        # serverseitig.
        self._state_etag: Optional[str] = None
        self._state_cache: Optional[dict] = None

    def validate_scan(self, code: str, direction: Optional[str] = None) -> dict:
        """
        Send scanned code to server for validation.
        Returns: {"granted": bool, "message": str, "ticket"?: {...}}
        """
        try:
            body: dict = {"code": code, "deviceId": self.device_id}
            if direction in ("IN", "OUT"):
                body["direction"] = direction
            resp = self._session.post(
                f"{self.server_url}/api/devices/pi/scan",
                json=body,
                timeout=TIMEOUT_SCAN,
            )
            if resp.status_code == 200:
                return resp.json()
            logger.error("Scan-Validierung fehlgeschlagen: HTTP %d", resp.status_code)
        except requests.ConnectionError:
            logger.error("Server nicht erreichbar")
        except requests.Timeout:
            logger.error("Scan-Timeout")
        except Exception as e:
            logger.error("Scan-Fehler: %s", e)

        return {"granted": False, "message": "Server nicht erreichbar", "offline": True}

    def report_dashboard_open(self) -> bool:
        """
        Meldet eine Dashboard-Öffnung (Relais per Button) als gültigen Scan am Server.
        Wird vom Pi aufgerufen, nachdem task=1 ausgeführt wurde.
        """
        try:
            resp = self._session.post(
                f"{self.server_url}/api/devices/pi/scan",
                json={"code": "__DASHBOARD_OPEN__", "deviceId": self.device_id},
                timeout=TIMEOUT_SCAN,
            )
            return resp.status_code == 200
        except Exception as e:
            logger.warning("Dashboard-Öffnung melden fehlgeschlagen: %s", e)
            return False

    def report_task_completed(self, task: int = 0) -> bool:
        """
        Meldet dem Server, dass der aktuelle Task ausgeführt wurde (z. B. task=0 nach Einmal öffnen).
        Verhindert, dass der Server task=1 weiter anzeigt und der Task-Poll mehrfach auslöst.
        Ergebnis aktualisiert auch den lokalen State-Cache, damit der naechste
        GET sofort wieder 304 zurueckgeben kann.
        """
        try:
            resp = self._session.post(
                f"{self.server_url}/api/devices/pi",
                json=[{
                    "pis_id": self.device_id,
                    "pis_task": task,
                    "pis_update": int(time.time()),
                }],
                timeout=TIMEOUT_HEARTBEAT,
            )
            if resp.status_code != 200:
                return False
            try:
                payload = resp.json()
                results = payload.get("results") or []
                if results and isinstance(results[0], dict) and "pis_task" in results[0]:
                    # State-Cache verwerfen, damit der naechste GET den frischen
                    # State holt (ETag stimmt nach Task-Reset sonst nicht mehr).
                    self._state_etag = None
                    self._state_cache = None
            except Exception:
                pass
            return True
        except Exception as e:
            logger.warning("Task-Bestätigung fehlgeschlagen: %s", e)
            return False

    def get_config(self) -> Optional[dict]:
        """
        Nur GET – Geräteconfig abrufen (z. B. für schnelles Task-Polling).
        Nutzt ETag/If-None-Match: bei 304 wird der zuletzt bekannte State
        unveraendert zurueckgegeben (kein DB-Hit serverseitig, kein Body).
        Returns device config or None.
        """
        try:
            headers = {}
            if self._state_etag:
                headers["If-None-Match"] = self._state_etag
            resp = self._session.get(
                f"{self.server_url}/api/devices/pi",
                params={"id": self.device_id},
                timeout=TIMEOUT_HEARTBEAT,
                headers=headers or None,
            )
            if resp.status_code == 304 and self._state_cache is not None:
                return self._state_cache
            if resp.status_code == 200:
                etag = resp.headers.get("ETag")
                try:
                    payload = resp.json()
                except Exception:
                    return None
                self._state_etag = etag
                self._state_cache = payload
                return payload
        except Exception as e:
            logger.debug("get_config: %s", e)
        return None

    def send_heartbeat(self, task: int = 0) -> Optional[dict]:
        """
        Send heartbeat with system info. Returns device config from server or None.
        Nutzt die POST-Antwort (enthält Pi-State) – nur ein Request statt POST+GET.
        Fallback: GET für ältere Server ohne State in results[].
        """
        try:
            sys_info = collect_system_info()

            resp = self._session.post(
                f"{self.server_url}/api/devices/pi",
                json=[{
                    "pis_id": self.device_id,
                    "pis_task": task,
                    "pis_update": int(time.time()),
                    "system_info": sys_info,
                }],
                timeout=TIMEOUT_HEARTBEAT,
            )
            if resp.status_code == 200:
                payload = resp.json()
                latest = payload.get("latest_scanner_version")
                results = payload.get("results") or []
                if results and isinstance(results[0], dict) and "pis_task" in results[0]:
                    cfg = dict(results[0])
                    if latest is not None:
                        cfg["latest_scanner_version"] = latest
                    # Heartbeat-Response liefert frischen State → State-Cache
                    # aktualisieren, ETag wird beim naechsten GET neu geholt.
                    self._state_etag = None
                    self._state_cache = cfg
                    return cfg

            resp = self._session.get(
                f"{self.server_url}/api/devices/pi",
                params={"id": self.device_id},
                timeout=TIMEOUT_HEARTBEAT,
            )
            if resp.status_code == 200:
                payload = resp.json()
                self._state_etag = resp.headers.get("ETag")
                self._state_cache = payload
                return payload
        except requests.ConnectionError:
            logger.warning("Heartbeat: Server nicht erreichbar")
        except Exception as e:
            logger.warning("Heartbeat-Fehler: %s", e)
        return None

    def test_connection(self) -> bool:
        """Quick connection test."""
        try:
            resp = self._session.get(
                f"{self.server_url}/api/devices/pi",
                params={"id": self.device_id},
                timeout=5,
            )
            # 200 = OK; 304 ist hier nicht zu erwarten (kein ETag mitgesendet),
            # aber wir akzeptieren beide als "Server erreichbar".
            return resp.status_code in (200, 304)
        except Exception:
            return False
