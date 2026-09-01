# EMP-Access-Hub

Lokaler On-Site-Agent für EMP Access. Läuft auf einem Mac (z. B. iMac im
Technikraum), verbindet sich **ausschließlich outbound** mit der Cloud
(kein Port-Forwarding nötig) und führt lokale Aufgaben aus.

## Was er kann

- **Heartbeat**: alle 30 s zur Cloud; bei offenen Tasks verkürzt sich der
  Task-Poll auf 1 s.
- **Task-Queue**: pollt offene Tasks, arbeitet zeitkritische parallel
  (`SCAN_SNAPSHOT`, Türöffner, PTZ, Snapshots). `NETWORK_SCAN` läuft im
  Hintergrund und blockiert die Queue nicht.
- **Netzwerk**: Ping-Sweep + Portscan (alle 30 min), Wake-on-LAN, optional
  SNMP der NETGEAR-Switches (Ports/VLANs/MAC-Tabelle).
- **Kameras (Reolink)**: CGI-Polling (parallel), Events, Personen- und
  Fahrzeug-Pipelines, PTZ/Scheinwerfer/IR/Sirene, MAC-Re-Mapping bei DHCP.
- **DoorBird**: `monitor.cgi` (Push), Klingel, Türöffner, Telegram-Torwunsch.
- **Gesichter**: InsightFace-Sidecar (`buffalo_l`, CoreML wenn vorhanden).
- **Kennzeichen**: fast-alpr (primär), macOS Vision als Fallback; lokale
  Aktoren (DoorBird/Shelly) ohne Cloud-Roundtrip.
- **Parken**: YOLO-Tracker-Zonen (`vehicleGate`) → Cloud.
- **Streams**: Cloud-Camera ist führend; der Hub schreibt IPs in
  `webcams/config.json` und `go2rtc.yaml` (gitignored, kein Auto-Commit).
- **Selbst-Update**: alle 5 min `git fetch` (async). Bei neuen Commits:
  `reset --hard origin/main` + `npm install` + Neustart durch launchd.

## Installation auf einer Hub-Maschine

Der Hub ist ein reines Deployment-Target: er fährt `origin/main` aus dem
GitHub-Repo und hält sich selbst aktuell. Mehrere Hubs an einem Account sind
vorgesehen, sie unterscheiden sich nur über `HUB_NAME`.

Voraussetzungen: **macOS** (launchd, `vm_stat`, Vision-OCR), Node.js ≥ 20,
git. Optional Python 3.12 (Face + ALPR) und `net-snmp` für SWITCH_SYNC.

```bash
# 1. Repo klonen (der Hub liegt im Unterordner hub/)
git clone https://github.com/wakemaster88/emp-access.git ~/repositories/emp-access
cd ~/repositories/emp-access/hub

# 2. Konfiguration anlegen
cp .env.example .env
# .env ausfüllen: HUB_API_URL, HUB_API_TOKEN (Account-API-Token) und
# HUB_NAME – pro Maschine eindeutig, er ist der Schlüssel des HubAgent
# in der Cloud. Ohne HUB_NAME wird der Hostname genommen.

# 3. Als launchd-Dienst installieren (Face + ALPR + Autostart)
./install/install.sh

# Logs ansehen
tail -f ~/Library/Logs/emp-hub.log
```

Ab da genügt ein Push auf `main`: jeder Hub zieht die Änderung innerhalb von
`HUB_UPDATE_INTERVAL` (Standard 5 min), startet neu und meldet seinen neuen
Commit im Heartbeat. Im Cloud-Dashboard zeigt die Hub-Karte, welcher Hub
verbunden ist und ob einer noch auf einem älteren Commit läuft.

Wird eine Maschine dauerhaft abgebaut, bleibt ihr `HubAgent` in der Cloud
stehen. Einträge, die länger als sieben Tage stumm sind, blendet das Widget
aus; sauber ist es, den Datensatz zu löschen.

## Lokales Dashboard

[http://localhost:8787](http://localhost:8787) zeigt die Lage des Standorts:
Startansicht **Lage** (welche Kamera gerade meldet, letzte Person und letztes
Kennzeichen pro Ort) sowie **Systeme**, **Netzwerk**, **Kameras**,
**Ereignisse**, **Personen**, **Fahrzeuge** und **Aktionen**.
**Systeme** zeigt zusaetzlich die Leistung des Rechners: CPU, Last, Speicher,
Platte, Netzdurchsatz und was Face-Sidecar, ALPR, Tracker und go2rtc kosten.
Oberflaeche: `src/ui/`, HTTP-Teil: `src/dashboard.ts`.

Vom Handy oder Tablet aus erreichbar wird es nur mit einem Token:

```bash
# hub/.env
HUB_DASHBOARD_TOKEN=langes-zufaelliges-geheimnis
```

Dann bindet der Server ans LAN (`0.0.0.0`, per `HUB_DASHBOARD_HOST`
uebersteuerbar) und verlangt das Token bei jedem Zugriff von aussen: einmal
`http://<iMac-IP>:8787/?token=…` aufrufen, danach merkt es ein Cookie.
Ohne Token bleibt das Dashboard strikt auf `127.0.0.1`. Es gibt kein HTTPS und
keine Benutzerverwaltung – nur im vertrauenswuerdigen Heimnetz nutzen.
Den Tueroeffner der DoorBird gibt es im Dashboard bewusst nicht.

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
│  • Task-Poll 2s / 1s  ─┼─────────▶│ /api/hub/tasks/:id/result │
│  • Kameras / DoorBird  │          │ /api/hub/cameras …        │
│  • Face + ALPR + YOLO  │          │ HubAgent / HubTask (DB)   │
│  • Self-Update 5min    │          │                          │
└────────────────────────┘          └──────────────────────────┘
```

Auth läuft über das Account-API-Token (`Authorization: Bearer …`), wie bei
den Raspberry Pis.
