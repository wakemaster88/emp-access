"""
EMP Access – Raspberry Pi Audio Player Main Loop

Ablauf:
1. Konfiguration laden (audio-config.json)
2. Musikquelle starten – mpv lokal oder Snapclient bei synchronen Zonen
3. Zonenzustand vom Server holen und Wiedergabe wiederherstellen
4. Jobs pollen und der Reihe nach abarbeiten (Durchsagen mit Vorrang)
5. Hintergrund: Heartbeat, Auto-Update, systemd-Watchdog
"""
from __future__ import annotations

import itertools
import logging
import os
import queue
import signal
import socket
import sys
import threading
import time
from datetime import datetime
from typing import Optional

from emp_audio import VERSION
from emp_audio.api_client import ApiClient
from emp_audio.cache import FileCache
from emp_audio.chime import ensure_chime
from emp_audio.config import Config
from emp_audio.player import MusicPlayer, SpeechPlayer
from emp_audio.snapcast import SnapcastMusic
from emp_audio.updater import check_and_update, restart_service

LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"

# systemd nimmt alles, was der Dienst ausgibt, mit derselben Prioritaet ins
# Journal – die Ebene aus Python sieht es nicht. Ein Praefix <N> je Zeile setzt
# sie richtig, damit `journalctl -p warning` wirklich nur Probleme zeigt.
JOURNAL_PRIORITY = {
    logging.CRITICAL: 2,
    logging.ERROR: 3,
    logging.WARNING: 4,
    logging.INFO: 6,
    logging.DEBUG: 7,
}


class JournalFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return f"<{JOURNAL_PRIORITY.get(record.levelno, 6)}>{super().format(record)}"


def _setup_logging() -> None:
    # JOURNAL_STREAM setzt systemd; von Hand gestartet wuerde das Praefix nur
    # die Ausgabe verschandeln.
    formatter = JournalFormatter if os.environ.get("JOURNAL_STREAM") else logging.Formatter
    handler = logging.StreamHandler()
    handler.setFormatter(formatter(LOG_FORMAT, datefmt="%H:%M:%S"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])


_setup_logging()
logger = logging.getLogger("emp.audio.main")

# Ab dieser Priorität unterbricht eine Durchsage eine bereits laufende Ansage.
EMERGENCY_PRIORITY = 100


def _sd_notify(state: str):
    """Send notification to systemd (if running under systemd)."""
    try:
        addr = os.environ.get("NOTIFY_SOCKET")
        if not addr:
            return
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        if addr.startswith("@"):
            addr = "\0" + addr[1:]
        sock.sendto(state.encode(), addr)
        sock.close()
    except Exception:
        pass


def _is_quiet_now(quiet_from: Optional[str], quiet_to: Optional[str]) -> bool:
    """Ruhezeit prüfen; das Fenster darf über Mitternacht laufen."""
    if not quiet_from or not quiet_to:
        return False
    now = datetime.now().strftime("%H:%M")
    if quiet_from <= quiet_to:
        return quiet_from <= now < quiet_to
    return now >= quiet_from or now < quiet_to


