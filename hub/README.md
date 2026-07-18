# EMP-Access-Hub

Lokaler On-Site-Agent für EMP Access. Läuft auf einem Mac (z. B. iMac im
Technikraum), verbindet sich **ausschließlich outbound** mit der Cloud
(kein Port-Forwarding nötig) und führt lokale Aufgaben aus.

## Was er kann (Phase 1)

- **Heartbeat**: meldet sich alle 30 s bei der Cloud – Status ist im
  Dashboard unter „Netzwerk" sichtbar.
- **Task-Queue**: pollt alle 5 s offene Tasks und führt sie aus:
  - `PING` – Erreichbarkeits-Check eines Hosts im LAN
  - `NETWORK_SCAN` – IP/MAC-Liste des lokalen Netzes (ARP-Tabelle)
  - `WAKE_ON_LAN` – Magic Packet an eine MAC-Adresse
- **Selbst-Update**: prüft alle 5 min GitHub (`origin/main`). Bei neuen
  Commits: `git pull` + `npm install` + Neustart durch launchd. Deployment
  auf den Hub = einfach auf `main` pushen.

## Installation auf dem iMac

Voraussetzungen: Node.js ≥ 20, git, das Repo ist geklont.

```bash
cd ~/repositories/emp-access/hub

# 1. Konfiguration anlegen
cp .env.example .env
# .env ausfüllen: HUB_API_URL, HUB_API_TOKEN (Account-API-Token), HUB_NAME

# 2. Als launchd-Dienst installieren (startet automatisch, auch nach Reboot)
./install/install.sh

# Logs ansehen
tail -f ~/Library/Logs/emp-hub.log
```

Deinstallieren:

```bash
launchctl unload ~/Library/LaunchAgents/com.emp-access.hub.plist
rm ~/Library/LaunchAgents/com.emp-access.hub.plist
```

## Manuell starten (zum Testen)

```bash
cd hub && npm install && npm start
```

## Architektur

```
iMac (LAN)                          Vercel (Cloud)
┌────────────────────────┐          ┌──────────────────────────┐
│ hub (launchd, Node)    │  https   │ /api/hub/heartbeat        │
│  • Heartbeat 30s      ─┼─────────▶│ /api/hub/tasks (GET)      │
│  • Task-Poll 5s       ─┼─────────▶│ /api/hub/tasks/:id/result │
│  • Self-Update 5min    │          │                          │
│    (git pull origin)   │          │ HubAgent / HubTask (DB)  │
└────────────────────────┘          └──────────────────────────┘
```

Auth läuft über das Account-API-Token (`Authorization: Bearer …`), wie bei
den Raspberry Pis. Geplante Ausbaustufen: SNMP-Sync der NETGEAR-Switches
(Ports/VLANs/MAC-Tabelle → Netzwerk-Bereich), Kamera-Snapshots (RTSP),
lokale KI-Analyse.
