# Hub-Verbesserungslog

Laufende Diagnose (automatisch, alle 5 min): `hub/.cache/improve-latest.md`  
Rohdaten: `hub/.cache/improve.jsonl` · API: `http://127.0.0.1:8787/api/improve`

## 2026-08-30

### Befunde

- Face auf CoreML (buffalo_l) war production-broken: `/embed` HTTP 500, Shape-Fehler. Gastro/Umkleide ohne Embeddings.
- Nach CPU-Fix: Detektor findet Weitwinkel-Gesichter (Gastro/Eingang/Drehkreuz) mit 12–22 px, Filter war 48 px. Alte „Zoom“-Crops haben nicht hochskaliert.
- Rescue-Zoom live bestätigt: Gastro 17.5 px ×6.4 det=0.55, Eingang 19 px ×5.9 det=0.73, Uploads OK. Drehkreuz: Zoom-Miss, Fallback `small_keep` 21 px.
- Parken: 1 Lot (Halle / `cam-halle-2`, `vehicleGate`). Tracker online. Halle vorne zählt bewusst nicht.
- SCAN_SNAPSHOT #8107 (16:50) OK in ~400 ms, nicht stale.
- DoorBird-Monitor startet nach jedem Hub-Kickstart (192.168.1.191). Türöffner nicht getestet (physisch).
- YOLO-Classify (`vision.ts`) seit Ollama-Umstellung in keinem Fahrzeug-Burst mehr im Log (`Vision (yolo)` fehlt nach 17:30).
- SNMP: `snmpwalk` ist installiert, `HUB_SNMP_TARGETS` fehlt – Modul idle.
- ALPR hat heute Plates erkannt (u. a. SO-M 464, HAM-OR 118, MR-U 40). Letzter Burst 16:53 ohne gewähltes Plate (Fehlalarm/leere Zufahrt).

### Änderungen

- Face dauerhaft CPU (`CPUExecutionProvider`).
- Face-Rescue-Zoom + `small_keep`, Match-Schwelle hochskaliert 0.55.
- Automatisches Verbesserungslog (`hub/src/improve-log.ts`), Dashboard-Karte Diagnose, Cursor-Regel + Session-Hook.

### Offen

- Alltag: Scan an der Tür, Kennzeichen-Burst live (Classify ist bereit), DoorBird-Öffner nur mit Absicht.
- SNMP: Switch-IPs in `HUB_SNMP_TARGETS`.
- Face auf Gastro bleibt weich (Mini-Gesichter); Matching bewusst strenger.
- Gallery-Matches: bisher person_nomatch, kein person_match – Enroll prüfen.

## 2026-08-30 (Abend, Diagnose)

### Befunde

- Improve-Hint war falsch: `face.none` zählte Retry-Versuche, Zoom/Keep zählten nicht als Erfolg. Live: Gastro/Drehkreuz mit Zoom/Keep + Upload, Übungslift/Eingang oft ohne Detektion.
- Tracker-Prozess seit vor `/classify` – Route 404. Presence und Fahrzeug-Vision wären ins Leere gelaufen.
- Erstes `/classify` auf Halle-JPEG: 4294 ms (kalt), danach 59 ms. Altes Hub-Timeout 2 s hätte jeden ersten Check verworfen.
- Halle-Classify: `vehicle=true conf=0.60` (Parkplatz sieht Autos).
- Reolink nach Kickstart: `GetMdState … please login first (-6)` wenn Poll vor gültigem Token.

### Änderungen

- Diagnose-Hints auf Pipeline-Ebene (`skip_no_face` vs. Zoom/Keep).
- CGI: bei rspCode -6/-1 einmal neu einloggen und denselben Call wiederholen.
- Tracker neu gestartet; `/classify` skaliert auf max. 1280 Kante.
- Vision-Timeout 5 s (`HUB_VISION_TIMEOUT_MS`).

## 2026-08-30 (Gallery-Match)

### Befunde

- Diagnose: „kein Gallery-Match – Enroll fehlt“. Gallery hat **11 Embeddings** (nicht leer). Umkleide matchte heute „Bael“ mit 0.60.
- Nomatch kam von Weitwinkel/Zoom (Gastro, Eingang) mit Schwelle 0.55. Ohne best-Score war nicht unterscheidbar: Unbekannte vs. knapp daneben vs. leere Gallery.
- DoorBird-Motion 17:54: 640×480, 4× kein Gesicht; YOLO `NO` – kein Tor-Öffnungswunsch (korrekt).

### Änderungen

- `scoreGallery`: immer nächsten Treffer + Schwelle + n loggen.
- `face.near_miss` wenn best ≥ Schwelle−0.10.
- Dashboard zeigt Gallery-Größe.

## 2026-08-30 (Halle 20:29 Auto)

### Befunde

- 20:25–20:29 **Kamera Halle** (vorne): nur PERSON, Gesichter hochgeladen, best-Score 0.06–0.17 (kein Match). Reolink hat kein VEHICLE.
- 20:29:41 **Kamera Halle 2** (Parkzone): nur MOTION, Tracker-Count blieb 0. Kein Plate-Burst.
- 20:30 DoorBird: YOLO Auto (0.79) → Telegram-Öffnungswunsch, Relais nicht.
- 20:31 **Eingang**: PERSON+VEHICLE gleichzeitig – kein Fahrzeug-Burst (Person-Pipeline / Throttle).