class EmpAudio:
    def __init__(self):
        self.config = Config()
        self.api: Optional[ApiClient] = None
        self.cache: Optional[FileCache] = None
        self.music = None
        self.speech: Optional[SpeechPlayer] = None
        self.chime_path: Optional[str] = None

        self._running = False
        self._jobs: queue.PriorityQueue = queue.PriorityQueue()
        self._job_sequence = itertools.count()
        self._seen_jobs: set[int] = set()

        self._zone: dict = {}
        self._zone_lock = threading.Lock()
        self._restored = False

    # ── Start ────────────────────────────────────────────────────────────────

    def start(self):
        logger.info("═══════════════════════════════════════")
        logger.info("  EMP Access Audio v%s", VERSION)
        logger.info("═══════════════════════════════════════")

        self._running = True
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)
        _sd_notify("READY=1")

        if not self.config.is_configured:
            logger.error("Keine Konfiguration vorhanden.")
            logger.error(
                "Setup ausführen: /opt/emp-audio/venv/bin/python -m emp_audio.setup '<JSON aus dem Dashboard>'"
            )
            sys.exit(1)

        self.api = ApiClient(
            server_url=self.config.server_url,
            api_token=self.config.api_token,
            device_id=self.config.device_id,
        )
        self.cache = FileCache(max_mb=int(self.config.cache_max_mb))
        self.chime_path = ensure_chime()

        logger.info("Server: %s", self.config.server_url)
        logger.info("Gerät:  #%d", self.config.device_id)

        if self.api.test_connection():
            logger.info("Serververbindung OK")
        else:
            logger.warning("Server nicht erreichbar – starte trotzdem")

        if self.config.snapserver_host:
            self.music = SnapcastMusic(
                host=self.config.snapserver_host,
                client_id=socket.gethostname(),
                soundcard=self.config.snapclient_soundcard,
            )
            logger.info("Synchrone Wiedergabe über Snapcast: %s", self.config.snapserver_host)
        else:
            self.music = MusicPlayer(audio_device=self.config.audio_device)

        self.music.start()
        self.speech = SpeechPlayer(self.music, audio_device=self.config.audio_device)

        _sd_notify("READY=1")

        threading.Thread(target=self._job_worker, daemon=True).start()
        threading.Thread(target=self._poll_loop, daemon=True).start()
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        threading.Thread(target=self._update_loop, daemon=True).start()
        threading.Thread(target=self._watchdog_loop, daemon=True).start()

        logger.info("Abspieler bereit")

        try:
            while self._running:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self._cleanup()

    # ── Server-Abgleich ──────────────────────────────────────────────────────

    def _poll_loop(self):
        interval = max(3, int(self.config.job_poll_interval))
        while self._running:
            try:
                if self.api:
                    state = self.api.fetch_state()
                    if state:
                        # Jobs zuerst: der Server hat sie beim GET bereits als
                        # zugestellt markiert, sie dürfen also nicht hinter dem
                        # Zonenabgleich hängen bleiben.
                        self._enqueue_jobs(state.get("jobs") or [])
                        self._apply_zone(state.get("zone") or {})
            except Exception as e:
                logger.debug("Job-Poll: %s", e)

            for _ in range(interval):
                if not self._running:
                    return
                time.sleep(1)

    def _apply_zone(self, zone: dict):
        if not zone:
            return
        with self._zone_lock:
            previous = self._zone
            self._zone = zone

        if not zone.get("isActive", True):
            if self.music and self.music.is_playing:
                logger.info("Zone deaktiviert – Wiedergabe wird beendet")
                self.music.stop()
            return

        volume = zone.get("volume")
        if isinstance(volume, int) and self.music and volume != self.music.volume:
            self.music.set_volume(volume)

        if not self._restored:
            self._restored = True
            self._restore_source(zone)
        elif previous.get("id") != zone.get("id"):
            self._restore_source(zone)

    def _restore_source(self, zone: dict):
        """
        Nach einem Neustart soll die Zone wieder das spielen, was im Dashboard
        hinterlegt ist – ohne dass jemand manuell auf „Play" drücken muss.

        Läuft in einem eigenen Thread, weil das Vorladen einer großen Playlist
        dauern kann und der Poll-Thread währenddessen keine Durchsagen
        verpassen darf.
        """
        threading.Thread(target=self._restore_source_blocking, args=(zone,), daemon=True).start()

    def _restore_source_blocking(self, zone: dict):
        source = zone.get("sourceKind")
        if source == "STREAM" and zone.get("streamUrl"):
            self.music.play_stream(zone["streamUrl"])
        elif source == "PLAYLIST" and zone.get("playlist"):
            if _is_quiet_now(zone.get("quietFrom"), zone.get("quietTo")):
                logger.info("Ruhezeit aktiv – Musik startet nicht")
                return
            tracks = zone["playlist"].get("tracks") or []
            paths = self.cache.ensure_many(t["url"] for t in tracks if t.get("url"))
            if paths:
                self.music.play_files(paths, shuffle=bool(zone["playlist"].get("shuffle")))

    def _enqueue_jobs(self, jobs: list):
        for job in jobs:
            job_id = job.get("id")
            if not isinstance(job_id, int) or job_id in self._seen_jobs:
                continue
            self._seen_jobs.add(job_id)

            payload = job.get("payload") or {}
            priority = payload.get("priority") if isinstance(payload, dict) else None
            priority = priority if isinstance(priority, int) else 0

            # Notfalldurchsagen dürfen nicht hinter einer laufenden Ansage warten.
            if job.get("kind") == "ANNOUNCE" and priority >= EMERGENCY_PRIORITY and self.speech:
                self.speech.interrupt()

            self._jobs.put((-priority, next(self._job_sequence), job))
            logger.info("Job #%d angenommen: %s", job_id, job.get("kind"))

        # Der Speicher darf nicht unbegrenzt wachsen; die IDs sind aufsteigend,
        # ältere können also gefahrlos vergessen werden.
        if len(self._seen_jobs) > 500:
            for old in sorted(self._seen_jobs)[:250]:
                self._seen_jobs.discard(old)

    # ── Jobs ─────────────────────────────────────────────────────────────────

    def _job_worker(self):
        while self._running:
            try:
                _, _, job = self._jobs.get(timeout=1)
            except queue.Empty:
                continue

            job_id = job.get("id")
            self._report(job_id, "PLAYING")
            try:
                self._handle_job(job)
                self._report(job_id, "DONE")
            except Exception as e:
                logger.error("Job #%s fehlgeschlagen: %s", job_id, e)
                self._report(job_id, "FAILED", str(e))

    def _report(self, job_id, status: str, error: Optional[str] = None):
        if not self.api or job_id is None:
            return
        report = {"id": job_id, "status": status}
        if error:
            report["errorMessage"] = error
        self.api.report_jobs([report])

    def _handle_job(self, job: dict):
        kind = job.get("kind")
        payload = job.get("payload") or {}

        with self._zone_lock:
            zone = dict(self._zone)

        if not zone.get("isActive", True):
            raise RuntimeError("Zone ist deaktiviert")

        if kind == "ANNOUNCE":
            self._do_announce(payload, zone)
        elif kind == "PLAY":
            self._do_play(payload, zone)
        elif kind == "STOP":
            self.music.stop()
        elif kind == "VOLUME":
            volume = payload.get("volume")
            if not isinstance(volume, int):
                raise ValueError("Lautstärke fehlt")
            self.music.set_volume(volume)
            logger.info("Lautstärke: %d%%", volume)
        elif kind == "SYNC_LIBRARY":
            self._do_sync_library(zone)
        else:
            raise ValueError(f"Unbekannter Job-Typ: {kind}")

    def _do_announce(self, payload: dict, zone: dict):
        url = payload.get("url")
        if not url:
            raise ValueError("Durchsage ohne Audiodatei")

        path = self.cache.ensure(url)
        if not path:
            raise RuntimeError("Audiodatei konnte nicht geladen werden")

        volume = zone.get("announcementVolume")
        duck = zone.get("duckVolume")
        logger.info("Durchsage wird abgespielt")
        completed = self.speech.play(
            path=path,
            volume=volume if isinstance(volume, int) else 80,
            duck_volume=duck if isinstance(duck, int) else 20,
            chime_path=self.chime_path if payload.get("chime") else None,
            repeat=payload.get("repeat") if isinstance(payload.get("repeat"), int) else 1,
        )
        if not completed:
            raise RuntimeError("Durch höher priorisierte Durchsage unterbrochen")

    def _do_play(self, payload: dict, zone: dict):
        volume = payload.get("volume")
        if isinstance(volume, int):
            self.music.set_volume(volume)

        if payload.get("kind") == "STREAM":
            url = payload.get("url")
            if not url:
                raise ValueError("Stream ohne URL")
            self.music.play_stream(url)
            return

        if _is_quiet_now(zone.get("quietFrom"), zone.get("quietTo")):
            logger.info("Ruhezeit aktiv – Musik wird nicht gestartet")
            return

        tracks = payload.get("tracks") or []
        paths = self.cache.ensure_many(t["url"] for t in tracks if t.get("url"))
        if not paths:
            raise RuntimeError("Keine abspielbaren Titel in der Playlist")
        self.music.play_files(paths, shuffle=bool(payload.get("shuffle")))

    def _do_sync_library(self, zone: dict):
        playlist = zone.get("playlist") or {}
        tracks = playlist.get("tracks") or []
        urls = [t["url"] for t in tracks if t.get("url")]
        paths = self.cache.ensure_many(urls)
        logger.info("Bibliothek abgeglichen: %d von %d Titeln lokal", len(paths), len(urls))

    # ── Hintergrund ──────────────────────────────────────────────────────────

    def _heartbeat_loop(self):
        while self._running:
            try:
                if self.api and self.music:
                    self.api.send_heartbeat(
                        is_playing=self.music.is_playing,
                        current_title=self.music.current_title(),
                        volume=self.music.volume,
                        system_info=self._system_info(),
                    )
            except Exception as e:
                logger.warning("Heartbeat-Fehler: %s", e)

            for _ in range(int(self.config.heartbeat_interval)):
                if not self._running:
                    return
                time.sleep(1)

    def _system_info(self) -> dict:
        try:
            from emp_scanner.sysinfo import collect_system_info

            info = collect_system_info()
            info.pop("scanner_version", None)
        except Exception:
            info = {}
        info["audio_version"] = VERSION
        if self.cache:
            free = self.cache.free_mb()
            if free is not None:
                info["cache_free_mb"] = free
        return info

    def _update_loop(self):
        time.sleep(60)
        while self._running:
            try:
                if check_and_update():
                    logger.info("Update installiert – starte neu...")
                    restart_service()
                    return
            except Exception as e:
                logger.warning("Update-Prüfung fehlgeschlagen: %s", e)

            for _ in range(int(self.config.update_check_interval)):
                if not self._running:
                    return
                time.sleep(1)

    def _watchdog_loop(self):
        while self._running:
            _sd_notify("WATCHDOG=1")
            time.sleep(30)

    # ── Ende ─────────────────────────────────────────────────────────────────

    def _shutdown(self, signum, frame):
        logger.info("Shutdown-Signal empfangen")
        self._running = False

    def _cleanup(self):
        logger.info("Aufräumen...")
        if self.speech:
            self.speech.interrupt()
        if self.music:
            self.music.cleanup()
        logger.info("Beendet")


def main():
    app = EmpAudio()
    app.start()


if __name__ == "__main__":
    main()
