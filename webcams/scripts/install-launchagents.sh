#!/usr/bin/env bash
# Installiert LaunchAgents auf macOS, sodass Next.js, go2rtc und Safari beim Login automatisch starten.
# Idempotent: bestehende Agents werden ersetzt.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/webcams"
NODE_BIN="$(command -v node || true)"
PNPM_BIN="$(command -v pnpm || true)"
# Bevorzuge das lokale Binary unter bin/go2rtc (vom setup.sh installiert),
# fallback auf $PATH (z.B. eigener brew-tap oder manueller install).
if [[ -x "$REPO_DIR/bin/go2rtc" ]]; then
  GO2RTC_BIN="$REPO_DIR/bin/go2rtc"
else
  GO2RTC_BIN="$(command -v go2rtc || true)"
fi
PORT="${PORT:-3000}"

if [[ -z "$NODE_BIN" ]]; then
  echo "❌ node nicht im PATH gefunden. Bitte 'brew install node' und erneut ausführen." >&2
  exit 1
fi
if [[ -z "$PNPM_BIN" ]]; then
  echo "❌ pnpm nicht im PATH gefunden. Bitte 'brew install pnpm' und erneut ausführen." >&2
  exit 1
fi
if [[ -z "$GO2RTC_BIN" ]]; then
  echo "⚠️  go2rtc nicht im PATH. Reolink-/Doorbird-Streams werden nicht laufen."
  echo "   Installation: brew install go2rtc"
fi

mkdir -p "$LAUNCH_DIR" "$LOG_DIR"

# 1) Build der Next.js-App, falls noch nicht geschehen
if [[ ! -d "$REPO_DIR/.next" ]]; then
  echo "🔨 Erster Build (next build) …"
  (cd "$REPO_DIR" && "$PNPM_BIN" install --prod=false && "$PNPM_BIN" build)
fi

# 2) Webcams Next.js Server
WEBCAMS_PLIST="$LAUNCH_DIR/com.local.webcams.plist"
cat > "$WEBCAMS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.webcams</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):$(dirname "$PNPM_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PORT</key>
    <string>$PORT</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>$PNPM_BIN</string>
    <string>start</string>
    <string>--</string>
    <string>-H</string>
    <string>127.0.0.1</string>
    <string>-p</string>
    <string>$PORT</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/next.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/next.err</string>
</dict>
</plist>
EOF

# 3) go2rtc
if [[ -n "$GO2RTC_BIN" ]]; then
  GO2RTC_PLIST="$LAUNCH_DIR/com.local.go2rtc.plist"
  cat > "$GO2RTC_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.go2rtc</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$GO2RTC_BIN</string>
    <string>-config</string>
    <string>$REPO_DIR/infra/go2rtc.yaml</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/go2rtc.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/go2rtc.err</string>
</dict>
</plist>
EOF

  # Stelle sicher dass go2rtc.yaml existiert (auch leer reicht)
  if [[ ! -f "$REPO_DIR/infra/go2rtc.yaml" ]]; then
    cp "$REPO_DIR/infra/go2rtc.example.yaml" "$REPO_DIR/infra/go2rtc.yaml"
  fi
fi

# 4) Safari im Vollbild öffnen, wenn der User sich einloggt
SAFARI_PLIST="$LAUNCH_DIR/com.local.webcams-safari.plist"
cat > "$SAFARI_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.webcams-safari</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/start-safari-fullscreen.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/safari.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/safari.err</string>
</dict>
</plist>
EOF

# 5) Reload all agents
for label in com.local.webcams com.local.go2rtc com.local.webcams-safari; do
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
done
launchctl bootstrap "gui/$UID" "$WEBCAMS_PLIST"
[[ -n "$GO2RTC_BIN" ]] && launchctl bootstrap "gui/$UID" "$LAUNCH_DIR/com.local.go2rtc.plist"
launchctl bootstrap "gui/$UID" "$SAFARI_PLIST"

echo ""
echo "✅ LaunchAgents installiert:"
echo "   - $WEBCAMS_PLIST"
[[ -n "$GO2RTC_BIN" ]] && echo "   - $LAUNCH_DIR/com.local.go2rtc.plist"
echo "   - $SAFARI_PLIST"
echo ""
echo "Logs: $LOG_DIR"
echo ""
echo "Status prüfen:"
echo "   launchctl list | grep com.local"
echo ""
echo "Stoppen:"
echo "   $REPO_DIR/scripts/uninstall-launchagents.sh"