### Änderungen

- VEHICLE wird nicht mehr durch das 30-s-Personen-Throttle geschluckt.
- Bei Person+Fahrzeug zuerst Burst, Person danach; sonst `pendingVehicle` nachziehen.

## 2026-08-31 (Dashboard als Lagekarte)

### Befunde

- Snapshot 19:30: Hub seit 30.08. durch, Face 11 Embeddings, 12 Cams, 1 DoorBird, Park-Tracker online. Hinweis unverändert: „Gallery-Treffer knapp unter der Schwelle“ (`face.near_miss` 5, `face.person_nomatch` 524, `face.person_match` 8).
- Das alte Dashboard zeigte nur Aggregate. Welche Kamera Alarm hat, wer erkannt wurde, welches Kennzeichen kam und welche Geräte im LAN sind, stand nirgends – Kamera-Map, DoorBird-Runtime, Whitelist und Scan-Liste waren modulintern.
- `improve.jsonl` taugt nicht als Live-Feed: keine Personennamen pro Ereignis, keine Scan-Geräte, kein „jetzt aktiv“.
- Modulauflösung: `src/dashboard.js` neben `dashboard.ts` kollidiert – ein direkter Import von `./src/dashboard.js` lädt die Browser-Datei. UI liegt deshalb in `src/ui/`.

### Änderungen

- Ereignisring in `src/state.ts` (`recordHubEvent`, 300 Einträge, laufende `seq`) plus Flankenmeldung für Heartbeat und Tasks. Kein Passwort, Token, Embedding.
- Last-Seen an Kamera und DoorBird: `lastPerson`, `lastPlate`, `lastEventAt`, `reachable`; Exporte `listCameraStatus()`, `listDoorbirdStatus()`, `listWhitelistPublic()`, `lastScanResult()`, `lastParkingSnapshot()`, `recentImproveEvents()`.
- API: `GET /api/overview` (ein Aufruf pro Tick, inkl. Health-Ampel), `GET /api/events?since=` als Delta, `GET /api/network`, `/api/improve` um JSONL-Tail erweitert. `/api/status` unverändert kompatibel.
- Zugang: ohne `HUB_DASHBOARD_TOKEN` weiter strikt `127.0.0.1`; mit Token Bind ans LAN und Guard vor allen Routen inklusive `POST /api/action`. Geprüft: LAN ohne Token 401, falscher Token 401, Header 200, `?token=` setzt HttpOnly-Cookie, Loopback 200.
- Oberfläche `src/ui/` mit acht Ansichten (Lage, Systeme, Netzwerk, Kameras, Ereignisse, Personen, Fahrzeuge, Aktionen), hell/dunkel automatisch, Sidebar ab 900 px, sonst Tab-Leiste; Tabellen stapeln unter 720 px.
- Headless-Prüfung: alle acht Ansichten rendern, keine Konsolenfehler, keine fehlgeschlagenen Requests; PING-Aktion und Auto-Scan (102 Geräte) landen in der Timeline.

## 2026-08-31 (Leistungsdaten im Dashboard)

### Befunde

- Der Hub zeigte nichts über die Maschine. Erste Messung: CPU **50 %** bei 10 Kernen, Last1 **7.5**, Speicher **86 %** (27.8 von 32 GB, davon 6.9 GB komprimiert), Platte 22 %, en0 **~900 KB/s** rein.
- Verteilung nach Prozess: Face-Sidecar 278 % CPU / 623 MB, Kamera-Tracker 52 % / 399 MB, go2rtc 7 % / 121 MB, ALPR-Daemon 0 % / 39 MB, Hub selbst ~2 % / 80 MB. Die Last kommt also aus der Bilderkennung, nicht aus dem Hub.
- `os.freemem()` ist auf macOS unbrauchbar (zeigt fast immer fast nichts) – belegt wird aus `vm_stat` als aktiv + wired + komprimiert gerechnet, wie im Aktivitätsmonitor.
- Der YOLO-Tracker heißt in der Prozessliste nicht „tracker“, sondern `uvicorn main:app --port 8088`; erst mit diesem Muster wird er gefunden. Bei mehreren Treffern pro Dienst gewinnt der mit dem größten RSS, sonst matcht ein zufälliger Suchbefehl.

### Änderungen

- Neues Modul `src/system-metrics.ts`: CPU-Sampling alle 2 s, Speicher und Netzdurchsatz alle 5 s, Platte und Prozessliste alle 30 s. Alles best-effort, keine Sudo-Rechte nötig.
- `/api/overview` liefert `system`; CPU, Speicher und Platte hängen zusätzlich als Ampel in der Health-Liste (ab 75 % auffällig, ab 90 % kritisch) und sind damit auch auf der Lage sichtbar.
- Systeme-Ansicht: Bereich „Leistung“ mit Balken für CPU/Speicher/Platte, Netzdurchsatz, Prozessor- und Lastdetails, Prozesstabelle und Durchsatz je Netzwerkkarte.
- Health-Karten stapeln auf dem Telefon jetzt zweispaltig (13 Karten waren untereinander zu lang).

### Offen

