"""Mammotion-Sidecar fuer den EMP-Access-Hub.

Spricht ueber PyMammotion (inoffiziell, Community) mit der Mammotion-Cloud und
stellt dem Hub eine kleine HTTP-API auf 127.0.0.1 bereit:

    GET  /health            Lebenszeichen
    GET  /status            Login-Zustand und alle Maeher (Status, Akku, Aufgaben, Zonen)
    GET  /map?mower=NAME     GeoJSON der Karte (Zonen, Station, Maeher-Position)
    POST /action            {"mower", "action", "planId"?, "enabled"?}

Wichtig fuer den Account: Mammotion sperrt Konten, die sich staendig neu mit
Passwort anmelden. Deshalb meldet sich der Dienst genau einmal an, speichert die
Sitzung (.cache/session.json, nur fuer den Benutzer lesbar) und stellt sie bei
jedem Neustart wieder her. Scheitert ein Login, wird nur selten und begrenzt
erneut versucht; ein abgelehntes Passwort wird nie wiederholt.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import sys
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from aiohttp import ClientSession, web

from pymammotion.client import MammotionClient
from pymammotion.data.error_codes import describe as describe_error
from pymammotion.messaging.command_queue import Priority
from pymammotion.transport.base import LoginFailedError
from pymammotion.utility.constant.device_enums import WorkMode
from pymammotion.utility.device_type import DeviceType

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
            if EMAIL:
                msg = msg.replace(EMAIL, _mask(EMAIL))
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
                mowers.append(_mower_payload(handle))
            except Exception as err:  # noqa: BLE001
                LOG.debug("Status fuer %s nicht lesbar: %s", handle.device_name, err)
                mowers.append({"name": handle.device_name, "error": str(err)})
        return {
            "state": self.state,
            "error": self.error,
            "account": _mask(EMAIL) if EMAIL else None,
            "loggedInAt": self.logged_in_at,
            "lastPollAt": self.last_poll_at,
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

    app.router.add_get("/health", health)
    app.router.add_get("/status", status)
    app.router.add_get("/map", map_)
    app.router.add_post("/action", action)

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
    logging.basicConfig(
        level=os.environ.get("MOWER_LOG_LEVEL", "INFO"),
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    for noisy in ("pymammotion", "aiomqtt", "paho", "aiohttp.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    web.run_app(build_app(MowerService()), host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
