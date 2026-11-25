# EMP-Access-Hub

Lokaler On-Site-Agent für EMP Access. Läuft auf einem Mac (seit 05.11.2026
ein Mac Studio im Technikraum, Betrieb siehe
[`docs/projektwissen/hub-betrieb.md`](../docs/projektwissen/hub-betrieb.md)), verbindet sich **ausschließlich outbound** mit der Cloud
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
  Aktoren (DoorBird/Shelly) ohne Cloud-Roundtrip. Tor und Shelly schalten
  nur bei einem **exakten** Treffer auf der Fahrzeugliste (liefert die Lesung
  eine Sicherheit, zusätzlich mindestens `HUB_ALPR_ACTUATE_MIN_CONF`,
  Standard 0,5). Ein unscharfer Treffer
  (gleiche Ziffern, ein bis zwei Zeichen daneben) steht nur als Hinweis
  „vermutlich …“ in Log und Ereignis und schaltet nie – weder lokal noch
  ersatzweise über die Cloud (`plate-match.ts`). Das Tor öffnet nur die dem
  Fahrzeug in der Fahrzeugverwaltung zugewiesene DoorBird
  (`vehicle-actuate-rules.ts`). Wird ein Fahrzeug der Liste ohne DoorBird und
  ohne Shelly gelesen, steht das höchstens stündlich je Fahrzeug im Log
  („… ohne zugewiesene DoorBird und ohne Shelly – keine lokale Schaltung“),
  Zähler `alpr.no_actuator`. Ein Shelly ohne IP-Adresse zählt nicht dazu:
  Ihn schaltet die Cloud über die Shelly-Cloud (Feld `shellyLinked` der
  Liste). `HUB_DOORBIRD_FALLBACK=1` (auch `true`, `ja`,
  `on`) stellt den früheren Rückfall her: ohne Zuweisung die DoorBird, wenn
  genau eine eingerichtet ist (Log höchstens stündlich je Fahrzeug, Zähler
  `alpr.doorbird_fallback`). Die Genehmigung per Telegram schickt die
  DoorBird mit, wenn genau eine eingerichtet ist. Lieferdienst-Öffnung
  (`HUB_DELIVERY_DOORBIRD_ID`, sonst die einzige DoorBird), Aufträge aus der
  Cloud und Offenhaltung bleiben unberührt. Kreise mit Umlaut (LÜD,
  LÜN, BÜR, GÖ …) liest die Erkennung ohne Umlaut: Der Abgleich vergleicht
  zusätzlich die Schreibweise ohne Umlaut des Listen-Eintrags, weiter Zeichen
  für Zeichen und nur, wenn sich diese Zeichen nicht auch als Kennzeichen
  eines anderen Kreises lesen lassen (BÖ und BO, GÖ-AB und GOA-B); die Cloud
  entscheidet gleich (`src/lib/plate-match.ts`). Eine Lesung mit einem
  solchen Kreis gilt als bekannter Kreis und erscheint mit Umlaut
  (`UMLAUT_CITY_BY_PLAIN` in `plate-cities.ts`). Ohne lesbares Kennzeichen
  entscheidet der YOLO-Tracker, ob überhaupt ein Auto an der Einfahrt steht:
  Boxen unter der Mindestgröße (Standard 2 % Bildfläche) oder außerhalb der
  Einfahrtszone gelten als Hintergrundverkehr. Beides wird pro Kamera in der
  Cloud eingestellt (Kameras → Bearbeiten → „Fahrzeug ohne Kennzeichen“, Zone
  per Klick auf den Schnappschuss); `HUB_VEHICLE_MIN_AREA` und
  `HUB_VEHICLE_ZONE(_<id>)` in `.env` sind nur noch der Fallback.
  Ist der Fahrzeug-Alarm beim ersten Bild schon wieder aus, wird das schon
  geholte Bild trotzdem gelesen (Kennzeichen, Fahrzeug-Prüfung); nur ohne
  Fund endet der Burst dort. Hat der Listen-Treffer eines Bilds Tor oder
  Shelly geschaltet, endet der Burst zwei Bilder danach. Jeder Burst endet
  mit einer Zeile mit Bildzahl und Grund.
- **Fahrzeugliste** (`plate.ts`, Regeln in `whitelist-rules.ts`): kommt alle
  5 min aus der Cloud und liegt für den Betrieb ohne Cloud in
  `.cache/allowed-vehicles.json` (mit Zeitpunkt des letzten gelungenen
  Abrufs). Ist sie älter als 5 min, warten die Bilder eines Bursts zusammen
  höchstens 1,5 s auf einen gemeinsamen Abruf (Zeitlimit 8 s), nach einem
  gescheiterten Abruf eine Minute lang gar nicht. Ein gescheiterter Abruf steht sofort und
  dann alle 30 min mit Ursache und Alter der Liste im Log, der erste Erfolg
  danach einmal. Gelingt `HUB_WHITELIST_MAX_AGE_H` (Standard 168 = 7 Tage,
  0 = unbegrenzt) lang kein Abruf, öffnet kein Kennzeichen mehr Tor, Tür
  oder Shelly („Fahrzeugliste seit … nicht erneuert, automatische Öffnung
  ausgesetzt“, Hub-Ereignis, dazu ein Befund an die Cloud über
  `/api/hub/alerts`, Quelle `fahrzeugliste-<Hub-Name>`, also Push und Alarm-Telegram,
  sobald sie erreichbar ist); Erkennung, Sichtungen und Anzeige laufen
  weiter, der nächste gelungene Abruf hebt das auf und nimmt den Befund
  zurück. Vor Ort ohne Cloud:
  `HUB_WHITELIST_MAX_AGE_H=0` in `hub/.env` und den Hub neu starten.
  Lieferdienst-Öffnung und Offenhaltung nutzen die Fahrzeugliste nicht und
  bleiben unberührt.