- Temperatur und Lüfter fehlen: `pmset -g therm` liefert auf diesem iMac nichts, alles andere braucht Root oder `powermetrics`.
- Speicher liegt dauerhaft bei ~86 % mit 6.9 GB komprimiert – im Auge behalten, ob der Face-Sidecar über Tage wächst.

## 2026-08-31 (Woher die 86 % Speicher kommen)

### Befunde

- Der Verbrauch kommt nicht aus unserem Stack. Von 32 GB sind **17.2 GB wired** und **7.9 GB Komprimierer** (darin 26 GB Daten), Swap **4.2 von 5 GB** belegt, frei ~90 MB.
- Ursache ist ein Ollama-Runner: `qwen2.5vl:7b`, **14 GB, 100 % GPU, Kontext 32768**, Prozess läuft seit **15 Tagen** (RSS 5.0 GB, dazu die wired GPU-Puffer im Unified Memory). CPU dabei 0 % – das Modell liegt nur herum und wird alle paar Minuten warmgehalten.
- Im Quellcode ruft niemand mehr Ollama auf – **im laufenden Kiosk schon**. `webcams/.next` stammte vom **27.08. 19:54**, `lib/people-counter.ts` wurde am **30.08. 17:27** auf den YOLO-Tracker umgestellt, und der `next start`-Prozess lief seit 4 Tagen. Der alte Build enthält noch `POST /api/generate` an `127.0.0.1:11434` und hat für die Cam „Eingang" jede Minute das Modell warmgehalten. Das ist der Grund, warum ein längst abgelöster Dienst 14 GB festhielt.
- Übrige Leichen im Code: `settings.ollama` im Schema (`lib/types.ts`), der Kommentar an `PeopleCounterSchema` und der Hinweistext in `admin/widget-form.tsx`.
- Unser Stack zusammen unter 1 GB: Tracker 416 MB (28 % CPU), go2rtc 209 MB, next-server 136 MB, Hub 82 MB, Face-Sidecar 52 MB.
- Die 52 MB des Face-Sidecars sind kein Sparerfolg, sondern Symptom: nach dem Modell-Load waren es 1.3 GB, unter dem Druck wurden die Modellseiten komprimiert bzw. ausgelagert. Das erste Gesicht danach zahlt die Page-Ins.
- `FaceAnalysis(name="buffalo_l")` lädt alle Module, also auch `genderage` – benutzt werden nur Detektion und Embedding.

### Änderungen

