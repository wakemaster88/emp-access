"""
Tor-Automatik einer Fahrzeug-Fläche (``vehicleGate``): Zählen und Öffnen
getrennt (reine Entscheidung, ohne OpenCV/YOLO, testbar).

Eine Kamera mit ``vehicleGate.enabled`` und Fläche zählt immer die Fahrzeuge
darin (``/counters``, Parkflächen-Zählung des Hubs). Geöffnet wird beim
Übergang von 0 auf mindestens 1 Fahrzeug nur bei ausdrücklicher Angabe:
``openDoorbirdConfirmed`` steht auf true (setzt nur der Kiosk-Schalter
„DoorBird öffnen“ beim Speichern), oder ``deviceIds`` nennt mindestens ein
Gerät. Fehlt beides, zählt die Fläche nur – das ist die Voreinstellung.

``openDoorbird`` allein öffnet nicht mehr: Frühere Voreinstellungen des
Kiosks haben es als true in die Datei geschrieben, ohne dass jemand es
gewählt hat. Steht es ohne ``openDoorbirdConfirmed`` auf true, sagt die
Startzeile der Kamera, dass es ignoriert wird.

Wie die Fläche arbeitet, meldet der Tracker je Kamera in ``/counters``
(Feld ``gate``, ``gate_mode``); der Hub zeigt es an.
"""

from __future__ import annotations

from typing import Any

LEGACY_HINT = "alte Einstellung openDoorbird ignoriert, im Kiosk ‚DoorBird öffnen‘ einschalten"


def _device_ids(vg: dict[str, Any]) -> list[int]:
    """Gültige Geräte-Nummern (ganze Zahlen > 0, auch als 7.0 geschrieben – wie die Kiosk-App sie liest)."""
    raw = vg.get("deviceIds")
    if not isinstance(raw, list):
        return []
    ids: list[int] = []
    for d in raw:
        if isinstance(d, bool):
            continue
        if isinstance(d, float) and d.is_integer():
            d = int(d)
        if isinstance(d, int) and d > 0:
            ids.append(d)
    return ids


def opens_doorbird(vg: dict[str, Any] | None) -> bool:
    """Öffnet die Fläche die DoorBird? Nur mit ``openDoorbirdConfirmed is True``."""
    return isinstance(vg, dict) and vg.get("openDoorbirdConfirmed") is True


def legacy_doorbird_ignored(vg: dict[str, Any] | None) -> bool:
    """``openDoorbird: true`` ohne ``openDoorbirdConfirmed``: alte Einstellung, öffnet nicht."""
    return isinstance(vg, dict) and vg.get("openDoorbird") is True and not opens_doorbird(vg)


def should_open(vg: dict[str, Any] | None) -> bool:
    """Öffnet die Tor-Automatik? Nur mit ``openDoorbirdConfirmed is True`` oder Geräten in ``deviceIds``."""
    if not isinstance(vg, dict):
        return False
    return opens_doorbird(vg) or len(_device_ids(vg)) > 0


def gate_mode(vg: dict[str, Any] | None) -> dict[str, Any]:
    """Betriebsart der Fläche für ``/counters``: öffnet sie, was, und warum (Text wie in der Startzeile)."""
    vg = vg if isinstance(vg, dict) else {}
    devices = _device_ids(vg)
    doorbird = opens_doorbird(vg)
    legacy = legacy_doorbird_ignored(vg)
    targets: list[str] = []
    if doorbird:
        targets.append("DoorBird (im Kiosk eingeschaltet)")
    if devices:
        targets.append("Geräte " + ", ".join(str(d) for d in devices))
    if targets:
        reason = " und ".join(targets) + (f"; {LEGACY_HINT}" if legacy else "")
    elif legacy:
        reason = LEGACY_HINT
    else:
        reason = "DoorBird öffnen aus, keine Geräte"
    return {
        "opens": doorbird or bool(devices),
        "doorbird": doorbird,
        "deviceIds": devices,
        "legacyDoorbirdIgnored": legacy,
        "reason": reason,
    }


def gate_mode_line(cam_id: str, vg: dict[str, Any] | None) -> str:
    """Eine Log-Zeile beim Start: öffnet die Fläche oder zählt sie nur, und warum."""
    mode = gate_mode(vg)
    if mode["opens"]:
        return f"vehicle-gate[{cam_id}] zählt und öffnet bei Fahrzeug in der Fläche: {mode['reason']}"
    if mode["legacyDoorbirdIgnored"]:
        return f"vehicle-gate[{cam_id}] zählt nur; {LEGACY_HINT}"
    return f"vehicle-gate[{cam_id}] zählt nur, öffnet nicht ({mode['reason']})"
