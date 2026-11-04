#!/bin/zsh
# Richtet das Python-venv fuer den Maeher-Dienst (Mammotion) ein.
# PyMammotion braucht Python 3.13 oder neuer:  brew install python@3.13
set -euo pipefail

MOWER_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$MOWER_DIR/.venv"

PY=""
for cand in python3.14 python3.13 /opt/homebrew/bin/python3.13 /usr/local/bin/python3.13 python3; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)' 2>/dev/null; then
    PY="$(command -v "$cand")"
    break
  fi
done
if [[ -z "$PY" ]]; then
  echo "FEHLER: Python 3.13+ fehlt. Bitte installieren:  brew install python@3.13"
  exit 1
fi

echo "1/2  Python-venv ($("$PY" --version)) …"
"$PY" -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip --quiet

echo "2/2  Dependencies …"
"$VENV/bin/pip" install -r "$MOWER_DIR/requirements.txt" --quiet
# Merkt sich den Stand, damit der Hub bei geaenderten Requirements neu installiert.
shasum -a 256 "$MOWER_DIR/requirements.txt" | cut -d' ' -f1 > "$VENV/.requirements.sha256"

"$VENV/bin/python" -I -c "import pymammotion, aiohttp, pyagorartc; print('OK pymammotion + pyagorartc')"
echo "Fertig. Der Hub startet den Dienst selbst, sobald MAMMOTION_EMAIL in hub/.env steht."
