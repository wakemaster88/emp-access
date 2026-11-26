"""
Zustand eines Zähl-Workers bei einem Fehler (reine Rechnung, ohne
OpenCV/YOLO, testbar).

``last_update`` steht für das letzte verarbeitete Bild aus dem Videostrom.
Ein Fehler (Strom abgebrochen, Kamera weg) setzt nur ``last_error``: So
sieht der Hub an ``lastUpdate`` in ``/counters``, wie alt Zählung und Bild
sind, und meldet die Belegung als unbekannt, statt die letzte Zählung mit
frischem Zeitstempel weiterzugeben. Beim nächsten gelungenen Verbindungsaufbau
setzt der Worker ``last_error`` wieder auf None.
"""

from __future__ import annotations

from typing import Any


def note_worker_error(counter: Any, exc: BaseException | str) -> str:
    """Fehler am Zähler vermerken; ``last_update`` bleibt beim letzten Bild."""
    counter.last_error = str(exc)
    return counter.last_error
