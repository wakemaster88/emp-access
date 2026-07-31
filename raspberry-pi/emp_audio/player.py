"""
Wiedergabe über mpv.

Zwei getrennte Wege, damit eine Durchsage die Musik nicht abwürgt:

* Musik läuft in einer dauerhaft geöffneten mpv-Instanz, die über einen
  IPC-Socket gesteuert wird (Lautstärke, Playlist, Stopp).
* Durchsagen laufen als kurzlebiger zweiter mpv-Prozess. Währenddessen wird die
  Musik abgesenkt (Ducking) und danach wieder hochgefahren.

Damit beide gleichzeitig auf die Soundkarte kommen, braucht das System einen
Mixer. Der Dienst läuft als root und erreicht PipeWire deshalb nicht – das
läuft in der Sitzung des angemeldeten Benutzers. Das Installationsskript legt
darum ein ALSA-Mischgerät (dmix) als Standardausgabe an, das ohne Sitzung
funktioniert.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import threading
import time
from typing import Optional

logger = logging.getLogger("emp.audio.player")

MUSIC_SOCKET = "/tmp/emp-audio-music.sock"
IPC_TIMEOUT = 3


class PlaybackError(Exception):
    """Wiedergabe fehlgeschlagen – wird im Dashboard am Job sichtbar."""


def _log_mpv(text: str) -> None:
    """
    mpv-Meldungen ins Journal spiegeln.

    Ohne das bleibt der haeufigste Fehler unsichtbar: bekommt mpv die
    Soundkarte nicht auf, laeuft der Dienst munter weiter und meldet sogar
    Wiedergabe, es kommt nur kein Ton.
    """
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            logger.warning("mpv: %s", stripped)


class MusicPlayer:
    """Dauerhaft laufende mpv-Instanz für Hintergrundmusik und Webradio."""

    def __init__(self, audio_device: str = "", socket_path: str = MUSIC_SOCKET):
        self.audio_device = audio_device
        self.socket_path = socket_path
        self._process: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        # Sollwert aus der Zonenkonfiguration. Beim Ducking geht nur der an mpv
        # gesendete Pegel runter, nicht der Sollwert – sonst würde ein Abgleich
        # mit dem Server mitten in der Durchsage die Musik wieder hochziehen.
        self._volume = 50
        self._duck_volume = 20
        self._ducked = False
        self._playing = False

    def start(self) -> bool:
        if self._process and self._process.poll() is None:
            return True

        if os.path.exists(self.socket_path):
            try:
                os.unlink(self.socket_path)
            except OSError:
                pass

        cmd = [
            "mpv",
            "--idle=yes",
            "--no-video",
            # Kein --no-terminal: das verschluckt auch die Fehlermeldungen.
            # Tastatureingaben braucht ein Dienst nicht, Meldungen sehr wohl.
            "--no-input-terminal",
            "--msg-level=all=warn",
            "--gapless-audio=yes",
            "--loop-playlist=inf",
            f"--input-ipc-server={self.socket_path}",
            f"--volume={self._volume}",
        ]
        if self.audio_device:
            cmd.append(f"--audio-device={self.audio_device}")

        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            logger.error("mpv ist nicht installiert – keine Wiedergabe möglich")
            return False

        # Die Pipe muss gelesen werden, sonst blockiert mpv, sobald der Puffer
        # voll ist. Der Thread endet von selbst, wenn mpv sich beendet.
        threading.Thread(
            target=self._pump_messages, args=(self._process.stdout,), daemon=True
        ).start()

        # mpv legt den Socket erst kurz nach dem Start an.
        for _ in range(50):
            if os.path.exists(self.socket_path):
                logger.info("Musik-Player bereit")
                return True
            time.sleep(0.1)

        logger.error("mpv-IPC-Socket wurde nicht angelegt")
        return False

    def _pump_messages(self, stream) -> None:
        try:
            for line in stream:
                _log_mpv(line)
        except Exception as e:
            logger.debug("mpv-Meldungen nicht mehr lesbar: %s", e)

    def _command(self, command: list) -> Optional[dict]:
        with self._lock:
            try:
                client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                client.settimeout(IPC_TIMEOUT)
                client.connect(self.socket_path)
                client.sendall((json.dumps({"command": command}) + "\n").encode())

                # mpv sendet ggf. mehrere Zeilen (Events); die erste Antwort mit
                # "error" gehört zu unserem Kommando.
                buffer = b""
                deadline = time.time() + IPC_TIMEOUT
                while time.time() < deadline:
                    chunk = client.recv(4096)
                    if not chunk:
                        break
                    buffer += chunk
                    for line in buffer.split(b"\n"):
                        if not line.strip():
                            continue
                        try:
                            payload = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if "error" in payload:
                            client.close()
                            return payload
                client.close()
            except Exception as e:
                logger.debug("IPC-Kommando %s: %s", command[0] if command else "?", e)
            return None

    def _apply_volume(self) -> None:
        level = self._duck_volume if self._ducked else self._volume
        self._command(["set_property", "volume", level])

    def set_volume(self, volume: int) -> None:
        self._volume = max(0, min(100, int(volume)))
        self._apply_volume()

    def duck(self, duck_volume: int) -> None:
        self._duck_volume = max(0, min(100, int(duck_volume)))
        self._ducked = True
        self._apply_volume()

    def unduck(self) -> None:
        self._ducked = False
        self._apply_volume()

    @property
    def volume(self) -> int:
        return self._volume

    def play_files(self, paths: list[str], shuffle: bool = False) -> bool:
        if not paths:
            return False
        if not self.start():
            return False

        self._command(["playlist-clear"])
        self._command(["loadfile", paths[0], "replace"])
        for path in paths[1:]:
            self._command(["loadfile", path, "append"])
        if shuffle:
            self._command(["playlist-shuffle"])
        self._command(["set_property", "pause", False])
        self._playing = True
        logger.info("Playlist gestartet (%d Titel)", len(paths))
        return True

    def play_stream(self, url: str) -> bool:
        if not self.start():
            return False
        self._command(["playlist-clear"])
        self._command(["loadfile", url, "replace"])
        self._command(["set_property", "pause", False])
        self._playing = True
        logger.info("Stream gestartet: %s", url)
        return True

    def stop(self) -> None:
        self._command(["stop"])
        self._playing = False
        logger.info("Wiedergabe gestoppt")

    @property
    def is_playing(self) -> bool:
        return self._playing

    def current_title(self) -> Optional[str]:
        if not self._playing:
            return None
        result = self._command(["get_property", "media-title"])
        if result and result.get("error") == "success":
            value = result.get("data")
            if isinstance(value, str) and value.strip():
                return value.strip()[:200]
        return None

    def cleanup(self) -> None:
        if self._process and self._process.poll() is None:
            self._command(["quit"])
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()


class SpeechPlayer:
    """Spielt eine Durchsage ab und senkt dabei die Musik ab."""

    def __init__(self, music: MusicPlayer, audio_device: str = ""):
        self.music = music
        self.audio_device = audio_device
        self._process: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._interrupted = False

    def _play_file(self, path: str, volume: int) -> None:
        cmd = [
            "mpv",
            "--no-video",
            "--no-input-terminal",
            "--msg-level=all=warn",
            f"--volume={volume}",
            path,
        ]
        if self.audio_device:
            cmd.append(f"--audio-device={self.audio_device}")
        try:
            with self._lock:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                process = self._process
            # communicate() leert die Pipe und wartet – ein blosses wait() wuerde
            # haengen, sobald mpv genug Meldungen für den Puffer schreibt.
            output, _ = process.communicate()
            returncode = process.returncode
        except FileNotFoundError:
            raise PlaybackError("mpv ist nicht installiert")
        finally:
            with self._lock:
                self._process = None

        if output:
            _log_mpv(output)

        # Negative Codes stammen vom Abbruch durch interrupt() – das ist kein
        # Fehler der Wiedergabe und wird von play() gesondert behandelt.
        if returncode > 0:
            # Die letzte Meldung von mpv sagt meist genau, was fehlt, und landet
            # so auch am Job im Dashboard.
            detail = next(
                (line.strip() for line in reversed((output or "").splitlines()) if line.strip()),
                "",
            )
            raise PlaybackError(
                f"mpv beendete sich mit Code {returncode}" + (f": {detail[:150]}" if detail else "")
            )

    def play(
        self,
        path: str,
        volume: int,
        duck_volume: int,
        chime_path: Optional[str] = None,
        repeat: int = 1,
    ) -> bool:
        """
        Blockiert bis die Ansage durch ist und meldet, ob sie vollständig lief.
        False bedeutet: durch eine höher priorisierte Ansage abgebrochen.
        Bei echten Wiedergabefehlern wird PlaybackError geworfen.

        Die Musik wird vorher abgesenkt und danach zuverlässig wieder
        hochgefahren – auch im Fehlerfall.
        """
        self._interrupted = False
        ducked = False
        try:
            if self.music.is_playing:
                self.music.duck(duck_volume)
                ducked = True
                # Kurz warten, damit die Absenkung hörbar vor der Ansage liegt.
                time.sleep(0.3)

            if chime_path and os.path.exists(chime_path) and not self._interrupted:
                self._play_file(chime_path, volume)

            for index in range(max(1, repeat)):
                if self._interrupted:
                    return False
                if index > 0:
                    time.sleep(0.6)
                self._play_file(path, volume)

            return not self._interrupted
        finally:
            if ducked:
                self.music.unduck()

    def interrupt(self) -> None:
        """Bricht eine laufende Durchsage ab (Notfalldurchsage hat Vorrang)."""
        # Flag zuerst setzen, damit die Wiederholungsschleife auch dann stoppt,
        # wenn gerade zwischen zwei Wiederholungen pausiert wird.
        self._interrupted = True
        with self._lock:
            process = self._process
        if process and process.poll() is None:
            process.terminate()
            logger.info("Laufende Durchsage unterbrochen")
