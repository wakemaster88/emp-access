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

# Ohne Vorgabe arbeitet mpv seine ganze Treiberliste ab und landet als
# root-Dienst am Ende bei Jack und sndio – die gibt es hier nicht, das Ergebnis
# ist Stille. ALSA ist auf dem Pi die richtige Ebene: dort haengt das
# Mischgeraet aus /etc/asound.conf am Standardgeraet.
DEFAULT_AUDIO_DEVICE = "alsa/default"

# Meldungen der Ausgabeschicht ausdruecklich mitnehmen. Sie nennen die Karte und
# den Grund, wenn sie sich nicht oeffnen laesst – ohne das bleibt nur ein
# nutzloses "no sound".
MSG_LEVEL = "all=warn,ao=v"

# Diese Meldung heisst: mpv hat die Soundkarte nicht aufbekommen und gibt fuer
# diese Datei endgueltig auf. Ohne neuen Ladebefehl bleibt die Zone stumm.
AO_FAILED = "Could not open/initialize audio device"
AO_RETRIES = 3
AO_RETRY_DELAY = 5

# Wortmarken, an denen sich eine mpv-Meldung als Problem zu erkennen gibt. Der
# Rest ist Betriebsfunk und gehoert nicht auf WARNING.
MPV_PROBLEM_WORDS = ("error", "failed", "could not", "unable", "cannot", "no sound")

# Eine Sprachdatei ist von Natur aus leiser als Musik: Musiktitel sind auf
# Vollpegel gemastert, eine Ansage aus der Sprachausgabe hat reichlich Luft nach
# oben. Beim selben mpv-Pegel setzt sie sich deshalb nicht gegen die Musik durch,
# und mit dem Regler ist da nichts zu retten – bei 100 ist Schluss. Diese Filter
# ziehen die Ansage vor der Wiedergabe auf einen einheitlichen Pegel hoch.
#
# Zwei Kandidaten, weil `speechnorm` erst ab ffmpeg 4.4 dabei ist (Bookworm ja,
# Bullseye und Buster nein). Faellt es aus, kommt `dynaudnorm` zum Zug, das es
# in jeder in Frage kommenden Version gibt.
SPEECH_FILTERS = (
    # p: Zielpegel knapp unter Vollaussteuerung, mehr laesst der Filter nicht zu
    # (deshalb braucht es keinen Limiter dahinter). e: bis zu 12,5-fache
    # Verstaerkung fuer leise Passagen. l: beide Kanaele auf demselben Gain,
    # sonst wandert das Stereobild mitten in der Ansage.
    "lavfi=[speechnorm=p=0.95:e=12.5:r=0.0005:l=1]",
    "lavfi=[dynaudnorm=f=150:g=15:p=0.9:m=20]",
)

# Woran eine mpv-Meldung zu erkennen gibt, dass der Filter das Problem ist und
# nicht die Audiodatei. Nur dann lohnt der naechste Kandidat.
FILTER_PROBLEM_WORDS = ("no such filter", "lavfi", "--af", "filter graph")


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
        if not stripped:
            continue
        # Die ipc-Meldungen entstehen daran, dass wir den Steuersocket nach jeder
        # Antwort schliessen. Ueber die Wiedergabe sagen sie nichts.
        if stripped.startswith("[ipc"):
            logger.debug("mpv: %s", stripped)
            continue
        lowered = stripped.lower()
        if any(word in lowered for word in MPV_PROBLEM_WORDS):
            logger.warning("mpv: %s", stripped)
        else:
            logger.info("mpv: %s", stripped)