- **Weißlicht nachts** (`vehicle-light-rules.ts`, `vehicle-light.ts`): Im
  Dunkeln (Sonnenzeiten von Open-Meteo, sonst 17–8 Uhr) schaltet der Hub an
  der Zufahrtskamera (Name mit Eingang/Einfahrt/Tor/Zufahrt oder
  `HUB_VEHICLE_SPOTLIGHT=<IDs>`, `=0` aus) für den Burst das Weißlicht ein.
  Ein Burst mit Licht nimmt die ersten `HUB_VEHICLE_LIGHT_MIN_FRAMES` Bilder
  (Standard 8, rund 7 Sekunden Licht; 0 = der Alarm entscheidet wie ohne
  Licht) unabhängig vom Alarm auf, auch wenn das Kennzeichen schon vorher
  sicher gelesen ist. Früher endet er nur zwei Bilder nach einer Schaltung
  durch einen Listen-Treffer. Das Licht geht direkt nach dem letzten Bild aus,
  spätestens nach 60 s und beim Beenden des Hubs. Zeigte keines der
  ausgewerteten Bilder Kennzeichen oder Fahrzeug, bleibt das Licht
  `HUB_VEHICLE_SPOTLIGHT_MUTE_MS` (5 min) aus; mit Mindestzahl erst, wenn
  mindestens so viele Bilder ausgewertet sind (bricht der Burst vorher ab,
  weil ein Bild nicht abrufbar war, gibt es keine Sperre). Im Dunkeln nennt das Log je
  Burst „Weißlicht an“ oder „kein Weißlicht (Grund)“, dazu den Lichtmodus,
  wie die Kamera ihn gemeldet hat („Lichtmodus laut Kamera mode=…“).
- **Weißlicht schalten** (`spotlight-rules.ts`; Burst, Aufträge aus Cloud,
  Dashboard und Assistent, Wächter-Knopf „Licht an“): Der Hub schaltet nur
  an und aus. Vor dem Schalten liest er `GetWhiteLed` (der Burst nutzt seine
  Abfrage von eben) und schickt Lichtmodus und Helligkeit so zurück, wie die
  Kamera sie meldet; Zeitplan und Erkennungsarten stehen nicht im Befehl.
  Eine Helligkeit aus dem Auftrag gilt nur beim Einschalten. Meldet die
  Kamera keinen brauchbaren Stand, geht für diesen Befehl der frühere hinaus
  (Lichtmodus 1, Helligkeit 100), Logzeile höchstens stündlich je Kamera,
  Zähler `camera.spotlight_fallback`. `HUB_SPOTLIGHT_LEGACY=1` (auch `true`,
  `ja`, `on`) stellt den früheren Befehl für jedes Schalten her. Dieselbe
  Regel gilt im Kiosk (`webcams/lib/spotlight-param.ts`, dort
  `WEBCAMS_SPOTLIGHT_LEGACY=1`).
