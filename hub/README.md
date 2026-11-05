# EMP-Access-Hub

Lokaler On-Site-Agent für EMP Access. Läuft auf einem Mac (z. B. iMac im
Technikraum), verbindet sich **ausschließlich outbound** mit der Cloud
(kein Port-Forwarding nötig) und führt lokale Aufgaben aus.

## Was er kann

- **Heartbeat**: alle 60 s zur Cloud; Task-Poll alle 5 s, bei offenen Tasks
  verkürzt er sich auf 1 s.
- **Updates ohne Neustart**: Ein Push auf `main`, der nur die Cloud betrifft,
  zieht den Checkout nach, startet den Hub aber nicht neu. Neu gestartet wird
  nur, wenn sich unter `hub/` etwas geändert hat.
- **Bilder** gehen verkleinert in die Cloud (1280 px, Personen 1600 px); das
  Original bleibt lokal für Gesichts- und Kennzeichen-Pipeline.
- **Task-Queue**: pollt offene Tasks, arbeitet zeitkritische parallel
  (`SCAN_SNAPSHOT`, Türöffner, PTZ, Snapshots). `NETWORK_SCAN` läuft im
  Hintergrund und blockiert die Queue nicht.
- **Netzwerk**: Ping-Sweep + Portscan (alle 30 min) über alle VLANs
  (`src/netmap.ts`, siehe „Mehrere VLANs“ unten), Wake-on-LAN, optional
  SNMP der NETGEAR-Switches (Ports/VLANs/MAC-Tabelle, Laufzeit) und die
  ARP-Tabelle des Routers für MACs in gerouteten VLANs.
- **Shelly**: Scan erkennt Shellys (Gen1 und Gen2+/Pro) an `/shelly`;
  Status und Relais schalten im lokalen Dashboard (mit Rückfrage) und per
  Task `SHELLY_STATUS` / `SHELLY_SWITCH` (`{ host, channel, on }`).
- **Kameras (Reolink)**: CGI-Polling (parallel), Events, Personen- und
  Fahrzeug-Pipelines, PTZ/Scheinwerfer/IR/Sirene, MAC-Re-Mapping bei DHCP
  und VLAN-Umzug (lokale ARP, Router-ARP, notfalls Ping-Sweep).
- **DoorBird**: `monitor.cgi` (Push), Klingel, Türöffner, Telegram-Torwunsch,
  MAC-Re-Mapping wie bei den Kameras (neue IP → Cloud + Streams).
  **Tor offen halten** (Task `DOORBIRD_HOLD`, Webcams/Kameras → Uhr-Symbol):
  Das Tor schließt ~1 min nach jedem Impuls von selbst, darum löst der Hub
  das Relais bis zum gewählten Endzeitpunkt alle 50 s erneut aus
  (`HUB_GATE_HOLD_PULSE`) und meldet jeden Impuls an die Cloud. Zielzustand
  ist `Camera.doorHoldUntil`; nach einem Hub-Neustart wird eine laufende
  Offenhaltung aus der Kamera-Konfiguration wieder aufgenommen, „Beenden“
  stoppt sofort.
- **Gesichter**: InsightFace-Sidecar (`buffalo_l`, CoreML wenn vorhanden).
- **Kennzeichen**: fast-alpr (primär), macOS Vision als Fallback; lokale
  Aktoren (DoorBird/Shelly) ohne Cloud-Roundtrip. Ohne lesbares Kennzeichen
  entscheidet der YOLO-Tracker, ob überhaupt ein Auto an der Einfahrt steht:
  Boxen unter der Mindestgröße (Standard 2 % Bildfläche) oder außerhalb der
  Einfahrtszone gelten als Hintergrundverkehr. Beides wird pro Kamera in der
  Cloud eingestellt (Kameras → Bearbeiten → „Fahrzeug ohne Kennzeichen“, Zone
  per Klick auf den Schnappschuss); `HUB_VEHICLE_MIN_AREA` und
  `HUB_VEHICLE_ZONE(_<id>)` in `.env` sind nur noch der Fallback.
- **Log-Abruf**: Task `HUB_LOG` liefert Ausschnitte von `emp-hub.log`,
  `emp-hub.error.log` oder der Diagnose an die Cloud (Netzwerk → Lokaler Hub
  → „Log abrufen“): Dateiende, ab Zeitpunkt (Binärsuche über die
  Zeitstempel) oder blätternd, mit Zeilenzahl und Filter. Kein SSH nötig.
