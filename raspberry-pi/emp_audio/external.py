"""
AirPlay- und Bluetooth-Empfang einer Zone.

Beide Wege drehen die Richtung um: nicht das Dashboard startet die Musik,
sondern ein Sender im Haus greift sich die Zone. Die eingestellte Quelle bleibt
davon unberührt – sie ist nur so lange pausiert, wie der Sender spielt.

Der Ton kommt hier aus einem fremden Prozess. Ein Steuersocket wie bei mpv
existiert nicht, deshalb läuft die Ausgabe über ein eigenes ALSA-Gerät
(`emp_external`) mit softvol-Regler davor: nur darüber lässt sich eine Durchsage
gegen einen fremden Sender durchsetzen. Beide Zweige münden in dasselbe
Mischgerät wie Musik und Durchsage, siehe install-audio.sh.

Erkennung der Übernahme:

* AirPlay – shairport-sync ruft bei Sitzungsbeginn und -ende ein Skript auf, das
  eine Datei unter /run/emp-audio anlegt bzw. entfernt.
* Bluetooth – ein verbundenes Gerät gilt als Übernahme. Wer sein Handy mit einem
  Lautsprecher verbindet, will darüber hören.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import time
from typing import Optional

logger = logging.getLogger("emp.audio.external")

STATE_DIR = "/run/emp-audio"
AIRPLAY_STATE = os.path.join(STATE_DIR, "airplay.active")

ASOUND_CONF = "/etc/asound.conf"
AIRPLAY_CONF = "/etc/emp-airplay.conf"

AIRPLAY_UNIT = "emp-airplay.service"
# Zwei Dienste: der eine nimmt die Bluetooth-Verbindung an, der andere schiebt
# den Ton auf die Soundkarte. Ohne den zweiten ist das Handy verbunden und es
# bleibt still.
BLUETOOTH_UNITS = ("emp-bluealsa.service", "emp-bluealsa-aplay.service")

CMD_TIMEOUT = 10

# Kennungen, unter denen die Backends im Heartbeat gemeldet werden. Das
# Dashboard gibt einen Schalter nur frei, wenn die Kennung angekommen ist –
# siehe AUDIO_BACKENDS in src/lib/audio-constants.ts.
BACKEND_AIRPLAY = "shairport"
BACKEND_BLUETOOTH = "bluealsa"


def _run(cmd: list[str], input_bytes: Optional[bytes] = None) -> tuple[int, str]:
    """Hilfsprogramm aufrufen und Rückgabecode samt Ausgabe liefern."""
    try:
        result = subprocess.run(
            cmd,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=CMD_TIMEOUT,
        )
        return result.returncode, (result.stdout or b"").decode(errors="replace")
    except FileNotFoundError:
        return 127, f"{cmd[0]} nicht gefunden"
    except subprocess.TimeoutExpired:
        return 124, f"{cmd[0]} hat nicht geantwortet"
    except Exception as e:  # pragma: no cover - defensiv
        return 1, str(e)


def _has_external_pcm(pcm: str) -> bool:
    """
    Gibt es das regelbare Ausgabegerät? Es entsteht in /etc/asound.conf und damit
    nur, wenn install-audio.sh in der neuen Fassung gelaufen ist. Ein reines
    Code-Update über den Updater reicht dafür nicht.
    """
    try:
        with open(ASOUND_CONF, "r") as f:
            return f"pcm.{pcm}" in f.read()
    except OSError:
        return False


def available_backends(pcm: str = "emp_external") -> list[str]:
    """
    Welche Empfänger dieser Pi wirklich bedienen kann. Fehlt das Ausgabegerät,
    fehlt allen die Grundlage – dann wird nichts gemeldet und das Dashboard
    bietet die Schalter gar nicht erst an.
    """
    if not _has_external_pcm(pcm):
        return []

    backends = []
    if shutil.which("shairport-sync"):
        backends.append(BACKEND_AIRPLAY)
    # Der Abspielhelfer heisst in jeder Fassung gleich, der Dienst dahinter
    # nicht (bluealsa bzw. bluealsad).
    if shutil.which("bluealsa-aplay") and shutil.which("bluetoothctl"):
        backends.append(BACKEND_BLUETOOTH)
    return backends


class ExternalSource:
    """
    Empfänger einer Zone: Dienste schalten, Übernahme erkennen, Pegel regeln.

    Lautstärke, Ducking und `is_playing` verhalten sich wie beim MusicPlayer,
    damit eine Durchsage nicht wissen muss, was gerade spielt.
    """

    def __init__(
        self,
        pcm: str = "emp_external",
        mixer: str = "EmpExternal",
        ctl: str = "default",
    ):
        self.pcm = pcm
        self.mixer = mixer
        self.ctl = ctl

        self._lock = threading.Lock()
        self._airplay_wanted = False
        self._bluetooth_wanted = False
        self._name = ""
        # Was zuletzt an die Dienste weitergegeben wurde, damit ein Poll im
        # Sekundentakt nicht dauernd systemctl und bluetoothctl aufruft.
        self._applied: Optional[tuple] = None
        self._pairable_applied: Optional[bool] = None
        self._pairable_until = 0.0

        self._active: Optional[str] = None
        self._sender: Optional[str] = None

        self._volume = 100
        self._duck_volume = 20
        self._ducked = False
        self._mixer_missing_logged = False

    # ── Einrichtung ──────────────────────────────────────────────────────────

    def start(self) -> None:
        """
        Einmal beim Dienststart: Zustandsverzeichnis anlegen, den softvol-Regler
        erzeugen und ihn aufdrehen.

        Das Aufdrehen ist keine Vorsichtsmaßnahme ohne Anlass: bricht der Dienst
        mitten in einer Durchsage ab, bleibt der Regler abgesenkt stehen und die
        Zone wäre nach dem Neustart dauerhaft leise.
        """
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
        except OSError as e:
            logger.warning("Zustandsverzeichnis %s nicht anlegbar: %s", STATE_DIR, e)

        # Eine Sitzung von vor dem Neustart darf nicht als laufend gelten.
        self._clear_airplay_state()

        if not _has_external_pcm(self.pcm):
            return
        self._prime_mixer()
        self._apply_volume(force=True)

    def _prime_mixer(self) -> None:
        """
        Einen softvol-Regler gibt es erst, nachdem das Gerät einmal geöffnet
        wurde – vorher findet amixer ihn nicht. Ein Bruchteil Stille genügt.
        """
        code, output = _run(
            [
                "aplay",
                "-D",
                self.pcm,
                "-q",
                "-t",
                "raw",
                "-f",
                "S16_LE",
                "-r",
                "48000",
                "-c",
                "2",
            ],
            input_bytes=b"\0" * 8192,
        )
        if code != 0:
            logger.warning(
                "Ausgabegerät %s ließ sich nicht öffnen – kein Ducking für "
                "AirPlay/Bluetooth möglich: %s",
                self.pcm,
                output.strip()[:150],
            )

    # ── Zonenkonfiguration ───────────────────────────────────────────────────

    def apply(self, airplay: Optional[dict], bluetooth: Optional[dict]) -> None:
        """
        Zonenkonfiguration übernehmen. `None` heißt: Empfänger aus, der Dienst
        wird gestoppt. Wird bei jedem Poll aufgerufen und tut nur etwas, wenn
        sich gegenüber dem letzten Aufruf etwas geändert hat.
        """
        airplay_wanted = isinstance(airplay, dict)
        bluetooth_wanted = isinstance(bluetooth, dict)
        source = airplay if airplay_wanted else bluetooth if bluetooth_wanted else None
        name = ""
        if isinstance(source, dict) and isinstance(source.get("name"), str):
            name = source["name"].strip()[:60]

        pairable_for = 0
        if bluetooth_wanted:
            value = bluetooth.get("pairableFor")
            pairable_for = value if isinstance(value, int) and value > 0 else 0

        with self._lock:
            self._airplay_wanted = airplay_wanted
            self._bluetooth_wanted = bluetooth_wanted
            self._name = name
            self._pairable_until = time.monotonic() + pairable_for if pairable_for else 0.0
            state = (airplay_wanted, bluetooth_wanted, name)
            changed = state != self._applied
            self._applied = state

        if changed:
            self._sync_services(airplay_wanted, bluetooth_wanted, name)

    def _sync_services(self, airplay: bool, bluetooth: bool, name: str) -> None:
        if airplay:
            self._write_airplay_conf(name)
            self._unit("restart", AIRPLAY_UNIT)
            logger.info("AirPlay-Empfang aktiv als „%s“", name)
        else:
            self._unit("stop", AIRPLAY_UNIT)
            self._clear_airplay_state()

        if bluetooth:
            if name:
                _run(["bluetoothctl", "system-alias", name])
            for unit in BLUETOOTH_UNITS:
                self._unit("restart", unit)
            logger.info("Bluetooth-Empfang aktiv als „%s“", name)
        else:
            for unit in reversed(BLUETOOTH_UNITS):
                self._unit("stop", unit)
            self._set_pairable(False)

    def _unit(self, action: str, unit: str) -> None:
        code, output = _run(["systemctl", action, unit])
        # Beim Stoppen eines Dienstes, den es gar nicht gibt, ist nichts zu tun.
        if code != 0 and action != "stop":
            logger.warning("systemctl %s %s: %s", action, unit, output.strip()[:150])

    def _write_airplay_conf(self, name: str) -> None:
        """
        Eigene Konfiguration statt der des Pakets: der Name ändert sich mit der
        Zone, und die Sitzungs-Hooks brauchen wir für die Übernahme-Erkennung.
        Über die Kommandozeile sind sie nicht setzbar.
        """
        config = f"""// Von emp-audio erzeugt – Änderungen gehen beim nächsten Start verloren.
