"""
Lokaler Dateicache.

Jede Datei wird genau einmal heruntergeladen und danach von der SD-Karte
abgespielt. Das hält die Wiedergabe auch dann am Laufen, wenn die
Internetverbindung wegbricht – gerade für Notfalldurchsagen entscheidend.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
from typing import Iterable, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger("emp.audio.cache")

CACHE_DIR = "/var/lib/emp-audio/cache"
DOWNLOAD_TIMEOUT = 60


class FileCache:
    def __init__(self, cache_dir: str = CACHE_DIR, max_mb: int = 2048):
        self.max_bytes = max_mb * 1024 * 1024
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except OSError:
            # Auf dem Pi läuft der Dienst als root; beim Entwickeln lokal nicht.
            cache_dir = os.path.expanduser("~/.cache/emp-audio")
            os.makedirs(cache_dir, exist_ok=True)
            logger.info("Cache liegt unter %s", cache_dir)
        self.cache_dir = cache_dir

    def _path_for(self, url: str) -> str:
        digest = hashlib.sha1(url.encode()).hexdigest()
        suffix = os.path.splitext(urlparse(url).path)[1][:6] or ".mp3"
        return os.path.join(self.cache_dir, f"{digest}{suffix}")

    def get_if_present(self, url: str) -> Optional[str]:
        path = self._path_for(url)
        return path if os.path.exists(path) else None

    def ensure(self, url: str) -> Optional[str]:
        """
        Gibt den lokalen Pfad zurück und lädt die Datei bei Bedarf herunter.
        None, wenn der Download fehlschlägt und nichts im Cache liegt.
        """
        path = self._path_for(url)
        if os.path.exists(path):
            # Zugriffszeit auffrischen, damit der Aufräumlauf aktiv genutzte
            # Dateien zuletzt entfernt.
            try:
                os.utime(path, None)
            except OSError:
                pass
            return path

        try:
            with requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT) as resp:
                if resp.status_code != 200:
                    logger.warning("Download fehlgeschlagen (HTTP %d): %s", resp.status_code, url)
                    return None
                # Erst in eine temporäre Datei schreiben und dann umbenennen –
                # so liegt nie eine halb geladene Datei im Cache.
                fd, tmp_path = tempfile.mkstemp(dir=self.cache_dir, suffix=".part")
                try:
                    with os.fdopen(fd, "wb") as out:
                        for chunk in resp.iter_content(chunk_size=64 * 1024):
                            out.write(chunk)
                    os.replace(tmp_path, path)
                except Exception:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                    raise
        except Exception as e:
            logger.warning("Download-Fehler für %s: %s", url, e)
            return None

        logger.info("Datei geladen: %s", os.path.basename(path))
        self.prune()
        return path

    def ensure_many(self, urls: Iterable[str]) -> list[str]:
        """Lädt mehrere Dateien und gibt die erfolgreich verfügbaren Pfade zurück."""
        paths = []
        for url in urls:
            path = self.ensure(url)
            if path:
                paths.append(path)
        return paths

    def prune(self) -> None:
        """Entfernt die am längsten ungenutzten Dateien, bis das Limit passt."""
        try:
            entries = []
            total = 0
            for name in os.listdir(self.cache_dir):
                full = os.path.join(self.cache_dir, name)
                if not os.path.isfile(full):
                    continue
                stat = os.stat(full)
                entries.append((stat.st_atime, stat.st_size, full))
                total += stat.st_size

            if total <= self.max_bytes:
                return

            entries.sort()
            for _, size, full in entries:
                if total <= self.max_bytes:
                    break
                try:
                    os.unlink(full)
                    total -= size
                    logger.info("Cache aufgeräumt: %s", os.path.basename(full))
                except OSError:
                    pass
        except Exception as e:
            logger.debug("Cache-Aufräumen: %s", e)

    def free_mb(self) -> Optional[float]:
        try:
            usage = shutil.disk_usage(self.cache_dir)
            return round(usage.free / 1024 / 1024, 1)
        except Exception:
            return None