- **Dienst-Neustart**: Task `SERVICE_RESTART` startet den YOLO-Tracker
  (`launchctl kickstart -k`, Label `HUB_TRACKER_LAUNCHD_LABEL`) oder den Hub
  selbst neu – nur diese beiden, kein freier Befehl.
- **Parken**: YOLO-Tracker-Zonen (`vehicleGate`) → Cloud.
- **Soundweb London (BSS)**: je Prozessor eine DI-Verbindung (TCP 1023,
  `src/soundweb.ts`, Byte-Protokoll in `src/soundweb-protocol.ts`). Geräte
  und Regler kommen aus der Cloud (Audio → Soundweb, `GET /api/hub/soundweb`),
  der Hub abonniert die State Variables, meldet Werte und Verbindungszustand
  (`POST /api/hub/soundweb/state`) und setzt Werte per Task `SOUNDWEB_SET`;
  `SOUNDWEB_SYNC` lädt die Konfiguration sofort neu. Lebenszeichen alle zwei
  Minuten per erneutem Abonnement, Wiederverbinden mit Backoff 3–60 s.
- **Mammotion-Mäher** (`src/mower.ts`, Dienst `mower/server.py`): Status,
  Akku, Fortschritt, Karte und die Aufgaben aus der Mammotion-App; Aufgabe
  sofort starten, Zeitplan an/aus, Pause, Fortsetzen, Auftrag beenden, zur
  Station. Läuft über die inoffizielle Bibliothek PyMammotion und die
  Mammotion-Cloud, nur mit `MAMMOTION_EMAIL`/`MAMMOTION_PASSWORD` eines
  Zweit-Accounts (siehe `.env.example`). Der Dienst meldet sich einmal an und
  stellt die Sitzung danach aus `mower/.cache/session.json` wieder her, weil
  Mammotion Konten mit ständigen Passwort-Logins sperrt. Python 3.13+ nötig,
  das venv richtet der Hub beim Start selbst ein (`mower/install.sh`).
  Zonen zeichnen geht nur in der App.
- **Mäher-Kameras** (`src/mower-streams.ts`, WHEP im Mäher-Dienst): Der Hub
  trägt je Kamera zwei Streams in go2rtc ein, `mower_<name>_<uid>` (H265 per
  WHEP vom Dienst, der dafür mit pyagorartc dem Agora-Kanal beitritt) und
  `…_h264` (ffmpeg, für jeden Browser). Die Zentrale zeigt sie als Kachel,
  live nur in der Großansicht; kein Standbild, keine Vorschau-Auffrischung,
  weil jede Verbindung die Kamera am Mäher einschaltet und die
  Mammotion-App dann kein Bild hat. Schaut in go2rtc niemand mehr zu oder
  nach `MOWER_CAMERA_MAX_S` (900 s), beendet der Dienst die Sitzung und
  schaltet die Kamera ab. Bei Bildproblemen helfen `MOWER_CAMERA_STRIP_MID=0`
  oder `MOWER_CAMERA_H265_FMTP=0` in `hub/.env`.
- **Streams**: Cloud-Camera ist führend; der Hub schreibt IPs in
  `webcams/config.json` und `go2rtc.yaml` (gitignored, kein Auto-Commit).
- **Selbst-Update**: alle 5 min `git fetch` (async). Bei neuen Commits:
  `reset --hard origin/main` + `npm install` + Neustart durch launchd.

## Mehrere VLANs

Nach der VLAN-Aufteilung (Kameras 30, Betrieb/IoT 40, Anlage/Audio 41 …)
bleibt der Hub **standardmäßig in VLAN 1** und erreicht die anderen Netze
über das Inter-VLAN-Routing des Routers (PR60X: an für 1, 30, 70). So bleibt
das Kamera-VLAN isoliert; der Hub braucht dafür kein eigenes Bein darin.

In `hub/.env`:

- `HUB_VLANS` – Soll-VLANs mit Namen und Subnetz; alle werden gescannt, das
  Dashboard zeigt je VLAN „direkt über …“, „nur geroutet“ oder „nicht
  erreichbar“ (Routing aus).