- **Lieferdienste** (`delivery.ts`): DHL/Deutsche Post, UPS, GLS, DPD, Hermes,
  Amazon an der Aufschrift, mindestens auf 2 Bildern des Bursts. Steht die
  Marke auf einem Bild und ist das Kennzeichen sicher gelesen (ab 90 %),
  merkt sich der Hub „Kennzeichen → Marke“ (`.cache/delivery-plates.json`,
  90 Tage ab letzter Sichtung, höchstens 200, Logik in
  `delivery-plates-rules.ts`). Beim nächsten Besuch meldet er den
  Lieferdienst schon am Kennzeichen, auch wenn die Aufschrift (frontal)
  nicht lesbar ist. Ein gemerktes Kennzeichen öffnet nie das Tor; dafür das
  Kennzeichen als freigegebenes Fahrzeug eintragen.
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
  `reset --hard` auf `origin/main`, bei geändertem Hub-Code `npm ci` (nur
  wenn sich `package.json`/`package-lock.json` geändert haben), Pre-Flight
  und erst dann Neustart durch launchd. Schlägt etwas fehl, geht der Checkout
  zurück auf den vorherigen Commit (siehe „Selbst-Update absichern“).

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
- **Wächter** (`watch.ts`, alle 5 min; Ablauf in `watch-runner.ts`, Regeln in `findings.ts`): Cloud-Verbindung, Kameras und DoorBird aus Hub-Sicht, RAM und Platte, Tracker, Soundweb, Face-Sidecar, Bildmodell (siehe „Bildmodell fällt aus“). Warnungen erst nach zwei Prüfungen, Alarme sofort, Entwarnung wenn erledigt. In der Ruhezeit (`HUB_AGENT_QUIET`, Vorgabe 22–7 Uhr) gesammelt am Morgen. Was die Cloud schon meldet (Hub offline, Gerät offline, Switch-Befunde), meldet der Wächter nicht doppelt. Der Stand (gemeldete Befunde, für den Morgen zurückgestellte Meldungen, Entwarnungen, die noch keinen Chat erreicht haben) liegt nach jeder Änderung in `.cache/agent-watch.json` (in einem Zug ersetzt) und wird beim Start übernommen: Nach einem Neustart des Hubs wird ein schon gemeldeter Befund nicht noch einmal gemeldet, und was währenddessen in Ordnung kam, bekommt seine Entwarnung. Ein Stand, der älter als 24 Stunden oder nicht lesbar ist, wird verworfen (Zeile im Log; ein leerer Stand gilt still). Auf der Platte gilt ein Befund erst als gemeldet, wenn seine Meldung zugestellt ist: Endet der Hub vorher, kommen Meldung und Entwarnung nach dem Neustart erneut. Jede Meldung steht mit dem Schlüssel ihres Befunds im Log: „Zustands-Wächter: gemeldet [cam:5] Kamera Seilbahn A nicht erreichbar“, „Zustands-Wächter: Entwarnung [cam:5] … (nach 12 min)“, „Zustands-Wächter: Ruhezeit, Meldung kommt am Morgen [ram] …“.
- **Früherkennung** (`health-trends.ts` sammelt, Regeln in `agent/early-warning.ts`): Der Hub führt 7 Tage Verlauf in `.cache/health-trends.json` und meldet, was sich ankündigt, bevor es ausfällt. Erreichbarkeit jeder Kamera (jeder Poll), DoorBird, Soundweb, Shellys, Cloud und Switches (SNMP) in 15-Minuten-Eimern: Vorwarnung ab 3 Aussetzern pro Stunde, 5 % Fehlversuchen oder 12 Aussetzern am Tag, mit Vergleich zur Vorwoche („nimmt zu“); wackeln viele Geräte gleichzeitig, kommt eine Sammelmeldung (eher Hub, Kern-Switch oder Router). Neustarts aus der Laufzeit von Switches, Shellys und dem Mac (ab 2 in 24 h oder 4 in 7 Tagen). Switch-Ports: `ifInErrors` (ab 100 Fehler in 24 h) und `ifLastChange` (ab 6 Link-Wechseln in 24 h). Shelly-Gerätetemperatur ab 75 °C. Platten-Prognose per Regression (voll in ≤ 14 Tagen). Abgelaufene oder abgelehnte Anmeldungen (Mammotion, Hub-Token der Cloud, Shelly-Passwort). Vorwarnungen laufen über den Wächter (gleiche Bestätigung, Ruhezeit und Entwarnung, Hysterese gegen Flattern), `/vorwarnungen` zeigt sie samt Verläufen, das Werkzeug `early_warnings` liefert sie dem Modell. Nur lesend, nichts wird geschaltet. Stichproben-Takt `HUB_HEALTH_SAMPLE_INTERVAL` (300 s).
- **Tagesbericht** um `HUB_AGENT_REPORT_TIME` (Vorgabe 07:30): Lage, Auffälligkeiten, Früherkennung (was sich ankündigt, mit Zahlen), höchstens drei Vorschläge. Vorschläge, keine eigenmächtigen Änderungen. Der Tag gilt erst als erledigt, wenn der Bericht einen Chat erreicht hat: Bis dahin geht derselbe Text nach 5 Minuten Pause erneut in die Zustellung (Regeln in `report-rules.ts`).
- **Zustellung** (`dispatch.ts`, Warteschlange `outbox.ts`, Regeln in `outbox-rules.ts`): Alarme des Wächters mit Bildern, ihre Zusatzbilder, die Meldungen des Wächters, Tagesvorschau und Tagesbericht gehen über eine Sende-Warteschlange im Speicher, je Chat in der Reihenfolge des Einreihens. Der erste Versuch geht sofort hinaus, die weiteren nach 5 s, 20 s, 60 s und dann alle 3 Minuten, höchstens 15 Minuten lang. Wiederholt wird bei Netzfehler, Zeitüberschreitung, HTTP 5xx und 429 (mit der Wartezeit, die Telegram nennt), nicht bei anderen 4xx. Lehnt Telegram das Bild eines Alarms ab oder läuft die Frist ab, geht der Alarm als Text mit seinen Knöpfen hinaus, auch wenn ein Versuch mit Bild erst nach dem Ende der Frist scheitert; das Bild steht dann in der Zentrale unter KI. Die Bewertung der nächsten Kamera wartet nicht auf die Zustellung. Im Log steht jede Zustellung, die mehr als einen Versuch gebraucht hat („Wächter: Alarm Eingang zugestellt nach 3 Versuchen (25 s)“), und jede Nachricht, die nicht angekommen ist („… NICHT zugestellt nach 9 Versuchen (15 min 0 s): fetch failed“); Zähler `camera.sentinel_send_ok|retry|text|failed`, `camera.sentinel_image_*`, `agent.watch_send_*`, `agent.preview_send_*`, `agent.report_send_*`. Ein Alarm, der keinen Chat erreicht hat, steht 12 Stunden als Befund „Wächter-Alarm nicht zugestellt: Kamera Uhrzeit“ beim Wächter (sofort gemeldet, auch in der Ruhezeit, ohne Entwarnung; Zähler `camera.sentinel_alarm_lost`; die Liste liegt in `.cache/agent-undelivered.json` und übersteht einen Neustart). Hat eine Meldung des Wächters keinen Chat erreicht, kommen ihre Befunde und Entwarnungen bei der nächsten Prüfung erneut, auch nach einem Neustart. Ist kein Chat gekoppelt, bleibt der Alarm im KI-Protokoll der Zentrale, im Log steht dazu höchstens eine Zeile je Stunde. Vor dem Beenden des Hubs geht ein Alarm, der noch auf seinen nächsten Versuch wartet, ein letztes Mal als Text hinaus. Weil das Beenden nur 3 s wartet, steht jeder offene Alarm vorher schon in der Liste der nicht zugestellten und wird bei Zustellung wieder ausgetragen; nach dem Neustart steht dazu einmal „Wächter: 1 Alarm beim letzten Beenden nicht zugestellt“ im Log. Ein Alarm, den schon ein Chat erhalten hat, gilt dabei als zugestellt. Die Knöpfe eines Alarms gelten 10 Minuten ab seiner Zustellung (bei mehreren Chats ab der letzten), auch wenn er in der Warteschlange gewartet hat.
- **Sprachnachrichten** (`voice.ts`): werden lokal mit whisper.cpp in Text umgewandelt (Homebrew `whisper-cpp`, Modell `HUB_AGENT_WHISPER_MODEL`, Vorgabe `large-v3-turbo`, ~1,6 GB in `.cache/whisper`, OGG → WAV per ffmpeg). Der Bot zeigt kurz, was er verstanden hat, und antwortet dann wie auf eine Textnachricht. Audio verlässt den Hub nicht.
- **Bilder** (`ollama.ts`, `sentinel.ts`): Zweites Ollama-Modell `HUB_AGENT_VISION_MODEL` (Vorgabe `qwen3-vl:8b`, ~6 GB). Werkzeug `look_at_camera` sieht sich ein aktuelles Kamerabild an; Fotos im Chat wertet es ebenfalls aus.
- **Wächter mit Bildern** (`sentinel.ts`, Regeln in `sentinel-rules.ts`): Beginnt ein Personen- oder Fahrzeugereignis an einer Kamera, deren Raum gerade geschlossen ist (ohne Betriebszeit: im Nachtfenster `HUB_AGENT_SENTINEL_NIGHT`, Vorgabe 22–6), bewertet das Bildmodell das Standbild. Auffälliges: drei Bilder im Abstand von 4 s gehen per Telegram raus, dazu Knöpfe „Neues Bild“, „Licht an“, „Sirene“. Licht und Sirene nur per Knopf, nie automatisch. Nach einer Bewertung ist die Kamera 3 Minuten gesperrt. Hat die Bewertung nichts ergeben (unauffällig, niemand im Bild, Fehler), sieht der Wächter im Nachtfenster schon nach 45 Sekunden wieder hin; diese zusätzlichen Blicke verschieben den 3-Minuten-Takt nicht, nutzen nur, was vom Stundenlimit `HUB_AGENT_SENTINEL_MAX_PER_HOUR` (30, über alle Kameras) übrig ist, und zählen selbst nicht mit. Nach einem Alarm sind es immer 3 Minuten. Höchstens zwei Bewertungen laufen gleichzeitig; ein weiterer Auslöser wird bis zu 30 Sekunden lang erneut versucht. Hält einer der zusätzlichen Blicke einen Platz, verfällt ein wartender Auslöser des 3-Minuten-Takts nicht: Er wird bewertet, sobald ein Platz frei ist. Für jede Stunde mit Auslösern steht eine Bilanz im Log, z. B. „Wächter 23–0 Uhr: 23 Auslöser, 14 bewertet (davon 3 nach kurzer Sperrzeit), 9 übergangen (Abstand 8, Limit 0, belegt 1); 6 Alarm, 5 unauffällig, 3 Tracker leer“. `HUB_AGENT_SENTINEL=off` schaltet ab, `=always` bewertet auch im Betrieb.
- **Bildmodell fällt aus** (`ollama.ts`, `sentinel.ts`, `watch.ts`, Regeln in `vision-rules.ts`): Der Zustands-Wächter meldet „Bildmodell nicht bereit“ (länger als 60 Sekunden nicht bereit, mit dem Grund) und „Bildmodell antwortet nicht (N Fehler in Folge)“: Jeder gescheiterte Aufruf zählt, der erste gelungene setzt den Zähler zurück und bringt die Entwarnung. Solange der Wächter mit Bildern eingeschaltet ist, ist das ein Alarm und kommt bei der nächsten Prüfung, auch in der Ruhezeit; mit `HUB_AGENT_SENTINEL=off` ist es eine Warnung, mit `HUB_AGENT_VISION=0` gibt es keinen Befund. Ist das Bildmodell nicht bereit, bewertet der Wächter keine Kamera-Ereignisse und stellt es aus seinem Takt höchstens alle 5 Minuten neu bereit (lädt das Modell, wenn es in Ollama fehlt; die Zeile „lade Modell“ kommt dabei einmal bis zum nächsten Erfolg). Im Log steht eine Zeile je Wechsel: „Wächter: Bildmodell nicht bereit (…), Kamera-Ereignisse werden so lange nicht bewertet; Wiederanlauf alle 5 Minuten“ und „Wächter: Bildmodell wieder bereit, Kamera-Ereignisse werden wieder bewertet“. Scheitert der Aufruf zum Übersichtsbild (Ollama nicht erreichbar, Zeitüberschreitung, Fehlerantwort), entscheidet die Regel `onVisionError`: Bei einem Personen-Auslöser, auf dessen Standbild der Tracker mindestens eine Person sieht, oder im Nachtfenster geht der Alarm mit dem Vermerk „ungeprüft, Bildmodell nicht erreichbar“ hinaus, mit dem Standbild, der Bildserie und den Knöpfen „Neues Bild“, „Licht an“, „Sirene“ (ohne Nahaufnahme, ohne Knopf „Ist in Ordnung“ und ohne Eintrag in der Merkliste); ein genehmigtes Fahrzeug bleibt ohne Alarm. Sonst bleibt es beim Befund. Danach gilt die Sperrzeit wie nach einem Fehler (im Nachtfenster 45 Sekunden, sonst 3 Minuten). Log: „Wächter: Eingang AUFFÄLLIG (ungeprüft): Person von der Kamera gemeldet (Tracker sieht 1 Person) – ungeprüft, Bildmodell nicht erreichbar“.
- **Zeitmessung des Bildmodells** (`ollama.ts`, `sentinel.ts`, Regeln in `vision-timing-rules.ts`): Der Hub liest aus jeder Antwort des Bildmodells die Zeitangaben von Ollama (`total_duration`, `load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration`). Zu jeder Bewertung des Wächters steht damit eine Zeile im Log, beide Aufrufe zusammen: „Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token); Nahaufnahme 41,0 s (…); Auslöser bis Urteil 67,8 s“. „Rest“ ist Zeit, die Ollama keinem Abschnitt zuordnet (zum Beispiel Warten auf einen laufenden Aufruf); „im Hub“ steht dabei, wenn der Hub mindestens eine Sekunde länger misst als Ollama; „von 8192 Token“ steht bei Bild+Prompt, sobald das Kontextfenster zu 90 % gefüllt ist; ein gescheiterter Aufruf steht als „gescheitert nach 120,0 s“ da. „Auslöser“ ist der Takt, in dem der Wächter das Ereignis der Kamera gesehen hat (höchstens 3 Sekunden nach dem Ereignis). Zähler im Verbesserungslog: `camera.sentinel_model_call` (beantwortete Aufrufe), `camera.sentinel_model_error`, `camera.sentinel_model_slow` (ab 30 s), `camera.sentinel_model_cold` (Modell erst geladen, ab 1 s), `camera.sentinel_model_ctx` (Kontextfenster zu 90 % gefüllt), `camera.sentinel_verdict` (Bewertungen mit Antwort) und `camera.sentinel_verdict_late` (letzte Antwort später als 30 s nach dem Auslöser). An den Aufrufen selbst ändert die Messung nichts.
- **Personen: Mitarbeiter oder nicht?** (`sentinel.ts`, `people.ts`, Regeln `decidePerson` in `sentinel-rules.ts`): Bei einer Person holt der Wächter eine Nahaufnahme (optisch über `personCloseUp`, sonst digital), bewertet sie (Anzahl, Arbeitskleidung, Tätigkeit, verdächtiges Verhalten) und gleicht sie mit den eingestempelten Mitarbeitern aus emp-control (`staff.ts`) ab. Kein Alarm, wenn höchstens so viele Personen da sind wie eingestempelt und sie Arbeitskleidung tragen oder es tagsüber (6–20 Uhr) ist, oder wenn die bestehende Gesichtserkennung einen Whitelist-Treffer hat. Verdächtiges Verhalten, Blacklist-Treffer, mehr Personen als eingestempelt oder niemand eingestempelt → Alarm mit Nahaufnahme und Übersichtsbild.
- **Digitaler Zoom auf Personen** (`person-crop.ts`, Geometrie in `person-crop-rules.ts`): Der Tracker liefert Personen-Boxen (`/classify` → `persons`), ffmpeg schneidet den Bereich aus dem hochaufgelösten Kamerabild aus und vergrößert ihn. Die Gesichtserkennung prüft Kopf-Ausschnitte, wenn im Vollbild kein Gesicht oder kein Treffer war (strengere Schwelle wie bei hochskalierten Gesichtern). Gesichtserkennung und Wächter nutzen ihn, wenn die optische Nahaufnahme nicht geht oder nicht lohnt.
- **Folgen und optische Nahaufnahme** (`camera-motion.ts`, Regeln in `camera-motion-rules.ts`): Schwenk-Kameras (Gastro, Shop, Halle, Übungslift) schalten beim ersten Personen-Signal das Tracking der Kamera ein (`bSmartTrack`; `aiTrack` ist bei diesen Modellen nicht der Schalter), höchstens 2 Minuten, dann zurück in die Grundstellung (Wachposition der Kamera, sonst Preset „Grundstellung“) und 1 Minute Pause. Fehlt die Wachposition, speichert der Hub die aktuelle Stellung, sobald die Kamera 10 Minuten unbewegt war. Kameras mit Zoom-Objektiv zoomen für Gesichtserkennung und Wächter gezielt heran: Schwenk-Kameras nach dem Zentrieren, reine Zoom-Kameras nur so weit, dass die Person im Bild bleibt (unter 1,3-fach bleibt es digital). Zonen-Kameras (Kennzeichen, Halteverbot, Lieferdienste, Parkfläche) zoomen höchstens 6 s und alle 2 min, folgen nie; Halteverbot, Parkfläche und Belegung warten bzw. halten so lange. Handsteuerung (Zentrale, Cloud, Assistent) bricht ab und sperrt 5 min, Regeln „Kamera steuern“ gehen vor. Laufende Bewegungen stehen in `hub/.cache/camera-motion.json` und werden nach einem Neustart zurückgestellt. Abschalten: `HUB_CAMERA_AUTOFOLLOW=off`, `HUB_CAMERA_AUTOZOOM=off`.
- **Wiedererkennung über Kameras** (`people.ts`, Regeln in `people-rules.ts`): Der Wächter merkt sich bewertete Personen mit einer kurzen Kleidungsbeschreibung des Bildmodells (kein Bild, kein Gesichtsmerkmal, `.cache/agent-people.json`). Bei der nächsten Person an einer anderen Kamera bekommt das Bildmodell diese Liste; passen alle Personen im Bild zu bekannten Einträgen, gibt es keinen neuen Alarm. Drei Arten von Einträgen: *freigegeben* (Whitelist-Treffer der Gesichtserkennung oder Knopf „Ist in Ordnung“ am Alarm) gilt 8 Stunden ab der letzten Sichtung. *Mitarbeiter* (eingestempeltes Personal oder Arbeit am Tag) gilt ebenso lange, zählt aber im Nachtfenster `HUB_AGENT_SENTINEL_NIGHT` nicht: Nachts entscheiden Stempeluhr und Arbeitskleidung bei jeder Sichtung neu. *Gemeldet* (für die Person ging ein Alarm hinaus) gilt 20 Minuten ab dem Alarm und wird beim Wiedersehen nicht verlängert; ist die Person danach noch da, gibt es wieder einen Alarm. Ein gemeldeter Eintrag wird nur umgestellt, wenn genau eine Person im Bild ist und die Gesichtserkennung sie auf der Whitelist findet (dann freigegeben) oder Personal eingestempelt ist (dann Mitarbeiter). Neue Beschreibungen unter dem Namen eines Gesichts-Treffers oder als Mitarbeiter kommen nur dazu, wenn genau eine Person im Bild ist. Die Datei wird in einem Zug ersetzt (`atomic-file.ts`); lässt sie sich nicht lesen, steht der Grund im Log und die Liste beginnt leer.
- **Wiederkehrende Fahrzeuge** (`vehicles.ts`, Logik in `repeat-vehicles.ts`): War ein unbekanntes Kennzeichen an `HUB_AGENT_VEHICLE_VISITS` (3) Besuchen da (neuer Besuch nach 2 h Abstand), schickt der Assistent ein Bild mit „Genehmigen“ / „Nein“. Genehmigen legt das Fahrzeug in der Cloud an (`POST /api/hub/allowed-vehicles`, nur für die Kamera, an der es gesehen wurde) und lädt die Liste neu; danach kein Wächter-Alarm mehr dafür. „Nein“ merkt sich die Antwort, unbeantwortet wird nach 7 Tagen erneut gefragt. Fragen in der Ruhezeit warten bis morgens, auch über einen Neustart (vermerkt im Zählerstand). Zählerstand in `.cache/agent-vehicles.json`, `HUB_AGENT_VEHICLE_ASK=off` schaltet ab.
- **Energie, Mäher, Bewässerung** (`energy.ts`, Regeln in `energy-rules.ts`, Wetter in `../weather.ts` über Open-Meteo, Standort aus dem Cloud-Account, sonst `HUB_LAT`/`HUB_LON`): alle 5 min. Licht/Schalter, die außerhalb der Betriebszeit ihres Raums seit 45 min an sind und keine Kamera im Raum hat jemanden gesehen → Vorschlag „Ausschalten“ / „Nicht mehr fragen“ (Heizungen und Lüfter der Cloud-Klimaregelung und Dauerverbraucher wie Kühlung/Pumpen ausgenommen). Mäh-Aufgabe startet in den nächsten 3 h trotz Regen, nassem Gras, < 3 °C oder Sturm → „Heute aussetzen“: Aufgabe wird abgeschaltet und nach dem Zeitfenster automatisch wieder eingeschaltet (`.cache/agent-energy.json`). Mäher mäht im Regen → „In die Station“. Mammotion getrennt → „Neu anmelden“ (Sidecar `POST /relogin`, höchstens alle 6 h). Werkzeuge `weather_forecast`, `energy_plan` (Vorschau heute/morgen, auch im Tagesbericht), `mower_skip_task`, `mower_relogin`, `energy_ignore_device`. Geschaltet wird nur per Knopf. `HUB_AGENT_ENERGY=off` schaltet ab.
- **Speicher:** Das Modell bleibt `HUB_AGENT_KEEP_ALIVE` (30 min) nach der letzten Anfrage geladen und wird dann entladen.

