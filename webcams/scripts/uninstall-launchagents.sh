#!/usr/bin/env bash
set -euo pipefail

LAUNCH_DIR="$HOME/Library/LaunchAgents"

for label in com.local.webcams com.local.go2rtc com.local.webcams-safari; do
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  rm -f "$LAUNCH_DIR/$label.plist"
done

echo "✅ LaunchAgents entfernt."
