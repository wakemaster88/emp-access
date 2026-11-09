"""
Auto-update via git pull.
Checks for new commits and restarts the scanner service if updated.

Sicherungen:
- Vor dem Update wird der bisherige Commit gemerkt. Nach dem Update läuft eine
  Vorab-Prüfung (Syntax aller Module + Import von emp_scanner.main). Schlägt sie
  fehl, wird auf den bisherigen Commit zurückgesetzt und NICHT neu gestartet.
- Optional (Standard: aus): nur GPG-signierte Commits einspielen. Aktivieren über
  die Umgebungsvariable EMP_UPDATE_VERIFY_SIGNATURE=1 oder
  "update_verify_signature": true in config.json (siehe README).
"""

import json
import subprocess
import logging
import os
import sys

from emp_scanner.config import CONFIG_PATH

logger = logging.getLogger("emp.updater")

PACKAGE_DIR = os.path.dirname(os.path.dirname(__file__))
PROJECT_DIR = os.path.dirname(PACKAGE_DIR)  # git root (/opt/emp-scanner)

VERIFY_ENV = "EMP_UPDATE_VERIFY_SIGNATURE"
PREFLIGHT_TIMEOUT = 120


def signature_check_enabled() -> bool:
    """Signaturprüfung ist nur aktiv, wenn sie ausdrücklich eingeschaltet wurde."""
    if os.environ.get(VERIFY_ENV, "").strip().lower() in ("1", "true", "yes", "on"):
        return True
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f).get("update_verify_signature") is True
    except Exception:
        return False