## Belegung und Wartezeiten

Läuft mit dem Hub-Assistenten (`hub/src/occupancy.ts`). Tagsüber (`HUB_OCCUPANCY_HOURS`, Standard `9-21`) alle 5 Minuten (`HUB_OCCUPANCY_INTERVAL` in Sekunden) zählt der Hub auf den Kamerabildern die Personen (YOLO-Tracker) an diesen Punkten:

| Punkt | Kameras (Name enthält) | voll ab | Durchsatz/h | Meldung ab Wartezeit |
| --- | --- | --- | --- | --- |
| `uebungslift` | Übungslift | 12 | 60 | 15 min |
| `seilbahn-a` | Seilbahn A | 25 | 100 (gemessen am Drehkreuz) | 20 min |
| `seilbahn-b` | Seilbahn B | 25 | 100 | 20 min |
| `gastro` | Gastro, Imbiss | 15 | 40 | 15 min |
| `drehkreuz` | Drehkreuz | 10 | 120 (gemessen am Drehkreuz Seilbahn A) | 10 min |

Wartezeit ≈ Personen ÷ Durchsatz. Den gemessenen Durchsatz liefert die Cloud (`GET /api/hub/occupancy`, Eintritte je Drehkreuz-Bereich der letzten 15/60 min und des Tages), sobald mindestens 20 Eintritte pro Stunde zusammenkommen. Ist ein Punkt zweimal hintereinander voll oder die Wartezeit über der Schwelle, ist eine Meldung fällig, und noch einmal, wenn es wieder leerer ist. Was dann geschieht, bestimmt `HUB_OCCUPANCY_ALERTS`:

