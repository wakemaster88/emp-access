#!/bin/zsh
# VLAN-Interfaces fuer den Hub-Mac anlegen (macOS), damit der Hub Geraete in
# isolierten VLANs (Kameras, Betrieb/IoT, Anlage/Audio) direkt erreicht – ohne
# Inter-VLAN-Routing am Router.
#
# Voraussetzung: Der Switch-Port des Hubs ist ein Trunk
#   (untagged VLAN 1, tagged 30/40/41) – in NETGEAR Insight am Core-Switch.
#
# Aufruf (zeigt standardmaessig nur an, was passieren wuerde):
#   ./install/setup-vlans.sh                     # Trockenlauf
#   sudo ./install/setup-vlans.sh --apply        # wirklich anlegen
#   sudo ./install/setup-vlans.sh --apply en0 "30:192.168.30.5 40:192.168.40.5 41:192.168.41.5"
#   sudo ./install/setup-vlans.sh --remove       # wieder entfernen
#
# Jedes VLAN-Interface bekommt eine feste IP OHNE Router-Eintrag: die
# Default-Route bleibt auf dem Haupt-Interface (VLAN 1), es kommt nur das
# jeweilige Subnetz dazu. Die Hub-IP (.5) passt zum Netzwerkplan; im Router
# sollte sie aus dem DHCP-Bereich (.100–.250) heraus liegen.
set -euo pipefail

MODE="dry"
case "${1:-}" in
  --apply) MODE="apply"; shift ;;
  --remove) MODE="remove"; shift ;;
esac

# Physisches Interface: Standard = Interface der Default-Route.
DEV="${1:-$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')}"
VLANS="${2:-30:192.168.30.5 40:192.168.40.5 41:192.168.41.5}"
MASK="255.255.255.0"

if [[ -z "$DEV" ]]; then
  echo "FEHLER: Kein Netzwerk-Interface gefunden. Bitte angeben, z. B. en0."
  exit 1
fi
if [[ "$MODE" != "dry" && $EUID -ne 0 ]]; then
  echo "Bitte mit sudo ausführen:  sudo $0 ${MODE/apply/--apply}"
  exit 1
fi

run() {
  if [[ "$MODE" == "dry" ]]; then
    echo "  (würde ausführen) $*"
  else
    echo "  $*"
    "$@"
  fi
}

echo "Physisches Interface: $DEV"
echo "Vorhandene VLANs:"
networksetup -listVLANs 2>/dev/null | sed 's/^/  /' || true
echo

for entry in ${=VLANS}; do
  TAG="${entry%%:*}"
  IP="${entry#*:}"
  NAME="VLAN $TAG"
  if [[ "$MODE" == "remove" ]]; then
    echo "Entferne $NAME …"
    run networksetup -deleteVLAN "$NAME" "$DEV" "$TAG" || true
    continue
  fi
  echo "$NAME → $IP/24 auf $DEV"
  if networksetup -listVLANs 2>/dev/null | grep -q "^VLAN User Defined Name: $NAME\$"; then
    echo "  existiert bereits"
  else
    run networksetup -createVLAN "$NAME" "$DEV" "$TAG"
  fi
  # Feste IP ohne Router: keine zweite Default-Route.
  run networksetup -setmanual "$NAME" "$IP" "$MASK"
done

if [[ "$MODE" == "dry" ]]; then
  echo
  echo "Trockenlauf – nichts geändert. Zum Anlegen:  sudo $0 --apply"
else
  echo
  echo "Fertig. Prüfen:  ifconfig | grep -A3 vlan   und im Hub-Dashboard unter Netzwerk → VLANs."
  echo "Danach im Hub hub/.env HUB_VLANS setzen (siehe .env.example) und den Hub neu starten."
fi