general = {{
  name = "{name or 'EMP Audio'}";
  output_backend = "alsa";
}};

alsa = {{
  // Regelbarer Zweig, damit eine Durchsage den Sender absenken kann.
  output_device = "{self.pcm}";
}};

sessioncontrol = {{
  run_this_before_entering_active_state = "/usr/local/bin/emp-airplay-state active";
  run_this_after_exiting_active_state = "/usr/local/bin/emp-airplay-state idle";
  // Der Abspieler darf auf die Meldung nicht warten.
  wait_for_completion = "no";
}};
"""
        try:
            with open(AIRPLAY_CONF, "w") as f:
                f.write(config)
        except OSError as e:
            logger.error("AirPlay-Konfiguration %s nicht schreibbar: %s", AIRPLAY_CONF, e)

    # ── Übernahme erkennen ───────────────────────────────────────────────────

    def poll(self) -> Optional[tuple[str, Optional[str]]]:
        """
        Wer die Zone gerade bespielt: ("AIRPLAY"|"BLUETOOTH", Sendername) oder
        None. Nebenbei wird das Kopplungsfenster nachgezogen.
        """
        with self._lock:
            airplay_wanted = self._airplay_wanted
            bluetooth_wanted = self._bluetooth_wanted
            pairable = bluetooth_wanted and time.monotonic() < self._pairable_until

        self._set_pairable(pairable)

        active: Optional[str] = None
        sender: Optional[str] = None

        # AirPlay hat Vorrang: es kommt aus dem WLAN und damit vom Personal,
        # Bluetooth kann auch ein vergessenes Handy in Reichweite sein.
        if airplay_wanted and os.path.exists(AIRPLAY_STATE):
            active = "AIRPLAY"
        elif bluetooth_wanted:
            sender = self._connected_bluetooth_device()
            if sender is not None:
                active = "BLUETOOTH"

        with self._lock:
            changed = active != self._active
            self._active = active
            self._sender = sender
            if changed and active is None:
                # Nach der Freigabe wieder auf Sollpegel, falls eine Durchsage
                # mitten in der Übernahme lief.
                self._ducked = False

        if changed:
            if active:
                logger.info(
                    "Zone übernommen: %s%s", active, f" ({sender})" if sender else ""
                )
                self._apply_volume()
            else:
                logger.info("Externer Sender hat die Zone freigegeben")

        return (active, sender) if active else None

    def _connected_bluetooth_device(self) -> Optional[str]:
        """
        Name des verbundenen Geräts, oder None. Ausgabeformat von bluetoothctl:
        "Device AA:BB:CC:DD:EE:FF iPhone von Anna".
        """
        code, output = _run(["bluetoothctl", "devices", "Connected"])
        if code != 0:
            return None
        for line in output.splitlines():
            parts = line.strip().split(" ", 2)
            if len(parts) >= 2 and parts[0] == "Device":
                name = parts[2].strip() if len(parts) > 2 else parts[1]
                return name[:120] or None
        return None

    def _clear_airplay_state(self) -> None:
        try:
            os.unlink(AIRPLAY_STATE)
        except OSError:
            pass

    def _set_pairable(self, pairable: bool) -> None:
        """
        Sichtbar und koppelbar nur im Fenster. Außerhalb kommen bereits
        gekoppelte Geräte weiterhin durch, neue nicht.
        """
        if pairable == self._pairable_applied:
            return
        if not shutil.which("bluetoothctl"):
            self._pairable_applied = pairable
            return

        value = "on" if pairable else "off"
        _run(["bluetoothctl", "discoverable", value])
        _run(["bluetoothctl", "pairable", value])
        self._pairable_applied = pairable
        logger.info("Bluetooth-Kopplung %s", "freigegeben" if pairable else "geschlossen")

    # ── Pegel ────────────────────────────────────────────────────────────────

    def _apply_volume(self, force: bool = False) -> None:
        # Solange niemand übernommen hat, geht der Pegel niemanden etwas an –
        # außer beim Aufräumen, wo der Regler ausdrücklich hoch soll.
        if self._active is None and not force:
            return
        level = self._duck_volume if self._ducked else self._volume
        code, output = _run(["amixer", "-D", self.ctl, "-q", "sset", self.mixer, f"{level}%"])
        if code != 0 and not self._mixer_missing_logged:
            self._mixer_missing_logged = True
            logger.warning(
                "Regler %s nicht ansprechbar – eine Durchsage geht gegen "
                "AirPlay/Bluetooth unter: %s",
                self.mixer,
                output.strip()[:150],
            )

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

    @property
    def is_playing(self) -> bool:
        return self._active is not None

    @property
    def active_kind(self) -> Optional[str]:
        return self._active

    @property
    def sender(self) -> Optional[str]:
        return self._sender

    def cleanup(self) -> None:
        """Dienste laufen weiter, aber der Regler darf nicht abgesenkt bleiben."""
        self._ducked = False
        self._apply_volume(force=True)
