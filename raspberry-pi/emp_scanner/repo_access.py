"""
Lesezugang zum GitHub-Repository per Deploy-Key (fuer ein privates Repo).

Ablauf, ohne dass jemand auf den Pi muss:
1. Beim ersten Update-Lauf erzeugt der Pi einen eigenen SSH-Schluessel
   (/etc/emp-access/github_deploy_ed25519). Der oeffentliche Teil geht im
   Heartbeat an die Cloud (Einstellungen -> „Update-Zugang der Geraete“).
2. Der Admin traegt ihn bei GitHub als Deploy-Key ein (nur Lesen).
3. Bei jedem Update-Lauf prueft der Pi, ob der Schluessel angenommen wird
   (`git ls-remote` ueber SSH). Sobald das klappt, stellt er `origin` auf SSH
   um und setzt `core.sshCommand` im Repository. Danach laufen fetch/reset
   wie bisher, nur eben ueber SSH.

Solange der Schluessel nicht eingetragen ist, bleibt alles beim alten
(HTTPS). Ein Fehler hier blockiert nie das eigentliche Update.

SSH laeuft ueber ssh.github.com:443, damit es auch hinter Firewalls geht,
die Port 22 sperren. Der Host-Schluessel von GitHub ist fest hinterlegt
(kein „trust on first use“).
"""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import subprocess
import time

logger = logging.getLogger("emp.repo_access")

KEY_DIR = "/etc/emp-access"
KEY_PATH = os.path.join(KEY_DIR, "github_deploy_ed25519")
KNOWN_HOSTS_PATH = os.path.join(KEY_DIR, "github_known_hosts")
STATUS_PATH = os.path.join(KEY_DIR, "repo_access.json")

SSH_HOST = "ssh.github.com"
SSH_PORT = 443

# Oeffentlicher ed25519-Host-Schluessel von github.com (gilt auch fuer
# ssh.github.com:443). Fingerprint SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU
GITHUB_ED25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"


def ssh_command() -> str:
    return (
        f"ssh -i {KEY_PATH} -o IdentitiesOnly=yes -o BatchMode=yes"
        f" -o UserKnownHostsFile={KNOWN_HOSTS_PATH} -o StrictHostKeyChecking=yes"
        " -o ConnectTimeout=15"
    )


def is_ssh_url(url: str) -> bool:
    return url.startswith("ssh://") or bool(re.match(r"^[\w.-]+@[\w.-]+:", url))


def ssh_url_for(url: str) -> str | None:
    """https://github.com/owner/repo(.git) -> ssh://git@ssh.github.com:443/owner/repo.git"""
    m = re.match(r"^https://(?:[^@/]+@)?github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", url.strip())
    if not m:
        return None
    return f"ssh://git@{SSH_HOST}:{SSH_PORT}/{m.group(1)}/{m.group(2)}.git"


def _git(project_dir: str, *args: str, timeout: int = 30, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, cwd=project_dir, timeout=timeout, env=env,
    )


def ensure_key() -> str | None:
    """Schluessel und known_hosts anlegen (falls noetig). Liefert den oeffentlichen Schluessel."""
    os.makedirs(KEY_DIR, mode=0o755, exist_ok=True)
    with open(KNOWN_HOSTS_PATH, "w") as f:
        f.write(f"github.com {GITHUB_ED25519}\n[{SSH_HOST}]:{SSH_PORT} {GITHUB_ED25519}\n")
    if not os.path.exists(KEY_PATH):
        comment = f"emp-access {socket.gethostname()}"
        subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", KEY_PATH],
            capture_output=True, text=True, timeout=30, check=True,
        )
        os.chmod(KEY_PATH, 0o600)
        logger.info("Deploy-Key erzeugt: %s.pub", KEY_PATH)
    try:
        with open(KEY_PATH + ".pub") as f:
            return f.read().strip() or None
    except OSError:
        return None


def _write_status(status: dict) -> None:
    try:
        tmp = STATUS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(status, f)
        os.chmod(tmp, 0o644)
        os.replace(tmp, STATUS_PATH)
    except OSError as e:
        logger.debug("Status nicht geschrieben: %s", e)


def ensure_repo_access(project_dir: str) -> dict:
    """
    Schluessel sicherstellen und – sobald GitHub ihn annimmt – auf SSH umstellen.
    Gibt den Status zurueck (mode "ssh" oder "https") und legt ihn fuer den
    Heartbeat in STATUS_PATH ab.
    """
    status: dict = {"mode": "https", "checked_at": int(time.time())}
    try:
        public_key = ensure_key()
        if public_key:
            status["public_key"] = public_key
        url = _git(project_dir, "remote", "get-url", "origin", timeout=10).stdout.strip()
        if is_ssh_url(url):
            # Bereits umgestellt; sshCommand nachziehen, falls es fehlt.
            _git(project_dir, "config", "core.sshCommand", ssh_command(), timeout=10)
            status["mode"] = "ssh"
        else:
            target = ssh_url_for(url)
            if not target:
                status["error"] = "Remote ist kein GitHub-Repository"
            elif public_key:
                env = {**os.environ, "GIT_SSH_COMMAND": ssh_command()}
                probe = _git(project_dir, "ls-remote", target, "HEAD", timeout=40, env=env)
                if probe.returncode == 0:
                    _git(project_dir, "config", "core.sshCommand", ssh_command(), timeout=10)
                    _git(project_dir, "remote", "set-url", "origin", target, timeout=10)
                    status["mode"] = "ssh"
                    logger.info("Repo-Zugang auf SSH (Deploy-Key) umgestellt: %s", target)
                else:
                    # Normalfall, bis der Schluessel bei GitHub eingetragen ist.
                    status["error"] = (probe.stderr.strip().splitlines() or ["SSH abgelehnt"])[-1][:200]
    except Exception as e:  # nie das Update blockieren
        status["error"] = str(e)[:200]
        logger.warning("Repo-Zugang nicht geprueft: %s", e)
    _write_status(status)
    return status


def read_status() -> dict | None:
    """Fuer den Heartbeat: zuletzt geprueften Zustand plus oeffentlichen Schluessel."""
    status: dict = {}
    try:
        with open(STATUS_PATH) as f:
            status = json.load(f)
    except (OSError, ValueError):
        pass
    if "public_key" not in status:
        try:
            with open(KEY_PATH + ".pub") as f:
                status["public_key"] = f.read().strip()
        except OSError:
            pass
    return status or None
