"""
Auto-update via git pull.

Gleiches Verfahren wie beim Scanner, nur mit eigenem Service-Namen und eigener
Requirements-Datei.
"""

import logging
import os
import subprocess
import sys

logger = logging.getLogger("emp.audio.updater")

PACKAGE_DIR = os.path.dirname(os.path.dirname(__file__))  # <repo>/raspberry-pi
PROJECT_DIR = os.path.dirname(PACKAGE_DIR)  # git root (/opt/emp-audio)
SERVICE_NAME = "emp-audio"


def get_current_hash() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=10,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def check_and_update() -> bool:
    """Returns True, wenn ein Update eingespielt wurde."""
    try:
        fetch = subprocess.run(
            ["git", "fetch", "origin"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if fetch.returncode != 0:
            logger.warning("git fetch fehlgeschlagen: %s", fetch.stderr.strip())
            return False

        local_hash = get_current_hash()
        remote = subprocess.run(
            ["git", "rev-parse", "origin/main"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=10,
        )
        remote_hash = remote.stdout.strip()

        if not remote_hash or local_hash == remote_hash:
            logger.debug("Kein Update verfügbar")
            return False

        logger.info("Update verfügbar: %s → %s", local_hash[:8], remote_hash[:8])

        reset = subprocess.run(
            ["git", "reset", "--hard", "origin/main"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if reset.returncode != 0:
            logger.error("git reset fehlgeschlagen: %s", reset.stderr.strip())
            return False

        req_file = os.path.join(PACKAGE_DIR, "requirements-audio.txt")
        if os.path.exists(req_file):
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "-r", req_file],
                capture_output=True, cwd=PROJECT_DIR, timeout=120,
            )

        logger.info("Update erfolgreich angewendet")
        return True

    except Exception as e:
        logger.error("Update-Fehler: %s", e)
        return False


def restart_service():
    try:
        subprocess.run(["sudo", "systemctl", "restart", SERVICE_NAME], timeout=10)
        logger.info("Service neugestartet")
    except Exception as e:
        logger.error("Service-Neustart fehlgeschlagen: %s", e)


def run_update_check():
    """Einzelner Update-Lauf – für systemd-Timer oder manuellen Aufruf."""
    logger.info("Prüfe auf Updates...")
    if check_and_update():
        restart_service()
