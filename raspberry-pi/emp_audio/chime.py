"""
Gong vor einer Durchsage.

Wird beim ersten Start als WAV erzeugt statt als Binärdatei im Repo zu liegen –
das hält das Repository frei von Audiodaten und funktioniert ohne zusätzliche
Abhängigkeiten. Wer einen eigenen Gong möchte, lädt ihn im Dashboard als Track
vom Typ „Gong" hoch und legt ihn unter CHIME_PATH ab.
"""
from __future__ import annotations

import logging
import math
import os
import struct
import wave

logger = logging.getLogger("emp.audio.chime")

CHIME_PATH = "/var/lib/emp-audio/chime.wav"

SAMPLE_RATE = 44100
# Zwei Töne (a'' und d''') – klassischer Zweiklang-Gong, der sich auch über
# Hornlautsprecher gut durchsetzt.
TONES = [(880.0, 0.28), (1174.7, 0.45)]
AMPLITUDE = 0.35


def _tone_samples(frequency: float, duration: float) -> list[int]:
    total = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(total):
        # Exponentielles Ausklingen, damit der Ton nicht abgehackt endet.
        decay = math.exp(-3.5 * i / total)
        value = AMPLITUDE * decay * math.sin(2 * math.pi * frequency * i / SAMPLE_RATE)
        samples.append(int(max(-1.0, min(1.0, value)) * 32767))
    return samples


def ensure_chime(path: str = CHIME_PATH) -> str | None:
    """Erzeugt den Gong einmalig und gibt den Pfad zurück."""
    if os.path.exists(path):
        return path

    try:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
        except OSError:
            path = os.path.expanduser("~/.cache/emp-audio/chime.wav")
            if os.path.exists(path):
                return path
            os.makedirs(os.path.dirname(path), exist_ok=True)

        samples: list[int] = []
        for frequency, duration in TONES:
            samples.extend(_tone_samples(frequency, duration))

        with wave.open(path, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(SAMPLE_RATE)
            out.writeframes(struct.pack(f"<{len(samples)}h", *samples))

        logger.info("Gong erzeugt: %s", path)
        return path
    except Exception as e:
        logger.warning("Gong konnte nicht erzeugt werden: %s", e)
        return None
