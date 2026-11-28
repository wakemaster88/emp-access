#!/usr/bin/env bash
# Monitor-Autostart für einen Mac (z. B. den iMac im Shop).
#
# Öffnet beim Anmelden einen Monitor-Link von EMP Access in Google Chrome im
# Vollbild (Kiosk-Modus) und erlaubt dort Ton ohne Tippen. So spielt die
# Audio-Zone des Monitors nach jedem Neustart und nach jedem automatischen
# Neuladen der Seite gleich weiter.
#
# Einmal im Terminal als der Benutzer ausführen, der am Monitor angemeldet ist:
#   bash monitor-autostart.sh                 # fragt in einem Fenster nach dem Link
#   bash monitor-autostart.sh 'https://…'     # Link direkt mitgeben
#   bash monitor-autostart.sh --entfernen     # Autostart wieder ausbauen
#
# Den Link gibt es in EMP Access unter Monitore (Taste „Kopieren“). Er wird nur
# auf diesem Mac gespeichert (~/Library/Application Support/EMP-Access-Monitor),
# nie im Repository. An den Link kommt „ton=an“, damit dieses Gerät nicht mehr
# „Hier abspielen?“ fragt.
#
# Beenden: Cmd+Q. Der Monitor startet dann erst beim nächsten Anmelden wieder.
# Stürzt Chrome ab, startet er nach 30 Sekunden neu.

set -euo pipefail

LABEL="de.emp-access.monitor"
APP_DIR="$HOME/Library/Application Support/EMP-Access-Monitor"
PROFILE_DIR="$APP_DIR/chrome-profil"
LINK_FILE="$APP_DIR/link.txt"
START_SCRIPT="$APP_DIR/start.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/emp-access-monitor"
DOMAIN="gui/$(id -u)"
ME="$(id -un)"

fail() {
  echo "❌ $*" >&2
  exit 1
}

if [[ "$(uname)" != "Darwin" ]]; then
  fail "Das Skript ist nur für macOS."
fi

stop_agent() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    # bootout ist erst nach einem Moment ganz durch, sonst scheitert bootstrap.
    sleep 2
  fi
}

if [[ "${1:-}" == "--entfernen" ]]; then
  stop_agent
  rm -f "$PLIST" "$START_SCRIPT" "$LINK_FILE"
  echo "✅ Autostart entfernt. Das Chrome-Profil des Monitors bleibt in:"
  echo "   $PROFILE_DIR"
  exit 0
fi

# ── Google Chrome ──────────────────────────────────────────────────────────
CHROME=""
for app in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do
  if [[ -x "$app/Contents/MacOS/Google Chrome" ]]; then
    CHROME="$app/Contents/MacOS/Google Chrome"
    break
  fi
done
if [[ -z "$CHROME" ]]; then
  fail "Google Chrome fehlt. Bitte von https://www.google.com/chrome/ installieren und das Skript noch einmal starten."
fi

# ── Link ───────────────────────────────────────────────────────────────────
LINK="${1:-}"
if [[ -z "$LINK" ]]; then
  LINK="$(osascript \
    -e 'text returned of (display dialog "Link des Monitors aus EMP Access (Monitore › Kopieren):" default answer "" with title "Monitor-Autostart" buttons {"Abbrechen", "Einrichten"} default button "Einrichten" cancel button "Abbrechen")' \
    2>/dev/null)" || fail "Abgebrochen, nichts geändert."
fi
# Leerzeichen und Zeilenumbrüche vom Kopieren entfernen.
LINK="$(printf '%s' "$LINK" | tr -d '[:space:]')"

if [[ ! "$LINK" =~ ^https://[^/]+/ ]]; then
  fail "Das ist kein Monitor-Link (er beginnt mit https://): $LINK"
fi
case "$LINK" in
  */checkin/* | */monitor/* | */resource-monitor/*) ;;
  *) echo "⚠️  Nur Check-in-, Scan- und Auslastungs-Monitore können Ton abspielen. Der Link öffnet trotzdem im Vollbild." ;;
esac
if [[ "$LINK" != *"ton="* ]]; then
  if [[ "$LINK" == *"?"* ]]; then LINK="$LINK&ton=an"; else LINK="$LINK?ton=an"; fi
fi
ORIGIN="$(printf '%s' "$LINK" | sed -E 's#^(https://[^/]+).*#\1#')"

# ── Dateien ────────────────────────────────────────────────────────────────
mkdir -p "$APP_DIR" "$PROFILE_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
umask 077
printf '%s\n' "$LINK" > "$LINK_FILE"

# Startskript: Link und Chrome-Pfad stehen in Dateien, nicht in der plist.
cat > "$START_SCRIPT" <<EOF
#!/bin/bash
# Von launchd beim Anmelden gestartet ($LABEL). Erzeugt von monitor-autostart.sh.
LINK="\$(cat "$LINK_FILE")"

# Warten, bis das Netz da ist (höchstens 2 Minuten), sonst zeigt Chrome eine Fehlerseite.
for _ in \$(seq 1 60); do
  curl -sS -o /dev/null -m 3 "$ORIGIN" 2>/dev/null && break
  sleep 2
done

# Solange der Monitor läuft, schläft der Mac nicht ein (sonst keine Durchsagen).
# Der Bildschirm darf weiter ausgehen.
/usr/bin/caffeinate -i -w \$\$ &

exec "$CHROME" \\
  --user-data-dir="$PROFILE_DIR" \\
  --kiosk \\
  --autoplay-policy=no-user-gesture-required \\
  --no-first-run \\
  --no-default-browser-check \\
  --disable-session-crashed-bubble \\
  --hide-crash-restore-bubble \\
  --noerrdialogs \\
  --overscroll-history-navigation=0 \\
  --disable-features=Translate \\
  "\$LINK"
EOF
chmod 700 "$START_SCRIPT"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$START_SCRIPT</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/monitor.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/monitor.err</string>
</dict>
</plist>
EOF
chmod 644 "$PLIST"

# ── Aktivieren ─────────────────────────────────────────────────────────────
stop_agent
if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
  echo "✅ Eingerichtet: Chrome öffnet den Monitor jetzt und bei jedem Anmelden im Vollbild."
else
  echo "✅ Eingerichtet: Der Monitor öffnet ab dem nächsten Anmelden im Vollbild."
fi
echo "   Beenden mit Cmd+Q. Ausbauen: bash monitor-autostart.sh --entfernen"

# ── Hinweise ───────────────────────────────────────────────────────────────
AUTO_USER="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)"
if [[ "$AUTO_USER" != "$ME" ]]; then
  echo ""
  echo "⚠️  Automatische Anmeldung für „$ME“ ist anscheinend nicht eingeschaltet. Ohne sie wartet der"
  echo "   Mac nach dem Einschalten am Anmeldefenster. Einschalten unter:"
  echo "   Systemeinstellungen › Benutzer:innen & Gruppen › Automatisch anmelden als"
fi
if fdesetup status 2>/dev/null | grep -q "FileVault is On"; then
  echo ""
  echo "⚠️  FileVault ist an. Dann bietet macOS keine automatische Anmeldung an;"
  echo "   nach einem Neustart muss jemand das Passwort eingeben."
fi
