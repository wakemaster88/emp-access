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

    def validate_scan(self, code: str) -> dict:
        """
        Send scanned code to server for validation.
        Returns: {"granted": bool, "message": str, "ticket"?: {...}}
        """
        try:
            resp = self._session.post(
                f"{self.server_url}/api/devices/pi/scan",
                json={"code": code, "deviceId": self.device_id},
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

    def send_heartbeat(self, task: int = 0) -> Optional[dict]:
        """
        Send heartbeat with system info. Returns device config from server or None.
        """
        try:
            sys_info = collect_system_info()

            self._session.post(
                f"{self.server_url}/api/devices/pi",
                json=[{
                    "pis_id": self.device_id,
                    "pis_task": task,
                    "pis_update": int(time.time()),
                    "system_info": sys_info,
                }],
                timeout=TIMEOUT_HEARTBEAT,
            )

            resp = self._session.get(
                f"{self.server_url}/api/devices/pi",
                params={"id": self.device_id},
                timeout=TIMEOUT_HEARTBEAT,
            )
            if resp.status_code == 200:
                return resp.json()
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
            return resp.status_code == 200
        except Exception:
            return False