def verify_commit(commit: str, previous: str) -> bool:
    """
    Prüft, ob `commit` eingespielt werden darf (nur bei aktiver Signaturprüfung):
    gültige GPG-Signatur (Schlüssel im Schlüsselbund von root) und Fast-Forward
    vom bisherigen Stand – so lässt sich das Gerät auch nicht auf einen älteren
    signierten Commit zurückdrehen.
    """
    try:
        verify = subprocess.run(
            ["git", "verify-commit", commit],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if verify.returncode != 0:
            logger.error(
                "Update abgelehnt: Commit %s hat keine gültige Signatur (%s)",
                commit[:8], verify.stderr.strip()[-200:],
            )
            return False
        ancestor = subprocess.run(
            ["git", "merge-base", "--is-ancestor", previous, commit],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if ancestor.returncode != 0:
            logger.error(
                "Update abgelehnt: %s ist kein Fast-Forward von %s", commit[:8], previous[:8],
            )
            return False
        return True
    except Exception as e:
        logger.error("Update abgelehnt: Signaturprüfung fehlgeschlagen: %s", e)
        return False


def preflight_check() -> bool:
    """
    Vorab-Prüfung des frisch ausgecheckten Codes, bevor der Dienst darauf neu startet:
    1. jede .py-Datei des Pakets muss sich kompilieren lassen,
    2. emp_scanner.main muss sich in einem frischen Interpreter importieren lassen
       (ohne Hardware möglich: GPIO/evdev sind beim Import optional).
    """
    package = os.path.join(PACKAGE_DIR, "emp_scanner")
    try:
        for root, _dirs, files in os.walk(package):
            for name in files:
                if not name.endswith(".py"):
                    continue
                path = os.path.join(root, name)
                with open(path, "rb") as f:
                    compile(f.read(), path, "exec")
    except Exception as e:
        logger.error("Vorab-Prüfung: Syntaxfehler im neuen Stand: %s", e)
        return False

    try:
        check = subprocess.run(
            [sys.executable, "-c", "import emp_scanner.main"],
            capture_output=True, text=True, cwd=PACKAGE_DIR, timeout=PREFLIGHT_TIMEOUT,
        )
    except Exception as e:
        logger.error("Vorab-Prüfung: Import-Test nicht ausführbar: %s", e)
        return False
    if check.returncode != 0:
        logger.error(
            "Vorab-Prüfung: emp_scanner.main lässt sich nicht importieren: %s",
            check.stderr.strip()[-500:],
        )
        return False
    return True


def rollback(commit: str) -> bool:
    """Arbeitsverzeichnis auf den bisherigen Commit zurücksetzen."""
    try:
        reset = subprocess.run(
            ["git", "reset", "--hard", commit],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if reset.returncode == 0:
            logger.warning("Rollback auf %s durchgeführt", commit[:8])
            return True
        logger.error("Rollback auf %s fehlgeschlagen: %s", commit[:8], reset.stderr.strip())
    except Exception as e:
        logger.error("Rollback auf %s fehlgeschlagen: %s", commit[:8], e)
    return False


def get_current_hash() -> str:
    """Get current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=10,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def check_and_update() -> bool:
    """
    Fetch latest changes and update if new commits available.
    Returns True if an update was applied.
    """
    try:
        # Fetch latest
        fetch = subprocess.run(
            ["git", "fetch", "origin"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if fetch.returncode != 0:
            logger.warning("git fetch fehlgeschlagen: %s", fetch.stderr.strip())
            return False

        # Compare local vs remote
        local_hash = get_current_hash()
        remote = subprocess.run(
            ["git", "rev-parse", "origin/main"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=10,
        )
        remote_hash = remote.stdout.strip()

        if not remote_hash or local_hash == remote_hash:
            logger.debug("Kein Update verfügbar")
            return False

        if not local_hash:
            # Ohne bekannten Ausgangsstand wäre kein Rollback möglich.
            logger.warning("Aktueller Commit unbekannt – Update übersprungen")
            return False

        logger.info("Update verfügbar: %s → %s", local_hash[:8], remote_hash[:8])

        # Optional: nur signierte Commits einspielen (Standard: aus).
        if signature_check_enabled() and not verify_commit(remote_hash, local_hash):
            return False

        # Welche Dateien unter raspberry-pi/ aendern sich? Ein Commit, der nur
        # die Cloud betrifft, soll den Pi nicht neu starten.
        diff = subprocess.run(
            ["git", "diff", "--name-only", local_hash, remote_hash, "--", "raspberry-pi"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        changed = [f for f in diff.stdout.split("\n") if f.strip()] if diff.returncode == 0 else ["raspberry-pi"]
        requirements_changed = any(f.endswith("requirements.txt") for f in changed)

        # Hard reset to remote (avoids merge conflicts from local changes).
        # Auf genau den geprüften Commit, nicht auf ein evtl. weitergewandertes origin/main.
        reset = subprocess.run(
            ["git", "reset", "--hard", remote_hash],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=30,
        )
        if reset.returncode != 0:
            logger.error("git reset fehlgeschlagen: %s", reset.stderr.strip())
            return False

        # Install updated dependencies (nur wenn sich die Liste geaendert hat)
        req_file = os.path.join(PACKAGE_DIR, "requirements.txt")
        if requirements_changed and os.path.exists(req_file):
            try:
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-q", "-r", req_file],
                    capture_output=True, cwd=PROJECT_DIR, timeout=120,
                )
            except Exception as e:
                # Nicht abbrechen: die Vorab-Prüfung unten entscheidet, ob der Stand lauffähig ist.
                logger.warning("pip install fehlgeschlagen: %s", e)

        if not changed:
            logger.info("Update eingespielt (nur Cloud-Aenderungen) – kein Neustart noetig")
            return False

        # Vorab-Prüfung: nie auf kaputten Code neu starten.
        if not preflight_check():
            logger.error(
                "Update %s verworfen – zurück auf %s, kein Neustart",
                remote_hash[:8], local_hash[:8],
            )
            rollback(local_hash)
            return False

        logger.info("Update erfolgreich angewendet (%d Pi-Dateien geaendert)", len(changed))
        return True

    except Exception as e:
        logger.error("Update-Fehler: %s", e)
        return False


def restart_service():
    """Restart the scanner systemd service."""
    try:
        subprocess.run(
            ["sudo", "systemctl", "restart", "emp-scanner"],
            timeout=10,
        )
        logger.info("Service neugestartet")
    except Exception as e:
        logger.error("Service-Neustart fehlgeschlagen: %s", e)


def run_update_check():
    """Single update check – called by systemd timer or manually."""
    logger.info("Prüfe auf Updates...")
    if check_and_update():
        restart_service()
