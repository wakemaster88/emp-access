#!/bin/zsh
# Richtet das Python-venv und InsightFace fuer den Face-Sidecar ein.
set -euo pipefail

FACE_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$FACE_DIR/.venv"

echo "1/3  Python-venv …"
python3 -m venv "$VENV"
source "$VENV/bin/activate"

echo "2/3  Dependencies …"
pip install --upgrade pip
pip install -r "$FACE_DIR/requirements.txt"

echo "3/3  Modell-Warmup (buffalo_l Download) …"
FACE_MODEL_ROOT="$FACE_DIR/.models" python - <<'PY'
from server import get_app
get_app()
print("OK")
PY

echo "Fertig. Start: $VENV/bin/python $FACE_DIR/server.py"
