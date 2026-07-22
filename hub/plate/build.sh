#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Compiling plate-ocr (macOS Vision)…"
swiftc -O -o plate-ocr PlateOCR.swift
echo "OK: $(pwd)/plate-ocr"
