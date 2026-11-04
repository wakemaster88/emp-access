"""Mammotion-Sidecar fuer den EMP-Access-Hub.

Spricht ueber PyMammotion (inoffiziell, Community) mit der Mammotion-Cloud und
stellt dem Hub eine kleine HTTP-API auf 127.0.0.1 bereit:

    GET  /health            Lebenszeichen
    GET  /status            Login-Zustand und alle Maeher (Status, Akku, Aufgaben, Zonen)
    GET  /map?mower=NAME     GeoJSON der Karte (Zonen, Station, Maeher-Position)
    POST /action            {"mower", "action", "planId"?, "enabled"?}
    POST /whep/NAME/UID      WHEP fuer go2rtc: SDP-Angebot rein, Antwort aus dem Agora-Kanal raus
    DELETE /whep/session/ID  Kamera-Sitzung beenden (PATCH dort wird angenommen und ignoriert)

Wichtig fuer den Account: Mammotion sperrt Konten, die sich staendig neu mit
Passwort anmelden. Deshalb meldet sich der Dienst genau einmal an, speichert die
Sitzung (.cache/session.json, nur fuer den Benutzer lesbar) und stellt sie bei
jedem Neustart wieder her. Scheitert ein Login, wird nur selten und begrenzt
erneut versucht; ein abgelehntes Passwort wird nie wiederholt.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import functools
import hashlib
import json
import logging
import os
import re
import secrets
import sys
import time
import traceback
from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any

from aiohttp import ClientSession, ClientTimeout, web

from pymammotion.client import MammotionClient
from pymammotion.data.error_codes import describe as describe_error
from pymammotion.messaging.command_queue import Priority
from pymammotion.transport.base import LoginFailedError
from pymammotion.utility.constant.device_enums import WorkMode
from pymammotion.utility.device_type import DeviceType

# Kamera (Agora). Fehlt die Bibliothek, laeuft die Steuerung trotzdem weiter.
try:
    from pyagorartc import (
        AgoraAPClient,
        AgoraSession,
        ChannelCredentials,
        ChannelEncryption,
        CloseReason,
        PyAgoraRTCError,
        SessionOptions,
    )

    CAMERA_IMPORT_ERROR: str | None = None
except Exception as _err:  # noqa: BLE001
    CAMERA_IMPORT_ERROR = f"Kamera-Bibliothek pyagorartc fehlt ({_err})"

LOG = logging.getLogger("mower")

HOST = os.environ.get("MOWER_HOST", "127.0.0.1")
PORT = int(os.environ.get("MOWER_PORT", "8791"))
EMAIL = os.environ.get("MAMMOTION_EMAIL", "").strip()
PASSWORD = os.environ.get("MAMMOTION_PASSWORD", "")
CACHE_DIR = Path(os.environ.get("MOWER_CACHE_DIR", Path(__file__).parent / ".cache"))
SESSION_FILE = CACHE_DIR / "session.json"
#: Merkt sich abgelehnte Zugangsdaten (nur als Hash), damit auch Hub-Neustarts
#: und Updates sie nicht immer wieder probieren. Neue Daten in .env heben es auf.
REJECTED_FILE = CACHE_DIR / "rejected.json"

#: Grundtakt fuer Berichte, solange ein Maeher arbeitet (Sekunden).
ACTIVE_POLL_S = 60
#: Takt, wenn alle Maeher stehen oder laden.
IDLE_POLL_S = 300
#: Zeitgesteuerte Abgleiche (Karte, Aufgaben, Wartung) wie in der HA-Integration.
SYNC_EVERY_S = 1800
#: Login-Wiederholung nur fuer Netz-/Serverfehler, nie fuer ein falsches Passwort.
LOGIN_RETRY_S = 900
LOGIN_MAX_RETRIES = 5

#: go2rtc auf dem Hub; dort sieht der Dienst nach, ob noch jemand zuschaut.
GO2RTC_URL = os.environ.get("HUB_GO2RTC_URL", "http://127.0.0.1:1984").rstrip("/")
#: Laengste Kamera-Sitzung am Stueck (Akku, Mammotion-App, 4G-Kontingent).
CAMERA_MAX_S = max(60, int(os.environ.get("MOWER_CAMERA_MAX_S", "900")))
#: Takt, in dem der Dienst die Zuschauer in go2rtc zaehlt.
CAMERA_WATCH_S = 10
#: Erste Pruefung erst nach dieser Zeit: go2rtc haengt seinen Zuschauer erst nach der Antwort an.
CAMERA_WATCH_GRACE_S = 20
#: Mammotion-Cloud: Der Maeher hat auf die Token-Anfrage nicht reagiert.
DEVICE_NOT_RESPONDING = 50504
#: go2rtc bietet H265 ohne fmtp an; mit profile-id=1 sieht das Angebot wie Chromes aus,
#: auf das das Agora-Gateway den H265-Stream des Maehers legt. 0 schaltet es ab.
CAMERA_H265_FMTP = os.environ.get("MOWER_CAMERA_H265_FMTP", "1") != "0"
#: pyagorartc entfernt die MID-Erweiterung aus der Antwort; zeigt go2rtc kein Bild, mit 0 probieren.
CAMERA_STRIP_MID = os.environ.get("MOWER_CAMERA_STRIP_MID", "1") != "0"
STREAM_NAME_RE = re.compile(r"^[\w.-]{1,80}$")

ACTIVE_MODES = {
    WorkMode.MODE_WORKING,
    WorkMode.MODE_RETURNING,
    WorkMode.MODE_PAUSE,
    WorkMode.MODE_CHARGING_PAUSE,
}

STATUS_LABELS: dict[int, str] = {
    WorkMode.MODE_NOT_ACTIVE: "Nicht aktiviert",
    WorkMode.MODE_ONLINE: "Online",
    WorkMode.MODE_OFFLINE: "Offline",
    WorkMode.MODE_POWER_OFF: "Ausgeschaltet",
    WorkMode.MODE_DISABLE: "Deaktiviert",
    WorkMode.MODE_INITIALIZATION: "Startet",
    WorkMode.MODE_READY: "Bereit",
    WorkMode.MODE_UNCONNECTED: "Nicht verbunden",
    WorkMode.MODE_WORKING: "Mäht",
    WorkMode.MODE_RETURNING: "Fährt zur Station",
    WorkMode.MODE_CHARGING: "Lädt",
    WorkMode.MODE_UPDATING: "Firmware-Update",
    WorkMode.MODE_LOCK: "Gesperrt",
    WorkMode.MODE_SYSTEM_ERROR: "Fehler",
    WorkMode.MODE_PAUSE: "Pausiert",
    WorkMode.MODE_MANUAL_MOWING: "Manuell",
    WorkMode.MODE_UPDATE_SUCCESS: "Update fertig",
    WorkMode.MODE_OTA_UPGRADE_FAIL: "Update fehlgeschlagen",
    WorkMode.MODE_LOCATION_ERROR: "Ortungsfehler",
    WorkMode.MODE_CHARGING_PAUSE: "Lädt (Auftrag pausiert)",
    WorkMode.MODE_SLEEPING: "Schläft",
}

WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

#: Verkaufsnamen, wo PyMammotion nur den internen Code kennt.
MODEL_NAMES = {DeviceType.LUBA_VA: "Luba 3 AWD", DeviceType.LUBA_2: "Luba 2 AWD"}


def _labels() -> dict[str, str]:
    """MOWER_NAMES="Luba-VS1234=Strand,Luba-VA5678=Wiese" (optional, aus hub/.env)."""
    out: dict[str, str] = {}
    for part in os.environ.get("MOWER_NAMES", "").split(","):
        key, sep, label = part.partition("=")
        if sep and key.strip() and label.strip():
            out[key.strip()] = label.strip()
    return out


LABELS = _labels()


class MowerService:
    """Haelt die eine Mammotion-Sitzung und den Polling-Takt."""

    def __init__(self) -> None:
        self.http: ClientSession | None = None
        self.client: MammotionClient | None = None
        self.state = "init"  # init | no_credentials | logging_in | ready | retrying | rejected | error
        self.error: str | None = None
        self.login_attempts = 0
        self.logged_in_at: float | None = None
        self.last_poll_at: float | None = None
        self.last_sync_at: dict[str, float] = {}
        self._loop_task: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()
        self.cameras = MowerCameras(self)

    # ------------------------------------------------------------------ Login

    def _load_cache(self) -> dict[str, Any] | None:
        try:
            data = json.loads(SESSION_FILE.read_text("utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as err:
            LOG.warning("Sitzungs-Cache unlesbar, melde neu an: %s", err)
            return None
        if data.get("account") != EMAIL:
            LOG.info("Sitzungs-Cache gehoert zu einem anderen Account, melde neu an")
            return None
        cache = data.get("cache")
        return cache if isinstance(cache, dict) and cache else None

    async def _save_cache(self) -> None:
        if self.client is None:
            return
        cache = self.client.to_cache()
        if not cache:
            return
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = SESSION_FILE.with_suffix(".tmp")
        payload = json.dumps({"account": EMAIL, "savedAt": time.time(), "cache": cache}, default=_jsonable)
        # Nur fuer den Benutzer lesbar: Die Datei enthaelt Zugangstoken.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp, SESSION_FILE)

    def _clear_cache(self) -> None:
        with contextlib.suppress(FileNotFoundError):
            SESSION_FILE.unlink()

    def _mark_rejected(self) -> None:
        with contextlib.suppress(OSError):
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            REJECTED_FILE.write_text(json.dumps({"fingerprint": _fingerprint(), "at": time.time()}), "utf-8")

    def _was_rejected(self) -> bool:
        try:
            return json.loads(REJECTED_FILE.read_text("utf-8")).get("fingerprint") == _fingerprint()
        except (OSError, ValueError, AttributeError):
            return False

    async def start(self) -> None:
        if not EMAIL or not PASSWORD:
            self.state = "no_credentials"
            self.error = "MAMMOTION_EMAIL und MAMMOTION_PASSWORD fehlen in hub/.env"
            LOG.warning(self.error)
            return
        if self._was_rejected():
            self.state = "rejected"
            self.error = (
                "Mammotion hat diese Zugangsdaten abgelehnt. Bitte MAMMOTION_EMAIL/MAMMOTION_PASSWORD "
                "in hub/.env korrigieren, dann versucht der Hub es erneut."
            )
            LOG.error(self.error)
            return
        self.http = ClientSession()
        self._loop_task = asyncio.create_task(self._run())

    async def _login(self) -> bool:
        """Ein Anmeldeversuch: erst die gespeicherte Sitzung, sonst einmal mit Passwort."""
        assert self.http is not None
        if self.client is not None:
            with contextlib.suppress(Exception):
                await self.client.stop()
        self.client = MammotionClient()
        self.client.on_credentials_updated = self._save_cache
        self.state = "logging_in"
        self.login_attempts += 1
        cached = self._load_cache()
        try:
            if cached:
                LOG.info("Stelle gespeicherte Mammotion-Sitzung wieder her …")
                await self.client.restore_credentials(EMAIL, PASSWORD, cached, self.http, check_for_new_devices=True)
            else:
                LOG.info("Melde mich bei Mammotion an (%s) …", _mask(EMAIL))
                await self.client.login_and_initiate_cloud(EMAIL, PASSWORD, self.http)
        except Exception as err:  # noqa: BLE001 - jede Ursache wird unten eingeordnet
            msg = str(err) or type(err).__name__
            # Mammotion nennt die Adresse im Klartext; Log und Dashboard zeigen sie maskiert.
            msg = _scrub(msg)
            if _is_rejected(err, self.client):
                self.state = "rejected"
                self.error = f"Mammotion lehnt die Anmeldung ab: {msg}. Zugangsdaten in hub/.env pruefen."
                self._clear_cache()
                self._mark_rejected()
                LOG.error(self.error)
            else:
                self.state = "retrying"
                self.error = f"Mammotion-Cloud nicht erreichbar: {msg}"
                LOG.warning(self.error)
            return False

        await self._save_cache()
        with contextlib.suppress(FileNotFoundError):
            REJECTED_FILE.unlink()
        self.client.setup_all_mower_watchers()
        self.state = "ready"
        self.error = None
        self.logged_in_at = time.time()
        names = [h.device_name for h in self.client.device_registry.all_devices]
        LOG.info("Mammotion verbunden, Geraete: %s", ", ".join(names) or "keine")
        return True

    async def _run(self) -> None:
        while not await self._login():
            if self.state == "rejected" or self.login_attempts > LOGIN_MAX_RETRIES:
                if self.state != "rejected":
                    self.state = "error"
                    self.error = (self.error or "Login fehlgeschlagen") + " (keine weiteren Versuche bis zum Neustart)"
                return
            await asyncio.sleep(LOGIN_RETRY_S)
        while True:
            try:
                await self._poll()
            except Exception as err:  # noqa: BLE001
                LOG.warning("Abfrage fehlgeschlagen: %s", err)
            interval = ACTIVE_POLL_S if self._any_active() else IDLE_POLL_S
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=interval)

    # ---------------------------------------------------------------- Polling

    def _mowers(self) -> list[Any]:
        if self.client is None:
            return []
        out = []
        for handle in self.client.device_registry.all_devices:
            name = handle.device_name
            if DeviceType.value_of_str(name).is_luba_type() or name.startswith(("Luba", "Yuka")):
                out.append(handle)
        return out

    def _any_active(self) -> bool:
        for handle in self._mowers():
            dev = handle.snapshot.raw
            if _mode(dev) in ACTIVE_MODES:
                return True
        return False

    async def _poll(self) -> None:
        assert self.client is not None
        now = time.time()
        for handle in self._mowers():
            name = handle.device_name
            if now - self.last_sync_at.get(name, 0) > SYNC_EVERY_S:
                self.last_sync_at[name] = now
                dev = handle.snapshot.raw
                # Karte und Aufgaben nur holen, solange sie fehlen oder alt sind;
                # Aenderungen am Maeher stoesst PyMammotion selbst an.
                if not dev.map.area or dev.map.missing_hashlist():
                    with contextlib.suppress(Exception):
                        await self.client.start_map_sync(name)
                with contextlib.suppress(Exception):
                    await self.client.start_plan_sync(name)
            with contextlib.suppress(Exception):
                await self.client.ensure_fresh_state(name, max_age_s=ACTIVE_POLL_S - 5)
            with contextlib.suppress(Exception):
                self.client.regenerate_stale_geojson(name)
        self.last_poll_at = now

    # ------------------------------------------------------------- Ausgaben

    def status(self) -> dict[str, Any]:
        mowers = []
        for handle in self._mowers():
            try:
                payload = _mower_payload(handle)
            except Exception as err:  # noqa: BLE001
                LOG.debug("Status fuer %s nicht lesbar: %s", handle.device_name, err)
                payload = {"name": handle.device_name, "error": str(err)}
            payload["cameras"] = self.cameras.feeds(handle.device_name)
            mowers.append(payload)
        return {
            "state": self.state,
            "error": self.error,
            "account": _mask(EMAIL) if EMAIL else None,
            "loggedInAt": self.logged_in_at,
            "lastPollAt": self.last_poll_at,
            "camera": {"available": CAMERA_IMPORT_ERROR is None, "error": CAMERA_IMPORT_ERROR, "maxS": CAMERA_MAX_S},
            "mowers": mowers,
        }

    def map_geojson(self, name: str) -> dict[str, Any] | None:
        handle = self._handle(name)
        if handle is None:
            return None
        dev = handle.snapshot.raw
        with contextlib.suppress(Exception):
            self.client.regenerate_stale_geojson(name)  # type: ignore[union-attr]
        geo = dev.map.generated_geojson or {"type": "FeatureCollection", "features": []}
        pos = dev.location.device
        return {
            "areas": geo,
            "mowPath": dev.map.generated_mow_path_geojson or None,
            "mower": _point(pos.latitude, pos.longitude),
            "dock": _point(dev.location.dock.latitude, dev.location.dock.longitude),
            "heading": dev.location.orientation,
        }

    def _handle(self, name: str) -> Any | None:
        for handle in self._mowers():
            if handle.device_name == name:
                return handle
        return None

    # --------------------------------------------------------------- Befehle

    async def action(self, name: str, action: str, body: dict[str, Any]) -> dict[str, Any]:
        if self.client is None or self.state != "ready":
            return {"ok": False, "error": self.error or "Mammotion nicht verbunden"}
        handle = self._handle(name)
        if handle is None:
            return {"ok": False, "error": f"Mäher {name} unbekannt"}
        client = self.client

        async def send(cmd: str, **kwargs: Any) -> None:
            await client.send_command_with_args(name, cmd, priority=Priority.USER, **kwargs)

        async def wait_mode(*modes: WorkMode, timeout: float = 30) -> None:
            await client.wait_for(name, lambda d: _mode(d) in modes, timeout=timeout)

        with contextlib.suppress(Exception):
            await client.ensure_fresh_state(name, max_age_s=30, wait=True)
        mode = _mode(handle.snapshot.raw)

        try:
            if action == "start_task":
                plan_id = str(body.get("planId") or "")
                if plan_id not in handle.snapshot.raw.map.plan:
                    return {"ok": False, "error": "Aufgabe nicht gefunden"}
                if mode in (WorkMode.MODE_WORKING, WorkMode.MODE_RETURNING, WorkMode.MODE_PAUSE):
                    return {"ok": False, "error": "Der Mäher hat schon einen Auftrag. Erst stoppen."}
                await send("single_schedule", plan_id=plan_id)
            elif action == "pause":
                if mode == WorkMode.MODE_WORKING:
                    await send("pause_execute_task")
                elif mode == WorkMode.MODE_RETURNING:
                    await send("cancel_return_to_dock")
                else:
                    return {"ok": False, "error": "Der Mäher mäht gerade nicht."}
            elif action == "resume":
                if mode != WorkMode.MODE_PAUSE:
                    return {"ok": False, "error": "Nichts zum Fortsetzen."}
                await send("resume_execute_task")
            elif action == "stop":
                # Wie in der App: erst anhalten, dann den Auftrag beenden.
                if mode == WorkMode.MODE_WORKING:
                    await send("pause_execute_task")
                    await wait_mode(WorkMode.MODE_PAUSE)
                    mode = WorkMode.MODE_PAUSE
                elif mode == WorkMode.MODE_RETURNING:
                    await send("cancel_return_to_dock")
                    await wait_mode(WorkMode.MODE_PAUSE, WorkMode.MODE_READY)
                    mode = _mode(handle.snapshot.raw)
                if mode == WorkMode.MODE_PAUSE:
                    await send("cancel_job")
                elif mode not in (WorkMode.MODE_READY,):
                    return {"ok": False, "error": "Kein laufender Auftrag."}
            elif action == "dock":
                if handle.snapshot.raw.report_data.dev.charge_state != 0:
                    return {"ok": False, "error": "Der Mäher steht schon in der Station."}
                if mode == WorkMode.MODE_WORKING:
                    await send("pause_execute_task")
                await send("return_to_dock")
            elif action == "enable_task":
                plan_id = str(body.get("planId") or "")
                plan = handle.snapshot.raw.map.plan.get(plan_id)
                if plan is None:
                    return {"ok": False, "error": "Aufgabe nicht gefunden"}
                await send("enable_plan", plan=plan, enabled=bool(body.get("enabled")))
                with contextlib.suppress(Exception):
                    await client.start_plan_sync(name)
            elif action == "refresh":
                self.last_sync_at.pop(name, None)
                self._wake.set()
            else:
                return {"ok": False, "error": f"Unbekannte Aktion {action}"}
        except Exception as err:  # noqa: BLE001
            LOG.warning("%s %s fehlgeschlagen: %s", name, action, err)
            return {"ok": False, "error": f"Befehl nicht bestätigt: {err or type(err).__name__}"}
        finally:
            with contextlib.suppress(Exception):
                await client.request_report_snapshot(name)
            self._wake.set()
        return {"ok": True}

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
        with contextlib.suppress(Exception):
            await self.cameras.close_all()
        if self.client is not None:
            with contextlib.suppress(Exception):
                await self.client.stop()
        if self.http is not None:
            await self.http.close()


# --------------------------------------------------------------------- Helfer


def _jsonable(obj: Any) -> Any:
    to_dict = getattr(obj, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    if isinstance(obj, (bytes, bytearray)):
        return obj.decode("latin-1")
    if isinstance(obj, (set, frozenset)):
        return list(obj)
    raise TypeError(f"{type(obj).__name__} nicht serialisierbar")


def _is_rejected(err: Exception, client: MammotionClient | None) -> bool:
    """Falsches Passwort/gesperrter Account: nie automatisch wiederholen.

    Gleiche Einordnung wie die Home-Assistant-Integration: Nur ein abgelehnter
    Login (oder eine Sitzung, die neu angemeldet werden muss) ist endgueltig.
    """
    if isinstance(err, LoginFailedError):
        return True
    return client is not None and getattr(client, "reauth_required", None) is not None


def _fingerprint() -> str:
    return hashlib.sha256(f"{EMAIL}\0{PASSWORD}".encode()).hexdigest()


def _mask(email: str) -> str:
    user, _, domain = email.partition("@")
    return f"{user[:2]}…@{domain}" if domain else "…"


def _scrub(text: str) -> str:
    """Maskiert Account-Adresse und Passwort in Texten fuer Log und Dashboard.

    PyMammotion und die Aliyun-Cloud schreiben die Adresse in Fehlermeldungen
    und Warnungen im Klartext, teils klein geschrieben.
    """
    if EMAIL:
        text = re.sub(re.escape(EMAIL), _mask(EMAIL), text, flags=re.IGNORECASE)
    if len(PASSWORD) >= 4:
        text = text.replace(PASSWORD, "***")
    return text


class _ScrubFormatter(logging.Formatter):
    """Log-Format, das jede Zeile (auch Tracebacks) durch _scrub schickt."""

    def format(self, record: logging.LogRecord) -> str:
        return _scrub(super().format(record))


def _mode(dev: Any) -> WorkMode:
    try:
        return WorkMode(dev.report_data.dev.sys_status)
    except Exception:  # noqa: BLE001
        return WorkMode.UNKNOWN


def _point(lat: float | None, lon: float | None) -> dict[str, float] | None:
    if not lat or not lon:
        return None
    return {"lat": lat, "lon": lon}


def _mower_payload(handle: Any) -> dict[str, Any]:
    dev = handle.snapshot.raw
    name = handle.device_name
    dtype = DeviceType.value_of_str(name)
    mode = _mode(dev)
    rpt = dev.report_data
    areas = {a.hash: a.name for a in dev.map.area_name}

    running_id = None
    job_id = getattr(dev.work, "job_id", 0)
    if mode in ACTIVE_MODES and job_id:
        prefix = str(job_id)
        running_id = next((p.plan_id for p in dev.map.plan.values() if p.plan_id.startswith(prefix)), None)

    tasks = []
    for plan in dev.map.plan.values():
        tasks.append(
            {
                "id": plan.plan_id,
                "name": plan.task_name or plan.job_name or "Aufgabe",
                "enabled": plan.is_enabled(),
                "running": plan.plan_id == running_id,
                "startTime": plan.start_time,
                "endTime": plan.end_time,
                "weekdays": [WEEKDAYS[d] for d in plan.weeks if 0 <= d < 7],
                "bladeHeightMm": plan.knife_height,
                "speed": plan.speed,
                "zones": [areas.get(h, f"Zone {i + 1}") for i, h in enumerate(plan.zone_hashs)],
            }
        )
    tasks.sort(key=lambda t: (t["startTime"] or "", t["name"]))

    errors = []
    for code in list(dev.errors.err_code_list)[:3]:
        if not code:
            continue
        try:
            text = describe_error(code, "de") or describe_error(code, "en")
        except Exception:  # noqa: BLE001
            text = ""
        errors.append({"code": code, "text": text})

    pos = dev.location.device
    return {
        "name": name,
        "label": LABELS.get(name) or MODEL_NAMES.get(dtype) or name,
        "model": MODEL_NAMES.get(dtype) or (dtype.get_model() if dtype is not DeviceType.UNKNOWN else name.split("-")[0]),
        "online": bool(handle.snapshot.online),
        "status": mode.name,
        "statusLabel": STATUS_LABELS.get(mode, mode.name.replace("MODE_", "").title()),
        "active": mode in ACTIVE_MODES,
        "charging": rpt.dev.charge_state != 0,
        "battery": rpt.dev.battery_val,
        "progress": rpt.work.mow_percent if mode in ACTIVE_MODES else None,
        "currentZone": areas.get(dev.location.work_zone) if dev.location.work_zone else None,
        "runningTaskId": running_id,
        "firmware": getattr(dev.device_firmwares, "device_version", "") or None,
        "position": _point(pos.latitude, pos.longitude),
        "zones": [{"hash": h, "name": n} for h, n in areas.items()],
        "tasks": tasks,
        "errors": errors,
        "reportAgeS": round(handle.report_age) if handle.report_age != float("inf") else None,
    }


# --------------------------------------------------------------------- Kamera
#
# Die Maeher-Kameras gibt es nur ueber Agora (die Mammotion-Cloud). go2rtc holt
# das Bild per WHEP hier ab: Es schickt sein SDP-Angebot, dieser Dienst holt ein
# frisches Stream-Token bei Mammotion (erst das laesst den Maeher senden), tritt
# mit pyagorartc dem Agora-Kanal bei und gibt die Antwort zurueck. Das Video
# selbst fliesst dann direkt vom Agora-Gateway zu go2rtc, das es an beliebig
# viele Zuschauer verteilt.
#
# Pro Kamera gibt es genau eine Sitzung. Die Mammotion-App verliert ihr Bild,
# solange der Hub zusieht. Schaut in go2rtc niemand mehr zu, endet die Sitzung
# und die Kamera am Maeher wird wieder abgeschaltet (vi_switch=0). Nach
# CAMERA_MAX_S ist ebenfalls Schluss.


def camera_feeds(name: str) -> list[dict[str, Any]]:
    """Kameras eines Maehers als Agora-uid (Kamera-Slot + 1), wie in der HA-Integration.

    Der Luba 3 (LUBA_VA) sendet nur Slot 0 als seine eine Vision-Kamera, der
    Luba 2 links (1) und rechts (2), der Yuka zusaetzlich hinten (3). Der Luba 1
    hat keine Kamera.
    """
    if DeviceType.is_luba1(name):
        return []
    dtype = DeviceType.value_of_str(name)
    if dtype.is_luba_va():
        return [{"uid": 1, "label": "Kamera"}]
    feeds = [{"uid": 1, "label": "Kamera links"}, {"uid": 2, "label": "Kamera rechts"}]
    if dtype.is_yu_ka():
        feeds.append({"uid": 3, "label": "Kamera hinten"})
    return feeds


def with_h265_profile(sdp: str) -> str:
    """Ergaenzt fmtp profile-id=1 fuer H265-Eintraege ohne fmtp (go2rtc/pion laesst sie weg)."""
    nl = "\r\n" if "\r\n" in sdp else "\n"
    lines = sdp.split(nl)
    has_fmtp = {m.group(1) for line in lines if (m := re.match(r"a=fmtp:(\d+) ", line))}
    out: list[str] = []
    for line in lines:
        out.append(line)
        m = re.match(r"a=rtpmap:(\d+) H265/", line, re.IGNORECASE)
        if m and m.group(1) not in has_fmtp:
            out.append(f"a=fmtp:{m.group(1)} profile-id=1")
    return nl.join(out)


def _credentials(data: Any) -> ChannelCredentials:
    """Agora-Zugang aus Mammotions Stream-Token (Abbildung wie in der HA-Integration)."""
    encryption = None
    if data.openEncrypt and data.key:
        # pyagorartc kann verschluesselte Kanaele nicht entschluesseln: dann kein Bild.
        encryption = ChannelEncryption(
            mode="aes-256-gcm2",
            secret=data.key,
            salt=base64.b64decode(data.salt) if data.salt else None,
        )
    return ChannelCredentials(
        app_id=data.appid,
        channel_name=data.channelName,
        token=data.token,
        uid=int(data.uid),
        license=data.license,
        encryption=encryption,
    )


def _session_options(uid: int) -> SessionOptions:
    return SessionOptions(
        client_codec="vp8",  # so tritt die Mammotion-App bei; das Bild selbst kommt als H265
        target_uid=uid,
        # Ein Gateway-Knoten pro Kamera: Sonst wirft der Knoten die aeltere Sitzung
        # mit derselben Zuschauer-uid hinaus (alle Kameras teilen sich das Token).
        gateway_edge_offset=uid - 1,
        declare_remote_video_ssrc=True,  # go2rtc (pion) braucht die SSRC in der Antwort
        disable_audio=True,
        strip_mid_extension=CAMERA_STRIP_MID,
    )


def _on_4g(handle: Any) -> bool:
    try:
        return str(handle.snapshot.raw.report_data.connect.used_net).upper().endswith("MNET")
    except Exception:  # noqa: BLE001
        return False


_CLOSE_TEXT = {
    "gateway_quit": "Ein anderer Zuschauer (z. B. die Mammotion-App) hat das Bild übernommen",
    "deadline": "Zeitlimit erreicht",
    "ping_timeout": "Agora antwortet nicht mehr",
    "socket_closed": "Verbindung zu Agora getrennt",
    "p2p_lost": "Verbindung zu Agora verloren",
}


class _CameraError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class _Live:
    sid: str
    name: str
    uid: int
    stream: str | None
    session: Any
    started_at: float
    watch: asyncio.Task[None] | None = None


class MowerCameras:
    """Eine Agora-Sitzung pro Maeher-Kamera, angefordert von go2rtc per WHEP."""

    def __init__(self, service: MowerService) -> None:
        self.service = service
        self.live: dict[tuple[str, int], _Live] = {}
        self.errors: dict[tuple[str, int], str] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        #: Maeher, fuer die gerade ein Beitritt laeuft: dort nie die Kamera abschalten.
        self._starting: set[str] = set()

    def feeds(self, name: str) -> list[dict[str, Any]]:
        out = []
        for feed in camera_feeds(name):
            key = (name, feed["uid"])
            live = self.live.get(key)
            out.append(
                {
                    **feed,
                    "live": live is not None,
                    "since": live.started_at if live else None,
                    "error": self.errors.get(key),
                }
            )
        return out

    def _lock(self, name: str) -> asyncio.Lock:
        return self._locks.setdefault(name, asyncio.Lock())

    async def offer(self, name: str, uid: int, offer_sdp: str, stream: str | None) -> tuple[int, str, str | None]:
        """Beantwortet ein WHEP-Angebot: (HTTP-Status, Antwort-SDP oder Fehlertext, Sitzungs-ID)."""
        if CAMERA_IMPORT_ERROR:
            return 503, CAMERA_IMPORT_ERROR, None
        svc = self.service
        client = svc.client
        if client is None or svc.state != "ready" or svc.http is None:
            return 503, svc.error or "Mammotion nicht verbunden", None
        handle = svc._handle(name)
        if handle is None:
            return 404, f"Mäher {name} unbekannt", None
        if not any(f["uid"] == uid for f in camera_feeds(name)):
            return 404, f"{name} hat keine Kamera {uid}", None
        if not handle.snapshot.online:
            return 503, "Der Mäher ist offline", None
        if not getattr(handle, "iot_id", ""):
            return 503, "Der Mäher hat keine Cloud-Kennung (iot_id)", None

        key = (name, uid)
        failure: _CameraError | None = None
        answer = sid = ""
        async with self._lock(name):
            self._starting.add(name)
            try:
                # go2rtc verbindet neu: alte Sitzung zu, Kamera am Maeher bleibt an.
                await self._close(key, stop_device=False)
                answer, sid = await self._join(client, handle, key, offer_sdp, stream)
            except _CameraError as err:
                failure = err
            finally:
                self._starting.discard(name)
        if failure is not None:
            self.errors[key] = failure.message
            LOG.warning("Kamera %s/%s: %s", name, uid, failure.message)
            # Das Token hat den Maeher evtl. schon senden lassen.
            await self._stop_device_if_idle(name)
            return failure.status, failure.message, None
        if key not in self.live:
            # Der Beitritt hat geklappt, die Sitzung ist aber schon wieder zu.
            await self._stop_device_if_idle(name)
        self.errors.pop(key, None)
        return 201, answer, sid

    async def _join(self, client: Any, handle: Any, key: tuple[str, int], offer_sdp: str, stream: str | None) -> tuple[str, str]:
        name, uid = key
        # Die rechte (und hintere) Kamera sendet nur mit einem Token fuer alle Kameras.
        all_cameras = uid > 1 or any(k[0] == name and k[1] > 1 for k in self.live)
        try:
            resp = await client.get_stream_subscription(name, handle.iot_id, all_cameras=all_cameras)
        except Exception as err:  # noqa: BLE001
            raise _CameraError(502, f"Kein Stream-Token von Mammotion: {_scrub(str(err) or type(err).__name__)}") from err
        if resp is None:
            raise _CameraError(502, "Kein Stream-Token von Mammotion")
        if getattr(resp, "code", None) == DEVICE_NOT_RESPONDING:
            raise _CameraError(503, "Der Mäher antwortet nicht (schläft oder hat kein Netz)")
        data = getattr(resp, "data", None)
        if data is None:
            raise _CameraError(502, f"Kein Stream-Token von Mammotion ({getattr(resp, 'code', '?')}: {getattr(resp, 'msg', '')})")
        if data.openEncrypt:
            LOG.warning("Kamera %s: Kanal ist verschlüsselt (openEncrypt=%s), vermutlich kein Bild", name, data.openEncrypt)
        # Wie die App: ein Sync-Stoss, damit der Maeher sicher zu senden beginnt.
        with contextlib.suppress(Exception):
            await client.send_command_with_args(name, "send_todev_ble_sync", priority=Priority.USER, sync_type=3)
        try:
            creds = _credentials(data)
            ap = await AgoraAPClient(session=self.service.http).choose_server(creds)
        except (PyAgoraRTCError, ValueError, TypeError) as err:
            raise _CameraError(502, f"Agora-Server nicht erreichbar: {err}") from err

        sid = secrets.token_hex(8)
        now = time.monotonic()
        on_4g = _on_4g(handle)
        deadline = now + CAMERA_MAX_S
        if on_4g and data.availableTime and data.availableTime > 0:
            deadline = min(deadline, now + data.availableTime)
        session = AgoraSession(
            creds,
            ap,
            options=_session_options(uid),
            on_closed=functools.partial(self._on_closed, key, sid),
            on_peer_left=functools.partial(self._on_peer_left, key),
            keepalive=functools.partial(self._keepalive, name) if on_4g else None,
            deadline=deadline,
        )
        live = _Live(sid=sid, name=name, uid=uid, stream=stream, session=session, started_at=time.time())
        self.live[key] = live
        try:
            answer = await session.join(with_h265_profile(offer_sdp) if CAMERA_H265_FMTP else offer_sdp, sid)
        except (PyAgoraRTCError, ValueError, TypeError) as err:
            if self.live.get(key) is live:
                self.live.pop(key, None)
            raise _CameraError(502, f"Agora-Beitritt fehlgeschlagen: {type(err).__name__}: {err}") from err
        if self.live.get(key) is live and stream:
            live.watch = asyncio.create_task(self._watch(key, sid, stream))
        streams = ", ".join(f"uid {s.uid} {s.codec or ''} pt {s.payload_type}" for s in session.remote_streams) or "noch keiner"
        LOG.info("Kamera %s/%s live über %s (Sitzung %s, Stream: %s)", name, uid, "4G" if on_4g else "WLAN", sid, streams)
        return answer, sid

    async def _close(self, key: tuple[str, int], *, stop_device: bool = True) -> None:
        live = self.live.pop(key, None)
        if live is None:
            return
        if live.watch is not None and live.watch is not asyncio.current_task():
            live.watch.cancel()
        with contextlib.suppress(Exception):
            await live.session.close()
        LOG.info("Kamera %s/%s beendet", *key)
        if stop_device:
            await self._stop_device_if_idle(key[0])

    async def _stop_device_if_idle(self, name: str) -> None:
        """Kamera am Maeher abschalten, sobald keine Sitzung mehr laeuft (wie die App beim Schliessen)."""
        if name in self._starting or any(k[0] == name for k in self.live):
            return
        client = self.service.client
        if client is None:
            return
        try:
            await client.stop_stream(name)
        except Exception as err:  # noqa: BLE001
            LOG.debug("Kamera %s: Abschalten nicht bestätigt: %s", name, err)

    async def _on_closed(self, key: tuple[str, int], sid: str, reason: CloseReason) -> None:
        # Eigenes Schliessen und ein gescheiterter Beitritt raeumen selbst auf.
        if reason in (CloseReason.CLOSED_BY_HOST, CloseReason.JOIN_FAILED):
            return
        live = self.live.get(key)
        if live is None or live.sid != sid:
            return
        self.live.pop(key, None)
        if live.watch is not None:
            live.watch.cancel()
        text = _CLOSE_TEXT.get(reason.value, "Stream beendet")
        if reason is not CloseReason.DEADLINE:
            self.errors[key] = text
        LOG.info("Kamera %s/%s: %s", key[0], key[1], text)
        await self._stop_device_if_idle(key[0])

    async def _on_peer_left(self, key: tuple[str, int], _uid: int) -> None:
        """Der Maeher hat den Kanal verlassen und kam nicht zurueck: wieder anstossen (wie HA)."""
        name = key[0]
        client = self.service.client
        handle = self.service._handle(name)
        if client is None or handle is None:
            return
        LOG.info("Kamera %s/%s: Mäher hat den Kanal verlassen, stoße ihn neu an", *key)
        with contextlib.suppress(Exception):
            await client.send_command_with_args(name, "send_todev_ble_sync", priority=Priority.USER, sync_type=3)
        with contextlib.suppress(Exception):
            await client.get_stream_subscription(name, handle.iot_id, all_cameras=key[1] > 1)

    async def _keepalive(self, name: str) -> bool:
        """Ueber 4G sendet der Maeher nur weiter, wenn man ihn regelmaessig anstoesst."""
        client = self.service.client
        handle = self.service._handle(name)
        if client is None or handle is None or not _on_4g(handle):
            return False
        try:
            await client.send_command_with_args(name, "refresh_fpv", priority=Priority.USER)
        except Exception:  # noqa: BLE001
            return False
        return True

    async def _viewers(self, stream: str) -> int | None:
        """Zuschauer des Streams in go2rtc; None, wenn go2rtc nicht antwortet."""
        http = self.service.http
        if http is None:
            return None
        try:
            async with http.get(
                f"{GO2RTC_URL}/api/streams", params={"src": stream}, timeout=ClientTimeout(total=4)
            ) as res:
                if res.status != 200:
                    return None
                data = await res.json(content_type=None)
        except Exception:  # noqa: BLE001
            return None
        return len((data or {}).get("consumers") or [])

    async def _watch(self, key: tuple[str, int], sid: str, stream: str) -> None:
        """Beendet die Sitzung, wenn in go2rtc zweimal hintereinander niemand zuschaut."""
        await asyncio.sleep(CAMERA_WATCH_GRACE_S)
        misses = 0
        while True:
            live = self.live.get(key)
            if live is None or live.sid != sid:
                return
            viewers = await self._viewers(stream)
            misses = misses + 1 if not viewers else 0
            if misses >= 2:
                async with self._lock(key[0]):
                    live = self.live.get(key)
                    if live is not None and live.sid == sid:
                        LOG.info("Kamera %s/%s: niemand schaut mehr zu", *key)
                        await self._close(key)
                return
            await asyncio.sleep(CAMERA_WATCH_S)

    async def close_sid(self, sid: str) -> bool:
        for key, live in list(self.live.items()):
            if live.sid == sid:
                async with self._lock(key[0]):
                    if self.live.get(key) is live:
                        await self._close(key)
                return True
        return False

    async def close_all(self) -> None:
        for key in list(self.live):
            await self._close(key)


# ------------------------------------------------------------------- HTTP-API


def build_app(service: MowerService) -> web.Application:
    app = web.Application()

    async def health(_req: web.Request) -> web.Response:
        return web.json_response({"ok": True, "state": service.state})

    async def status(_req: web.Request) -> web.Response:
        return web.json_response(service.status(), dumps=_dumps)

    async def map_(req: web.Request) -> web.Response:
        geo = service.map_geojson(req.query.get("mower", ""))
        if geo is None:
            return web.json_response({"error": "Mäher unbekannt"}, status=404)
        return web.json_response(geo, dumps=_dumps)

    async def action(req: web.Request) -> web.Response:
        try:
            body = await req.json()
        except ValueError:
            return web.json_response({"ok": False, "error": "Ungültiges JSON"}, status=400)
        result = await service.action(str(body.get("mower", "")), str(body.get("action", "")), body)
        return web.json_response(result, status=200 if result.get("ok") else 409)

    async def whep_offer(req: web.Request) -> web.Response:
        try:
            uid = int(req.match_info["uid"])
        except ValueError:
            return web.Response(status=400, text="Kamera-Nummer ungültig")
        stream = req.query.get("stream") or None
        if stream is not None and not STREAM_NAME_RE.match(stream):
            stream = None
        offer = await req.text()
        if not offer.lstrip().startswith("v=0"):
            return web.Response(status=400, text="Kein SDP-Angebot")
        code, body, sid = await service.cameras.offer(req.match_info["mower"], uid, offer, stream)
        if sid is None:
            return web.Response(status=code, text=body)
        return web.Response(
            status=201,
            text=body,
            content_type="application/sdp",
            headers={"Location": f"/whep/session/{sid}"},
        )

    async def whep_patch(_req: web.Request) -> web.Response:
        # Agora kennt kein Nachreichen von Kandidaten; go2rtc schickt sie ohnehin im Angebot mit.
        return web.Response(status=204)

    async def whep_delete(req: web.Request) -> web.Response:
        closed = await service.cameras.close_sid(req.match_info["sid"])
        return web.Response(status=200 if closed else 404)

    app.router.add_get("/health", health)
    app.router.add_get("/status", status)
    app.router.add_get("/map", map_)
    app.router.add_post("/action", action)
    app.router.add_patch("/whep/session/{sid}", whep_patch)
    app.router.add_delete("/whep/session/{sid}", whep_delete)
    app.router.add_post("/whep/{mower}/{uid}", whep_offer)

    async def on_startup(_app: web.Application) -> None:
        await service.start()
        if os.environ.get("MOWER_PARENT_WATCH") == "1":
            _app["parent_watch"] = asyncio.create_task(_exit_with_parent(os.getppid()))

    async def on_cleanup(_app: web.Application) -> None:
        await service.stop()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


async def _exit_with_parent(parent: int) -> None:
    """Beendet den Dienst, wenn der Hub-Prozess weg ist (sonst liefe alter Code weiter)."""
    while True:
        await asyncio.sleep(5)
        if os.getppid() != parent:
            LOG.info("Hub-Prozess beendet, Maeher-Dienst beendet sich")
            os._exit(0)


def _dumps(obj: Any) -> str:
    return json.dumps(obj, default=_jsonable, ensure_ascii=False)


def main() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_ScrubFormatter("%(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=os.environ.get("MOWER_LOG_LEVEL", "INFO"), handlers=[handler])
    # Auch ein unerwarteter Absturz landet im Hub-Log, also ebenfalls maskiert.
    sys.excepthook = lambda typ, val, tb: sys.stderr.write(
        _scrub("".join(traceback.format_exception(typ, val, tb)))
    )
    for noisy in ("pymammotion", "aiomqtt", "paho", "aiohttp.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    web.run_app(build_app(MowerService()), host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
