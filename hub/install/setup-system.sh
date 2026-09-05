#!/bin/zsh
# Einmalige Systempflege des Hub-Macs (braucht Root):
#   sudo ./install/setup-system.sh [HH:MM]
#
# 1. Energie: nie schlafen, Neustart nach Stromausfall, Wake-on-LAN
# 2. Tägliches Einschalten (Standard 06:00), falls jemand abends ausschaltet
# 3. sudoers-Regel, damit der Hub `pmset` künftig ohne Passwort nachziehen
#    kann – nach jedem Update prüft er die Werte selbst (src/system-setup.ts)
# 4. Automatische Anmeldung des Hub-Benutzers (Passwort wird abgefragt,
#    nicht gespeichert). Mit FileVault ist Auto-Login nicht möglich.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo ausführen:  sudo $0 [HH:MM]"
  exit 1
fi
HUB_USER="${SUDO_USER:-}"
if [[ -z "$HUB_USER" || "$HUB_USER" == "root" ]]; then
  echo "FEHLER: SUDO_USER fehlt – bitte aus dem Hub-Benutzerkonto heraus mit sudo starten."
  exit 1
fi
POWER_ON="${1:-06:00}"
if [[ ! "$POWER_ON" =~ ^[0-9]{2}:[0-9]{2}$ ]]; then
  echo "FEHLER: Uhrzeit als HH:MM angeben, z. B. 06:00"
  exit 1
fi

echo "1/4  Energie: nie schlafen, Neustart nach Stromausfall, Wake-on-LAN …"
pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1 womp 1

echo "2/4  Täglich einschalten um $POWER_ON …"
pmset repeat wakeorpoweron MTWRFSU "$POWER_ON:00"

echo "3/4  sudoers-Regel: $HUB_USER darf /usr/bin/pmset ohne Passwort …"
TMP="$(mktemp)"
echo "$HUB_USER ALL=(root) NOPASSWD: /usr/bin/pmset" > "$TMP"
if visudo -cf "$TMP" >/dev/null; then
  install -m 0440 -o root -g wheel "$TMP" /etc/sudoers.d/emp-hub
  echo "     /etc/sudoers.d/emp-hub geschrieben"
else
  echo "     FEHLER: sudoers-Regel ungültig, nicht installiert"
fi
rm -f "$TMP"

echo "4/4  Automatische Anmeldung für $HUB_USER …"
CURRENT="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)"
if [[ "$CURRENT" == "$HUB_USER" ]]; then
  echo "     bereits aktiv"
elif fdesetup status 2>/dev/null | grep -q "FileVault is On"; then
  echo "     FileVault ist an – Auto-Login geht damit nicht. Entweder FileVault aus"
  echo "     (Systemeinstellungen → Datenschutz & Sicherheit) oder den Mac nie herunterfahren."
else
  echo "     Passwort von $HUB_USER eingeben (wird nur an sysadminctl übergeben):"
  sysadminctl -autologin set -userName "$HUB_USER" -password -
fi

echo
echo "Fertig. Kontrolle:"
echo "  pmset -g | grep -E ' sleep| autorestart'"
echo "  pmset -g sched"
echo "  defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser"
echo "Der Hub meldet den Zustand ab dem nächsten Start im Log (\"Systempflege: …\") und in der Hub-Karte unter Netzwerk."