- `ollama stop qwen2.5vl:7b` und `brew services stop ollama`. Ergebnis nachgemessen: wired **17.2 → 3.8 GB**, Komprimierer **7.9 → 4.4 GB**, freier Speicher **21 → 73 %**. Im Hub-Dashboard steht der Speicher jetzt bei **50.6 %** statt 86 %.
- Ollama-Reste entfernt: `settings.ollama` aus Schema und `config.json`, Kommentar an `PeopleCounterSchema` korrigiert („Snapshot an den YOLO-Tracker"), Hinweistext im Widget-Formular auf die tatsächlich geprüften Dienste gekürzt (Hub, Tracker, go2rtc, Cloud, Doorbird, Face).
- Kiosk neu gebaut und über `launchctl kickstart` neu gestartet – der neue Build enthält kein `11434` mehr. Der Zähler „Eingang" liefert wieder Werte (2 Personen, kein Fehler); vorher stand dort `fetch failed`, weil der alte Build ins Leere rief.

### Offen

- Vorbestehend, unabhängig davon: `tests/parking-lot-schema.test.ts` scheitert mit 4 Fällen (auf HEAD sind es 5). Nicht angefasst.
- Face-Sidecar lädt mit `buffalo_l` auch `genderage`, benutzt werden nur Detektion und Embedding. `allowed_modules=["detection", "recognition"]` spart Modell und Rechenzeit – noch nicht umgesetzt.
- Merke: `next start` friert den Stand von `npm run build` ein. Nach Änderungen an Serverlogik im Kiosk gehört ein Rebuild dazu, sonst läuft tagelang alter Code weiter.

## 2026-09-01 (Hub-Karte im Cloud-Dashboard, Push-Bereitschaft)

### Befunde

- Selbst-Update war schon fertig, nur nicht sichtbar: `src/updater.ts` prüft alle 5 min `origin/main`, macht `reset --hard` + `npm install` und beendet sich, launchd startet neu (`KeepAlive`). Dieselbe Mechanik wie bei den Pis (systemd-Timer alle 5 min → `git reset --hard origin/main`).
- Zwei `HubAgent`-Datensätze in der Cloud, beide mit Hostname `iMac-von-Aaron.local`: `imac-technikraum` (aktiv, Commit `f7262052`) und `imac-von-aaron` (seit **16 Tagen** stumm, Commit `9bc7698`). Letzterer ist eine Karteileiche aus der Zeit vor gesetztem `HUB_NAME`.
- Der Hub meldet `git rev-parse --short HEAD` – hier **8 Zeichen** (`f7262052`), der alte Eintrag 7. Ein Vergleich mit fest zugeschnittener Vercel-SHA hätte dauerhaft „Update offen" gemeldet.
- Vor dem Push lagen drei Fallen: `.pnpm-store/` (**954 MB**), `pnpm-lock.yaml` (hätte den Vercel-Build von npm auf pnpm gezogen) und `webcams/.cache-dreh-snap.jpg` waren untracked und **nicht** ignoriert. Das Repo ist öffentlich; Secrets waren nie eingecheckt.
- `npx tsc` zeigte 19 Fehler – 18 davon nur wegen eines veralteten generierten Prisma-Clients (`status`, `scanLockSeconds` fehlten), nach `prisma generate` weg. Der letzte war echt: `src/app/api/hub/switch/route.ts` castete `SwitchIngestPayload[]` direkt auf `InputJsonValue`, was den Vercel-Build gestoppt hätte.

### Änderungen

- `/api/dashboard/ops` liefert `hubs` (online/total, Cloud-Commit, je Hub Name, Host, Version, `lastSeenAt`, `online`, `outdated`). Karteileichen älter als 7 Tage fallen raus, Commit-Vergleich über das gemeinsame Präfix.
- Neue Hub-Karte in der `OpsStrip` (Raster auf fünf Spalten): „x/y verbunden", darunter nach Dringlichkeit wer offline ist, wer noch ein Update zieht, sonst der laufende Commit. Rot bei fehlendem Hub, Amber bei ausstehendem Update, verlinkt auf `/network`.
- `.gitignore` (Root und `webcams/`) deckt die drei Push-Fallen ab; `switch/route.ts` castet über `unknown` mit Begründung.
- `hub/README.md`: Installation nicht mehr „auf dem iMac", sondern für beliebige Hub-Maschinen inklusive `git clone`, eindeutigem `HUB_NAME` und dem Update-Weg über einen Push auf `main`.
- Gegen echte Daten geprüft: Karte zeigt „1/1 verbunden – Stand f7262052", die 16-Tage-Leiche ist gefiltert, `outdated` bleibt korrekt false. `npx next build` läuft durch, `tsc` bei 0 Fehlern.

### Nachtrag: Lücke im Selbst-Update

- Beim Live-Test fiel auf, dass der Updater nur `origin/main` gegen den Checkout verglich. Sind beide gleich, tat er nichts – auch wenn der **laufende Prozess** auf einem älteren Commit gestartet war. Genau der Fall auf dieser Maschine: HEAD stand nach dem Commit auf `9d0d0588`, der Hub meldete weiter `f7262052` und wäre nie von selbst neu gestartet. Dasselbe passiert nach einem manuellen `git pull` auf einem Hub.
- `updater.ts` vergleicht jetzt zusätzlich HEAD mit der beim Start ermittelten `CONFIG.version` und startet dann neu. Kein Neustartkreis, weil die Version nach dem Neustart genau HEAD ist; bei `unknown` oder zu kurzem Hash bleibt er ruhig.
- Nebenwirkung, bewusst in Kauf genommen: auf der Entwicklermaschine startet der Hub nach jedem Commit einmal neu.
- Kette komplett geprüft: fünf Commits gepusht, Vercel-Deploy für `89501bb2` erfolgreich, Hub meldet nach dem Neustart `89501bb2`, Karte steht damit auf „1/1 verbunden – Stand 89501bb2".

### Offen

- Visuell nicht gesehen: die gerenderte Karte im Dashboard braucht eine Session, geprüft sind Datenpfad, Typen, Build und die gemeldete Version.
- Der Hub ist macOS-gebunden (launchd, `vm_stat`, Swift-Vision-OCR im Kennzeichen-Fallback). Für Linux-Hubs müssten `install/`, `system-metrics.ts` und `plate.ts` Alternativen bekommen.
- Karteileiche `imac-von-aaron` ist gelöscht; es bleibt ein Hub in der Liste.

## 2026-09-01 (Grenze Cloud ↔ lokal geprüft)

### Befunde

- Code-Trennung hält: kein Import über die Ordnergrenze in beide Richtungen, `tsconfig.json` schließt `hub` und `webcams` aus dem Vercel-Build aus, `vercel.json` betrifft nur `src/app/api/**`. Der Hub hat keinen DB-Zugriff, nur `HUB_API_URL` + `HUB_API_TOKEN` über `api()` in `src/config.ts`, ausgehend mit Bearer-Token.
- Root-ESLint kannte die Grenze nicht: erfasste **576 Dateien in `webcams/`** (davon 399 aus `webcams/.next`) und **26 im Hub**, zusammen **10.248 Meldungen in 361 Dateien**. Das globale `.next/**`-Ignore wirkt nur auf die Wurzel.
- Vertrag doppelt gepflegt: `VALID_TASK_TYPES` in `src/app/api/hub/tasks/route.ts` listet 11 Typen, `src/tasks.ts` behandelt 12. `SCAN_SNAPSHOT` fehlt in der Cloud-Liste und wird in `src/app/api/devices/pi/scan/route.ts` direkt angelegt, an der Prüfung vorbei. In Prisma ist `type` ein `String`, kein Enum.
- `normalizePlate` liegt zeichengleich in `src/lib/vehicles.ts:10` und `hub/src/plate.ts:88`.

### Änderungen

- `eslint.config.mjs`: `hub/**` und `webcams/**` in `globalIgnores`. Danach erfasst der Root-Lint nur noch `src`, `scripts` und die Root-Configs; übrig bleiben **77 Fehler und 77 Warnungen im Cloud-Code** (Top: `react-hooks/set-state-in-effect` 46x, `no-unused-vars` 42x) – vorher unter zehntausend Meldungen begraben. Kein Deploy-Risiko, `next build` ruft kein ESLint.

### Offen

- Der Hub hat damit keinen eigenen Lint mehr (`webcams/` hat eine eigene `eslint.config.mjs`, der Hub nicht). Falls gewünscht, eine schlanke Node-/TS-Konfiguration in `hub/` nachziehen.
- Task-Typen und `normalizePlate` bleiben doppelt – bewusst offen gelassen, siehe Befunde.

## 2026-08-31 (Dashboard, offene Punkte)

- `face.near_miss` weiter beobachten – die Personen-Ansicht zeigt jetzt Match/Near-Miss/Nomatch nebeneinander, damit die Schwelle belegbar wird.
- Fahrzeug-Zähler standen nach dem Neustart auf 0; nach dem nächsten Burst prüfen, ob Kennzeichen und Whitelist-Treffer in der Fahrzeug-Ansicht auftauchen.
- SNMP bleibt aus (`HUB_SNMP_TARGETS` fehlt) – erscheint als Health-Zeile „aus“.

## 2026-09-01 (Kameras/Geräte an die Schließanlage gehängt)

Snapshot nicht verfügbar: `http://127.0.0.1:8787/api/improve` antwortet nicht, `hub/.cache/improve-latest.md` existiert nicht – der Hub lief während der Arbeit nicht. Reine Cloud-/Schema-Arbeit, keine Hub-Laufzeit angefasst.

### Befund

- `Camera` und `Device` hatten keinen Ortsbezug zur Schließanlage: Bestand sind **78 Geräte** und **13 Kameras**, davon **0** einem Raum zugeordnet. Wo ein Shelly oder eine Kamera physisch hängt, stand nirgends.
- Die drei neuen Fremdschlüssel haben den Typvergleich im ganzen Repo gekippt: `next build` brach in `src/app/(dashboard)/areas/page.tsx` mit TS2349 ab – genau der in `src/lib/prisma.ts` dokumentierte Effekt, und in einer Datei, die mit der Schließanlage nichts zu tun hat.

### Änderungen

- `Device.keyRoomId`, `Camera.keyRoomId`, `KeyLock.deviceId` (alle nullable, `ON DELETE SET NULL`) plus Indizes – Migration `20260901133000_link_devices_to_keying`.
- `TenantDb` ist keine Union mehr: `tenantClient()` gibt jetzt `PrismaClient` zurück (die Erweiterung setzt nur den RLS-Kontext). `npx tsc --noEmit` fällt damit von **rund 200 Fehlern auf 0**; vorher war der Typecheck als Werkzeug unbrauchbar.
- `network-scan-ingest.ts`: `IpHistoryEntry` von `interface` auf Type-Alias – erst dadurch passt es in Prismas `InputJsonValue`. Der Fehler war vorher hinter der Union versteckt.

### Offen

- Kein Gerät und keine Kamera ist bislang einem Raum zugeordnet – die Zuordnung muss einmal von Hand gepflegt werden, bevor die Anzeige im Raumbaum etwas hergibt.
- Der Hub kennt die Raumzuordnung nicht. Falls Kamera-Events künftig nach Raum gefiltert werden sollen, muss `keyRoomId` in die Hub-Sicht auf Kameras.

## 2026-09-01 (Raum-Leitstand, Etappe 1 zum Smart-Home-Ausbau)

Snapshot nicht verfügbar: `http://127.0.0.1:8787/api/improve` antwortet nicht, `hub/.cache/` ist leer, `~/Library/Logs/emp-hub.log` existiert nicht – der Hub lief während der Arbeit nicht. Reine Cloud-Arbeit, keine Hub-Laufzeit angefasst.

### Befund

- Der Weg „Bewegung erkannt → Lampe an" braucht heute **3–7 s**, im schlechten Fall **10 s**: Reolink-Polling (0–5 s) → `POST /api/hub/camera-events` (0,1–0,5 s) → `runCameraAutomations()` in der Cloud (0,05–0,2 s) → `controlShelly()` von Vercel, das `192.168.x` nicht erreicht und deshalb über die Shelly Cloud geht (0,5–2 s). **LAN-only-Shellys ohne Cloud-Zugang schlagen dabei ganz fehl.**
- `Device.schedule` (Json) hat eine vollständige UI („Automatische Zeitsteuerung", `src/components/devices/schedule-card.tsx`) und speichert, **aber kein Cron liest das Feld je aus**. Eingetragene Zeiten schalten nichts.
- Fünf parallele Zeitplan-Systeme bauen dasselbe Muster (Cron + `lastRunAt`-Guard) nach: Shelly-Automationen, Bewässerung, Audio, Überwachung, E-Mail. Shelly wird an vier Stellen unterschiedlich geschaltet (`executeGroup`, `triggerDeviceAction`, `vehicles.ts`, `persons.ts`).
- Kamera-Ereignisse sind **5915 in 24 h** über 13 Kameras – deutlich mehr als erwartet. Erste Fassung der Leitstand-Abfrage holte „die neuesten 300" und wäre damit komplett von den aktivsten Kameras belegt gewesen; Räume anderer Kameras hätten dauerhaft keine letzte Bewegung gezeigt. Jetzt `distinct: ["cameraId"]`, gegen `groupBy(_max(startedAt))` geprüft: 13 von 13 Kameras identisch, Ergebnis **1 Zeile statt 298** bei aktueller Zuordnung.
- Zuordnungsstand: **1 von 13 Kameras** (Halle) und **0 von 78 Geräten** hängen an einem Raum. 17 Räume sind angelegt.

### Änderungen

- Neue Seite `/raeume` (Sidebar „Räume" unter Betrieb): pro Raum Geräte mit Live-Zustand und Schaltflächen, Kamera-Kacheln mit Schnappschuss, Schließpunkte aus der Schließanlage, letzte Bewegung im Raum.
- Baut auf Vorhandenem auf statt daneben: `triggerDeviceAction()` zum Schalten, `visibleDeviceControls()` für die Knöpfe, `GET /api/devices/shelly-statuses` für den Zustand. Kein neues Schalt- oder Statussystem.
- Zuordnung von Geräten und Kameras direkt aus dem Leitstand über denselben Endpunkt wie die Schließanlage (`PUT /api/schliessanlage/rooms/[id]`) – ein Raumbegriff, zwei Sichten.
- Relative Zeitangaben („vor 3 Min") rechnen mit einem Server-Zeitstempel als Startwert und ziehen erst nach dem Mounten im Browser nach – sonst weicht das hydrierte Markup ab.

### Offen

- Regel-Engine mit Raumbezug fehlt noch (Etappe 2). Sie soll `ShellyAutomation` ablösen, nicht ergänzen – sonst ist es das sechste parallele System.
- Die Regeln müssen anschließend auf den Hub gespiegelt werden (Etappe 3), damit Bewegung lokal unter 1 s schaltet und bei Cloud-Ausfall weiterläuft. Dafür braucht der Hub `keyRoomId` in seiner Kamera- und Gerätesicht; die Vorlage dafür ist `hub/src/vehicle-actuate.ts`, das genau das für die Kennzeichen-Whitelist schon tut.
- `Device.schedule` entweder an die neue Engine anbinden oder die UI entfernen. Aktuell verspricht sie etwas, was nicht passiert.
- 78 Geräte und 12 Kameras müssen einmal einem Raum zugeordnet werden, bevor der Leitstand etwas hergibt. Der gelbe Hinweiskasten oben auf `/raeume` führt dorthin.

## 2026-09-01 (Betriebszeiten als Fundament der Regel-Engine, Etappe 2a)

Snapshot nicht verfügbar: `http://127.0.0.1:8787/api/improve` antwortet nicht, `hub/.cache/` fehlt, `~/Library/Logs/emp-hub.log` existiert nicht – der Hub lief während der Arbeit nicht. Reine Cloud-Arbeit, keine Hub-Laufzeit angefasst. Offener Hinweis aus dem letzten Eintrag („Regel-Engine mit Raumbezug fehlt") wird hiermit begonnen.

### Befund

- **Nirgends im System steht, wann der Betrieb geöffnet hat.** `AccessArea.openingHours` ist ein Freitextfeld ohne Validierung, wird nur auf dem Dashboard und in der Bereichsliste angezeigt und in der Scan-Logik nie geprüft. Maschinenlesbar lagen die Zeiten ausschließlich extern in ANNY – und dort je Service und Ressource, nicht je Betrieb.
- Die Zeile „Betrieb von X bis Y" auf der Drehkreuz-Kachel ist **keine konfigurierte Öffnungszeit**, sondern der erste und letzte Scan des Tages (`turnstile-card.tsx:271`). Sie beschreibt, was war, nicht was gilt.
- Es gibt **kein Feiertags- oder Ausnahmetag-Modell**. Einzige Einzeltag-Ausnahme im Bestand ist `SlotBlock`, und die gilt nur für einen ANNY-Slot.
- Kein Saison-Modell, obwohl der Betrieb saisonal läuft. Saison entsteht heute implizit aus Datumsbereichen auf `Subscription`/`Ticket` und aus ANNY-`/start-dates`.
- Die Zeitzonen-Helfer für „HH:mm in Ortszeit" lagen **privat in `shelly-automation.ts`** (`minutesInTz`, `berlinWeekdayBitIndex`, `berlinTimeOfDayToUtc`). `surveillance.ts` importierte `isWithinTimeWindow` quer aus der Automations-Datei – eine Überwachungsfunktion hing damit an einem Shelly-Modul.

### Änderungen

- **`src/lib/tz-time.ts`** neu: Wanduhr-Rechnen in beliebiger IANA-Zeitzone (`tzMinutesOfDay`, `tzWeekdayBit`, `tzYmd`, `tzInstant`, `isWithinWindow`). Die Kopien in `shelly-automation.ts` sind entfernt, `surveillance.ts` importiert jetzt von hier. Verhalten unverändert, nur an einer Stelle.
- **Datenmodell** `OperatingSchedule` → `OperatingSeason` → `OperatingPeriod`, dazu `OperatingException`. Profil je Betriebsteil (Strandbad, Gastronomie, Seilbahn), Saison als jährlich wiederkehrender `MM-TT`-Zeitraum, mehrere Öffnungsperioden je Wochentag (Mittagspause), Ausnahmetag schlägt jede Saison. `KeyRoom.operatingScheduleId` verbindet Raum und Profil (`onDelete: SetNull`).
- **Bewusste Festlegung:** Ein Profil ohne passende Saison gilt als **geschlossen**, ein Raum ohne Profil als **dauerhaft verfügbar**. Ersteres fällt in der Oberfläche sofort auf, Letzteres verhindert, dass ein ungepflegter Raum stillschweigend alle Regeln blockiert.
- Nur `OperatingSchedule` trägt `accountId` und RLS; Saison, Periode und Ausnahmetag hängen per Cascade daran – wie `ShellyGroupMember`.
- **`src/lib/operating-hours.ts`**: reine Auswertung ohne Prisma, damit sie auch im Browser läuft. `openingForDay`, `isOperatingAt`, `boundariesForDay`. Letzteres liefert Betriebsbeginn und -ende als **echte Zeitpunkte**, weil die Regel-Engine „30 Minuten vor Betriebsende" braucht und eine Nachtspanne (18:00–02:00) am Folgetag endet.
- Seite `/betriebszeiten` (Sidebar unter Betrieb) mit Wochenplan, Saisons und Ausnahmetagen. Der Raum-Leitstand zeigt je Raum „geöffnet/geschlossen · Profil · heute 10:00–20:00" und erlaubt die Zuordnung im Raum-Dialog.

### Geprüft

- 17 Unit-Tests zur Auswertung: Saisonwechsel, Saison über den Jahreswechsel, Ausnahmetag mit und ohne Sonderzeit, Mittagspause, Spanne über Mitternacht inklusive Vortags-Überhang, Winter- gegen Sommerzeit (10:00 Berlin = 09:00 UTC im Januar, 08:00 UTC im Juli) und der Umstellungstag 2026-03-29. Gesamt 43 Tests grün.
- Rauchtest an der echten Datenbank: Profil mit zwei Saisons, 8 Perioden und einem Ausnahmetag angelegt, geladen, ausgewertet, einem Raum („Shop") zugeordnet und gelöscht. Bestätigt: Ausnahmetag schlägt die Sommersaison (2026-09-01 „geschlossen" trotz Saison 01.05.–15.09.), Cascade räumt Saisons und Ausnahmen mit ab, `SetNull` lässt den Raum stehen.

### Offen

- Etappe 2b: Regel-Engine mit Raumbezug. Betriebszeit-Trigger (`OPENING`/`CLOSING` mit Offset) und -Bedingung („nur während", „nur außerhalb") sind jetzt auswertbar; `boundariesForDay` ist der Einstiegspunkt. Sie soll `ShellyGroup`/`ShellyAutomation` **ablösen**, dazu Datenmigration der Bestandsregeln und Ersatz von `/automation`.
- Beim Ablösen mitziehen: `POST /api/hub/camera-events` ruft `runCameraAutomations()`, `data-retention.ts` räumt `ShellyAutomationRun`, `cover-constants.isGroupActionValid` validiert Szenen-Aktionen.
- Die fünf bestehenden Zeitplan-Systeme (Bewässerung, Audio, Überwachung, E-Mail, Shelly) pflegen ihre Fenster weiter selbst. Sobald die Engine steht, können sie auf die Betriebszeit verweisen statt eigene Uhrzeiten zu halten – das war der eigentliche Grund für dieses Modell.
- Noch kein Profil angelegt (der Rauchtest hat sein eigenes wieder entfernt). Ohne mindestens ein Profil bleibt die Betriebszeit-Anzeige im Leitstand aus.

## 2026-09-01 (Regel-Engine löst die Shelly-Automation ab, Etappe 2b)

Snapshot nicht verfügbar: `http://127.0.0.1:8787/api/improve` antwortet nicht, `hub/.cache/` fehlt, `~/Library/Logs/emp-hub.log` existiert nicht – der Hub lief während der Arbeit nicht. Cloud-Arbeit; der Hub-Ingest für Kamera-Ereignisse wird auf die neue Engine umgehängt, sein Vertrag bleibt unverändert.

### Befund

- Im Bestand lagen genau **eine Szene, eine Automation und neun Läufe**: „Aquapark Person nachts → Außenbeleuchtung", Kamera-Trigger `PERSON`, Fenster 22:00–08:00, fünf Minuten Sperre, ein Zielgerät. Die Ablösung war damit eine Datenmigration von neun Zeilen, keine Umstellung im großen Stil.
- Die alte Automation konnte **nur Shelly-Szenen schalten**. Schlösser, Ventile und Audio waren nicht erreichbar, obwohl `triggerDeviceAction()` sie längst bedient.
- Kamera und Zielgerät der Bestandsautomation haben **keinen Raum**. Die migrierte Regel läuft deshalb betriebsweit weiter; sobald „Kamera Aquapark" und „Außenbeleuchtung" einem Raum zugeordnet sind, greift der Raumbezug von selbst.
- `ShellyAction` wird außerhalb der Automation weiterverwendet (`AllowedVehicle.shellyAction`, `ListedPerson.shellyAction`) und bleibt deshalb stehen. Entfernt wurde nur `AutomationTrigger`.

### Änderungen

- **Datenmodell** `RoomRule` → `RoomRuleAction`, dazu `RoomRuleRun` als Verlauf. Neun Auslöser (Uhrzeit, Betriebsbeginn, Betriebsende, Sonnenauf-/-untergang, Bewegung, Gerät geschaltet, Zutritt am Leser, Ruhe im Raum) und drei Aktionsarten (Gerät, Benachrichtigung, Audio). Bedingungen: Wochentage, Zeitfenster, Betriebszeit-Status, Dunkelheit.
- **`src/lib/room-rules.ts`** in drei Schichten: `ruleAllows()` prüft Bedingungen ohne Datenbank und ist deshalb testbar, `executeRule()` führt die Aktionen der Reihe nach aus und schreibt den Verlauf, darüber je eine Funktion pro Auslöserquelle.
- **Doppelausführung** verhindert `claimRule()`: `lastRunAt` wird per `updateMany` mit der alten Zeit in der Bedingung gesetzt, zwei gleichzeitige Cron-Läufe können nicht beide gewinnen. Bei zeitgesteuerten Regeln gilt mindestens das Feuerfenster (drei Minuten) als Sperre, sonst würde eine Regel im selben Fenster zweimal auslösen.
- **Regelketten** über `DEVICE_SWITCHED` sind auf `MAX_CHAIN_DEPTH = 1` begrenzt. Ohne Grenze könnten sich zwei Regeln endlos gegenseitig schalten.
- **Anbindung:** Cron `/api/cron/room-rules` (alle 5 Min.) für alles Zeitgesteuerte, `POST /api/hub/camera-events` für Bewegung, `POST /api/devices/pi/scan` für Zutritt, `POST /api/devices/[id]/action` für Schaltvorgänge. Die drei Ereignis-Hooks laufen bewusst unaufgeschoben nebenher (`void … .catch`), damit ein Knopfdruck nicht auf Folgeregeln wartet.
- **Datenmigration** `20260901161000_migrate_shelly_automations`: Szene, Automation und Läufe nach `RoomRule`/`RoomRuleAction`/`RoomRuleRun` überführt. `lastRunAt` wandert mit, damit eine gerade gelaufene Automation nicht unmittelbar nach der Migration erneut feuert. Danach `20260901162000_drop_shelly_automations`.
- **Abgelöst und entfernt:** Seite `/automation`, `src/components/automation/`, `src/lib/shelly-automation.ts`, die Routen `shelly-groups`, `shelly-automations`, `automation-runs`, der Cron `shelly-automations`, die zugehörigen Zod-Schemata und `isGroupActionValid`. `data-retention.ts` räumt jetzt `RoomRuleRun`; der Schlüssel `automationRuns` in den Aufbewahrungs-Einstellungen bleibt, damit eingestellte Fristen erhalten bleiben.
- **Oberfläche** `/regeln` (Sidebar unter Betrieb, neben Räume und Betriebszeiten): Regeln nach Raum gruppiert, je Regel Auslöser und Aktionen im Klartext, „jetzt ausführen", Pause und Verlauf. Der Raum-Leitstand zeigt die Regeln des Raums auf der Karte.

### Geprüft

- Rauchtest an der echten Datenbank gegen eine Regel mit Betriebsbeginn-Auslöser: 30 Minuten vorher **kein** Auslösen, exakt zum Betriebsbeginn ausgelöst (Verlaufseintrag `opening`), zweiter Tick zum selben Zeitpunkt durch die Sperre blockiert. Das Zielgerät war absichtlich deaktiviert, damit keine Hardware geschaltet wird – die Engine meldet „Gerät ist deaktiviert" und schreibt den Lauf als fehlgeschlagen.
- Migration nachgezählt: eine Regel mit einer Geräte-Aktion, neun Läufe übernommen, `lastRunAt` (2026-08-30) erhalten, Sperre korrekt von 5 Minuten auf 300 Sekunden umgerechnet.
- 55 Unit-Tests grün, `tsc` sauber, Build durch. Kein neuer Lint-Fehler (die 20 bestehenden liegen alle in älteren Dateien).

### Offen

- **Alles läuft weiterhin über die Cloud.** Bewegung im Raum bis geschaltetes Licht heißt: Hub pollt die Kamera (bis 5 s), meldet an die Cloud, die Cloud ruft Shelly Cloud – zusammen 3–7 Sekunden, und für LAN-only-Shellys gar nicht. Der beschlossene Zielzustand ist der Spiegel der Regeln auf den Hub, damit er lokal und offline schaltet. Das ist Etappe 3.
- Kein Profil in `OperatingSchedule` angelegt. Ohne mindestens eines bleiben die Auslöser „Betriebsbeginn"/„Betriebsende" und die Bedingung „nur während der Betriebszeit" wirkungslos – die Regel findet dann keinen Zeitpunkt und feuert nicht.
- Die vier verbliebenen Zeitplan-Systeme (Bewässerung, Audio, Überwachung, E-Mail) halten weiter eigene Fenster. Sie könnten jetzt Regeln werden oder wenigstens auf die Betriebszeit verweisen.
- `Device.schedule` ist weiterhin ein Feld ohne Ausführung. Entweder in eine Regel überführen oder aus der Oberfläche nehmen.