- `HUB_SNMP_ROUTER` – Router-IP; liefert per SNMP die MACs aus gerouteten
  VLANs (dort sieht der Hub keine ARP-Einträge). Ohne SNMP fehlen dort die
  MACs, und diese Geräte gehen nicht in die Cloud-Geräteliste.
- `HUB_SCAN_EXCLUDE` – VLANs, die nicht gescannt werden sollen.

Kameras und DoorBird werden über ihre **MAC** wiedergefunden: Der Hub lernt
die MAC, solange ein Gerät erreichbar ist (ARP, Router-SNMP oder bei Reolink
direkt per `GetLocalLink`). Antwortet es nicht mehr, sucht er die MAC in der
ARP-Tabelle (lokal + Router), pingt notfalls die Netze an und fragt bei
Reolink die Kandidaten aus dem letzten Scan per API nach ihrer MAC. Taucht
sie unter neuer IP auf, stellt er sofort um, meldet die IP an die Cloud und
zieht go2rtc/Kiosk nach.

**Optional** (nur wenn ein VLAN ohne Routing direkt erreichbar sein soll und
der Hub per Kabel an einem Trunk-Port hängt): `install/setup-vlans.sh` legt
macOS-VLAN-Interfaces an (Trockenlauf ohne `--apply`). Das umgeht die
Isolation des VLANs – bewusst entscheiden.

## Betrieb rund um die Uhr

Der Hub läuft als **launchd-Agent in der Benutzersitzung** (`gui/<uid>`,
`~/Library/LaunchAgents`). Das heißt: Meldet sich der Benutzer am Hub-Mac ab
oder fährt ihn herunter, endet der Hub mit einem SIGTERM und startet erst mit
der nächsten Anmeldung wieder – genau so entstand die Lücke vom 03.09. 20:37
bis 04.09. 10:53 Uhr, in der keine Kamera, kein Kennzeichen und kein
Türöffner lief. Dasselbe gilt für Tracker und go2rtc.

Was der Hub selbst tut (bei jedem Start, also auch nach jedem Update,
`src/system-setup.ts`):

- **Ruhezustand verhindern:** `caffeinate -i -s` läuft mit, solange der Hub
  lebt – ohne Root, sofort wirksam.
- **Energieeinstellungen nachziehen:** Ist die sudoers-Regel aus dem
  Setup-Skript vorhanden, setzt er `pmset` selbst (nie schlafen, Neustart
  nach Stromausfall, tägliches Einschalten um `HUB_POWER_ON_TIME`, Standard
  06:00). Ändert jemand die Werte, stehen sie nach dem nächsten Hub-Start
  wieder.
- **Zustand melden:** Auto-Login, Ruhezustand und Einschaltplan stehen im
  Log („Systempflege: …“), im Diagnose-Snapshot und in der Hub-Karte unter
  Netzwerk – mit Hinweis, wenn etwas fehlt.

Was einmal Root braucht – **einmalig auf dem Hub-Mac**:

```bash
cd ~/repos/emp-access/hub && sudo ./install/setup-system.sh 06:00
```

Das Skript setzt die `pmset`-Werte, plant das tägliche Einschalten, legt die
sudoers-Regel nur für `/usr/bin/pmset` an und schaltet die automatische
Anmeldung des Hub-Benutzers ein (Passwort wird abgefragt, nicht gespeichert;
mit FileVault geht Auto-Login nicht). Danach genügt: zum Betriebsende den
Bildschirm sperren, nicht abmelden – und selbst ein Herunterfahren endet
morgens um 06:00 mit einem laufenden Hub.

Fällt der Hub trotzdem aus, kommt innerhalb von zehn Minuten ein **Push „Hub
offline“** an alle registrierten Geräte (Einstellungen →
Push-Benachrichtigungen) und „Hub wieder online“, sobald der Heartbeat zurück
ist (`HubAgent.offlineNotifiedAt`, 5-Minuten-Cron).

Eine LaunchDaemon-Variante (läuft ohne angemeldeten Benutzer) ist nicht
umgesetzt: Vision-OCR und Face-Sidecar müssten dafür erst einmal in einer
Sitzung ohne Fenster-Server geprüft werden.

## Hub-Assistent (lokales Sprachmodell + Telegram)