- `on` (auch `1`, `true`, `ja`): Der Assistent meldet sich per Telegram mit Bild.
- `off` (auch `0`, `false`, `nein`): Es wird gemessen, die Meldestufen werden nicht ausgewertet.
- ohne Angabe oder `shadow` (Probelauf, Vorgabe): Die fällige Meldung steht im Hub-Log („Belegung: … → Meldung (Probelauf, nichts gesendet)“) und im Zähler `occupancy.shadow_alert`, gesendet wird nichts. So lassen sich die Schwellen an echten Messungen prüfen, bevor Meldungen eingeschaltet werden. Ein unbekannter Wert gilt ebenfalls als Probelauf.

Die erste Messung jedes Tages steht mit der Zahl der gemessenen Bereiche und der Summe der Personen im Log („Belegung: erste Messung heute: …“), die weiteren Messungen nicht.

Im Chat: „Wie voll ist es?“ (Werkzeug `occupancy`). Schwellen lassen sich per Chat ändern („Übungslift ist erst ab 20 Leuten voll“, mit Bestätigung) oder direkt in `hub/occupancy.json`, dort auch Zonen je Kamera, damit nur der Wartebereich zählt:

```json
{ "spots": [ { "key": "uebungslift", "full": 20, "zones": { "5": [[0, 0.4], [1, 0.4], [1, 1], [0, 1]] } } ] }
```