class MusicPlayer:
    """Dauerhaft laufende mpv-Instanz für Hintergrundmusik und Webradio."""

    def __init__(self, audio_device: str = "", socket_path: str = MUSIC_SOCKET):
        self.audio_device = audio_device or DEFAULT_AUDIO_DEVICE
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
        # Was gerade abgespielt werden soll, um es nach einem Fehler an der
        # Soundkarte erneut anstossen zu koennen.
        self._source: Optional[tuple] = None
        self._ao_retries = 0

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
            f"--msg-level={MSG_LEVEL}",
            "--gapless-audio=yes",
            "--loop-playlist=inf",
            f"--input-ipc-server={self.socket_path}",
            f"--volume={self._volume}",
            f"--audio-device={self.audio_device}",
        ]

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
                if AO_FAILED in line:
                    self._retry_source()
        except Exception as e:
            logger.debug("mpv-Meldungen nicht mehr lesbar: %s", e)

    def _retry_source(self) -> None:
        """
        Nach einem Dienstneustart ist die Soundkarte manchmal noch belegt, etwa
        von der vorigen mpv-Instanz. mpv gibt dann fuer diese Datei endgueltig
        auf – ein neuer Ladebefehl bringt es dazu, die Karte erneut zu oeffnen.
        """
        if self._source is None or self._ao_retries >= AO_RETRIES:
            return
        self._ao_retries += 1
        delay = AO_RETRY_DELAY * self._ao_retries
        logger.warning(
            "Soundkarte nicht verfügbar – neuer Versuch %d von %d in %d s",
            self._ao_retries,
            AO_RETRIES,
            delay,
        )
        threading.Timer(delay, self._replay).start()

    def _replay(self) -> None:
        source = self._source
        # Ein Stopp in der Zwischenzeit setzt die Quelle zurueck; dann bleibt es
        # dabei, sonst wuerde die Musik gegen den Willen des Bedieners angehen.
        if source is None or not self.start():
            return
        logger.info("Wiedergabe nach Fehler an der Soundkarte erneut angestoßen")
        self._load(source)

    def _load(self, source: tuple) -> None:
        kind = source[0]
        self._command(["playlist-clear"])
        if kind == "stream":
            self._command(["loadfile", source[1], "replace"])
        else:
            paths, shuffle = source[1], source[2]
            self._command(["loadfile", paths[0], "replace"])
            for path in paths[1:]:
                self._command(["loadfile", path, "append"])
            if shuffle:
                self._command(["playlist-shuffle"])
        self._command(["set_property", "pause", False])
        self._playing = True

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

        self._source = ("files", paths, shuffle)
        self._ao_retries = 0
        self._load(self._source)
        logger.info("Playlist gestartet (%d Titel)", len(paths))
        return True

    def play_stream(self, url: str) -> bool:
        if not self.start():
            return False
        self._source = ("stream", url)
        self._ao_retries = 0
        self._load(self._source)
        logger.info("Stream gestartet: %s", url)
        return True

    def stop(self) -> None:
        self._source = None
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

    def __init__(self, music: MusicPlayer, audio_device: str = "", normalize: bool = True):
        self.music = music
        self.audio_device = audio_device or DEFAULT_AUDIO_DEVICE
        self._process: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._interrupted = False
        # Welcher Filter aus SPEECH_FILTERS gerade gilt. Lehnt mpv einen ab,
        # ruecken wir dauerhaft eine Stelle weiter, statt es bei jeder Ansage
        # erneut zu probieren. normalize=False heisst: gar kein Filter.
        self._filter_index = 0 if normalize else len(SPEECH_FILTERS)

    def _mpv_command(self, path: str, volume: int, filter_index: int) -> list[str]:
        cmd = ["mpv", "--no-video", "--no-input-terminal", f"--msg-level={MSG_LEVEL}"]
        if filter_index < len(SPEECH_FILTERS):
            cmd.append(f"--af={SPEECH_FILTERS[filter_index]}")
        cmd += [
            f"--volume={volume}",
            f"--audio-device={self.audio_device}",
            path,
        ]
        return cmd

    def _run(self, cmd: list[str]) -> tuple[int, str]:
        """Startet mpv, wartet das Ende ab und gibt Rückgabecode und Ausgabe zurück."""
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
        return returncode, output or ""

    def _play_file(self, path: str, volume: int, normalize: bool = False) -> None:
        # Ohne Anhebung (Gong) oder wenn schon alle Filter durchgefallen sind,
        # bleibt es beim unveraenderten Pegel der Datei.
        index = self._filter_index if normalize else len(SPEECH_FILTERS)
        returncode, output = self._run(self._mpv_command(path, volume, index))

        # Kennt das ffmpeg des Systems den Filter nicht, kommt kein Ton – je nach
        # Version mit oder ohne Fehlercode. Der zweite Versuch haengt darum an
        # der Meldung, nicht am Rueckgabewert. Eine leise Ansage ist besser als
        # keine: naechster Filter, notfalls ganz ohne.
        while (
            index < len(SPEECH_FILTERS)
            and not self._interrupted
            and any(word in output.lower() for word in FILTER_PROBLEM_WORDS)
        ):
            index += 1
            self._filter_index = index
            logger.warning(
                "mpv nimmt die Sprachanhebung nicht an – %s",
                "nächster Filter" if index < len(SPEECH_FILTERS) else "Ansage läuft unverändert",
            )
            returncode, output = self._run(self._mpv_command(path, volume, index))

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

            # Der Gong läuft ohne Anhebung: sein Pegel steht fest, und ein
            # ausklingender Ton würde von der Sprachanhebung künstlich
            # gehalten statt auszuklingen.
            if chime_path and os.path.exists(chime_path) and not self._interrupted:
                self._play_file(chime_path, volume)

            for index in range(max(1, repeat)):
                if self._interrupted:
                    return False
                if index > 0:
                    time.sleep(0.6)
                self._play_file(path, volume, normalize=True)

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
