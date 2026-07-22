#!/bin/sh
# Richtet das fast-alpr venv ein (Python 3.12, onnxruntime hat noch kein 3.14-Wheel).
set -e
cd "$(dirname "$0")"

PY=""
for cand in python3.12 python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.13; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.12/3.13 fehlt. Installiere z. B.: brew install python@3.12" >&2
  exit 1
fi

"$PY" -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet fast-alpr onnxruntime
./.venv/bin/python -c "import fast_alpr, onnxruntime; print('fast-alpr bereit,', 'onnxruntime', onnxruntime.__version__)"