`src/agent/`: Ein lokales Modell über Ollama spricht über einen **eigenen Telegram-Bot** mit dem Betreiber, überwacht den Hub und schlägt Verbesserungen vor. Der Bot läuft per Long Polling vom Hub aus, also ohne Webhook und auch dann, wenn die Cloud nicht erreichbar ist.

- **Einschalten:** Bot bei @BotFather anlegen, Token als `HUB_AGENT_TELEGRAM_TOKEN` in `hub/.env`. Beim nächsten Start installiert der Hub Ollama per Homebrew (falls nötig), startet es mit `brew services` und lädt das Modell (`HUB_AGENT_MODEL`, Vorgabe `qwen3:30b-a3b-instruct-2507-q4_K_M`, rund 19 GB, ohne Denkmodus; ist nur ein älteres `qwen3:30b` da, arbeitet der Hub damit weiter, bis das neue geladen ist). Bis das Modell bereit ist, beantwortet der Bot `/status` und `/befunde` ohne Modell.
- **Kopplung:** Der Bot redet nur mit freigeschalteten Chats. Beim ersten „Hallo“ schickt der Hub einen sechsstelligen Code über den Alarmkanal der Cloud (`/api/hub/alerts`, Quelle `agent`, also Push und Alarm-Telegram). Wer den Code im Bot eingibt, ist gekoppelt (`.cache/agent.json`). Fünf falsche Versuche sperren, der Code gilt 15 Minuten.
- **Werkzeuge** (`tools.ts`): Lesen läuft sofort (Lage, Kameras, Standbild, Ereignisse, Log, Räume mit Live-Zustand, Klima, Netzwerk-Inventar, Ping, Mäher, Verbesserungslog, Notizen). Alles, was schaltet (Gerät, Kamera-Licht/Sirene/Preset, Tor, Mäher, Dienst-Neustart), kommt als Rückfrage mit Knopf „Ausführen“. Netzwerk-Änderungen (Router, Switches, VLANs, DHCP, WLAN) und freie Shell-Befehle gibt es bewusst nicht.
- **Wächter** (`watch.ts`, alle 5 min): Cloud-Verbindung, Kameras und DoorBird aus Hub-Sicht, RAM und Platte, Tracker, Soundweb, Face-Sidecar. Warnungen erst nach zwei Prüfungen, Alarme sofort, Entwarnung wenn erledigt. In der Ruhezeit (`HUB_AGENT_QUIET`, Vorgabe 22–7 Uhr) gesammelt am Morgen. Was die Cloud schon meldet (Hub offline, Gerät offline, Switch-Befunde), meldet der Wächter nicht doppelt.
- **Tagesbericht** um `HUB_AGENT_REPORT_TIME` (Vorgabe 07:30): Lage, Auffälligkeiten, höchstens drei Vorschläge. Vorschläge, keine eigenmächtigen Änderungen.
- **Sprachnachrichten** (`voice.ts`): werden lokal mit whisper.cpp in Text umgewandelt (Homebrew `whisper-cpp`, Modell `HUB_AGENT_WHISPER_MODEL`, Vorgabe `large-v3-turbo`, ~1,6 GB in `.cache/whisper`, OGG → WAV per ffmpeg). Der Bot zeigt kurz, was er verstanden hat, und antwortet dann wie auf eine Textnachricht. Audio verlässt den Hub nicht.
- **Bilder** (`ollama.ts`, `sentinel.ts`): Zweites Ollama-Modell `HUB_AGENT_VISION_MODEL` (Vorgabe `qwen3-vl:8b`, ~6 GB). Werkzeug `look_at_camera` sieht sich ein aktuelles Kamerabild an; Fotos im Chat wertet es ebenfalls aus.
- **Wächter mit Bildern** (`sentinel.ts`, Regeln in `sentinel-rules.ts`): Beginnt ein Personen- oder Fahrzeugereignis an einer Kamera, deren Raum gerade geschlossen ist (ohne Betriebszeit: im Nachtfenster `HUB_AGENT_SENTINEL_NIGHT`, Vorgabe 22–6), bewertet das Bildmodell das Standbild. Auffälliges: PTZ-Kamera folgt 3 Minuten automatisch und stellt sich danach zurück, drei Bilder im Abstand von 4 s gehen per Telegram raus, dazu Knöpfe „Neues Bild“, „Licht an“, „Sirene“. Licht und Sirene nur per Knopf, nie automatisch. Je Kamera höchstens alle 3 Minuten, insgesamt `HUB_AGENT_SENTINEL_MAX_PER_HOUR` (30). `HUB_AGENT_SENTINEL=off` schaltet ab, `=always` bewertet auch im Betrieb.
- **Personen: Mitarbeiter oder nicht?** (`sentinel.ts`, `people.ts`, Regeln `decidePerson` in `sentinel-rules.ts`): Bei einer Person zoomt der Wächter heran (Zoom-Objektiv auf ~60 %, PTZ folgt vorher), bewertet die Nahaufnahme (Anzahl, Arbeitskleidung, Tätigkeit, verdächtiges Verhalten) und gleicht sie mit den eingestempelten Mitarbeitern aus emp-control (`staff.ts`) ab. Kein Alarm, wenn höchstens so viele Personen da sind wie eingestempelt und sie Arbeitskleidung tragen oder es tagsüber (6–20 Uhr) ist, oder wenn die bestehende Gesichtserkennung einen Whitelist-Treffer hat. Verdächtiges Verhalten, Blacklist-Treffer, mehr Personen als eingestempelt oder niemand eingestempelt → Alarm mit Nahaufnahme und Übersichtsbild.
- **Wiederkehrende Fahrzeuge** (`vehicles.ts`, Logik in `repeat-vehicles.ts`): War ein unbekanntes Kennzeichen an `HUB_AGENT_VEHICLE_VISITS` (3) Besuchen da (neuer Besuch nach 2 h Abstand), schickt der Assistent ein Bild mit „Genehmigen“ / „Nein“. Genehmigen legt das Fahrzeug in der Cloud an (`POST /api/hub/allowed-vehicles`, nur für die Kamera, an der es gesehen wurde) und lädt die Liste neu; danach kein Wächter-Alarm mehr dafür. „Nein“ merkt sich die Antwort, unbeantwortet wird nach 7 Tagen erneut gefragt. Fragen in der Ruhezeit warten bis morgens. Zählerstand in `.cache/agent-vehicles.json`, `HUB_AGENT_VEHICLE_ASK=off` schaltet ab.
- **Speicher:** Das Modell bleibt `HUB_AGENT_KEEP_ALIVE` (30 min) nach der letzten Anfrage geladen und wird dann entladen.

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
Ohne Token bleibt das Dashboard strikt auf `127.0.0.1`. Es gibt keine
Benutzerverwaltung – nur im vertrauenswuerdigen Netz (LAN/VPN) nutzen.
Das Cookie gilt ein Jahr und verlaengert sich bei jedem Aufruf; das Token
wird nach der Anmeldung aus der Adresse entfernt.