Es werden keine Bilder gespeichert, nur die Tagesspitzen (`hub/.cache/occupancy.json`).

## Installation auf einer Hub-Maschine

Der Hub ist ein reines Deployment-Target: er fährt `origin/main` aus dem
GitHub-Repo und hält sich selbst aktuell. Mehrere Hubs an einem Account sind
vorgesehen, sie unterscheiden sich nur über `HUB_NAME`. Die Kamera-Liste gilt
dabei für den ganzen Account: Jeder Hub fragt alle aktivierten Kameras ab und
führt ihre Ereignisse (Beginn, Ende, Aufräumen nach einem Neustart). Eine
Zuordnung von Kameras zu einem Hub gibt es noch nicht; sie gehört dazu, bevor
ein zweiter Hub Kameras übernimmt.

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

### Selbst-Update absichern

Bevor der Hub auf einen neuen Stand neu startet (`src/updater.ts`):

1. **Installation** nur, wenn sich `hub/package.json` oder
   `hub/package-lock.json` geändert haben: `npm ci` (ohne Lockfile
   `npm install`), asynchron und mit 5 min Zeitlimit – Tasks, DoorBird-Monitor
   und „Tor offen halten“ laufen währenddessen weiter.
2. **Pre-Flight**: Der neue Stand wird einmal in einem Kindprozess geladen
   (`HUB_PREFLIGHT=1 npx tsx src/index.ts`, Zeitlimit 2 min). `index.ts`
   beendet sich dabei direkt nach dem Laden aller Module, ohne etwas zu
   starten. Das fängt Syntaxfehler, fehlende Dateien, fehlende Exporte und
   fehlende Pakete ab – keine Fehler, die erst im Betrieb auftreten.
