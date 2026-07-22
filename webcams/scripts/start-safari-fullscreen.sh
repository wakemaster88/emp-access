#!/usr/bin/env bash
# Wartet bis Next.js auf Port 3000 antwortet, öffnet Safari und schaltet in den Vollbildmodus.
# Wird von com.local.webcams-safari.plist beim Login gestartet.

set -euo pipefail

URL="${WEBCAMS_URL:-http://localhost:3000}"
TIMEOUT_SEC=120
SLEEP_SEC=2
WAITED=0

echo "[$(date '+%F %T')] Warte auf $URL …"
while ! curl -fsS -m 2 "$URL" >/dev/null 2>&1; do
  sleep "$SLEEP_SEC"
  WAITED=$((WAITED + SLEEP_SEC))
  if [[ $WAITED -ge $TIMEOUT_SEC ]]; then
    echo "[$(date '+%F %T')] Timeout: $URL nicht erreichbar nach ${TIMEOUT_SEC}s"
    exit 1
  fi
done

echo "[$(date '+%F %T')] Server bereit – öffne Safari im Vollbild"

osascript <<APPLESCRIPT
tell application "Safari"
  activate
  if (count of windows) is 0 then
    make new document with properties {URL:"$URL"}
  else
    set URL of front document to "$URL"
  end if
end tell

delay 1.5

tell application "System Events"
  tell process "Safari"
    -- Vollbild via Cmd+Ctrl+F
    keystroke "f" using {command down, control down}
  end tell
end tell
APPLESCRIPT

echo "[$(date '+%F %T')] Safari im Vollbild gestartet"
