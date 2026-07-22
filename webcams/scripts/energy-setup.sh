#!/usr/bin/env bash
# Konfiguriert den Mac für Dauerbetrieb am TV.
# Benötigt sudo, weil pmset systemweit wirkt.

set -euo pipefail

echo "Energie-Einstellungen für TV-Dauerbetrieb"
echo "----------------------------------------"
echo "Diese Befehle benötigen sudo. Du wirst nach deinem Passwort gefragt."
echo ""

read -r -p "Mac soll nie schlafen, Display soll nie schlafen? [y/N] " yn
case "$yn" in
  [Yy]*)
    sudo pmset -a sleep 0
    sudo pmset -a displaysleep 0
    sudo pmset -a disksleep 0
    echo "✅ Schlafmodus deaktiviert"
    ;;
  *)
    echo "Übersprungen"
    ;;
esac

read -r -p "Auto-Login bei Stromrückkehr aktivieren (sehr empfohlen für TV-Setup)? [y/N] " yn
case "$yn" in
  [Yy]*)
    sudo pmset -a autorestart 1
    echo "✅ Auto-Restart nach Stromausfall aktiviert"
    ;;
  *)
    echo "Übersprungen"
    ;;
esac

read -r -p "macOS-Updates auf manuell setzen (verhindert Reboot mitten in der Nacht)? [y/N] " yn
case "$yn" in
  [Yy]*)
    sudo softwareupdate --schedule off || true
    sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false
    sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -bool false
    echo "✅ Auto-Updates deaktiviert"
    ;;
  *)
    echo "Übersprungen"
    ;;
esac

echo ""
echo "Aktuelle pmset-Konfiguration:"
pmset -g