3. Scheitert eins von beiden: **Rollback** (`git reset --hard` auf den
   vorherigen Commit), **kein Neustart**, der Hub läuft mit dem bisherigen
   Code weiter. Im Log steht „Update ABGEBROCHEN: …“; die Hub-Karte in der
   Cloud zeigt weiter den alten Commit. Derselbe Stand wird frühestens nach
   30 min erneut probiert, ein neuer Commit sofort.

Die Abfrage `HUB_PREFLIGHT` am Anfang von `src/index.ts` darf nie entfallen
oder umbenannt werden: Der jeweils laufende (alte) Updater verlässt sich
darauf. Notausgang, falls sich ein Hub nicht mehr selbst aktualisiert:
`hub/install/update.sh` auf der Maschine.

**Signaturprüfung (optional, Standard aus):**

```bash
# hub/.env
HUB_UPDATE_VERIFY_SIGNATURE=1
```

Dann spielt der Hub nur Commits ein, für die `git verify-commit` gelingt;
sonst bleibt er auf dem alten Stand und loggt „Update ABGELEHNT“. **Vorher**
müssen auf dem Hub-Rechner (im Benutzerkonto, unter dem der Hub läuft) die
Signaturschlüssel installiert sein – sonst kommt kein Update mehr an:

- GPG-signierte Commits: öffentliche Schlüssel aller, die auf `main`
  schreiben, mit `gpg --import` einspielen. Für Merges über die
  GitHub-Oberfläche auch den GitHub-Schlüssel
  (`curl https://github.com/web-flow.gpg | gpg --import`). Jeder Schlüssel
  im Schlüsselbund gilt als vertraut – dort nur die erlaubten ablegen.
