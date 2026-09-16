"""
Live-Durchsage: Ton aus dem Dashboard fortlaufend abholen.

Der Browser schickt rohes PCM (16 Bit little-endian, mono) in Stücken von ein
paar hundert Millisekunden an die Cloud. LiveFeed holt sie im Hintergrund ab
und puffert sie; abgespielt wird im SpeechPlayer (player.py), der den Puffer im
Takt der Wiedergabe leert.

Der Pi steigt beim neuesten Stück ein, nicht am Anfang der Durchsage – wer
später dazukommt, soll hören, was gerade gesagt wird.
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from array import array
from typing import Optional

logger = logging.getLogger("emp.audio.live")

# Nach einem Abruf mit Ton kurz warten, bis sich wieder etwas gesammelt hat.
# Der Browser schickt alle 400 ms; schneller zu fragen kostet nur Anfragen.
FETCH_GAP = 0.3

# Kommt so lange nichts vom Server, gilt die Durchsage als verloren. Dieselbe
# Grenze, ab der auch der Server eine verstummte Sitzung beendet.
GIVE_UP_AFTER = 15.0


class LiveFeed:
    """Holt den Ton einer Live-Sitzung im Hintergrund und puffert ihn."""

    def __init__(self, api, session_id: int):
        self.api = api
        self.session_id = session_id
        self.sample_rate = 16000
        self._buffer = bytearray()
        self._cond = threading.Condition()
        self._after: Optional[int] = None
        self._ended = False
        self._closed = False
        self._thread: Optional[threading.Thread] = None

    def is_open(self) -> bool:
        """
        Läuft die Sitzung noch? Ein Pi, der den Job verspätet abholt, soll nicht
        mit Gong in eine längst beendete Durchsage starten.
        """
        deadline = time.monotonic() + GIVE_UP_AFTER
        while time.monotonic() < deadline:
            result = self.api.fetch_live(self.session_id, None)
            if result is not None:
                return result.state != "ENDED"
            time.sleep(1)
        return False

    def start(self) -> None:
        """Beim neuesten Stück einsteigen und ab jetzt fortlaufend abholen."""
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        last_ok = time.monotonic()
        while not self._closed:
            result = self.api.fetch_live(self.session_id, self._after)
            if result is None:
                if time.monotonic() - last_ok > GIVE_UP_AFTER:
                    logger.warning(
                        "Live-Durchsage #%d: Server seit %d s nicht erreichbar – Abbruch",
                        self.session_id,
                        GIVE_UP_AFTER,
                    )
                    self._finish()
                    return
                time.sleep(0.5)
                continue

            last_ok = time.monotonic()
            with self._cond:
                self.sample_rate = result.rate
                self._after = result.seq
                if result.data:
                    self._buffer.extend(result.data)
                self._cond.notify_all()

            if result.state == "ENDED":
                self._finish()
                return
            # Ohne Ton hat der Server schon gewartet – sofort erneut fragen.
            if result.data:
                time.sleep(FETCH_GAP)

    def _finish(self) -> None:
        with self._cond:
            self._ended = True
            self._cond.notify_all()

    def wait_for_audio(self, timeout: float) -> bool:
        """
        Wartet auf die erste Antwort des Servers – erst dann steht die
        Abtastrate fest. False, wenn die Durchsage vorher endet.
        """
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._after is None and not self._ended:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._cond.wait(remaining)
            return bool(self._buffer) or not self._ended

    @property
    def backlog_bytes(self) -> int:
        with self._cond:
            return len(self._buffer)

    def read(self, size: int, timeout: float) -> Optional[bytes]:
        """
        Bis zu `size` Bytes (auf ganze Samples gerundet). b"" heißt: gerade nichts
        da. None heißt: Durchsage vorbei und alles abgespielt.
        """
        size -= size % 2
        with self._cond:
            if not self._buffer and not self._ended:
                self._cond.wait(timeout)
            if not self._buffer:
                return None if self._ended else b""
            take = min(size, len(self._buffer) - len(self._buffer) % 2)
            if take <= 0:
                return b""
            data = bytes(self._buffer[:take])
            del self._buffer[:take]
            return data

    def drop_oldest(self, keep_bytes: int) -> int:
        """Angestauten Ton bis auf `keep_bytes` verwerfen; gibt die Menge zurück."""
        keep_bytes -= keep_bytes % 2
        with self._cond:
            excess = len(self._buffer) - keep_bytes
            if excess <= 0:
                return 0
            excess -= excess % 2
            del self._buffer[:excess]
            return excess

    def close(self) -> None:
        self._closed = True
        self._finish()


def is_quiet(block: bytes, threshold: int = 400) -> bool:
    """
    Sprechpause? RMS unter etwa −38 dBFS. Nur solche Blöcke dürfen wegfallen,
    wenn die Wiedergabe hinterherhinkt – so holt sie auf, ohne Wörter zu
    verschlucken.
    """
    samples = array("h")
    samples.frombytes(block[: len(block) - len(block) % 2])
    if not samples:
        return True
    if sys.byteorder == "big":
        samples.byteswap()
    energy = sum(s * s for s in samples)
    return energy / len(samples) < threshold * threshold