### Als App auf iPhone/iPad (PWA)

Das Dashboard ist eine Home-Bildschirm-App (Manifest, Icons, Service Worker,
Safe-Area, Touch-Gesten). Service Worker gibt es auf iOS nur per HTTPS,
deshalb spricht der Port **8787 HTTP und HTTPS gleichzeitig**. Beim ersten
Start legt der Hub dafuer eine eigene CA an (`hub/.tls/`, nicht im Git) und
stellt ein Zertifikat fuer seine LAN-IPs und `<hostname>.local` aus
(zusaetzliche Namen: `HUB_DASHBOARD_TLS_NAMES`, abschalten:
`HUB_DASHBOARD_TLS=0`). Einmal pro Geraet:

1. In Safari `http://<Hub-IP>:8787/ca.crt` laden („Profil geladen“).
2. Einstellungen → Allgemein → VPN & Geräteverwaltung → Profil installieren.
3. Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen →
   „EMP-Access Hub CA“ einschalten.
4. `https://<Hub-IP>:8787/` oeffnen, Token eingeben, Teilen → „Zum
   Home-Bildschirm“.

Das Dashboard zeigt auf dem Telefon selbst einen Hinweis, welcher Schritt
fehlt. Der Service Worker cached nur die App-Huelle (Netz zuerst, Cache nur
wenn der Hub nicht antwortet); `/api/*`, Livebilder und Standbilder gehen
immer direkt ans Netz.
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