- SSH-signierte Commits: `git config gpg.ssh.allowedSignersFile <Datei>` im
  Repo setzen und die erlaubten Schlüssel dort eintragen.

Test vor dem Einschalten: `git fetch origin main && git verify-commit origin/main`
im Repo muss ohne Fehler durchlaufen.

### Privates Repository (Deploy-Key)

Der Hub erzeugt beim ersten Update-Check einen eigenen Lese-Schlüssel
(`~/.config/emp-access/github_deploy_ed25519`, `src/repo-access.ts`), schreibt
ihn einmal ins Log und meldet ihn im Heartbeat. Im Dashboard unter
**Einstellungen → Update-Zugang der Geräte** kopieren und bei GitHub unter
*Settings → Deploy keys* eintragen (ohne Schreibzugriff). Danach stellt der Hub
beim nächsten Update-Check selbst auf SSH um (`ssh.github.com:443`,
`core.sshCommand` im Repo), auch `install/update.sh` nutzt dann den Schlüssel.
Bis dahin bleibt es bei HTTPS.

Neue Hub-Maschine bei privatem Repo: erst den Schlüssel erzeugen und eintragen,
dann klonen:

```bash
mkdir -p ~/.config/emp-access && ssh-keygen -t ed25519 -N "" -C "emp-access $(hostname)" -f ~/.config/emp-access/github_deploy_ed25519
cat ~/.config/emp-access/github_deploy_ed25519.pub   # bei GitHub als Deploy-Key eintragen
GIT_SSH_COMMAND="ssh -i ~/.config/emp-access/github_deploy_ed25519 -o IdentitiesOnly=yes" \
  git clone ssh://git@ssh.github.com:443/wakemaster88/emp-access.git ~/repositories/emp-access
```

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
wird nach der Anmeldung aus der Adresse entfernt. Im Cookie steht nicht das
Token selbst, sondern ein daraus abgeleiteter Wert (`src/dashboard-auth.ts`);
aeltere Cookies mit dem Token gelten weiter und werden beim naechsten
Seitenaufruf ersetzt. Ueber HTTPS kommt zusaetzlich `__Secure-hub_dash` mit
`Secure`. Wird das Token geaendert, sind alle Geraete abgemeldet.

Nach 20 falschen Anmeldedaten (Token in Adresse, Header oder Cookie) in
15 Minuten antwortet das Dashboard dieser Adresse 15 Minuten lang mit 429
(„Zu viele Fehlversuche“, gleitendes Fenster); derselbe falsche Wert zaehlt
dabei nur einmal, Zugriffe vom Hub-Rechner selbst nie. Eine Anmeldung ueber
`?token=` setzt den Zaehler der Adresse zurueck. Bindet das Dashboard ans Netz ohne
Token, steht beim Start eine Warnung im Log; der Heartbeat meldet die
Zugriffsart als `system.dashboardAccess` (`local`, `lan-token`, `lan-open`).

**Schutz der schreibenden Routen** (`src/dashboard-guard.ts`): Anfragen vom
Hub-Rechner selbst (127.0.0.1) brauchen kein Token. Damit keine fremde
Webseite im Browser des Hub-Rechners das ausnutzt (CSRF, DNS-Rebinding),
prueft der Hub jede Anfrage ausser GET/HEAD:

- `Content-Type: application/json` ist Pflicht (Ausnahmen: das
  WebRTC-Angebot der Kamera-Zentrale mit `application/sdp` und der
  Messwert-Eingang `/api/climate/report`).
- Ein `Origin`-Header muss zum Dashboard selbst gehoeren (gleicher Host und
  Port wie die Anfrage).
- Ohne gueltiges Token muss der `Host` ein eigener Name des Hubs sein:
  `localhost`, `127.0.0.1`, der Rechnername (auch `<name>.local`), seine
  IP-Adressen sowie alles aus `HUB_DASHBOARD_TLS_NAMES` und
  `HUB_DASHBOARD_ALLOWED_HOSTS`. Geraete im LAN, die sich mit Token
  angemeldet haben, erreichen den Hub weiter unter jedem Namen.

Lesende Anfragen auf `/api/*` vom Hub-Rechner ohne Token (GET/HEAD) pruefen
nur den `Host` nach derselben Liste. Seiten, Icons, `/ca.crt` und Anfragen
mit Token sind davon nicht betroffen.

Abgelehnte Anfragen antworten mit 403/415 und stehen (gedrosselt) als
„Dashboard: … abgelehnt“ im Log. Wird das Dashboard **am Hub-Rechner
selbst** oder ohne Token unter einem weiteren Namen aufgerufen (DNS-Eintrag
im Router, Reverse-Proxy), diesen eintragen:

```bash
# hub/.env – mehrere durch Komma trennen, ohne Port
HUB_DASHBOARD_ALLOWED_HOSTS=hub.example.lan
```

Skripte, die schreibend zugreifen (z. B. `curl -X POST …/api/action`),
muessen `-H "Content-Type: application/json"` mitschicken. Der Shelly-H&T-
Webhook (`GET /api/climate/report?token=…`) ist nicht betroffen.

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
