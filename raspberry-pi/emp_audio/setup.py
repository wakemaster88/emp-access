"""
Ersteinrichtung des Abspielers.

Der Scanner bekommt seine Zugangsdaten per QR-Code – ein Audio-Pi hat keinen
Scanner, deshalb wird derselbe JSON-Inhalt hier einmalig übergeben:

    python -m emp_audio.setup '{"url":"https://...","token":"...","id":42}'

Alternativ ohne Argument aufrufen und den JSON-Text eingeben.
"""

import logging
import sys

from emp_audio.config import Config

logging.basicConfig(level=logging.INFO, format="%(message)s")


def main() -> int:
    if len(sys.argv) > 1:
        raw = " ".join(sys.argv[1:])
    else:
        print("Konfigurations-JSON aus dem Dashboard einfügen (Gerätedetails):")
        raw = sys.stdin.readline()

    config = Config()
    if not config.apply_setup_json(raw.strip()):
        return 1

    print("")
    print("Konfiguration gespeichert. Dienst starten:")
    print("  sudo systemctl restart emp-audio")
    print("  journalctl -u emp-audio -f")
    return 0


if __name__ == "__main__":
    sys.exit(main())
