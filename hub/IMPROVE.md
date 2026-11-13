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

## 2026-09-05 (Fahrzeugerkennung: Fehlalarme, verlorene Bursts, Log-Abruf)

Snapshot nicht verfügbar: Hub läuft auf dem iMac, diese Sitzung lief auf dem MacBook (kein Zugriff auf `emp-hub.log`, SSH abgelehnt). Befund deshalb aus der Cloud-Datenbank (nur lesend) und aus 23 Fahrzeug-Schnappschüssen, lokal mit denselben fast-alpr-Modellen nachgerechnet.

### Befunde

- **Hub-Ausfall 3.9. ~21:00 bis 4.9. 10:50 Uhr.** In dieser Zeit kam von keiner Kamera ein Ereignis an; sonst liefern die Kameras nachts 100–200 Ereignisse pro Stunde. DO-HM 338E wurde bis 2.9. täglich zwischen 9:20 und 10:20 Uhr erkannt, am 3./4.9. nicht – am 4.9. stand der Hub in genau diesem Fenster. Ursache steht nur im Log auf dem iMac.
- **Kennzeichen-OCR unverändert, Liste doppelt so verrauscht.** Kennzeichen je VEHICLE-Alarm (tags, Eingang): Woche ab 24.8. 21 %, Woche ab 31.8. 20 %. Anteil der Alarme, die als „Fahrzeug ohne Kennzeichen" landen: 23.–30.8. ~28 %, ab 31.8. ~55 %. Seit dem Tracker-Neustart am 30.8. antwortet `/classify` wieder – und sagt „Fahrzeug" auf jedes geparkte Auto und jeden Wagen auf der Straße oben links im Bild. 23 von 23 geprüften „ohne Kennzeichen"-Bildern (1.–4.9.) zeigen kein Fahrzeug an der Einfahrt, fast-alpr findet in keinem ein Kennzeichen.
- **Abends nichts lesbar:** nach 20 Uhr 109 Alarme, 3 Kennzeichen; nach 21 Uhr null. Sonnenuntergang rückt wöchentlich 15 min vor.
- **Zweiter Wagen ging verloren:** `pendingVehicle` wurde nur nach der Personen-Pipeline abgearbeitet, nie nach dem Fahrzeug-Burst.
- **Phantom-Flanken:** der Burst schrieb `cam.states.VEHICLE` selbst; der parallele Poll sah beim Flackern neue Flanken. 60–70 % der VEHICLE-Ereignisse hatten kein Ende, nach jedem Burst startete sofort der nächste (Doppel-Einträge im Minutenabstand, z. B. BN-PL 8546 um 10:38:18 und „ohne Kennzeichen" um 10:38:41).
- **ALPR konnte sich still abschalten:** ein Daemon-Start über 30 s setzte `disabled = true` bis zum Neustart, stderr des Daemons wurde verworfen.
- Plates je Frame laufen auf dem MacBook in 0,2 s inkl. 3×2 Kacheln; die Vito-Platte (129×43 px in 4K) fand nur der Kachel-Durchlauf, das Vollbild nicht – die Kacheln bleiben Pflicht.

### Änderungen

- Tracker `/classify` liefert zusätzlich `vehicles[]` mit normierten Boxen (x, y, w, h, conf, cls); `vehicle`/`conf` bleiben für alte Hubs.
- `vision.ts`: `checkVehicle()` zählt eine Box nur ab `HUB_VEHICLE_MIN_AREA` (Default 2 % Bildfläche) und – falls `HUB_VEHICLE_ZONE` bzw. `HUB_VEHICLE_ZONE_<kameraId>` gesetzt – nur mit Mittelpunkt in der Zone. Log nennt den Grund (`größte Box 0.06% < 2.0%`, `außerhalb der Einfahrtszone`). Vito-Frame 3,8 %, geparkter BMW am Tor 3,1 %, Wagen auf der Straße 0,5 %, Parkplatz 0,07 %. DoorBird bleibt ohne Schwelle (`minArea: 0`).
- `cameras.ts`: Burst liest den Alarm nur noch, schreibt `cam.states` nicht mehr; `pendingVehicle` wird auch nach dem Fahrzeug-Burst nachgezogen (Body prüft zuerst den Alarm, sonst Abbruch); gleiches Kennzeichen an derselben Kamera innerhalb `HUB_PLATE_REPEAT_MS` (60 s) wird nicht erneut hochgeladen (`alpr.repeat`).
- `alpr.ts`: Startup-Timeout 60 s (`HUB_ALPR_STARTUP_TIMEOUT_MS`), danach Pause 5 → 10 → 20 → 30 min statt Aus bis zum Neustart; stderr im 30-Zeilen-Ring, die letzten Zeilen stehen bei Abbruch/Timeout im Log; `STATE.alpr.ready` spiegelt jetzt den laufenden Daemon.
- Neuer Task `HUB_LOG` (`hub/src/hublog.ts`): liefert das Ende von `emp-hub.log`, `emp-hub.error.log` oder `improve-latest.md` (max. 2000 Zeilen, nur das letzte MB gelesen, Filter, `token=`-Werte geschwärzt, Fallback auf den Speicher-Ring). Cloud: Typ freigeschaltet, `GET /api/hub/tasks/[id]`, Knopf „Log abrufen" in der Hub-Karte unter Netzwerk mit Datei, Zeilenzahl, Filter und Kopieren. Bei mehreren Hubs antwortet der, der den Task zuerst holt.
- Diagnose-Hinweise für `vision.no_small` (Kamera-KI reagiert auf Hintergrund) und `alpr.repeat`.
- Geprüft: `tsc` Hub und Cloud ohne Fehler, ESLint der neuen Cloud-Dateien sauber, `py_compile` des Trackers, Mock-Test für Log-Tail (3000 Zeilen, Filter, Schwärzung, fehlende Datei) und Größen-/Zonenfilter.

### Offen

- Log vom 3.9. abends holen (jetzt per „Log abrufen", Filter `Update` oder `ALPR`) und die Ausfallursache eintragen.
- Einfahrtszone für Kamera 9 ausmessen und als `HUB_VEHICLE_ZONE_9` setzen, wenn die 2-%-Schwelle allein nicht reicht; alternativ die Erkennungszone in der Reolink-Kamera auf die Einfahrt begrenzen.
- Abendstunden: Belichtung/IR der Eingangskamera für Kennzeichen prüfen, sonst bleibt nach 20 Uhr nichts lesbar.
- Der Tracker auf dem iMac muss neu gestartet werden, damit `/classify` die Boxen liefert; bis dahin greift die alte Ja/Nein-Antwort ohne Größenfilter.

## 2026-09-05 (Ausfallnacht geklärt, Log-Zeitsuche, Dienst-Neustart aus der Cloud)

Snapshot über den neuen Task `HUB_LOG` gelesen (Hub auf `df15676`), nicht vom iMac.

### Befunde

- **Ausfall 3.→4.9. war kein Absturz:** letzte Zeile am 3.9. 20:37:44 Uhr `SIGTERM – Hub beendet sich.`, danach nichts bis 4.9. 10:53:39 Uhr `EMP-Access-Hub startet (60b46750)`. Kein Neustart-Loop, keine Fehler davor (Log 19:30–20:37 Uhr ohne „fehl“). Der Hub läuft als launchd-**Agent** (`gui/<uid>`), also nur in einer angemeldeten Sitzung: SIGTERM um 20:37 heißt Abmelden oder Herunterfahren des iMac zum Betriebsende, Wiederanlauf mit der Anmeldung am nächsten Vormittag. In dieser Zeit sind alle Kennzeichen, DoorBird-Öffnungen und Kameraereignisse verloren; die Cloud zeigt den Hub nur als offline.
- Dasselbe Muster am 5.9. um 11:08 Uhr (SIGTERM, sofortiger Neustart – hier von Hand).
- Fehler-Log enthält wiederholt `fatal: unable to access 'https://github.com/…': Could not resolve host: github.com` – DNS am Standort fällt zeitweise aus; Cloud-API blieb erreichbar. Nur die Update-Prüfung scheitert dann.
- Nach dem Update auf `a930f6b` lief der YOLO-Tracker noch als alter Prozess: `Vision (yolo) Kamera Eingang: YES conf=0.91 (Tracker ohne Boxen)` – der Größenfilter greift erst nach einem Tracker-Neustart.
- Versionsnummer im Heartbeat ist seit `bc50d63` kein Beleg für einen Neustart mehr (`CONFIG.version` wird nach `reset --hard` auch ohne Neustart nachgezogen); Beleg ist die Zeile `EMP-Access-Hub startet`.

### Änderungen

- `HUB_LOG` liest jetzt ein 1-MB-Fenster an wählbarer Stelle: Dateiende, `at` (Binärsuche über die `[ISO]`-Zeitstempel, bei 91 MB wenige Lesezugriffe), `before`/`after` (Blättern, lückenlos an Zeilengrenzen). Ergebnis mit `windowStart/End`, `hasOlder/Newer`, `firstTs/lastTs`. UI: Datum/Uhrzeit, „Ab hier lesen“, Älter/Neuer.
- Neuer Task `SERVICE_RESTART` (`hub/src/services.ts`): `tracker` per `launchctl kickstart -k gui/<uid>/<HUB_TRACKER_LAUNCHD_LABEL>` mit Warten auf `/health`, `hub` per Exit nach Ergebnis. Knöpfe mit Rückfrage in der Hub-Karte.
- Updater: Änderungen an `hub/IMPROVE.md`, `hub/README.md`, `hub/.env.example` lösen keinen Neustart mehr aus.

### Offen

- **Hub als LaunchDaemon oder Auto-Login:** Solange der Hub ein Benutzer-Agent ist, stirbt er mit jeder Abmeldung. Entweder Auto-Login und „Ruhezustand nie“ auf dem iMac, oder `install/` um eine Daemon-Variante (`/Library/LaunchDaemons`, `UserName`) ergänzen.
- Tracker über „Tracker neu starten“ neu starten und danach im Log nach `Vision (yolo)` mit `Fläche=` schauen.
- DNS-Aussetzer am Standort prüfen (Router/Pi-hole?); der Hub sollte bei `Could not resolve host` nicht jede 5 Minuten eine Fehlerzeile schreiben, sondern gedrosselt.

## 2026-09-05 (Hub-Ausfall als Push, Update-Fehler gedrosselt)

### Befunde

- Der Ausfall 3.→4.9. blieb 14 Stunden unbemerkt: die Offline-Prüfung im 5-Minuten-Cron kannte nur Pis, Shellys und GARDENA, nicht den Hub. Die rote Hub-Karte im Dashboard sieht nur, wer gerade hinschaut.
- Tracker auf dem iMac um 11:22 Uhr weiterhin „Tracker ohne Boxen“ – der Neustart per Knopf steht noch aus.

### Änderungen

- `HubAgent.offlineNotifiedAt` (Migration `20260905120000_hub_offline_notified`); `runOfflineCheckTick` prüft je Account zuerst die Hubs: Heartbeat älter als 5 min → Push „Hub offline“ mit Uhrzeit des letzten Lebenszeichens, Heartbeat zurück → „Hub wieder online“. Zustandsübergang wie bei den Geräten, Karteileichen älter als 7 Tage werden nicht gemeldet.
- Updater loggt Fetch-Fehler nur noch beim ersten Mal und dann stündlich mit Zähler, plus eine Zeile, wenn es wieder geht.
- README: Abschnitt „Betrieb rund um die Uhr“ (Auto-Login, `pmset`, warum der Agent mit der Abmeldung stirbt, LaunchDaemon bewusst nicht umgesetzt).

### Offen

- Tracker neu starten (Knopf), danach `Vision (yolo)` mit `Fläche=` im Log erwarten.
- Auto-Login und `pmset` auf dem iMac setzen; Push-Abo auf dem Handy prüfen (Einstellungen → Push).

## 2026-09-05 (Mindestgröße und Einfahrtszone pro Kamera in der Cloud)

### Befunde

- Tracker läuft seit ~12:00 Uhr mit Box-Ausgabe: `Vision (yolo) Kamera Eingang: YES conf=0.93 Fläche=31.3%` (echtes Fahrzeug), DoorBird-Prüfungen melden `NO – kein Fahrzeug`. Der Größenfilter ist damit scharf.
- Zone und Schwelle lagen bisher nur in `hub/.env` auf dem iMac – ohne SSH nicht erreichbar, und je Kamera-ID von Hand.

### Änderungen

- `Camera.vehicleMinArea` (Anteil 0..0,5) und `Camera.vehicleZone` (Polygon, normiert) – Migration `20260905130000_camera_vehicle_zone`. `/api/hub/cameras` liefert beide mit, der Hub nimmt sie vor `HUB_VEHICLE_MIN_AREA`/`HUB_VEHICLE_ZONE(_<id>)`.
- Kameras → Bearbeiten: Abschnitt „Fahrzeug ohne Kennzeichen“ mit Prozentfeld und Klick-Editor auf dem letzten Schnappschuss (`zone-editor.tsx`, Polygon ab 3 Punkten, max. 32, „Letzten Punkt“/„Zone löschen“). Leer = Hub-Standard bzw. keine Zone.
- Mock-Test: Cloud-Zone rechts lehnt Box links ab (`zone`), Zone links akzeptiert, 2-Punkte-Zone wird ignoriert, Cloud-Schwelle 10 % lehnt 4 %-Box ab (`small`).

### Offen

- Zone für Kamera Eingang im Editor setzen (Straße und Parkplatz oben links ausklammern); Schnappschuss vorher per „Schnappschuss“ anfordern, sonst ist der Editor leer.
- Wirkung nach ein paar Tagen an `vision.no_small`/`vision.no_zone` gegen `vision.yes` im Diagnose-Snapshot ablesen.

## 2026-09-05 (Systempflege: Ruhezustand, pmset, Auto-Login automatisch soweit möglich)

### Befunde

- Der Hub läuft ohne Root. Auto-Login (`sysadminctl`, braucht das Benutzerpasswort) und `pmset` kann er nicht selbst setzen; nur `caffeinate` geht ohne Rechte.
- Auf dem Entwickler-MacBook geprüft: `checkSystem()` liest Auto-Login (`defaults read … autoLoginUser`), `pmset -g` (sleep/autorestart) und `pmset -g sched` korrekt, startet `caffeinate -i -s -w <pid>` und erkennt die fehlende sudoers-Regel.

### Änderungen

- `hub/src/system-setup.ts`: bei jedem Start (also nach jedem Update) und alle 6 h – caffeinate gegen den Ruhezustand; wenn `/etc/sudoers.d/emp-hub` da ist, `pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1 womp 1` und `pmset repeat wakeorpoweron MTWRFSU <HUB_POWER_ON_TIME>` nachziehen; Zustand nach `STATE.system`, ins Log („Systempflege: …“), in die Diagnose-Hinweise und per Heartbeat in `HubAgent.status.system`.
- `install/setup-system.sh` (einmal mit sudo): pmset-Werte, tägliches Einschalten (Standard 06:00), sudoers-Regel nur für `/usr/bin/pmset`, Auto-Login per `sysadminctl -autologin set` mit Passwortabfrage (FileVault-Check).
- Hub-Karte unter Netzwerk zeigt die Hinweise des Hubs (Auto-Login aus, Ruhezustand, kein Einschaltplan) in Amber.

### Offen

- Einmal auf dem iMac: `cd ~/repos/emp-access/hub && sudo ./install/setup-system.sh 06:00`. Danach verschwinden die Hinweise in der Hub-Karte von selbst.

## 2026-09-05 (Setup-Skript gelaufen, FileVault blockiert Auto-Login)

### Befunde

- Nach `sudo install/setup-system.sh` meldet der iMac um 12:43 Uhr: kein Ruhezustand, Einschalten täglich 06:00, pmset per sudo erlaubt, caffeinate an – aber weiterhin „Auto-Login aus“.
- Ursache per `fdesetup status`: **FileVault ist an**. macOS erlaubt dann keine automatische Anmeldung; nach einem Neustart wartet der Mac an der Anmeldemaske, der Hub-Agent startet erst mit der Anmeldung.

### Änderungen

- Task `SYSTEM_CHECK` liest den Zustand auf Abruf und zieht pmset nach; das Setup-Skript startet den Hub zum Schluss selbst neu.
- `system-setup.ts` erkennt FileVault; der Hinweis nennt jetzt die Ursache und die zwei Auswege (FileVault aus oder nie herunterfahren).

### Offen

- Entscheidung: FileVault am iMac ausschalten (Systemeinstellungen → Datenschutz & Sicherheit → FileVault), dann `sudo install/setup-system.sh` erneut für Auto-Login. Ohne das gilt: Der Mac darf abends nicht heruntergefahren werden; das tägliche Einschalten um 06:00 hilft dann nur bis zur Anmeldemaske.

## 2026-09-05 (Hub-Mac fertig eingerichtet)

- 13:53 Uhr per `SYSTEM_CHECK` bestätigt: FileVault aus, Auto-Login `aaronarmnborst`, kein Ruhezustand, Neustart nach Stromausfall, Einschalten täglich 06:00, sudo-Regel für pmset, caffeinate an – keine Hinweise mehr. Auto-Login wurde über die Systemeinstellungen gesetzt, nachdem der zweite Lauf des Setup-Skripts bei `sysadminctl` abgebrochen war (Skript-Ausgabe nicht gesehen).
- Damit überlebt der Hub Herunterfahren und Neustart des iMac ohne Zutun; der Ausfall vom 3./4.9. kann so nicht mehr entstehen.

## 2026-09-07 (Audio und Shelly an Räume und Betriebszeiten gekoppelt)

Schließt zwei offene Punkte vom 1.9.: Audio hielt eigene Uhrzeiten statt auf die Betriebszeit zu verweisen, und `Device.schedule` war ein Wochenplan ohne Ausführung.

### Änderungen

- **Audio-Zone hat einen Raum** (`AudioZone.keyRoomId`). Zuordnung im Zonen-Dialog unter Audio oder im Raum-Dialog unter Räume („Beschallung in diesem Raum“). Die Raumkarte zeigt die Zone mit Start/Stopp; die Zonenkarte unter Audio zeigt den Raum.
- **Audio-Zeitpläne kennen Betriebsbeginn und Betriebsende** (`AudioSchedule.trigger` = TIME | OPENING | CLOSING, `offsetMinutes`, `operatingScheduleId`, `operating`). Welche Betriebszeit gilt, entscheidet wie bei den Regeln zuerst der Zeitplan, sonst der Raum der jeweiligen Zielzone – Zonen in verschiedenen Räumen sind zu verschiedenen Zeiten dran, der Lauf gruppiert sie. Dazu die Bedingung „nur während / nur außerhalb der Betriebszeit“ je Zone. Die Karte zeigt „Betriebsende −15 Min.“ und den nächsten Termin („heute 19:45“); Warnungen, wenn eine Zielzone keine Betriebszeit hat.
- **`Device.schedule` entfernt** (Migration `20260907090000_audio_operating_coupling`), samt Karte „Automatische Zeitsteuerung“ und Wochenplan im Anlege-Dialog. An ihrer Stelle auf der Gerätedetailseite die Karte **„Raum und Betriebszeit“**: Raum, Betriebszustand des Raums, alle Regeln, die das Gerät schalten, und „Mit der Betriebszeit koppeln“ – legt „Einschalten bei Betriebsbeginn“ und „Ausschalten bei Betriebsende“ als zwei Raumregeln an (Versatz je Zeitpunkt, wahlweise andere Betriebszeit). Bei Rolltor/Markise heißt „aus“ schließen, beim LOQED abschließen. Gerät anlegen/bearbeiten hat jetzt ein Feld „Raum“.
- **`operating-hours.ts`**: `dueOperatingOccurrence`/`nextOperatingOccurrence` suchen Vortag, heute und Folgetag ab. Ein Betriebsende um 02:00 gehört zum Vortag und ging in `scheduledTimeFor()` der Regel-Engine bisher verloren – die nutzt jetzt denselben Helfer. Wochentage gelten für den Betriebstag, nicht für den Kalendertag des Endes.
- `WeekScheduleEditor`/`lib/schedule.ts` bleiben: Mitarbeiter-Zeitfenster und Tickets nutzen sie weiter.

### Geprüft

- 68 Unit-Tests grün (9 neue für Betriebszeit-Auslöser: Fenster, Vortag, Wochentag des Betriebstags, Versatz über Mitternacht, Anzeige). `tsc` sauber, `scripts/audio-schedule-check.ts` weiter grün.
- Lauf gegen die lokale Dev-DB: Zone im Raum mit Betriebszeit 10–20 Uhr, Zeitplan „Stopp, Betriebsende −15 Min.“ → 19:30 nichts, 19:46 ein STOP-Job (`SCHEDULE:CLOSING`), 19:48 kein zweiter, Uhrzeit-Plan „nur während der Betriebszeit“ um 21:01 bleibt aus. Testdaten wieder entfernt.
- Seiten Audio, Räume, Geräte, Gerätedetail, Regeln kompilieren im Dev-Server ohne Fehler. Oberfläche nicht eingeloggt geprüft (Browser-Session abgelaufen).

### Offen

- Bewässerung, Überwachung und E-Mail halten weiter eigene Fenster.
- Bestehende Regeln mit Betriebsende nach Mitternacht feuern ab jetzt; wer so etwas eingerichtet hatte, sieht neue Verlaufseinträge.

## 2026-09-07 (Ruhezeit der Audio-Zonen durch die Betriebszeit abgelöst)

Die Zone hielt neben der Betriebszeit noch ein eigenes festes Fenster „keine Musik von 22:00 bis 08:00“ – zweite Uhrzeitquelle ohne Saison und Ausnahmetage. Jetzt heißt es „Musik nur zur Betriebszeit“, je Ende mit Versatz.

### Änderungen

- **`AudioZone`**: `quietFrom`/`quietTo` weg, dafür `musicOperating`, `musicOpenOffset`, `musicCloseOffset` (Migration `20260907150000_audio_music_operating`; Zonen mit Ruhezeit bekommen die Kopplung eingeschaltet, Versatz 0). Zonen-Dialog: Schalter, zwei Versatzfelder, Vorschau „heute 09:30–20:30“ aus der Betriebszeit des Raums, Hinweis, wenn Raum oder Betriebszeit fehlen.
- **`operating-hours.ts`**: `operatingSpansForDay`, `isWithinOperatingSpan`, `operatingSpanState` – Öffnungsspannen als Zeitpunkte mit Versatz an beiden Enden, zusammengelegt, wo sich Spannen berühren; dazu der nächste Wechsel. `audio-constants.ts`: `musicWindowState` (Zone + Betriebszeit → erlaubt/bis wann), `describeMusicWindow`, `parseOffsetMinutes`, `MAX_OPERATING_OFFSET_MINUTES` (gilt jetzt auch für Zeitpläne).
- **Pi-Abspieler 1.2.0**: bekommt im Zonenabgleich `music: { allowed, until }` statt Uhrzeiten und rechnet nichts selbst. Nach `until` gilt der umgekehrte Zustand, bis der nächste Abgleich kommt – die Musik geht abends auch ohne Verbindung aus. Ohne `music` (Zone ohne Kopplung) wie bisher: Musik jederzeit.
- Regel-Engine, Dashboard-Ops-Karte („Betriebsruhe“) und Zeitplan-Warnungen fragen dasselbe Fenster. Die Warnung an der Zeitplan-Karte prüft bei fester Uhrzeit den nächsten Termin, bei Betriebsbeginn/-ende den Versatz gegen den der Zone.

### Offen

- Pi zieht das Update per git beim nächsten Lauf; bis dahin gilt auf ihm keine Begrenzung mehr (die Cloud schickt keine Uhrzeiten mehr).


## 2026-09-12 (Falschparker Kamera Eingang: Machbarkeit geprüft)

Anlass: Rechts neben der Zufahrt stehen regelmäßig Autos im absoluten Halteverbot. Gefragt war Erkennung, Push und eine Ansage über den Kamera-Lautsprecher. Diese Sitzung war reine Analyse plus zwei Live-Proben an der Kamera; noch kein Produktionscode.

### Befunde

- „Kamera Eingang" in der Cloud ist physisch `cam-eingang-oben`, RLC-811A auf 192.168.40.11 (Gerätename „Eingang Oben", Firmware v3.1.0.4695). Die Kamera auf 192.168.1.86 heißt intern ebenfalls „Eingang", zeigt aber Drehkreuz und Shop – nicht die Zufahrt. Wer nur nach dem Namen greift, landet auf der falschen Kamera.
- Der Lautsprecher taugt für Sprache, aber nicht über die CGI-API: `GetAudioFileList`, `GetAudioAlarm`, `GetAutoReply` antworten alle `not support` (rspCode -9). Eigene Audiodateien lassen sich also nicht hochladen, `AudioAlarmPlay` bleibt auf den fest eingebauten Alarmton beschränkt. `GetAudioAlarmV20` und `GetAudioCfg` (Lautstärke 92) gehen.
- Der Weg für freie Ansagen ist der ONVIF-Backchannel über RTSP. DESCRIBE mit `Require: www.onvif.org/ver20/backchannel` liefert einen dritten Track: `m=audio RTP/AVP 0`, `PCMU/8000`, `a=sendonly`. Ohne den Header fehlt er.
- Live erprobt und funktionsfähig: `say -v Anna --data-format=LEI16@8000` → `afconvert -d ulaw@8000` → RTSP DESCRIBE/SETUP/PLAY → RTP-Pakete à 160 Byte alle 20 ms, interleaved über TCP. 4,69 s Ansage gingen in 4,70 s durch, ohne Abbruch. Beide Werkzeuge liegen in macOS, ffmpeg ist auf dem Hub nicht installiert.
- Zwei Fallen dabei: `RECORD` beantwortet die Kamera mit `405 Method Not Allowed`, es muss `PLAY` sein (`Public:` listet OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE, GET_PARAMETER, SET_PARAMETER). Und der `Require`-Header muss auch an SETUP und PLAY, nicht nur an DESCRIBE.
- Erkennungsseitig fehlt eine Standzeit. `vision.ts` prüft Einzelbilder ohne Gedächtnis, der Zone-Worker im Tracker zählt über `ZoneOccupancy` nur, wie viele Tracks gerade in der Fläche sind. Für „steht seit 10 Minuten" gibt es nichts.
- Der Tracker läuft mit drei Workern (`cam-drehkreuze`, `cam-aquapark`, `cam-halle-2`, yolov8n); `cam-eingang-oben` ist nicht dabei. go2rtc 1.9.14 hat die Kamera als `cam-eingang-oben_main`/`_sub`.
- `parkingLot` mit `spots` steht in `webcams/config.json` und hat einen Editor (`parking-spots-editor.tsx`), bei `cam-halle-2` sogar vier fertige Plätze – der Tracker liest das Feld aber nirgends aus, `parking_history.py` wird von `main.py` nicht importiert. Toter Strang, kein Fundament.

### Änderungen

- Keine am Code. An der Kamera wurde für die Hörprobe die Lautstärke auf 3 gesetzt und danach wieder auf 92 gestellt (`SetAudioCfg`, geprüft).

### Offen

- Die Zone rechts an der Hecke ist noch nicht abgestimmt; der Zuschnitt liegt nur als Vorschlag vor. Radaufstandspunkte der drei Autos liegen bei etwa (0.55, 0.09), (0.61, 0.13), (0.70, 0.20).
- Ob am Lautsprecher wirklich Ton herauskommt, ist ungeprüft: Der Sendeweg ist bestätigt, gehört hat es bei Lautstärke 3 niemand.
- Dauerparker am Rand (eigene Fahrzeuge?) würden ohne Sperrzeit zum Daueralarm führen.

## 2026-09-13 (Halteverbot am Eingang: Erkennung mit Standzeit, Ansage über den Kamera-Lautsprecher)

Aus der Machbarkeitsprüfung vom Vortag ist Code geworden. Neu ist ein eigener Takt, der die Standzeit misst – das fehlte bisher überall: `vision.ts` bewertet Einzelbilder ohne Gedächtnis, und `ZoneOccupancy` im Tracker zählt nur, wie viele Fahrzeuge gerade in einer Fläche sind.

### Befunde

- Die Fläche ließ sich erst zuschneiden, als sie leer war. Am Vorabend mit parkenden Autos lag der erste Entwurf zu hoch und deckte überwiegend Hecke und Grünstreifen ab; am Sonntagmorgen war die Grenze zwischen Asphalt und Schotter klar zu sehen.
- Belastbarer als jedes Augenmaß waren die echten Radaufstandspunkte: Über vier Aufnahmen (18:46, 20:14, 22:08, 09:40) liegen alle acht geparkten Fahrzeuge bei x 0,546–0,797 und y 0,178–0,319. Der Lieferwagen auf dem Pflaster im Vordergrund liegt bei (0,668, 0,920) mit 35,7 % Bildfläche und bleibt außen – genau deshalb zählt der Radaufstandspunkt und nicht der Box-Mittelpunkt.
- Der Bildausschnitt war über alle vier Zeitpunkte identisch, es hat also niemand gezoomt oder geschwenkt. Eine feste Fläche in normierten Koordinaten ist damit tragfähig; nach einem PTZ-Eingriff wäre sie es nicht.
- Die Mindestgröße musste deutlich unter `HUB_VEHICLE_MIN_AREA` (2 %) liegen: Ein Pkw auf dem Schotter belegt 0,7–1,8 % der Bildfläche, die Autos auf dem Parkplatz im Hintergrund nur 0,10–0,29 %. 0,5 % trennt beides sauber.
- Das Wiedererkennen über die Zeit ist unkritisch, weil stehende Autos stillstehen: Im Trockenlauf über drei Minuten lag die Boxenüberdeckung bei 0,96–0,99. Ein einzelner Aussetzer bei einem schwach erkannten Fahrzeug (conf 0,38–0,50 bei 0,71 % Fläche) wurde durch die Aussetzer-Toleranz überbrückt, die Standzeit lief korrekt weiter.
- YOLO meldet denselben Transporter gern doppelt, als Auto (conf 0,49) und als Lastwagen (conf 0,58) auf derselben Box. Ohne Zusammenführung ab 0,6 Überdeckung zählte ein Fahrzeug zweimal.
- Hörprobe bei Lautstärke 92 über den fertigen Code: 4,7 s Ansage, sauber durchgelaufen.

### Änderungen

- **`hub/src/camera-talk.ts`** (neu): Ansage über den ONVIF-Audio-Backchannel. `say` erzeugt 8-kHz-Sprache, `afconvert` wandelt in µ-law, dann RTP-Pakete à 160 Byte im 20-ms-Takt, interleaved über TCP. Erzeugte Sprache liegt in `hub/.cache/talk` (`say` braucht rund eine Sekunde), pro Kamera spricht immer nur eine Ansage. Kein ffmpeg nötig, kein Cloud-Dienst – die Ansage läuft auch bei Internet-Ausfall.
- **`hub/src/noparking.ts`** (neu): Schnappschuss alle 20 s, Fahrzeug-Boxen über `detectVehicles`, Filter nach Klasse, Vertrauen, Mindestgröße und Radaufstandspunkt in der Fläche, danach Zuordnung zu den bekannten Fahrzeugen über die Boxenüberdeckung. Ab 2 Minuten Standzeit Meldung, Wiederholung nach 10 Minuten. Ansage und Cloud-Meldung laufen unabhängig voneinander, damit ein Ausfall die andere Seite nicht mitnimmt.
- **`hub/src/vision.ts`**: `detectVehicles` liefert die rohen Boxen (die bestehende `checkVehicle`-Logik mit Box-Mittelpunkt und 2-%-Schwelle passt für die Einfahrt, nicht für Standzeiten), `inside` ist jetzt exportiert.
- **`hub/src/cameras.ts`**: `announceOnCamera` (nicht mit `setSiren` verwechseln – die Sirene kann nur den eingebauten Alarmton) und `findCameraByRef`, damit Kameras in Einstellungen auch über den Namen benannt werden können.
- **Cloud**: `POST /api/hub/parking-violations` und `src/lib/parking-violations.ts` – Eintrag in der Fahrzeug-Historie mit Bild (`VehicleSighting.source = "NO_PARKING"`), Push, Telegram mit Schnappschuss. Die Historie entsteht immer, benachrichtigt wird höchstens alle 10 Minuten: Ein Fahrzeug, das eine Stunde steht, soll nicht stündlich klingeln.
- **`hub/scripts/talk-test.ts`** (neu): Ansage von Hand auslösen, für den Hörtest.
- Diagnose-Hinweise für fehlgeschlagene Prüfungen, Dauerbelegung ohne Meldung und scheiternde Ansagen; neue Improve-Art `noparking`.
- Aktiv auf Kamera 9: Schwelle 2 Minuten, Takt 20 s, Ansage von 8 bis 22 Uhr. Die Fahrzeuge dort sind fremd, es gibt also keine Ausnahmen.
- Cloud-Teil ausgeliefert (`7b1c3e72`): Der Endpunkt antwortete rund sieben Minuten nach dem Push statt mit 404 mit 401, war also erreichbar und prüfte den Token.

### Offen

- Der erste echte Durchlauf steht noch aus: Zum Zeitpunkt der Aktivierung war die Fläche leer (Sonntagmorgen, Regen). Bis dahin ist nur belegt, dass Erkennung, Endpunkt und Lautsprecher je einzeln funktionieren – nicht, dass die Kette bis zum Push auf dem Handy durchläuft. Bei der nächsten Meldung lohnt der Blick in den Log: `Halteverbot-Meldung fehlgeschlagen: HTTP …` wäre das Zeichen für einen Fehler zwischen Hub und Cloud.
- 4,7 s Ansage sind lang, wenn jemand nur kurz aussteigt. Nach den ersten Erfahrungen lohnt ein kürzerer Text über `HUB_NOPARK_TEXT`.
- Die Fläche steht in `hub/.env` und ist nur dort änderbar. Ein Editor im Dashboard wäre der nächste Schritt; der Zonen-Editor für die Einfahrt (`zone-editor.tsx`) ließe sich dafür wiederverwenden.
- Nach einem PTZ-Eingriff an der Kamera stimmt die Fläche nicht mehr. Fällt die Erkennung dauerhaft auf `clear`, ist das der erste Verdacht.

## 2026-09-13 (Halteverbot-Fläche im Dashboard statt in hub/.env)

Der Zuschnitt vom Morgen war zu grob – und er ließ sich nur an der Maschine im Technikraum ändern. Beides ist behoben: Die Fläche liegt jetzt an der Kamera in der Cloud und wird im Dashboard mit der Maus gezogen.

### Befunde

- Der erste Zuschnitt entstand vor parkenden Autos und deckte überwiegend Hecke und Grünstreifen ab. Am leeren, hellen Sonntagmorgen war die Grenze zwischen Asphalt und Schotter eindeutig zu sehen – die Fläche gehörte deutlich weiter nach unten und rechts.
- Der Bereich um den Anhänger rechts unten (etwa x 0,85–0,94, y 0,45–0,63) lag außerhalb. Wer dort parkt, wäre unentdeckt geblieben.
- Beim Nachziehen der linken Kante nach rechts fiel eine echte Parkposition (0,546/0,183) aus der Fläche. Im Detailausschnitt zeigte sich, dass sie im Übergang zwischen Asphalt und Schotter liegt: Die Kante bei x 0,535 nimmt sie mit und bleibt trotzdem rechts der Durchfahrt. Die neue Fläche enthält alle acht beobachteten Parkpositionen, der Lieferwagen auf dem Pflaster davor (35,7 % Bildfläche) bleibt außen.
- Der bestehende `ZoneEditor` der Einfahrtszone war wiederverwendbar – gleiches Koordinatensystem, gleicher Schnappschuss-Endpunkt. Nur die Hinweistexte waren fest verdrahtet und sprachen vom Box-Mittelpunkt; beim Halteverbot zählt der Radaufstandspunkt, und wer das nicht weiß, rahmt die falsche Fläche ein.
- Nach dem Herausnehmen aller `HUB_NOPARK_*`-Werte aus `hub/.env` prüft der Hub weiter („Halteverbot prüft: Kamera Eingang"). Damit ist belegt, dass Auswahl und Fläche wirklich aus der Cloud kommen und nicht mehr aus der Umgebung.

### Änderungen

- **`Camera.noParkDetection`, `noParkZone`, `noParkMinutes`** (Migration `20260913080000_camera_no_park_zone`), Standard aus. Der eingeschaltete Schalter ohne Fläche wird von der API abgelehnt, sonst liefe die Erkennung ins Leere.
- **`ZoneEditor`**: Beschriftung über `texts` austauschbar, Vorgabe bleibt die Einfahrt. Die Validierung in `PUT /api/cameras/[id]` liegt jetzt in `parseZoneInput` und gilt für beide Flächen.
- **Kamera-Formular**: Abschnitt „Halteverbot" mit Schalter, Standzeit und Fläche, samt Hinweis, die Durchfahrt nicht mit einzurahmen.
- **Hub**: `zoneFor`/`minutesFor` nehmen die Cloud-Einstellung vor der Umgebung, `camerasToCheck` liest die Auswahl in jedem Durchlauf neu – beim Start ist der Cloud-Abgleich noch nicht gelaufen. Der Takt läuft deshalb immer und ist ohne ausgewählte Kamera ein Leerlauf. Wird das Halteverbot abgeschaltet, verfällt die gemessene Standzeit. Kameras ohne Fläche werden einmal gemeldet, nicht alle 20 Sekunden.
- Fläche der Kamera Eingang auf 13 Ecken erweitert (ganzer Schotter), Standzeit 2 Minuten – in der Datenbank hinterlegt, damit sie im Dashboard sichtbar ist und dort nur noch nachgezogen werden muss.
- `hub/.env` enthält vom Halteverbot nur noch die Ansage; Kamera und Fläche stehen auskommentiert als Notausgang darin.

### Offen

- Der erste echte Falschparker steht weiter aus – die Fläche war den ganzen Sonntagmorgen leer. Bis dahin ist die Kette bis zum Push nur in Einzelteilen belegt.
- Die Ansage (Text, Zeitfenster, ein/aus) hängt noch an der Umgebung und gilt für alle Kameras gleich. Sobald eine zweite Kamera eine gesperrte Fläche bekommt, gehört das an die Kamera.
- `HUB_NOPARK_MIN_AREA` und `HUB_NOPARK_MIN_CONF` gelten weiter global. Bei einer Fläche weiter weg von der Kamera wäre 0,5 % zu grob.

## 2026-09-16 (Soundweb London aus dem Dashboard statt vom Windows-Rechner)

Zwei fertig eingerichtete BSS-Soundweb-Prozessoren sollen aus EMP Access bedient werden, nicht mehr über einen Windows-Rechner mit Audio Architect. Der Hub bekommt dafür ein Modul für das London-DI-Protokoll; die Cloud die Verwaltung der Regler und einen Tab unter Audio.

### Befunde

- Das Protokoll ist schmal und gut dokumentiert (Soundweb London Interface Kit Rev. 2.7): `STX <Body> <XOR-Prüfsumme> ETX`, Body `<Typ> <Node 2> <VD 1> <Objekt 3> <SV 2> <Daten 4>`, danach Ersetzung von 0x02/0x03/0x06/0x15/0x1B durch `0x1B, Byte+0x80`. Beide Byte-Beispiele aus dem Dokument (Prüfsummen 0x84 und 0x3F) werden vom neuen Encoder exakt getroffen.
- Über Ethernet gibt es kein ACK/NAK („TCP provides it“), Port 1023, mehrere Verbindungen gleichzeitig erlaubt. Ein Abonnement (`0x89` bzw. `0x8E` für Prozent) antwortet sofort mit dem aktuellen Wert und danach bei jeder Änderung; die Rate im Datenfeld zählt nur für Meter, 0 ist für Regler richtig. Preset-Abrufe (`0x8C`) sind Broadcast ohne Adresse.
- Gain-Fader haben ein eigenes Law: dB × 10000 zwischen −10 und +10 dB, darunter `−log10(|dB/10|) × 200000 − 100000` (−20 dB = −160206, −80 dB = −280618). Prozent ist Wert × 65536. Beides liegt jetzt in `src/lib/soundweb.ts` mit Tests, weil die Karte dB anzeigen soll und nicht Rohwerte.
- Ein Soundweb sendet von sich aus nichts, solange sich kein Wert ändert. Eine gestorbene Verbindung fiele damit erst beim nächsten Befehl auf. Darum abonniert der Hub alle zwei Minuten eine SV erneut und wertet die Antwort als Lebenszeichen.
- Durchgängiger Test ohne Hardware: simuliertes Soundweb (TCP-Server mit dem echten Protokollmodul), der echte `hub/src/soundweb.ts` als Runner gegen den Dev-Server, Cloud-Routen per Session-Cookie. Gerät anlegen → `SOUNDWEB_SYNC` → verbunden und vier SVs abonniert in unter einer Sekunde; Werte aller fünf Arten gesetzt und mit Echo bestätigt (Fader-Rundreise 0,8–1,6 s, davon 1 s Task-Poll); Fremdänderung am Gerät nach 2 s im Status; Gerät weg → „getrennt“ im Status, Befehl sofort mit 503 abgelehnt; Gerät wieder da → Wiederverbinden und Neu-Abonnieren nach 9 s.
- Ein sauber geschlossener Socket (FIN vom Gerät) hatte zunächst keinen Fehlertext, die Karte zeigte dann „noch keine Meldung“ statt „getrennt“. Behoben: ohne Grund heißt es „Verbindung vom Gerät geschlossen“, und die Karte nennt alles „getrennt“, was der Hub schon einmal gemeldet hat.

### Änderungen

- **`hub/src/soundweb-protocol.ts`** (neu): Rahmen bauen und zerlegen, ohne Netz und ohne Hub-Importe – prüfbar gegen aufgezeichnete Bytes. Der Parser verkraftet zerstückelte und zusammengeklebte Rahmen, ignoriert ACK/NAK und meldet falsche Prüfsummen als Fehler statt sie zu verwerfen.
- **`hub/src/soundweb.ts`** (neu): je Gerät eine Verbindung mit Backoff 3–60 s, Abonnements beim Verbinden (je SV einmal, getrennt nach Roh und Prozent), Zuordnung der Antworten auch ohne Node-Treffer (Antworten tragen den Node der Quelle), gebündelte Meldung an `POST /api/hub/soundweb/state` (400 ms) plus voller Stand jede Minute, Konfiguration aus `GET /api/hub/soundweb` alle fünf Minuten und per Task. Eine Verbindung wird nur neu aufgebaut, wenn sich an ihrem Gerät etwas geändert hat. Tasks `SOUNDWEB_SET` (wartet 1,5 s auf das Echo, ohne Echo gilt der gesendete Wert) und `SOUNDWEB_SYNC`; beide hoch priorisiert, Modul `soundweb`, Health-Karte im lokalen Dashboard, Improve-Art `soundweb`.
- **Cloud**: Modelle `SoundwebDevice` und `SoundwebControl` (Migration `20260916150000_soundweb_london`), Arten GAIN/MUTE/PERCENT/SELECT/PRESET. Routen unter `/api/audio/soundweb` (Geräte, Regler, `set`, `status`) und `/api/hub/soundweb` (Konfiguration, Zustand). `set` lehnt ohne Hub oder ohne stehende Verbindung sofort mit Grund ab, statt zehn Sekunden zu warten, und schreibt den bestätigten Wert zurück. Jede Änderung an Geräten oder Reglern legt einen `SOUNDWEB_SYNC` an (nur einen, solange einer offen ist).
- **Dashboard**: Tab „Soundweb“ unter Audio mit Gerätekarten, Reglern nach Abschnitt, dB-Fadern (Anzeige −∞ am Anschlag), Stummschaltern, Auswahl-Chips und Preset-Knöpfen. Bestätigte Werte überstimmen den Serverstand, bis die Statusabfrage (alle 5 s, nur bei sichtbarem Tab) sie eingeholt hat; Fremdänderungen kommen darüber an. Dialoge nehmen die Adresse so, wie Audio Architect sie zeigt (`0x000103000100`), auch nur das Objekt oder `Node, VD, Objekt, SV`.
- **Doku**: README-Abschnitt „Soundweb London (BSS) steuern“, Hub-README, `hub/.env.example` (`HUB_SOUNDWEB_CONFIG_INTERVAL`, `HUB_SOUNDWEB_PROBE_INTERVAL`, `HUB_SOUNDWEB_SUBSCRIBE_RATE`).

### Offen

- Noch gegen kein echtes Gerät gelaufen. Erster Schritt vor Ort: beide Prozessoren mit IP und Node anlegen und mit einem einzelnen Mute beginnen – so empfiehlt es auch das DI Kit. Bleibt die Karte auf „getrennt: Verbindung abgelehnt“, ist Port 1023 am Gerät oder ein Firewall-Regel zwischen Hub-VLAN und Audio-VLAN der erste Verdacht.
- Ob der Node in der DI-Nachricht über TCP der HiQnet-Node des Geräts sein muss oder auch 0 („direkt verbunden“) genügt, sagt das Dokument nur für die serielle Verbindung. Der Hub schickt den konfigurierten Node und ordnet Antworten zur Not ohne Node zu; bleibt ein Wert dauerhaft leer, im Log nach `unknown_sv` in der Diagnose schauen.
- Ob das Gerät eigene SETs an denselben Abonnenten zurückechot, ist im Simulator so angenommen. Tut es das nicht, gilt nach 1,5 s der gesendete Wert (`echoed: false` im Task-Ergebnis) – funktional gleich, nur 1,5 s langsamer.
- Meter (Pegelanzeigen) sind bewusst nicht dabei; dafür müsste die Abonnement-Rate gesetzt und die Meldung an die Cloud gedrosselt werden.
- Regeln und Zeitpläne kennen Soundweb-Regler noch nicht (z. B. Preset zum Betriebsbeginn). Die Task-Schnittstelle ist dafür bereits da.

## 2026-09-26 (DO-HM 338E erkannt, DoorBird danach geöffnet)

### Befunde

- Heute 09:51 Uhr (07:51 UTC): Burst Kamera Eingang, 13 Frames, Fahrzeug-Ende 09:50:58. OCR spät→früh. Frames 13–6 ohne Kandidaten (0,00). Frame 5: **DO-HM 338E, conf 0,96, Whitelist**. Dump `hub/.cache/veh-burst/2026-09-26T07-51-16-589Z_Kamera_Eingang`, chosen=4. Auf dem Trefferbild steht der weiße Wagen an der Einfahrt, die späteren Frames sind leer.
- Tür 26 ms später: `Tür geöffnet (Relais 1)` um 09:51:16.623, aus der lokalen Whitelist-Schaltung, nicht aus dem Telegram-Knopf.
- 0,9 s davor, 09:51:15.700: eigener Pfad. DoorBird MOTION ab 09:51:04, kein Gesicht (4 Versuche), YOLO am DoorBird YES conf=0,84 Fläche=14,8 % → `Öffnungswunsch (MOTION) → Telegram`. Das ist die Besuchermeldung, unabhängig vom Kennzeichen.
- Snapshot-Hinweise (Gallery-Schwelle, Halteverbot, DoorBird-Monitor) erklären diesen Vorgang nicht. Monitor-Drop 10:01 Uhr lag danach.

### Änderung

- Keine.

### Nächster Schritt

- OCR der leeren späten Frames kostet hier ~16 s, bis der frühe lesbare Frame drankommt. Frühstopp gilt erst nach dem ersten Whitelist-Treffer. Ob die Reihenfolge bei schon durchgefahrenem Auto umgedreht oder abgebrochen werden soll, ist offen. Umgesetzt am selben Tag, siehe unten.

## 2026-09-26 (Kennzeichen: Tür nicht mehr 16 s hinter den leeren Frames)

### Befunde

- Nachgerechnet am Dump von 09:51: fast-alpr Vollbild findet das Schild in 4K nicht (0,05 s, null Treffer). Die sechs Kacheln brauchen auf einem leeren Frame 0,26–0,31 s und finden nichts. macOS Vision auf demselben leeren Frame braucht **1,5–1,9 s** und liest nur die Kamerauhr. Acht leere Frames × (0,3 + 1,6) s = die 16 s. Der Trefferframe selbst ist in 0,10 s fertig (Kachel links, `DOHM338E`), Vision lief dort gar nicht.
- Im Dump: Frame 02 liest falsch `DOH1336E` (keine Whitelist, andere Ziffern). Frame 03 und der gewählte Frame lesen `DOHM338E`. Die späteren Frames sind leer.

### Änderung

- Burst startet fast-alpr mit jedem Schnappschuss, nicht erst danach von hinten. Whitelist öffnet das DoorBird, sobald dieser Frame fertig ist. Die Aufnahme läuft weiter.
- Vision nur noch einmal, und nur wenn fast-alpr kein sicheres Whitelist-Kennzeichen hat (unter `HUB_PLATE_EARLY_STOP_CONF` 0,85 oder gar keins).
- Kachel-Schleife bricht nach einem klaren Treffer ab (Detektion ≥ 0,5 und OCR ≥ 0,7), statt die restlichen Kacheln zu Ende zu suchen.
- Gleichzeitige ALPR-Aufrufe gehen nacheinander an den Daemon.

### Nächster Schritt

- Hub um 10:16 Uhr neu gestartet, ALPR-Daemon bereit. Beim nächsten eigenen Wagen im Log: `DoorBird sofort` noch während des Bursts, nicht ~16 s nach `VEHICLE ende`.

## 2026-10-10 (Audio: Musik im Restaurant geht nicht mehr von selbst an und aus)

### Befunde

- Hub lokal nicht erreichbar (kein `/api/improve`, kein `emp-hub.log`); Befund aus der Datenbank, nur lesend.
- Zone „Restaurant“ (#2, Abspieler „Sound Gastro“, v1.3.0, online): Raum „Gastronomie“ mit Betriebszeit „Gastronomie“. Die hat **nur die Saison „September“ 01.09.–30.09.** (Di–Fr 12–20, Sa+So 10–20). Seit dem 01.10. gilt die Gastronomie damit als ganztägig geschlossen.
- „Musik nur zur Betriebszeit“ ist an der Zone **aus**. Es gibt keinen PLAY/STOP-Zeitplan. Alle 63 PLAY/STOP-Jobs der Zone seit 10.09. sind `MANUAL` (37 PLAY, 26 STOP), zuletzt PLAY am 09.10. 16:32. Es wird also nur von Hand geschaltet.
- Zone „Insel“ (#1): Kopplung an, aber kein Raum. Sie wirkt dort also nicht.
- Zwei Fallen dahinter: (1) Die Kette Zone → Raum → Betriebszeit → Saison → Wochenplan wird stumm, sobald eine Saison endet. (2) Ein abendlicher Stopp setzt `sourceKind` auf SILENCE, und der Pi setzt zum Fensterbeginn nur `sourceKind` fort. Nach einem Stopp bliebe die Musik am nächsten Tag also auch mit Kopplung aus.
- Nebenbei: Seit `ed3b541` (22.08.) speicherte der Zonen-Dialog „Quelle“, „Sync-Gruppe“ und „Zone aktiv“ nicht mehr. Die Felder sind beim Umbau aus dem PUT gefallen.

### Änderung

- `AudioZone.musicOperating` ersetzt durch `musicMode` (MANUAL / TIMES / OPERATING) plus `musicTimes` (je Wochentag `from`/`to`). Migration `20261010120000_audio_music_mode`: Kopplung an → OPERATING.
- Zonen-Dialog „Musik automatisch an und aus“ mit den Knöpfen Aus / Eigene Zeiten / Betriebszeit des Raums. Bei „Eigene Zeiten“ sieben Zeilen Schalter + Start + Ende, vorbelegt aus der Betriebszeit des Raums. Darunter eine Vorschau „heute 10:00–20:00 · Musik an bis heute 20:00“. Warnung, wenn die Betriebszeit in den nächsten Tagen keine Öffnung hat oder die Quelle „Keine Musik“ ist.
- Zonenkarte zeigt den Stand („Musik aus bis morgen 12:00“), in Warnfarbe bei stummer Automatik.
- `GET /api/devices/audio`: außerhalb des Fensters wird `sourceKind` von SILENCE auf die Quelle der Zone zurückgesetzt. Ein Stopp gilt damit nur bis zum Fensterende. Pi unverändert.
- Fensterrechnung für eigene Zeiten über dieselbe `operatingSpanState` (ganzjähriges Profil). Regel-Engine, Dashboard-Ops und Zeitplan-Warnungen fragen `musicWindowSource`.
- Zonen-PUT speichert `defaultSource`, `sourceKind`, `isActive`, `syncGroup` wieder.
- Tests: 106/106 grün, neu u. a. Restaurant-Wochenplan mit Ruhetag Montag und Warnung bei Betriebszeit ohne Saison.

### Nächster Schritt

- Restaurant im Dashboard auf „Eigene Zeiten“ stellen und die Oktober-Zeiten eintragen. Insel ebenso, oder Raum mit Betriebszeit zuordnen.
- Am nächsten Morgen prüfen: Zonenkarte „Musik an bis …“ und im Pi-Journal „Betriebszeit beginnt – Quelle wird fortgesetzt“.
- Offen: Per Hand außerhalb der Musikzeit starten geht weiterhin nicht (Pi verwirft PLAY still). Falls für Abendveranstaltungen gewünscht: Override „bis Ende heute“.

## 2026-10-10 (Restaurant: Musikzeiten von der Website übernommen)

### Befunde

- Deploy von `850bd84` live: Migration 12:14 UTC; danach Heartbeats von Insel und Restaurant um 12:18/12:19 UTC (alter Code hätte ohne `musicOperating` nicht mehr speichern können).
- Website-API `tuttenbrocksee.com/api/opening?page_id=7&date=…` (Gastro) für 120 Tage abgefragt: bis 31.10. Do–So 12:00–18:00 (Mo–Mi zu); 01.11. Allerheiligen 12:00–18:00 (Sonntag); 02.11.–06.12. Sa+So 12:00–18:00; ab 07.12. zu (geprüft bis 07.02.2027).
- „Eigene Zeiten“ hält nur einen Wochenplan und hätte am 02.11. und 07.12. von Hand umgestellt werden müssen. Betriebszeit „Gastronomie“ hängt nur am Raum Gastronomie, keine Regeln, keine Zeitpläne.

### Änderung

- Betriebszeit „Gastronomie“: Saisons „Oktober“ (10-01–10-31, Do–So 12–18) und „November bis Nikolaus“ (11-01–12-06, Sa+So 12–18) ergänzt, September unverändert.
- Zone Restaurant: `musicMode` = OPERATING, Versatz 0. Stichproben gegen die Website: 10.10./15.10./31.10./01.11./07.11./06.12. offen, 12.10./05.11./12.12. zu.

### Nächster Schritt

- Heute 18:00: Musik im Restaurant geht aus; morgen 12:00 wieder an (Pi-Journal „Betriebszeit beginnt – Quelle wird fortgesetzt“).
- Durchsagen Happy Hour (18:00/18:45) und „Gastro Feierabend“ (19:00 täglich) liegen jetzt nach Betriebsende bzw. an Ruhetagen – mit dem Betrieb abstimmen.
- Nachtrag gleicher Tag: Restaurant-Durchsagen auf Betriebsende umgestellt (Happy Hour Craft Beer/Kukki/Wein/Aperitif −60, Last Minute −15, Gastro Feierabend −10; Wochentage unverändert). Texte zeitneutral: „bis 20 Uhr“ → „bis zum Feierabend“, „es ist 20 Uhr — … macht jetzt Feierabend“ → „in wenigen Minuten macht … Feierabend“; `trackId` geleert, TTS rendert beim nächsten Abspielen neu. Heute fällig: Wein 17:00, Last Minute 17:45, Feierabend 17:50, Musik aus 18:00 – im Audio-Verlauf prüfen. Craft Beer (nur Mi) läuft bis Saisonende nicht, Mi ist zu.

## 2026-11-02 (Welcher Rechner für den Hub)

Snapshot nicht verfügbar: Hub läuft auf dem iMac, diese Sitzung auf dem MacBook Pro M5 (10 Kerne, 24 GB) ohne Hub-Prozess.

### Befunde

- `HubAgent.status` enthält nur `system` (Systempflege) und `parking`. CPU, Speicher und Prozesse aus `system-metrics.ts` gehen nicht in den Heartbeat. Ohne Zugriff auf den iMac gibt es deshalb keine aktuellen Leistungszahlen.
- Bemessung daher aus der Messung vom 31.08.: CPU ~50 % von 10 Kernen, davon Face-Sidecar ~2,8 Kerne (läuft auf CPU, weil CoreML bei `buffalo_l` Shape-Fehler wirft), Tracker ~0,5 Kern plus GPU (MPS), go2rtc und Hub zusammen unter 0,1 Kern. Speicher nach dem Abschalten von Ollama ~16 von 32 GB für die ganze Maschine.
- Last ist Dauerlast rund um die Uhr. Ein lüfterloses MacBook Air drosselt dabei. Ein MacBook schläft mit geschlossenem Deckel ohne externen Monitor trotz `pmset sleep 0`; das verhindert erst `pmset -a disablesleep 1`, das `system-setup.ts` nicht setzt. MacBooks haben kein Ethernet.

### Änderung

- Keine. Empfehlung: stationär Mac mini M6 mit 32 GB und Ethernet. Als MacBook nur ein MacBook Pro 14" M6 mit 32 GB (Lüfter), Ethernet-Adapter, Deckel offen oder `disablesleep`.
- Nachtrag (Anforderung: Tag und Nacht, alle Kameras überwachen): Der YOLO-Tracker läuft heute auf 3 von 13 Kameras, jeweils auf dem Substream (`<camId>_sub`, FFmpeg-Dekodierung auf der CPU). Auf allen 13 Kameras wären das grob 2–2,5 Kerne statt ~0,5, zusammen mit Face ~6–7 Kerne. Das ist für den M6 mit 6 Effizienzkernen knapp. Empfehlung deshalb Mac mini M5 Pro (15 Leistungskerne, 48 GB). Mac Studio M5 Max (ab 2.999 €) erst bei lokalem Bildmodell zu jedem Ereignis, YOLO auf den 4K-Hauptstreams oder deutlich mehr Kameras. Videoaufzeichnung gibt es im System nicht; Daueraufzeichnung von 13 Kameras wären grob 0,5–1 TB pro Tag und gehört auf NVR oder NAS.
- Nachtrag (Anforderung: lokale KI durchgängig): Arbeitsspeicher wird zum Hauptkriterium. Ollama mit `qwen2.5vl:7b` hielt am 31.08. 14 GB, auf 32 GB lief die Maschine damit in Swap und lagerte den Face-Sidecar aus. Empfehlung jetzt Mac Studio M5 Max 18/40 Kerne, 64 GB, 1 TB (Apple ab 4.099 € mit 512 GB). Mit 128 GB (ab 5.859 €), wenn mehrere Modelle oder ein Modell der 70B-Klasse parallel laufen sollen. Mac mini M5 Pro 64 GB (3.099 €) hat denselben Speicher, aber die halbe GPU und die halbe Speicherbandbreite (307 statt 614 GB/s) und ist bei 64 GB am Ende. Bildmodell nur auf Ereignisse nach YOLO/Face/ALPR, nicht auf jedes Bild (5915 Kamera-Ereignisse in 24 h am 01.09.).

### Nächster Schritt

- CPU, Speicher und die Prozess-Top-Liste in den Heartbeat aufnehmen, damit Hardwarefragen aus der Cloud beantwortbar sind.
- Face-Sidecar mit `allowed_modules=["detection", "recognition"]` (offen seit 31.08.); spart auf jeder Hardware Rechenzeit.

## 2026-11-04 (Ereigniserkennung nach dem Kamera-Umzug in VLAN 30)

### Befunde

- Pro Kamera und Poll zwei HTTP-Requests (GetMdState, GetAiState), Takt 5 s. Im Mittel ~2,5 s plus Poll-Dauer, bis ein Burst überhaupt startet.
- Die Bild-Pipelines (Kennzeichen, Gesicht) starteten erst nach dem `await` auf den Cloud-Upload der Ereignisliste. Jede Cloud-Latenz lag damit vor dem ersten Burst-Frame und vor der Tür.
- KI-Alarme flackern; jede Flanke wurde ein eigenes Cloud-Ereignis mit Raumregeln. Frühere Auswertung: nachts 100–200 Ereignisse pro Stunde.
- Überwachungs-Push für VEHICLE ging auf den rohen Kamera-Alarm (geparkte Autos, Straße, Flackern), Personen dagegen erst nach dem Face-Match.
- Auto-Snapshots bei Bewegung gingen in voller Auflösung in die Datenbank, obwohl sie nur angezeigt werden.

### Änderungen

- `pollStates`: GetMdState + GetAiState in einem Batch-Request. Kameras, die kein Batch können, fallen einmalig auf Einzelabfragen zurück (Log-Zeile).
- Poll-Takt 2 s statt 5 s (`HUB_CAMERA_POLL_INTERVAL`, ab 1 s).
- `event-debounce.ts`: Ereignis endet erst nach `HUB_EVENT_END_HOLD_MS` (6 s) Ruhe; Ende trägt den Zeitpunkt der letzten aktiven Messung. Pipelines hängen weiter an den rohen Flanken (zweiter Wagen geht nicht verloren).
- Pipelines starten vor dem Cloud-Upload der Ereignisse.
- Auto-Snapshot bei Bewegung auf 1280 px verkleinert; Snapshot per Task bleibt in voller Größe.
- Cloud: VEHICLE-Überwachungs-Push erst in `processVehicleSighting` (nach Prüfung auf dem Hub), nicht für freigegebene Fahrzeuge.
- Geprüft: `tsc` Hub und Cloud, ESLint, Tests 113/113 (neu: Entprellung), Mock mit zwei Fake-Reolinks (Batch und Fallback, Flackern 1-0-1 → ein Start, ein Ende).

### Offen

- Echtzeit statt Polling: Reolink-Push (Baichuan, Port 9000) oder ONVIF-PullPoint, < 0,5 s bis zum Burst.
- Erkennungszonen, Objektgröße und Empfindlichkeit in den Kameras selbst setzen (v. a. Eingang: Straße oben links, Parkplatz Halle).
- Personen ohne Gesicht: YOLO-Gegenprüfung statt nur Face-Detektor.
- Nach dem Deploy im Log prüfen: keine „Batch-Abfrage nicht unterstützt“-Zeilen, Ereignisse pro Stunde vorher/nachher.

## 2026-11-04 (Regel-Aktion „Kamera steuern“: Klingel → Halle auf Position, dann folgen)

### Änderungen

- Neue Regel-Aktion `CAMERA` (Migration `20261104110000_rule_camera_action`): Kamera, Preset, automatisch folgen (an/aus/unverändert), optional „danach zurück nach N s“.
- Cloud legt dafür den Hub-Task `CAMERA_SCENE` an. Hub (`cameraScene`): Folgen kurz aus, Preset anfahren, nach `HUB_CAMERA_SCENE_SETTLE_MS` (2,5 s) Folgen an; Rückkehr stellt Preset und vorherigen Folgen-Zustand wieder her, ein neuer Auslöser verlängert.
- Auto-Tracking über `GetAiCfg`/`SetAiCfg` (`aiTrack`, ältere Firmware `bSmartTrack`).
- `/api/hub/camera-events` wartet jetzt auf die Regeln und meldet `rulesTriggered`; der Hub holt seine Tasks dann sofort (`task-kick.ts`) statt bis zu 5 s später. Gilt auch für die DoorBird-Klingel.
- Notbetrieb: Kamera-Aktionen führt der Hub ohne Cloud selbst aus.
- Regel-Dialog (Cloud und Hub-Dashboard): Aktion „Kamera steuern“ mit Positionen laden, Ereignisart „Klingel (DoorBird)“.
- Geprüft: `tsc` Hub und Cloud, ESLint, Tests 115/115, Mock-Reolink: Preset → Folgen an → nach 1 s zurück, Folgen wieder aus.

### Offen

- Live an der Halle prüfen, ob die Kamera `aiTrack` in `GetAiCfg` liefert (sonst Fehlermeldung im Regelverlauf).

## 2026-11-04 (Lieferdienste am Eingang erkennen)

### Änderungen

- `delivery.ts`: Nach dem Fahrzeug-Burst liest der Hub die Aufschrift (macOS Vision, `readTextFromJpeg`) auf bis zu 4 Bildern mit Fahrzeug in Zone/Mindestgröße. DHL/Deutsche Post, UPS, GLS, DPD, Hermes, Amazon als eigenes Wort; Treffer erst ab 2 Bildern (`HUB_DELIVERY_MIN_FRAMES`).
- Kamera-Einstellung `deliveryMode` (Aus / Melden / Tor öffnen) plus Zeitfenster `deliveryFrom`/`deliveryTo` (Standard 07:00–20:00, Mo–Sa über `HUB_DELIVERY_DAYS`), Sperrzeit 5 min nach Öffnung. DoorBird: der einzige oder `HUB_DELIVERY_DOORBIRD_ID`. Migration `20261104160000_delivery_detection`.
- Cloud: Sichtung speichert `deliveryBrand`/`deliveryOpened`, Push bei jedem Treffer („DHL am Eingang“ bzw. „Tor geöffnet“).
- Einstellungen in der Kamera-Bearbeitung (Cloud) und unter Fahrzeuge im Hub-Dashboard.
- Aaron (04.11.): erst 3–5 Tage nur melden, dann entscheiden.

### Offen

- Eingang auf „Melden“ stellen und nach ein paar Tagen Treffer/Fehltreffer im Log (`Lieferdienst`) und in den Sichtungen prüfen. Fahrzeuge ohne Logo (Subunternehmer) erkennt das nicht.

## 2026-11-05 (Hub-Dashboard im Liquid-Glass-Stil der Cloud)

Snapshot nicht verfügbar: `/api/improve` ließ sich nicht lesen, in dieser Umgebung lief kein Hub. Abgleich deshalb im Hub-Mock gegen Aufnahmen der Cloud und `docs/design-regeln.md` §21.

### Befunde

- Akzent: Hub Cyan→Violett (`#06b6d4`→`#6d4aff`, dunkel `#22d3ee`→`#8b6dff`), Cloud Indigo `oklch(0.53 0.24 276)`, dunkel `oklch(0.6 0.22 277)`, Violett nur im Verlauf.
- Grund: Hub `#f3f5fa`/`#060912` mit zwei Glows, Cloud `oklch(0.978 0.004 255)`/`oklch(0.145 0.025 262)` mit Aurora aus vier Verläufen.
- Karten: Hub Radius 1.1rem, Fläche Weiß 86 % bzw. `rgb(17 24 41 / 72 %)`, Blur 12 px. Cloud Radius 1.5rem, Glas Weiß 58 % bzw. 5,5 %, Blur 28 px, Lichtkante oben.
- Schrift: Seitentitel Hub 1.75rem/720, Cloud 1.25rem (Desktop 1.375rem)/600. Abschnittslabel Hub 0.72rem/0.1em, Cloud 11 px/0.12em.
- Knöpfe: Hub 2.6rem hoch, Radius 0.75rem, Primär im Cyan-Verlauf. Cloud 2.25rem (Touch 2.75rem), Radius 0.875rem, Primär Indigo flächig.
- Navigation: Hub Tab-Leiste über die volle Breite (4.5rem) bzw. Sidebar unter der Kopfleiste. Cloud schwebendes Glas-Dock mit Pille bzw. Sidebar über die volle Höhe mit eigenem Kopf.
- Gerätekacheln: Hub „an“ immer grün. Cloud färbt nach Art (Licht Amber, Heizung Orange, Lüftung/Wasser Himmelblau, Audio Violett, Mäher Smaragd).

### Änderungen

- `dashboard.css` neu auf den Cloud-Tokens: Grund, Text, Indigo-Akzent, Statusfarben (Smaragd/Amber/Rose/Himmelblau), Glas-Ebenen, Radien 1.5rem/1.125rem/0.875rem, Aurora. Hell/dunkel und `data-theme` wie bisher, `prefers-reduced-transparency` macht die Flächen deckend.
- Telefon: schwebendes Dock (4rem, Pille für den aktiven Bereich), Kopfleiste als Glasbalken, Dialoge als Bottom-Sheet. Ab 900 px Sidebar über die volle Höhe mit Logo-Kopf, Kopfleiste nur über dem Inhalt.
- Karten, Kennzahlen, Hinweise (mit Ton-Chip), Segment-Leisten, Felder, Knöpfe, Tabellen mit festem Kopf, Zeitleiste, Regel-Karten, Schalter (40×24) und Räume (Tönung bei offen, Warnung, Fehler) im Cloud-Stil.
- `dashboard.js` nur für die Optik: `.dev` bekommt eine `tone-*`-Klasse (`devTone`). Ids, data-/aria-Attribute, Handler, Abrufe, Bedingungen und Texte unverändert.
- `dashboard.html`/`manifest.webmanifest`: `theme-color` `#f6f8fa`/`#050a15`, Ring-Verlauf Indigo→Violett.
- Alle Farben liegen in sRGB (nur Chroma gesenkt, L und H wie in der Cloud), Mischungen `in oklab`. Sonst zeichnet Chromium türkise Eckpixel an getönten Rändern und rosa Kachelverläufe.

### Geprüft

- Hub-Mock: 13 Bereiche plus 9 Extras (Kamera-, Regel-, Fahrzeug-, Zonen-Dialog, Bestätigung, Toast, Shelly, Mehr-Sheet, Theme-Wechsel), jeweils hell und dunkel, 1440 px und 390 px: 86 Aufnahmen ohne Überlauf. Dazu die Zustände Notbetrieb, leer und Mäher-Einrichtung.
- Kontrast: 163 Text- und Flächenpaare in beiden Themes ohne Befund. Keine abgeschnittenen Knöpfe oder Labels (bis auf gewollte Ellipsen bei Kachelnamen).
- Jede Klasse aus Templates, HTML und `classList` hat weiter eine Regel im CSS. `node --check hub/src/ui/dashboard.js`, `npm test` 197/197.

### Offen

- Live auf dem iPhone (App vom Home-Bildschirm) nach dem Hub-Update ansehen. Der Service Worker braucht eventuell einmal Neuladen, bis die neue CSS greift.
- Login-Seite (`hub/src/dashboard.ts`) und Offline-Seite (`sw.js`) sind seit dem Nachtrag unten Glaskarten im Cloud-Stil, die App-Icons seit dem zweiten Nachtrag im Akzent der Cloud.
- Raum-Tönung (`:has()`) und VLAN-Töne (relative Farben) brauchen Safari 16.4+ bzw. Chrome 119+. Ältere Browser zeigen ungetönte Räume und die HSL-Farben von vorher.
- In Headless-Chromium wird der Inhalt unter dem Dock bei Scroll-Position 0 nicht weichgezeichnet. Das Dock ist deshalb zu 72 % deckend (Cloud-Balken 65 %). Auf dem Gerät prüfen, ob weniger reicht.

### Nachtrag: Prüfbefunde aus zwei Reviews

Übernommen:

- Telefon: Fahrzeug-, Regel- und Zonen-Dialog sind wieder Bottom-Sheets über die volle Breite. Ihre festen Breiten galten auch unter 640 px, die Dialoge hingen links mit 32 px Lücke.
- Zustandsfarben nach §3: Kamera-Erkennung himmelblau (Kacheln, Orte, Puls-Leiste, Lage-Kopf, Zähler), Klingel violett, mähender Mäher smaragd statt Rot. Offline, „nicht erreichbar“ und „getrennt“ rot statt gelb, das OFFLINE-Schild der Kamerakacheln rot statt amber. „KEIN STREAM“/„KEIN BILD“ sind Hinweise (gelb).
- Raumkarten: Hinweise (Akku, Mäher-Pause, Gerätefehler) tönen gelb. Rot nur bei Klima-Fehler oder nicht erreichbarem Gerät.
- Ring- und Balkenverlauf entfernt: gesund grün, Ports im Akzent, Mäh-Fortschritt smaragd (pausiert gelb).
- Kontrast: Über der Kamerawand der Zentrale ist das Dock zu 92 % deckend (Labels vorher 2,9:1). Graue Badges und Segment-Zähler sind im Dunkeln heller (`--badge-muted`, oklch 0.81), vorher 3,4:1 über den hellen Farbflecken.
- Segment-Leisten brechen mit Maus oder Trackpad um, auf Touch wischt man weiter. Bei 1024 px waren vorher Filter unsichtbar abgeschnitten.
- Raum-Auswahl auf Touch mit 16 px Schrift und 44 px Höhe, damit iOS beim Fokus nicht zoomt. Radien wie in der Cloud: kleiner Knopf 18 px, Klima und Hinweis als Kachel 18 px, Raum-Chip rund. Seitentitel bleibt auf dem Desktop bei 1.25rem.
- Schloss: entriegelt wieder mit grünem Icon, verriegelt grau. Im Kiosk und Vollbild haben Kamerakacheln eine dunkle statt einer weißen Kante.

Nicht übernommen:

- Volle Cloud-Chroma: Alle Cloud-Werte liegen außerhalb von sRGB. Chromium zeichnet damit an getönten Rändern farbfremde Pixel, beim Violett 325 Pixel gegenüber 0. Der Hub behält die größte Chroma in sRGB bei gleichem L und H.
- Inter: Dafür bräuchte es eine Font-Datei und eine eigene Route in `hub/src/dashboard.ts`. Es bleibt bei der Systemschrift.
- `.live-tag.live` auf `--emerald-solid`: Weiße Schrift fiele von 5,5:1 auf 3,8:1. Eine feste Farbe auf dem Kamerabild erlaubt §15.
- Login- und Offline-Seite: Glaskarte über der Aurora mit denselben Tokens wie `dashboard.css`, hell und dunkel nach Systemeinstellung, `theme-color` `#f6f8fa`/`#050a15`, Tasten 44 px. Texte und Formular (GET mit `token`) unverändert.

### Nachtrag: App-Icons

- `icons/icon.svg` und die PNGs (192, 512, maskierbar 512, Apple 180) im Akzent-Indigo der Cloud statt Cyan→Violett: Verlauf `#5b86ff` → `#514bf2` → `#7c42ee`, weicher Lichtfleck oben links, bei den abgerundeten Varianten (SVG, 192, 512) eine helle Glaskante wie bei den Glaskacheln. Blitz, Form und Radius unverändert. Maskierbar und Apple sind vollflächig (das System rundet selbst), der Blitz liegt dort in der sicheren Zone (80 %).
- Der Service Worker lädt `/icons/` zuerst aus dem Netz, Browser-Tab und Manifest zeigen das neue Icon nach dem nächsten Laden. Auf dem iPhone behält der Home-Bildschirm das alte Icon, bis man die App dort einmal entfernt und neu hinzufügt.

### Nachtrag: Handy ohne Querscrollen

Aaron (05.11.): Auf dem Handy darf nichts seitlich scrollen, Köpfe und Filter aufräumen. Geprüft im Hub-Mock mit Touch bei 390 und 360 px: 13 Bereiche, Mehr-Sheet und fünf Dialoge, hell und dunkel.

Vorher:

- Die Seite war nie breiter als das Fenster, aber drei Segment-Leisten wischten seitlich (bei 360 px): Geräte 622 px Inhalt in 326 px, Netzwerk-VLANs 834 px, Ereignisse 1017 px. Ein Teil der Filter war ohne Wischen nicht zu sehen.
- Dock bei 360 px: „Ereigni…“ statt „Ereignisse“.
- Köpfe: Die Taste des Bereichs stand in einer eigenen Zeile unter dem Untertitel, im Netzwerk zwei Tasten untereinander (Kopf 175 px hoch). „Fahrzeug hinzufügen“ stand links unter dem Hinweis.

Änderungen (`dashboard.css`, drei Tasten in `dashboard.html`):

- Segment-Leisten brechen auch auf Touch um, die Einträge füllen jede Zeile. Radius = halbe Zeilenhöhe (22 px, auf Touch 25 px). Das ersetzt „auf Touch wischt man weiter“ im Nachtrag oben.
- Dock: Einträge gleich breit, aber nie schmaler als ihr Label. Ab 320 px passen alle sechs ungekürzt; schmaler (Zoom) kürzen die Labels wie bisher, damit „Mehr“ im Dock bleibt.
- Kopf unter 640 px: Titel links, Taste oben rechts daneben, Untertitel darunter über die volle Breite, „Switches abfragen“ als zweite Taste darunter. Zentrale: Spaltenwahl und Vollbild (nur Symbol) neben dem Titel.
- Fahrzeuge: „+ Fahrzeug“ oben rechts neben dem Hinweis. Gekürzte Texte sind nur ausgeblendet, VoiceOver liest weiter „Vollbild“ und „Fahrzeug hinzufügen“.
- Suche: Der Hinweis „/“ fällt auf dem Telefon weg, der Text bekommt die Breite.

Gemessen:

- 76 Aufnahmen (390/360 px, hell/dunkel, 13 Bereiche plus 6 Extras): kein innerer Scroller, nichts über den Rand (außer dem Skip-Link), kein gekürztes Dock-Label. Ebenso 57 Aufnahmen bei 320, 375 und 430 px und die Zustände Notbetrieb, leer, Mäher-Einrichtung und ruhig.
- Kopfhöhe bei 360 px vorher → nachher: Zentrale 129 → 92, Räume und Regeln 119 → 82, Geräte und Mäher 138 → 101, Netzwerk 175 → 140. Bei 390 px wächst nur der Netzwerk-Kopf (123 → 140), weil „Switches abfragen“ jetzt unter dem Untertitel steht.
- Filterzeilen bei 390/360 px: Geräte 2/2, Räume 1/2, Netzwerk-VLANs 3/4, Ereignisse 4/4.
- Tabellen (Netzwerk, Freigegebene Fahrzeuge, Aufgaben-Historie) sind unter 720 px gestapelt: 326 von 326 px.
- Desktop 1440 px hell und dunkel pixelgleich bis auf die Uhrzeiten. Bei 1024 px füllen umbrochene Filter ihre Zeilen.
- `node --check hub/src/ui/dashboard.js`, `npm test` 197/197.

Offen:

- Auf dem iPhone ansehen: Titel neben der Taste, vier Zeilen Ereignis-Filter, „Halle“ allein in der zweiten Zeile des Raum-Filters bei 360 px.
- Gestapelte Tabellen sind lang (Netzwerk mit 47 Geräten gut 10 000 px).
- Netzwerk-Kopf: Sichtbar steht der Scan oben rechts, beim Tabben kommt „Switches abfragen“ zuerst.
- Bei 1024 px scrollt die Netzwerk-Tabelle in ihrer Karte weiter 31 px seitlich (wie vorher).

### Nachtrag: Abschlussprüfung Handy

Hub-Mock, Touch, 390 und 360 px, hell und dunkel, 13 Bereiche plus Mehr-Sheet, Zustände normal und Notbetrieb (leer, ruhig, Mäher-Einrichtung nur gemessen): Seite nie breiter als das Fenster, kein innerer Scroller, nichts über den Rand – vorher wie nachher, zuletzt 156 von 156 Messungen ohne Befund.

Gefunden und geändert (`dashboard.css`, `dashboard.js`):

- Segment-Leisten wie §6 der Cloud: der aktive Eintrag bleibt bei 500 statt 600 (fetter war er breiter, die umbrochene Leiste sprang beim Wechseln), auf dem Telefon 10 px Innenabstand. Damit passt der Raum-Filter bei 360 px in eine Zeile („Halle“ stand allein in Zeile zwei, Punkt aus „Offen“ oben erledigt).
- Ereignis-Filter: auf dem Telefon zwei gleiche Spalten (bei 390 px vorher 3/2/2/1 mit „Aufgaben“ allein), bei 600–1019 px Bereichsbreite vier Spalten (bei 1280 px vorher 7/1, bei 768/1024 px 5/3). Ab ~1020 px eine Zeile wie bisher.
- Netzwerk-Tabelle auf dem Telefon kompakt: Name mit Status rechts, darunter IP und VLAN, dann Hersteller und Typ, Ports nur wenn offen. Die Zeile ist rund 110 statt 220 px hoch, die Seite bei 360 px 10 700 statt 15 000 px. Die anderen Tabellen bleiben gestapelt mit Labels.
- Kennzahl-Kacheln auf dem Telefon mit 8 px Abstand (§5) und engerem Kopf: „Übersprungen“ (Fahrzeuge) war bei 360 px gekürzt.
- Relative Zeiten („vor 20 s“, „vor 18 min“) mit geschütztem Leerzeichen: die Einheit stand allein in der nächsten Zeile (Mäher-Kopf, Lage-Orte).

Offen:

- VLAN-Filter: bei 768/1024 px 6/1 (sieben VLANs im Mock). Die Zahl hängt vom Standort ab, eine feste Spaltenzahl hilft nicht immer.
- Kamera-Kacheln der Zentrale kürzen lange Namen bei zwei Spalten („Luba Seewiese · vor…“); der volle Name steht im Dialog.

## 2026-11-06 (Personen: optischer Zoom und Folgen – Bestandsaufnahme und Design)

Snapshot und Log über Cloud-Tasks gelesen (`HUB_LOG` improve, Grep „Wächter“/„folgen“), Kamerafähigkeiten über `CAMERA_CAPS` für alle 12 Reolinks. Diese Sitzung lief nicht auf dem Hub-Rechner.

### Befunde

- Snapshot seit 05.11. 17:11 UTC: `face.none` 265, `face.skip_no_face` 29, `face.zoom` 7, `face.zoom_face` 1, `face.person_nomatch` 17, `face.ok` 16. Offener Hinweis: „Gallery-Treffer knapp unter der Schwelle“.
- Optischer Zoom für Personen praktisch aus: Gesichtserkennung nur digital, Wächter seit `a346114` digital, sobald YOLO Boxen liefert (Mitte-Zoom hatte Personen am Rand verfehlt). README beschreibt noch „optisch, PTZ folgt vorher“.
- Folgen 21-mal ausgelöst (Übungslift, Shop) seit 05.11. 13:27 UTC, ohne Fehler, aber jeweils 30–60 s nach dem Ereignis (erst nach Bildmodell und Alarm). Aaron: Kameras folgen nicht. Ob es an der Verzögerung oder an der Tracking-Einstellung liegt, ist offen.
- Fähigkeiten: Schwenken bei Gastro, Shop (E1 Pro), Halle (RLC-823S1), Übungslift (RLC-823A 16X). Zoom ohne Schwenkkopf bei Seilbahn B, Eingang, Drehkreuz, Halle 2 (RLC-811A). Seilbahn A (192.168.1.69): „fetch failed“.
- Zonen-Kameras: Eingang (Halteverbot, Kennzeichen, Lieferdienste), Halle 2 (Parkfläche). Belegung misst an Übungslift, Seilbahn A/B, Gastro/Imbiss, Drehkreuz.

### Änderung

- Keine am Code. Design in `docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md`: immer optisch zoomen und folgen, Zonen-Kameras nur kurz (≤ 6 s, nie folgen), Folgen über das Kamera-Tracking ab dem ersten Signal, höchstens 2 min, dann Grundstellung und 1 min Pause, Belegung wartet auf die Grundstellung.

### Diagnose (CAMERA_CAPS mit `motion`, Hub `a121111`, 10:13 UTC)

- Ursache „folgt nicht“: Gastro, Shop (E1 Pro), Halle (RLC-823S1), Übungslift (RLC-823A 16X) melden alle `aiTrack: 1` und `bSmartTrack: 0`. `readAutoTrack` nahm `aiTrack` zuerst, hielt das Tracking für an und schrieb nie; der Schalter `bSmartTrack` blieb 0. Die 21 „folgen an“ seit 05.11. waren wirkungslos, ebenso die Regel „Klingel → Halle folgen“.
- Tracking-Einstellungen: `trackType.people` überall 1; Rückkehr der Kamera nach Verschwinden/Stillstand: E1 Pro und RLC-823S1 10/20 s, RLC-823A 16X 30/30 s.
- Wachposition: alle 8 Kameras beantworten `GetPtzGuard`, keine hat eine (`bexistPos: 0`, `benable: 0`).
- Zoom-Positionen jetzt: Übungslift 18, Halle 8, Drehkreuz 2, Seilbahn B, Eingang, Halle 2 je 0. E1 Pro ohne Zoom (`GetZoomFocus` rspCode -17).
- Drehkreuz (RLC-811A, ältere Firmware): nur `aiTrack: 0`, kein `bSmartTrack` (ohne Schwenkkopf ohnehin ohne Folgen).

### Nächster Schritt

- Seilbahn A prüfen (nicht erreichbar).

## 2026-11-06 (Personen: optischer Zoom und Folgen umgesetzt)

### Änderung

- `camera-motion.ts`: Folgen ab der ersten PERSON-Flanke (Gastro, Shop, Halle, Übungslift) über `bSmartTrack`, höchstens 120 s, dann Wachposition (fehlt sie: nach 10 min ohne Bewegung gespeichert) bzw. Preset „Grundstellung“ und 60 s Pause. Hand sperrt 5 min, Regeln gehen vor (Tracking des Hubs vorher aus, sonst merkt sich die Regel „an“), Neustart stellt zurück (`.cache/camera-motion.json`).
- Optische Nahaufnahme für Gesichtserkennung und Wächter, gezielt aus den YOLO-Boxen (Schwenk-Kameras nach dem Zentrieren), relativ zur aktuellen Zoom-Position. Zonen-Kameras Eingang und Halle 2: ≤ 6 s, alle 2 min, nie bei Fahrzeug.
- Halteverbot überspringt, Parkfläche hält, Belegung wartet bis 20 s, Fahrzeug-Burst bis 3 s, solange eine Kamera bewegt ist.
- Regel-Aktion „Kamera steuern“ nutzt denselben Schalter (`bSmartTrack` vor `aiTrack`).
- Geprüft: `tsc` Hub, `npm test` 321/321 (neu: 31 für Regeln und Abläufe mit Fake-Treiber), Module laden.

### Nächster Schritt

- Nach dem Deploy: `follow.*`, `face.optical*` und `camera.zoom_ratio` im Snapshot. Ziele nach zwei Tagen: `face.optical_face / face.optical` ≥ 50 %, mehr Gesichter optisch als digital, `follow.end_gone` > `follow.end_max`, `follow.home_fail` = 0.
- Im Log „aktuelle Stellung als Grundstellung (Wachposition) gespeichert“ je Schwenk-Kamera prüfen: Die Stellung 10 min nach dem Neustart wird die Grundstellung. Steht eine Kamera dann nicht richtig, Wachposition in der Reolink-App setzen.
- `camera.zoom_ratio` (erwartet gegen gemessen) je Modell auswerten, Zoomfaktor der RLC-823S1 festlegen.
- Live ansehen: Übungslift folgt einer Person und kehrt zurück, Eingang zoomt kurz ohne Halteverbots-Fehlmeldung.

## 2026-11-06 (Post-Auto am Eingang nicht als Lieferdienst gemeldet)

Snapshot (seit 10:21 UTC, Stand 10:56): `delivery.none` 5, `alpr.plate` 1, `alpr.upload_noplate` 4, `camera.closeup_skip` 1, keine Hinweise. Log per `HUB_LOG`.

### Befunde

- 10:58:22–10:58:32 UTC, Kamera Eingang (Modus NOTIFY): Burst 9 Bilder in 10,7 s (je ~1,2 s statt 400 ms, 4K-Snap). Kennzeichen BN-PL 8546 auf Bild 1/2 (conf 0,98/0,97), Sichtung 1969 ohne `deliveryBrand`.
- Lieferdienst-Prüfung (späte Bilder zuerst): Bild 9–6 Hintergrund (0,08–0,09 %), 5–4 kein Fahrzeug, Bild 3 und 2 Fahrzeug (10,9 % / 7,8 %), Bild 1 mit 1,89 % knapp unter `vehicleMinArea` 2 % übersprungen. „DHL nur auf 1/2 Bildern – kein Treffer“.
- Bild (Frame 1, 11:58:24 Ortszeit): gelber VW-Transporter frontal von oben links; „DHL/Deutsche Post“ steht seitlich, lesbar nur kurz beim Einbiegen. Zwei Bilder mit Aufschrift sind bei dieser Anfahrt kaum zu schaffen.
- Folgen/Nahaufnahme haben nicht eingegriffen (keine Zeilen dazu im Burst).

### Änderung

- Aaron (06.11.): Kennzeichen mit erkannter Marke merken, nur melden, nie öffnen. Eine Marke auf einem Bild reicht weiterhin nicht für eine Meldung.
- `delivery-plates-rules.ts` + `delivery.ts`: Marke auf ≥ 1 Bild und Kennzeichen ≥ 0,9 → `.cache/delivery-plates.json` (90 Tage ab letzter Sichtung, max. 200). Nachschlagen vor dem Lernen, also erst beim nächsten Besuch: Meldung „am Kennzeichen erkannt“ (`delivery.plate`), `opened` immer false.
- Geprüft: `tsc` Hub, `npm test` 325/325 (neu: 4).

### Nächster Schritt

- BN-PL 8546 wird beim nächsten Besuch gelernt, wenn „DHL“ auf einem Bild lesbar ist (Log „als DHL gemerkt“), ab dem übernächsten gemeldet.
- `delivery.plate` gegen `delivery.weak`/`delivery.none` beobachten.

## 2026-11-09 (Härtung: Tor nur bei exaktem Kennzeichen, Dashboard-CSRF, Update mit Rollback)

Snapshot nicht verfügbar: `http://127.0.0.1:8787/api/improve` antwortet nicht, `hub/.cache/` fehlt – Arbeit ohne Zugriff auf den Hub-Rechner, nichts davon ist am echten Tor, an den Kameras oder unter launchd geprüft.

### Befunde (Audit)

- Unscharfer Whitelist-Treffer (gleiche Ziffern, ≤ 2 Zeichen daneben oder Buchstaben-Teilstück, conf ≥ 0,25) wurde zum Whitelist-Kennzeichen umgeschrieben und öffnete das Tor – lokal und, ohne lokale Schaltung, über den DOORBIRD_OPEN-Task der Cloud. Auch ein exakter Treffer brauchte keine Mindest-Confidence.
- Dashboard: Loopback ohne Token, kein Origin-/Host-Check, JSON wurde bei jedem Content-Type gelesen. Jede Webseite im Browser des Hub-Rechners konnte `{"type":"DOORBIRD_OPEN"}` an `127.0.0.1:8787/api/action` schicken.
- Updater: `execSync("npm install")` ohne Zeitlimit blockierte den Event-Loop (Tasks, Offenhalte-Impulse); kein Rollback, Neustart auch auf kaputten Stand.
- Keine Handler für `unhandledRejection`/`uncaughtException`: Absturzgrund nur in `emp-hub.error.log`.

### Änderung

- `plate-match.ts` (neu, reine Logik): Unscharfe Treffer sind nur noch Hinweis (`probable`, „vermutlich …“ in Log und Ereignis) und landen nie mehr als Kennzeichen im Ergebnis. `PlateScore` trägt `matchKind`, `matchConfidence`, `actuate`. `actuateIfAllowed` schaltet nur bei exaktem Treffer (mit Messwert zusätzlich conf ≥ `HUB_ALPR_ACTUATE_MIN_CONF`, Standard 0,5; Kennzeichen der Kamera-eigenen Erkennung ohne Messwert zählen bei exaktem Treffer); sonst `localActed=1` an die Cloud, damit sie nicht ersatzweise schaltet. Reolink-LPR (ohne Confidence) schaltet nicht mehr.
- `dashboard-guard.ts` (neu): Für alles außer GET/HEAD Pflicht `Content-Type: application/json` (Ausnahmen: `/api/go2rtc/webrtc` mit `application/sdp`, `/api/climate/report`), Origin muss das Dashboard selbst sein, Host ohne Token nur eigene Namen/IPs (`HUB_DASHBOARD_ALLOWED_HOSTS` für weitere). Oberfläche: `/api/rooms/sync` schickt jetzt den JSON-Typ.
- `updater.ts`: Installation async mit 5 min Zeitlimit (`npm ci`, nur bei geändertem Manifest/Lockfile), Pre-Flight (`HUB_PREFLIGHT=1 npx tsx src/index.ts`, 2 min), bei Fehler Rollback auf den vorherigen Commit und kein Neustart; abgelehnter Stand frühestens nach 30 min erneut. Optional `HUB_UPDATE_VERIFY_SIGNATURE=1` (`git verify-commit`).
- `index.ts`: Pre-Flight-Abfrage vor allem anderen; `unhandledRejection`/`uncaughtException` loggen ins Hub-Log und beenden den Prozess (launchd startet neu, wie bisher).
- Geprüft: `tsc -p hub` 0 Fehler; Hub-Tests grün (neu: `plate-match`, `dashboard-guard`, `updater-rules`); Dashboard lokal gestartet und mit curl durchgespielt (CSRF, Rebinding, Shelly-Webhook, LAN mit Token); Updater in einem Wegwerf-Klon gegen gute, kaputte und unsignierte Commits.

### Nächster Schritt

- Nach dem Ausrollen im Log prüfen: „Fahrzeug-Burst … DoorBird sofort“ bei bekannten Fahrzeugen noch da? Zeilen „Treffer zu unsicher“ und „vermutlich …“ zählen – wenn bekannte Fahrzeuge zu oft unter 0,5 bleiben, `HUB_ALPR_ACTUATE_MIN_CONF` bewusst anpassen statt den unscharfen Treffer zurückzuholen.
- Zeilen „Dashboard: … abgelehnt (host)“: Name in `HUB_DASHBOARD_ALLOWED_HOSTS` eintragen. Offene Dashboard-Tabs einmal neu laden.
- Erstes Update nach diesem Stand beobachten: „Neuer Stand installiert und geprüft“ bzw. „Update ABGEBROCHEN“. Bleibt ein Hub hängen: `hub/install/update.sh`.
- Offen: Lesende Routen (GET) prüfen den Host nicht – eine per DNS umgebogene Seite im Browser des Hub-Rechners kann weiterhin Lage, Log und Standbilder lesen. `DOORBIRD_OPEN` steht weiter in `ALLOWED_ACTIONS`, obwohl die Oberfläche den Türöffner bewusst nicht anbietet.

## 2026-11-11 (Personen: Zählung am Drehkreuz, Face-Dienst schlanker)

Snapshot nicht verfügbar: Arbeit ohne Zugriff auf den Hub-Rechner, Befunde aus dem Code und den Einträgen vom 31.08. und 06.11. Nichts davon ist an den Kameras geprüft.

### Befunde

- `WEBCAMS_TRACKER_FRAME_STRIDE` sparte im Linien-Worker nichts: `model.track(stream=True)` rechnet YOLO und ByteTrack für jedes Bild, übersprungen wurde erst danach, also nur die Prüfung an der Linie. Bei Stride 2 sah die Linie die Hälfte der Bilder.
- Bekommt eine Person am Drehkreuz nach kurzer Verdeckung eine neue Track-Nummer, kannte die neue Nummer keine Seite. Ein Durchgang mit Nummernwechsel wurde gar nicht gezählt.
- Face-Sidecar lud alle fünf Modelle von buffalo_l (inkl. Alter/Geschlecht, 2D/3D-Landmarken), gelesen werden nur Box, Score und Embedding. Offen seit 31.08. (Face ~2,8 Kerne).
- README nannte `WEBCAMS_TRACKER_CONF` 0,4, der Code nimmt 0,3.

### Änderung

- `webcams/tracker/main.py`: Linie prüft jedes Bild; `FRAME_STRIDE` gilt nur noch für die Zonen-Worker (die lesen ihre Bilder selbst, dort spart es wirklich).
- `HysteresisLineCounter`: Nummernwechsel – eine neue Nummer übernimmt die Seite einer höchstens 1,5 s zuvor verschwundenen Nummer, wenn deren letzter Fußpunkt höchstens `WEBCAMS_TRACKER_HANDOVER` × Bildhöhe (Standard 0,12, `0` = aus) entfernt liegt. Leere Bilder gehen jetzt auch durch den Zähler, damit er verschwundene Nummern bemerkt. Log: „Linie: Nummer #… übernimmt Seite von #…“.
- `hub/face/server.py`: `allowed_modules=["detection", "recognition"]`.
- Geprüft: `py_compile`; Zähler-Logik mit Stub-Detektionen (Durchgang mit Nummernwechsel: vorher 0, jetzt 1 gezählt; neue Nummer weit weg erbt nicht).

### Nächster Schritt

- Tracker neu starten (Knopf „Tracker neu starten“), Face-Sidecar startet mit dem Hub neu.
- Eine Woche lang Durchgänge ohne Scan am Drehkreuz und die Zeilen „übernimmt Seite“ zählen. Steigen ungedeckte Durchgänge, `WEBCAMS_TRACKER_HANDOVER` senken.
- CPU des Face-Sidecars gegen die 2,8 Kerne vom 31.08. vergleichen.

## 2026-11-11 (Personen: bestes Gesichtsbild, gemittelte Merkmale, Abstand zum Zweitbesten)

Snapshot nicht verfügbar (Arbeit ohne Hub-Rechner). Ausgangslage aus dem Eintrag vom 06.11.: `face.none` 265, `face.skip_no_face` 29, `face.person_nomatch` 17, `face.ok` 16, offener Hinweis „Gallery-Treffer knapp unter der Schwelle“.

### Befunde

- `uploadPersonSnapshotBody` nahm das erste Bild mit irgendeinem Gesicht, egal wie klein, gedreht oder verwackelt. Ein einzelnes schwaches Bild landet leicht knapp unter der Schwelle.
- `scoreGallery` verglich nur den besten Einzelwert. Liegen zwei Personen fast gleichauf, gewann die mit dem zufällig höheren Wert – Verwechslungsgefahr, auch am DoorBird.

### Änderung

- Face-Dienst liefert je Gesicht `frontal` (Nase zwischen den Augen, aus den 5 Punkten des Detektors) und `sharp` (Laplace-Varianz auf 112 px, `FACE_SHARP_REF` Standard 120).
- `face-rules.ts` (neu, reine Logik): `faceQuality`, `bestShot`, `fuseEmbeddings` (gewichtetes Mittel nur über Bilder derselben Person, Cosine ≥ 0,4 zum besten), `rankGallery` (je Person bester Wert, Treffer nur mit `FACE_MATCH_MARGIN` Abstand zur zweitbesten Person, Standard 0,04).
- `cameras.ts`: Nach dem ersten Gesicht noch `HUB_FACE_BEST_EXTRA` Bilder (Standard 2, `0` = aus) im Abstand von `HUB_FACE_BEST_GAP_MS` (400 ms); bestes Bild wird hochgeladen, die gemittelten Merkmale gehen in Abgleich und Cloud. Neues Ereignis „Person unsicher (zwei Kandidaten)“, Improve-Zähler `face.bestshot` und `face.ambiguous`.
- Geprüft: `tsc -p hub` 0 Fehler, `npm test` 407/407 (neu: 5 für `face-rules`), `face_quality` mit synthetischen Bildern (scharf/frontal 1,0/1,0; verwischt/gedreht 0,03/0,1).

### Nächster Schritt

- Nach zwei Tagen: `face.person_match` und `face.near_miss` gegen den 06.11. vergleichen; `face.bestshot` zeigt, wie oft ein späteres Bild gewinnt (`pick` > 1).
- `face.ambiguous` beobachten: Taucht es oft bei denselben zwei Personen auf, deren Profile über „Profil optimieren“ schärfen statt die Marge zu senken.
- DoorBird bekommt die Bildserie noch nicht, nur den Abstand zum Zweitbesten.

## 2026-11-11 (Personen: Name an der richtigen Box in der Zentrale)

Snapshot nicht verfügbar (Arbeit ohne Hub-Rechner).

### Befund

- Die Großansicht der Zentrale hängte den Namen eines Gesichts-Treffers immer an die größte Box. Bei zwei Personen im Bild stand der Name oft bei der falschen Person.

### Änderung

- Person-Ereignis merkt sich (nur im Speicher) die Gesichtsmitte im Vollbild (`pos`): aus der Gesichtsbox, nach digitalem Zoom aus der Personenbox; nach optischem Zoom keine Lage (anderer Bildausschnitt).
- `faceViaZoom` liefert die Personenbox, zu der das Gesicht gehört.
- `assignBoxLabels` (reine Logik, `live-people-rules.ts`): frischer Treffer (≤ 15 s) benennt die Box, in deren Kopfbereich er liegt; Namen wandern bei der nächsten Abfrage (≤ 5 s) zur nächstgelegenen Box, wenn sie sich höchstens etwa eine Boxgröße bewegt hat; ohne Lage gilt der Kamera-Name nur bei genau einer Person.
- `/api/live/boxes` liefert `label` je Box, die Oberfläche zeigt ihn (älterer Hub ohne Feld: wie bisher).
- Geprüft: `tsc -p hub` und Cloud 0 Fehler, `npm test` 409/409 (neu: 2), ESLint 0 Fehler.

### Nächster Schritt

- Live ansehen: Zwei Personen vor einer Kamera, eine bekannt – Name muss bei ihr stehen und beim Gehen mitwandern. Springt er bei schnellen Bewegungen ab, Reichweite (0,8 × Boxgröße) anpassen.
