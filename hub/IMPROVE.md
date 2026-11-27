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
- ALPR hat heute Plates erkannt (drei verschiedene). Letzter Burst 16:53 ohne gewähltes Plate (Fehlalarm/leere Zufahrt).

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

- **Hub-Ausfall 3.9. ~21:00 bis 4.9. 10:50 Uhr.** In dieser Zeit kam von keiner Kamera ein Ereignis an; sonst liefern die Kameras nachts 100–200 Ereignisse pro Stunde. Das Whitelist-Kennzeichen wurde bis 2.9. täglich am Vormittag erkannt, am 3./4.9. nicht – am 4.9. stand der Hub in genau diesem Fenster. Ursache steht nur im Log auf dem iMac.
- **Kennzeichen-OCR unverändert, Liste doppelt so verrauscht.** Kennzeichen je VEHICLE-Alarm (tags, Eingang): Woche ab 24.8. 21 %, Woche ab 31.8. 20 %. Anteil der Alarme, die als „Fahrzeug ohne Kennzeichen" landen: 23.–30.8. ~28 %, ab 31.8. ~55 %. Seit dem Tracker-Neustart am 30.8. antwortet `/classify` wieder – und sagt „Fahrzeug" auf jedes geparkte Auto und jeden Wagen auf der Straße oben links im Bild. 23 von 23 geprüften „ohne Kennzeichen"-Bildern (1.–4.9.) zeigen kein Fahrzeug an der Einfahrt, fast-alpr findet in keinem ein Kennzeichen.
- **Abends nichts lesbar:** nach 20 Uhr 109 Alarme, 3 Kennzeichen; nach 21 Uhr null. Sonnenuntergang rückt wöchentlich 15 min vor.
- **Zweiter Wagen ging verloren:** `pendingVehicle` wurde nur nach der Personen-Pipeline abgearbeitet, nie nach dem Fahrzeug-Burst.
- **Phantom-Flanken:** der Burst schrieb `cam.states.VEHICLE` selbst; der parallele Poll sah beim Flackern neue Flanken. 60–70 % der VEHICLE-Ereignisse hatten kein Ende, nach jedem Burst startete sofort der nächste (Doppel-Einträge im Minutenabstand, z. B. BN-AB 2345 um 10:38:18 und „ohne Kennzeichen" um 10:38:41).
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

- 13:53 Uhr per `SYSTEM_CHECK` bestätigt: FileVault aus, Auto-Login dem Benutzer des Hub-Rechners, kein Ruhezustand, Neustart nach Stromausfall, Einschalten täglich 06:00, sudo-Regel für pmset, caffeinate an – keine Hinweise mehr. Auto-Login wurde über die Systemeinstellungen gesetzt, nachdem der zweite Lauf des Setup-Skripts bei `sysadminctl` abgebrochen war (Skript-Ausgabe nicht gesehen).
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

## 2026-09-26 (Whitelist-Kennzeichen erkannt, DoorBird danach geöffnet)

### Befunde

- Heute 09:51 Uhr (07:51 UTC): Burst Kamera Eingang, 13 Frames, Fahrzeug-Ende 09:50:58. OCR spät→früh. Frames 13–6 ohne Kandidaten (0,00). Frame 5: **Whitelist-Kennzeichen, conf 0,96**. Dump `hub/.cache/veh-burst/2026-09-26T07-51-16-589Z_Kamera_Eingang`, chosen=4. Auf dem Trefferbild steht der Wagen an der Einfahrt, die späteren Frames sind leer.
- Tür 26 ms später: `Tür geöffnet (Relais 1)` um 09:51:16.623, aus der lokalen Whitelist-Schaltung, nicht aus dem Telegram-Knopf.
- 0,9 s davor, 09:51:15.700: eigener Pfad. DoorBird MOTION ab 09:51:04, kein Gesicht (4 Versuche), YOLO am DoorBird YES conf=0,84 Fläche=14,8 % → `Öffnungswunsch (MOTION) → Telegram`. Das ist die Besuchermeldung, unabhängig vom Kennzeichen.
- Snapshot-Hinweise (Gallery-Schwelle, Halteverbot, DoorBird-Monitor) erklären diesen Vorgang nicht. Monitor-Drop 10:01 Uhr lag danach.

### Änderung

- Keine.

### Nächster Schritt

- OCR der leeren späten Frames kostet hier ~16 s, bis der frühe lesbare Frame drankommt. Frühstopp gilt erst nach dem ersten Whitelist-Treffer. Ob die Reihenfolge bei schon durchgefahrenem Auto umgedreht oder abgebrochen werden soll, ist offen. Umgesetzt am selben Tag, siehe unten.

## 2026-09-26 (Kennzeichen: Tür nicht mehr 16 s hinter den leeren Frames)

### Befunde

- Nachgerechnet am Dump von 09:51: fast-alpr Vollbild findet das Schild in 4K nicht (0,05 s, null Treffer). Die sechs Kacheln brauchen auf einem leeren Frame 0,26–0,31 s und finden nichts. macOS Vision auf demselben leeren Frame braucht **1,5–1,9 s** und liest nur die Kamerauhr. Acht leere Frames × (0,3 + 1,6) s = die 16 s. Der Trefferframe selbst ist in 0,10 s fertig (Kachel links, Whitelist-Kennzeichen), Vision lief dort gar nicht.
- Im Dump: Frame 02 liest falsch (ein Buchstabe als Ziffer, eine Ziffer daneben, keine Whitelist). Frame 03 und der gewählte Frame lesen das Whitelist-Kennzeichen richtig. Die späteren Frames sind leer.

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

- 10:58:22–10:58:32 UTC, Kamera Eingang (Modus NOTIFY): Burst 9 Bilder in 10,7 s (je ~1,2 s statt 400 ms, 4K-Snap). Kennzeichen eines Lieferwagens auf Bild 1/2 (conf 0,98/0,97), Sichtung 1969 ohne `deliveryBrand`.
- Lieferdienst-Prüfung (späte Bilder zuerst): Bild 9–6 Hintergrund (0,08–0,09 %), 5–4 kein Fahrzeug, Bild 3 und 2 Fahrzeug (10,9 % / 7,8 %), Bild 1 mit 1,89 % knapp unter `vehicleMinArea` 2 % übersprungen. „DHL nur auf 1/2 Bildern – kein Treffer“.
- Bild (Frame 1, 11:58:24 Ortszeit): gelber VW-Transporter frontal von oben links; „DHL/Deutsche Post“ steht seitlich, lesbar nur kurz beim Einbiegen. Zwei Bilder mit Aufschrift sind bei dieser Anfahrt kaum zu schaffen.
- Folgen/Nahaufnahme haben nicht eingegriffen (keine Zeilen dazu im Burst).

### Änderung

- Aaron (06.11.): Kennzeichen mit erkannter Marke merken, nur melden, nie öffnen. Eine Marke auf einem Bild reicht weiterhin nicht für eine Meldung.
- `delivery-plates-rules.ts` + `delivery.ts`: Marke auf ≥ 1 Bild und Kennzeichen ≥ 0,9 → `.cache/delivery-plates.json` (90 Tage ab letzter Sichtung, max. 200). Nachschlagen vor dem Lernen, also erst beim nächsten Besuch: Meldung „am Kennzeichen erkannt“ (`delivery.plate`), `opened` immer false.
- Geprüft: `tsc` Hub, `npm test` 325/325 (neu: 4).

### Nächster Schritt

- Dieses Kennzeichen wird beim nächsten Besuch gelernt, wenn „DHL“ auf einem Bild lesbar ist (Log „als DHL gemerkt“), ab dem übernächsten gemeldet.
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

## 2026-11-14 (Kennzeichen nachts: Weißlicht beim Fahrzeug-Burst)

Snapshot über Log-Abruf (HUB_LOG): `alpr.upload_noplate` 61, `alpr.plate` 8 seit 13.11. abends.

### Befund

- Aaron stand um kurz nach 18 Uhr innen am Tor, das Tor ging nicht auf. Kamera Eingang (RLC-811A) hat zwischen 18:00 und 18:08 fünf Fahrzeug-Bursts aufgenommen, die OCR las pro Bild etwas anderes (drei verschiedene Fehllesungen) mit Sicherheit 0,5–0,7. Kein exakter Treffer, also kein Öffnen (richtig so).
- Seit Sonnenuntergang (ca. 16:35) 0 gelesene Kennzeichen bei 16 Fahrzeugen. In 30 Tagen zwischen 16 und 6 Uhr kein einziger Whitelist-Treffer. Tagsüber klappt es (Whitelist-Kennzeichen um 10:45 und 11:07 erkannt, DoorBird offen).
- Nachtbild der Kamera: große, helle, unscharfe Streifen direkt vor der Linse (Gitter/Zweige/Spinnennetz werfen das IR zurück). Vermutlich Hauptursache, muss vor Ort angesehen werden.

### Änderung

- `vehicle-light-rules.ts` (neu, rein): `isDark` (Sonnenauf-/-untergang aus `weather.ts`, 30 Min Puffer, ohne Wetter 17–8 Uhr) und `spotlightWanted` (nur Kameras mit Weißlicht und Name Eingang/Einfahrt/Tor/Zufahrt; `HUB_VEHICLE_SPOTLIGHT=0` aus, `=9,3` feste IDs).
- `cameras.ts`: Vor dem Fahrzeug-Burst nachts Weißlicht an (`SetWhiteLed`), `HUB_VEHICLE_SPOTLIGHT_SETTLE_MS` (800 ms) warten, nach dem Burst wieder aus; spätestens nach 60 s aus. War das Licht schon manuell an, bleibt es unberührt. Improve-Zähler `alpr.spotlight`.
- Geprüft: `tsc -p hub` 0 Fehler, Tests für die Regeln (7 neu).

### Nächster Schritt

- Vor Ort prüfen, was vor der Linse der Kamera Eingang hängt.
- Nach ein paar Abenden `alpr.spotlight` gegen `alpr.plate` nach Sonnenuntergang vergleichen. Liest sie trotz Licht nichts, Belichtung/Shutter der Kamera nachts anpassen (nur mit Aarons OK).

## 2026-11-14 (Dashboard-Optik schlicht wie die Cloud)

Nur Oberfläche, keine Logik. `/api/improve` war aus der Cloud-Sitzung nicht erreichbar, offene Hinweise darum nicht abgearbeitet.

### Befund

- Aaron wünscht das ganze Design „schlichter, clean, modern“ mit hellem Grund und gleichwertigem Hell/Dunkel. Das Hub-Dashboard spiegelt die Cloud-Tokens (design-regeln.md §21).

### Änderung

- `dashboard.css`: Glas-Tokens auf deckende Flächen gestellt (Karte weiß bzw. eine Stufe heller als der dunkle Grund, Haarlinien, kaum Schatten), Weichzeichner 0, Farbflecken des Grunds aus, Radien 16/12/10 px, neutraleres Grau. Klassen und Aufbau unverändert.

### Nächster Schritt

- Am Hub-Dashboard (Handy und Desktop, hell und dunkel) kurz ansehen, ob eine Fläche ohne Glas zu flach wirkt.

## 2026-11-20 (Fahrzeuge: Kennzeichen aus der Region, richtiges Bild, schnellerer Burst)

Snapshot über Log-Abruf (HUB_LOG, Hub `imac-technikraum`, Stand b7992b4): `alpr.skip` 124, `alpr.upload_noplate` 79, `alpr.plate` 14, `alpr.spotlight` 46, `alpr.deferred` 38 seit 14.11. Offene Hinweise: Gallery knapp unter Schwelle, Halteverbot-Prüfung schlägt fehl, DoorBird-Monitor bricht ab (nicht Teil dieser Änderung). Log 19.11. 11 Uhr bis 20.11. 12:25 UTC: 58 Fahrzeug-Bursts an der Kamera Eingang.

### Befunde

- **Lesbare Kennzeichen verworfen.** 16 Uploads, davon nur 2 mit Kennzeichen (22 weitere Bursts ganz verworfen). In mindestens 9 Bursts las fast-alpr das Kennzeichen über mehrere Bilder sicher (eines 18× mit 0,98, eines 15× mit 0,96, vier weitere aus BS, LIP, BE und GT), verworfen wurde es, weil der Kreis nicht in `KNOWN_CITY` stand (nur ~35 Ruhrgebiets-Kreise, weder WAF noch BE, GT, PB, MS). Ergebnis: „Fahrzeug ohne Kennzeichen“ trotz klarer Lesung.
- **Einzelbild-Fehllesung gewinnt.** 20.11. 08:59: Bild 1 las den Kreis „ST“ statt „GT“ (0,91, ST bekannt) und wurde genommen, obwohl die folgenden Bilder „GT“ mit 0,95–0,97 lasen. 19.11. 13:59 ähnlich (ST statt GT).
- **Falsches Bild.** Ohne angenommenes Kennzeichen prüfte YOLO die Bilder von hinten und nahm das erste mit Fahrzeug, also das letzte: 7 von 14 Uploads „Frame 20/20“ bzw. letzter Frame, oft das wegfahrende Auto, obwohl das Schild 10 Bilder vorher lesbar war.
- **Träge.** Bildabstand im Mittel 1,15 s statt 400 ms (Alarm-Abfrage, 4K-Snap und feste Pause nacheinander). Der Burst lief immer bis 20 Bilder (~23 s), auch wenn das Kennzeichen nach 3 Bildern feststand. Danach macOS Vision „einmal“: 16 Aufrufe, 0 Treffer, je 2–7,5 s. Vom Eintreffen bis zum Upload so 25–35 s.
- **Licht-Schleife in der Dämmerung.** 19.11. 15:28–15:33 UTC und 20.11. 07:07 UTC: Licht an → 800 ms → Alarm schon weg → Licht aus, ~8 s später neuer Fahrzeug-Alarm. 16 von 19 Licht-Bursts ohne ein einziges Bild. Das Schalten selbst löst den Kamera-Alarm aus.

### Änderung

- `plate-cities.ts` (neu): alle deutschen Unterscheidungszeichen (654, ohne Umlaut-Zeichen) als `KNOWN_CITY`; Kreise der Region (WAF, BE, GT, HAM, MS, …) als Tie-Break in `scorePlateFormat` (GTK3434E → GT-K statt G-TK). Schalten hängt weiter nur am exakten Whitelist-Treffer.
- `vehicle-burst-rules.ts` (neu, rein): `burstConsensus` (Mehrheit über den Burst, abgeschnittene Lesungen zählen zur längeren; ≥ 2 Bilder oder 1 Bild ≥ 0,95; 1–2 Ziffern brauchen 3 Bilder; Upload-Bild = mittleres der sichersten), `pickFallbackFrame` (ohne Kennzeichen: Bild mit Schild-artiger Lesung, sonst größte Fahrzeug-Box), `burstDone` (Kennzeichen auf 3 Bildern bestätigt → noch 2 Bilder, mit Lieferdienst-Prüfung 4, dann Schluss).
- `cameras.ts`: Alarm-Abfrage und Snap gleichzeitig, Pause nur noch bis zum Takt; Burst endet nach bestätigtem Kennzeichen; Konsens-Kennzeichen ersetzt Einzelbild-Treffer (eigener Score nur, wenn das Bild selbst genau das las, sonst `actuate: false` → `localActed=1`); macOS Vision im Burst aus (`HUB_VEHICLE_PLATE_VISION=1` an). Weißlicht nur, wenn der Alarm unmittelbar vorher noch steht; Licht-Burst ohne Fahrzeug sperrt das Licht 5 min (`HUB_VEHICLE_SPOTLIGHT_MUTE_MS`). Neue Zähler `alpr.consensus`, `alpr.early_stop`, `alpr.spotlight_mute`.
- Geprüft: `tsc -p hub` 0 Fehler, `npm test` 517/517 (neu: 7 für die Burst-Regeln mit den Lesungen aus dem Log, 1 für Kreise der Region). Nicht an der Kamera geprüft.

### Nächster Schritt

- Nach einem Tag: Anteil `alpr.plate` an den Uploads gegen heute (2 von 16) vergleichen; Log-Zeilen „auf N Bildern … → Frame“ und „Kennzeichen sicher – fertig nach“ ansehen. Bildabstand im Log prüfen (Ziel ≤ 0,8 s); verträgt die Kamera die gleichzeitigen Anfragen nicht (Fehler „Re-Check fehlgeschlagen“), zurück auf nacheinander.
- `alpr.spotlight_mute` in der Dämmerung beobachten. Bleibt es bei Fehlalarmen ohne Licht, die KI-Erkennungszone der Kamera Eingang verkleinern (nur mit Aarons OK).
- `hub/plate/PlateOCR.swift` hat noch die alte Kreisliste; im Burst ist Vision jetzt aus, bei Bedarf nachziehen.

## 2026-11-22 (Zentrale ohne Livebilder: go2rtc sichtbar machen)

Snapshot über Log-Abruf (HUB_LOG, Hub `imac-technikraum`, Stand 5a63527, läuft seit 20.11. ~13:54): Offene Hinweise unverändert (Gallery knapp unter Schwelle, Halteverbot-Prüfung schlägt fehl, DoorBird-Monitor bricht ab), nicht Teil dieser Änderung.

### Befund

- Zentrale 22.11. 11:54: 5 von 13 Kacheln „LIVE“, aber schwarz; die übrigen 7 hängen auf „Verbindung wird aufgebaut …“. Seilbahn A offline (seit 14.11. kein Signal).
- Alle anderen 11 Kameras melden sich laut Cloud im Takt beim Hub (`lastSeenAt` aktuell), Schnappschüsse laufen (KI-Verlauf mit Bildern). Es klemmt also nur der Weg über go2rtc.
- Code der Zentrale seit 11.11. unverändert. Im Hub-Log (1 MB, 13 182 Zeilen) steht zu go2rtc **keine einzige Zeile**: Aus der Ferne war nicht zu sehen, ob go2rtc von der Kamera nichts bekommt, der Stream H.265 ist oder nur WebRTC zum Fenster scheitert.
- Kamera-Uhren: Gastro −2071 s, Übungslift −32 379 s (≈ −9 h, sieht nach falscher Zeitzone/Werksreset aus). Nicht angefasst (Kamera-Einstellung, nur mit Aarons OK).

### Änderung

- `go2rtc-status-rules.ts` (neu, rein, 5 Tests): wertet `/api/streams` aus (Host ohne Zugangsdaten, Videoformat, empfangene Bytes, Zuschauer), erkennt Streams mit Zuschauern ohne Daten und H.265 im Sub-Stream.
- `go2rtc-status.ts` (neu): Hub schaut alle 2 min auf go2rtc und schreibt bei Änderung eine Zeile ins Hub-Log („go2rtc: 7/26 ohne Daten von der Kamera: …“, „Format nicht abspielbar: …“, „go2rtc nicht erreichbar“). Zähler `camera.live_problem`, `camera.go2rtc_down`, `camera.webrtc_fail`.
- `dashboard.ts`: gescheiterte WebRTC-Anfragen an go2rtc (HTTP-Fehler mit Antworttext, Timeout) landen im Log, je Stream höchstens alle 5 min. `/api/go2rtc/streams` liefert zusätzlich Format, Bytes, Zuschauer (weiter ohne RTSP-URLs).
- `hub_status` (Assistent/MCP) hat jetzt `live`: Streams ohne Daten, Formate, WebRTC-Fehler der letzten 10 min.
- Zentrale: Kachel sagt nach dem ersten Fehlversuch, woran es liegt (H.265, Kamera liefert kein Video an go2rtc, keine Verbindung zu go2rtc, Kamera nicht erreichbar) statt endlos „Verbindung wird aufgebaut“.
- Geprüft: `tsc -p hub` 0 Fehler, `npm test` 781/781. Nicht am Hub geprüft.

### Nächster Schritt

- Nach dem Update (Hub zieht main selbst) Log-Abruf mit `grep: "go2rtc"`; je nach Zeile: go2rtc neu starten, H.265-Sub-Stream an der Kamera auf H.264 stellen (nur mit Aarons OK) oder WebRTC-Kandidaten in `go2rtc.yaml` prüfen.
- Uhren Gastro und Übungslift (NTP/Zeitzone) mit Aaron klären.

## 2026-11-22 (Zentrale: Browser-Seite der Livebilder)

Log-Abruf nach PR #232 (Hub 9c533b6, 11:06–11:18 UTC): go2rtc läuft, 34 von 35 Streams bekommen Daten von der Kamera; ohne Daten nur `cam-gastro_sub`. WebRTC-Anfragen scheitern nur für `cam-seilbahn-a_sub` („dial tcp 192.168.1.69:554: host is down“, Kamera seit 14.11. offline). Die Signalisierung klappt also für alle anderen – das Problem sitzt zwischen go2rtc und dem Fenster (ICE) oder beim Abspielen.

### Änderung

- `dashboard.js`: Hing eine Verbindung nach der Antwort von go2rtc in „new/connecting“, gab es nie einen neuen Versuch (Kachel ewig „Verbindung wird aufgebaut“). Jetzt nach 15 s neu (`ice-timeout`).
- Jede Kachel meldet Fehlversuche, Erholung und schwarzes Bild (Pixelprüfung 4 s nach „LIVE“) an `POST /api/go2rtc/client`; der Hub schreibt das gedrosselt ins Log („Zentrale (Safari) cam-…_sub: ice-timeout – Verbindung connecting, ICE checking, Bilder 0 …“). `hub_status.live.browser` zeigt die letzten Meldungen.
- Geprüft: `tsc -p hub` 0 Fehler, Tests grün. Nicht am Hub geprüft.

### Nächster Schritt

- Zentrale auf dem Hub-Rechner neu laden, nach ein paar Minuten Log-Abruf mit `grep: "Zentrale ("`. `ice-timeout` → WebRTC-Kandidaten in `webcams/infra/go2rtc.yaml` prüfen; `schwarz` mit Bildern > 0 → Dekoder/Browser.
- Kamera Gastro liefert go2rtc keine Daten, obwohl Schnappschüsse kommen: RTSP-Sub-Stream der Kamera prüfen.

## 2026-11-22 (Zentrale: Safari dekodiert, zeigt aber nichts)

Log-Abruf nach PR #233 (Hub 9a9c42c, Zentrale in Safari neu geladen 11:29 UTC):

### Befund

- Beim ersten Aufbau hingen 8 Kacheln in „connecting / ICE checking“ (`ice-timeout` nach 15 s); der neue Versuch war jeweils nach 3–7 s verbunden. Der 15-s-Neuversuch aus #233 behebt also die ewig wartenden Kacheln.
- Alle verbundenen Kacheln dekodierten Bilder (bis 1 853 je Verbindung), das `<video>` hatte aber durchgehend **0×0**. Die Zentrale meldete trotzdem „LIVE“, weil `framesDecoded` stieg – das sind die schwarzen LIVE-Kacheln vom Screenshot. Fenster war in dieser Zeit verdeckt; ob Safari auch sichtbar bei 0×0 bleibt, zeigt der nächste Log-Abruf.
- Etwa alle 4–5 min brechen mehrere Verbindungen gleichzeitig ab (11:32:08 fünf „disconnected“, 11:36:44 elf „failed“), go2rtc meldete 11:31:56 kurz 6 Streams ohne Daten. Neuaufbau klappt jeweils nach ~4 s. Ursache offen.
- Seilbahn A: go2rtc „dial tcp 192.168.1.69:554: host is down“ – Kamera aus/abgeklemmt, nicht Software.

### Änderung

- `dashboard.js`: „LIVE“ erst, wenn das Video eine Größe hat. Dekodiert Safari, bleibt das Element aber bei sichtbarem Fenster 6 s leer, wird der Stream neu angehängt, nach weiteren 8 s die Verbindung neu aufgebaut (Meldung `kein-bild-im-fenster` bzw. `live-nach-neuanhaengen`).

### Nächster Schritt

- Bei sichtbarem Fenster Log mit `grep: "Zentrale ("` lesen: kommt `live-nach-neuanhaengen`, war es das; kommt `kein-bild-im-fenster` immer wieder, Safari-Web-App gegen Chrome tauschen.
- Gleichzeitige Abbrüche alle 4–5 min weiter beobachten (Takt mit Auto-Scan/SNMP vergleichen).

## 2026-11-22 (Zentrale in Safari weiter schwarz, falsche Prozent-Warnungen)

### Befund

- Screenshot 12:53 (Safari-Tab, `http://192.168.1.121:8787`, Hub d92f7dc mit #235): 12 von 13 Kacheln „LIVE“ – nach #235 heißt das, das Video hat eine Bildgröße –, trotzdem alles schwarz. Die Pixelprüfung meldete kein „schwarz“, Safari hat das Bild also, zeigt es aber nicht. Verdacht: das Ein-/Ausblenden des `<video>` über `opacity` (Safari-Ebenen).
- KI-Warnungen „Arbeitsspeicher des Hubs bei 4316 %“, „Platte des Hubs bei 909 %“: `systemMetrics()` liefert Prozent (0–100), `agent/watch.ts` prüfte gegen 0,92 und rechnete ×100 – Warnung bei jedem Stand (tatsächlich ≈ 43 % RAM, ≈ 9 % Platte). Gleicher Fehler in `hub_status` (cpu/ram/disk) und im Platten-Verlauf (`health-trends.ts` speicherte Prozent, die Prognose rechnet mit Anteilen).

### Änderung

- `dashboard.css`: Video der Kachel nicht mehr per `opacity` ein-/ausblenden; der Hinweis liegt darüber und verschwindet mit `is-live`.
- `dashboard.js`: Meldung `bild-ok`, wenn das Canvas bei sichtbarem Fenster ein Bild sieht (zeigt, dass nur die Anzeige fehlt).
- `watch.ts`: Schwellen 92 % / 90 %, kein ×100. `tools.ts`: Prozentwerte unverändert durchreichen. `health-trends.ts`: Anteile speichern; `reviveHealthStore` rechnet alte Prozent-Werte um (Test).

### Nächster Schritt

- Zentrale neu laden. Bleibt Safari schwarz, obwohl `bild-ok` im Log steht, Zentrale in Chrome öffnen.

## 2026-11-22 (Zentrale: Safari malt das Videobild nicht – Canvas-Umweg)

### Befund

- Nach #238 und Neuladen um 13:18: alle 12 Kacheln melden „bild-ok“ (Canvas liest ein helles Bild, 640×360 bis 1536×432), auf dem Schirm trotzdem schwarz. Aaron am Mac im Management-WLAN, Safari-Tab `192.168.1.121:8787`.
- Gleicher Mac, Chrome: alle Bilder sichtbar. Netz und go2rtc sind also in Ordnung, Safari stellt das `<video>` nicht dar.
- Erster Aufbau hängt weiter bei 7 von 12 Kacheln (`ice-timeout`), Neuversuch nach ca. 4 s verbunden; um 13:19 drei gleichzeitige Abbrüche, sofort neu verbunden.

### Änderungen

- In Safari malt ein Canvas über jedem Live-Video das Bild selbst (ca. 15 Bilder/s, übernimmt object-fit, Zoom und Einblendung der Großansicht). `?spiegel=1` / `?spiegel=0` erzwingt bzw. schaltet ab (wird gemerkt).

### Offen

- Prüfen, ob Safari damit Bilder zeigt; sonst Zentrale in Chrome.
- Gleichzeitige Abbrüche alle paar Minuten und langsamer erster ICE-Aufbau.

## 2026-11-22 (Belegung: nicht mehr in geschlossenen Räumen zählen)

### Befund

- Belegungszählung läuft fest 9–21 Uhr (`HUB_OCCUPANCY_HOURS`), unabhängig von der Betriebszeit. Log 22.11. ab 12:01: nur die Startzeile „Belegung: an, alle 300 s zwischen 9-21 Uhr“, keine Meldung. Im Winter oder an Ruhetagen misst der Hub trotzdem alle 5 Min mit YOLO und kann bei Mitarbeitern am Lift „wird voll“ melden.
- Diagnose 23:06: Hinweise Gallery-Schwelle und Fahrzeug-Bursts ohne Plate unverändert offen; betreffen Kameras und Zufahrt, hier nicht angefasst.

### Änderungen

- `occupancy-rules.ts`: `spotClosed` (Test) – ein Punkt ruht, wenn alle Räume seiner Kameras laut Betriebszeit zu sind. Kameras ohne Raum oder Räume ohne Betriebszeit zählen weiter wie bisher.
- `occupancy.ts`: der Takt misst nur offene Punkte und setzt den Meldestatus der ruhenden zurück. Das Werkzeug „occupancy“ misst auf Nachfrage weiter alles.

### Nächster Schritt

- In der Saison prüfen, ob an Öffnungstagen alle Punkte gemessen werden (`occupancy` → `spots`); fehlt ein Punkt, den Raum seiner Kamera prüfen.

## 2026-11-24 (Log, Tests und Kommentare: nur noch Platzhalter-Kennzeichen)

### Befund

- Log, Testdaten und Kommentare führten Kennzeichen als Beispiele. Das Repo ist öffentlich, Beispiele brauchen kein echtes Kennzeichen.

### Änderungen

- `hub/IMPROVE.md`: 13 Stellen umgeschrieben („Whitelist-Kennzeichen“, „ein Lieferwagen“, Kreis statt Kennzeichen).
- Tests und Kommentare (`plate-match`, `vehicle-burst-rules`, `delivery-plates-rules`, `plate`, `plate-cities`, `alpr`, `cameras`, `alpr_daemon.py`): Platzhalter mit gleichem Aufbau (`BO-XY 474E`, `GT-AB 4321` …). Logik unverändert, Tests grün.
- `scripts/backfill-plates.ts`: Listen kommen aus der Umgebung (`BACKFILL_DROP_PLATES`, `BACKFILL_RESET_MATCHED`).
- Regel ergänzt (`.cursor/rules/hub-improve-log.mdc`): keine Kennzeichen, keine Namen Dritter.

### Nächster Schritt

- Bei neuen Einträgen Kennzeichen umschreiben, in Tests nur Platzhalter.

## 2026-11-24 (Stream-Konfiguration: Kamera-Adressen werden vor dem Schreiben geprüft)

### Befund

- `applyIpChange` in `streams.ts` ersetzte die alte Adresse in `webcams/infra/go2rtc.yaml` und `webcams/config.json` durch jeden Host-Wert aus der Cloud. Ein Schreibweg (`rewriteFile`), 2 Zieldateien, gerufen aus `updateLocalStreams` und `syncLocalStreamsFromCloud`.
- Die Ersetzung grenzte nur gegen Ziffern und Punkte ab. Ein Hostname wie `cam` hätte auch Teile von `cams` getroffen.

### Änderungen

- Neue Datei `hub/src/stream-host.ts` (5 Tests): Alte und neue Adresse müssen eine IPv4 in üblicher Schreibweise sein (Werte bis 255, ohne führende Nullen) oder ein Hostname aus Buchstaben, Ziffern, Punkten und Bindestrichen. `replaceHost` ersetzt eine IPv4 wie bisher und einen Hostnamen nur als ganzen Namen.
- Bei abgelehnten Werten bleiben die Dateien unverändert, go2rtc wird nicht neu gestartet. Im Log steht einmal pro Prozesslauf „Stream-Konfig nicht angepasst (Kamera <Name>)“ mit alter und neuer Adresse.
- Die Cloud prüft den Host beim Speichern mit derselben Regel. Stand heute: 13 Kameras, alle mit privater IPv4 in üblicher Schreibweise, es wird also nichts abgelehnt.

### Nächster Schritt

- Ein paar Tage im Hub-Log auf „Stream-Konfig nicht angepasst“ achten. Taucht die Meldung auf, den Host der genannten Kamera in der Cloud bzw. den Eintrag in `config.json` korrigieren.

## 2026-11-24 (Assistent fragt vor dem Merken nach, Hilfsskripte gehärtet)

### Befund

- Diagnose von 17:41 UTC gelesen: ein offener Hinweis zur Gesichtserkennung (Treffer knapp unter der Schwelle). Er gehört zur laufenden Arbeit an der Gesichtserkennung und ist hier nicht angefasst.
- Das Werkzeug `remember` lief als „read“ ohne Rückfrage und stand auch im Tagesbericht zur Verfügung. Notizen bis 300 Zeichen landen in jedem Gespräch im System-Prompt.
- Das Ereignis zur Kopplungsanfrage enthielt den sechsstelligen Code im Feld `detail`, Ereignistitel übernahmen den Telegram-Anzeigenamen ungekürzt.
- `backfill-plates` verband sich ohne Zertifikatsprüfung, `install.sh` ließ die Rechte von `hub/.env` offen.

### Änderungen

- `remember` ist jetzt „act“ und braucht wie die Schaltwerkzeuge den Knopf „Ausführen“.
- Der Filter des Tagesberichts ist eine reine Funktion (`reportToolAllowed` in `agent/report-tools.ts`, Test): nur „read“, ohne die beiden Bild-Werkzeuge.
- Das Kopplungsereignis enthält keinen Code mehr. Namen in Ereignistiteln sind auf 40 druckbare Zeichen gekürzt (`titleName`, Test in `pairing.test.ts`).
- `backfill-plates` nutzt TLS mit Zertifikatsprüfung, `install.sh` setzt `chmod 600` auf `hub/.env`.

### Nächster Schritt

- Beobachten, wie oft Rückfragen zu `remember` kommen und wie oft sie abgebrochen werden.
- Kopplung neuer Chats zusätzlich von einem schon gekoppelten Chat bestätigen lassen und Anfragen je Chat begrenzen (offen, ändert die Bedienung).

## 2026-11-25 (Dashboard: Cookie ohne Token, Begrenzung der Fehlversuche, Host-Prüfung beim Lesen)

### Befund

- Das Cookie `hub_dash` enthielt das Token selbst, also denselben Wert, der auch im Header X-Hub-Token und in `?token=` gilt. Es lief gleitend ein Jahr, ohne Secure, auch über HTTPS.
- Fehlversuche bei der Anmeldung waren nicht begrenzt.
- Lesende Anfragen (GET/HEAD) vom Hub-Rechner ohne Token prüften den Host nicht (stand im Eintrag vom 24.11. unter „Offen“).
- Lokale Aufrufer der Dashboard-API am Hub-Rechner: die Oberfläche selbst (relative Pfade), das Kontrollzentrum (`webcams/lib/service-status.ts`, GET `http://127.0.0.1:8787/api/status`, sofern HUB_DASHBOARD_URL nicht gesetzt ist) und die Cursor-Regel (`/api/improve` über 127.0.0.1). Alle nutzen erlaubte Namen.

### Änderung

- Neu: `dashboard-auth.ts` (reine Logik, 11 Tests). Der Cookie-Wert ist ein HMAC-SHA256 aus dem Token, base64url. Alte Cookies mit dem Token gelten weiter und werden beim nächsten Seitenaufruf ersetzt. Über HTTPS kommt zusätzlich `__Secure-hub_dash` mit Secure, mit eigenem Namen, damit derselbe Browser über HTTP angemeldet bleibt. Über HTTP bleibt `hub_dash` mit denselben Attributen wie bisher.
- Fehlversuche je Client-Adresse: 20 ungültige Werte in 15 min (gleitendes Fenster) führen zu 15 min 429 für diese Adresse. Derselbe falsche Wert zählt nur einmal (offener Tab mit altem Cookie). Loopback wird nie begrenzt. Nur eine Anmeldung über `?token=` setzt den Zähler zurück, eine gültige Cookie-Anfrage nicht (NAT). Höchstens 1.000 Adressen, alles nur im Speicher. Im Log steht dann: „Dashboard: zu viele Fehlversuche von <Adresse> – 15 min gesperrt“.
- `dashboard-guard.ts`: GET/HEAD auf /api/* ohne Token (vom Hub-Rechner) prüfen den Host nach derselben Liste wie schreibende Anfragen (2 neue Tests). Seiten, Icons, /ca.crt und Anfragen mit Token sind unverändert.
- Start im Netz ohne Token: weiterhin kein Startverbot, aber eine Warnzeile im Log. Der Heartbeat meldet `system.dashboardAccess` (`local`, `lan-token`, `lan-open`), nur zusammen mit einem vollständigen system-Objekt, weil die Cloud `system` als Ganzes ersetzt.
- Geprüft: `tsc -p hub` und `tsc` ohne Fehler, `dashboard-auth.test.ts` und `dashboard-guard.test.ts` 26/26 grün. Laufzeit-Probe mit Test-Token in einer Sandbox über HTTP und HTTPS: Anmeldung, altes Cookie wird ersetzt, Kopfzeile, Sperre nach 20 Fehlversuchen, Hub-Rechner selbst bleibt frei. Am Hub nicht geprüft.

### Nächster Schritt

- Nach dem Update im Log nach „zu viele Fehlversuche“ und „abgelehnt (host)“ suchen. Taucht dort ein eigener Name auf, ihn in `HUB_DASHBOARD_ALLOWED_HOSTS` eintragen.
- Die Startzeile „Lokales Dashboard … (…)“ lesen. Steht dort „im LAN OHNE Token“, mit dem Betreiber ein Token setzen.
- `dashboardAccess` in der Hub-Karte der Cloud anzeigen, eventuell als eigener Schlüssel unabhängig von STATE.system (eigenes Paket in src/).

## 2026-11-24 (Gesamtprüfung Hub und Kamera-Erkennung, Teil 1: Personen-Start, Ereignisfluss, Log)

### Befund

Grundlage: Hub-Log 22.–24.11. (54 Stunden, rund 23.000 Zeilen), Diagnose-Snapshot und die Ereignistabelle der Cloud.

- **Gesichtserkennung startete bei 127 von 843 Personen-Ereignissen nicht** (15 %; Shop 46 von 141, Eingang 20 von 256, Gastro 11 von 169). Die Kamera meldet Bewegung meist ein, zwei Sekunden vor der Person. Das Anzeige-Bild dieser Bewegung setzte dieselbe 30-Sekunden-Drossel wie die Erkennung und sperrte sie damit aus.
- **Rund 58 % des Logs waren Routine ohne Aussage:** Zugriffszeilen des Gesichts-Dienstes 4.901, Bewegung Beginn/Ende 5.595, SNMP-Lauf 1.074, Fahrzeugliste 649, Diagnose-Snapshot 640, Gesichter-Liste 318, Kamera-Uhren 107. Mehrzeilige Ausgaben des Gesichts-Dienstes standen ohne Zeitstempel im Log.
- **Bewegung flackert:** rund 17.100 Bewegungs-Ereignisse in 7 Tagen (Eingang 3.560, Aquapark 3.400, Übungslift 2.327, Halle 2 2.277). 78 % der Pausen zwischen zwei Ereignissen derselben Kamera sind kürzer als 60 s.
- **Jede Ereignis-Meldung schrieb alle Kamera-Zeilen neu** (`seen` hing an jeder Meldung): 2,76 Mio. Schreibvorgänge auf der Kamera-Tabelle seit dem 10.11.
- **Die Meldung an die Cloud lief im Poll-Takt:** Solange sie unterwegs war (Zeitlimit 30 s), fragte der Hub keine Kamera ab.
- **19 Ereignisse in der Cloud ohne Ende**, alle rund um Hub-Neustarts (11., 13., 14., 20. und 22.11.). Der Hub kennt nach dem Neustart seine laufenden Ereignisse nicht mehr. Im Kontrollzentrum blinkte auf fünf Kacheln dauerhaft ein altes Ereignis.
- In 54 Stunden kein einziger gescheiterter Ereignis-Upload, keine unbehandelte Ausnahme im Poll.

### Änderungen

- `camera-poll-rules.ts` (neu, Tests): `snapshotJobFor` trennt Anzeige-Bild und Erkennung. Ein Anzeige-Bild drosselt nur weitere Anzeige-Bilder (`lastAutoSnapshotAt`), die Personen-Pipeline wartet nur noch auf Erkennungs-Pipelines. Kennzeichen starten wie bisher immer.
- `event-debounce.ts`: Nachlauf je Ereignisart. Reine Bewegung läuft 60 s nach (`HUB_MOTION_END_HOLD_MS`), Person, Fahrzeug und Tier bleiben bei 6 s. Das Ende trägt weiter die Zeit der letzten aktiven Messung.
- `cameras.ts`: Meldungen an die Cloud laufen nacheinander außerhalb des Polls (Zeitlimit 15 s). `seen` geht einmal je Minute mit. Scheitert eine Meldung, entfallen ihre Beginne wie bisher (sie lösen Regeln aus, und die sollen nicht Minuten später feuern); ihre Enden gehen noch einmal mit (`endsToRetry`, Tests). Eine Störung steht einmal im Log und dann alle 5 Minuten, dazu „Cloud wieder erreichbar“.
- Nach dem Start meldet der Hub `closeOpen`; die Cloud schließt die Ereignisse von davor (`src/lib/camera-events.ts`, Tests): Das jüngste je Kamera und Art endet, als der Hub die Kamera zuletzt meldete, ältere Altlasten enden an ihrem Beginn.
- Ruhe im Raum zählt jetzt auch ein laufendes Ereignis: Cloud `roomIsIdle` und das Overlay im Kontrollzentrum über `recentActivityWhere`, Hub `noteCameraActivity` bei jeder aktiven Messung.
- Log: Gesichts-Dienst protokolliert nur noch Fehler (`log_request`), seine Ausgabe kommt zeilenweise mit Zeitstempel. Bewegung wird gezählt statt geloggt (`camera.motion`). Fahrzeugliste, Gesichter-Liste, Diagnose-Snapshot, SNMP-Lauf und Kamera-Uhren melden nur noch Änderungen (`change-log.ts`), SNMP und Uhren zusätzlich einmal am Tag.
- `improve-log.ts`: `improveCount` zählt Routine („Halteverbot frei“, „Parkplatz gemeldet“, „VLAN in Ordnung“, SNMP ok), ohne eine Zeile in `improve.jsonl` zu schreiben.
- `face.ts`: die `/health`-Abfrage vor jedem Bild entfällt, solange der Dienst in den letzten 20 s geantwortet hat; bricht die Verbindung ab, wird er neu sichergestellt und das Bild einmal wiederholt.
- `repo-access.ts`: Fehlermeldung nennt die Ursache („Permission denied (publickey).“) statt der letzten Zeile des Hinweistexts.

### Nach dem Gegenlesen ergänzt (25.11.)

Drei unabhängige Durchgänge über die Änderung (Ereignisfluss im Hub, Ereignisse in der Cloud, Gesichts-Dienst und Log) brachten 21 Befunde, keinen kritischen. Alle sind hier eingearbeitet.

- **Kennzeichen warteten hinter der Gesichtserkennung.** Die Personen-Pipeline hielt die Kamera für ihren ganzen Lauf (8 bis 12 s und mehr); ein Fahrzeug an derselben Kamera kam erst danach an die Reihe. Weil die Pipeline jetzt öfter startet, hätte das die Einfahrt häufiger getroffen als vorher (`alpr.deferred`: 38 in sechs Tagen). Ablauf-Test gegen Attrappen (Bewegung bei 3 s, Person bei 5 s, Fahrzeug bei 7 s): Der Burst begann auf dem alten Stand nach 8,4 s, mit der ersten Fassung dieser Änderung nach 11,1 s, jetzt wieder nach 8,4 s. Dafür `CameraLease` in `camera-poll-rules.ts` (Tests): Die Pipeline braucht die Kamera nur noch während eines Bildes oder des optischen Zooms und gibt sie dazwischen ab, sobald ein Fahrzeug wartet. Hatte sie bis dahin kein Gesicht, läuft sie nach dem Burst einmal neu (im Test nach 17,0 s). Log „Personen-Snapshot …: unterbrochen (Fahrzeug geht vor)“, Zähler `face.yield_vehicle`.
- **Ein Ereignis konnte in der Cloud offen bleiben oder ganz fehlen,** wenn die Cloud eine Meldung verarbeitet hatte, der Hub sie aber als gescheitert sah, oder wenn ein Beginn verloren ging. Ablauf-Test mit gestörter Cloud (drei Ereignisse, Antworten 500 mit und ohne Verarbeitung): In der ersten Fassung blieb eines offen und eines fehlte, jetzt sind alle drei vollständig. Dafür drei Dinge: Der Hub wiederholt jedes Ende einer gescheiterten Meldung; die Cloud schließt mit einem Ende nur ein Ereignis, das vor diesem Ende begann. Mit der Erreichbarkeit nennt der Hub einmal je Minute, was gerade läuft (`running`, `RunningReport`), und die Cloud trägt Fehlendes ohne Regeln und ohne Push nach (Log „N laufende in der Cloud nachgetragen“). Kommt ein neuer Beginn, enden ältere offene Ereignisse derselben Kamera und Art an ihrem Beginn (`staleOpen`).
- **Nach einem Stromausfall endeten offene Ereignisse erst zum Wiederanlauf.** Der Hub schreibt jetzt alle 30 s ein Lebenszeichen auf die Platte (`alive-mark.ts`) und meldet nach dem Start, bis wann sein Vorgänger lief (`closeOpen.lastAlive`); die Ereignisse enden zu diesem Zeitpunkt.
- **Ein offenes Ereignis an einer stummen Kamera hielt den Raum belegt.** Als Aktivität zählt es nur noch bis zur letzten Meldung der Kamera (`recentActivityWhere`, `activityAt`); Räume, Dashboard, Assistent und Kontrollzentrum zeigen denselben Stand.
- Wird eine Kamera entfernt oder deaktiviert, enden ihre laufenden Ereignisse (`endAll`). Die DoorBird meldet ein gescheitertes Ende nach 10 s, 60 s und 5 min noch einmal.
- Log-Lücken der ersten Fassung geschlossen: Scheitert der Abruf der Fahrzeugliste oder der Gesichter-Liste, steht das einmal im Log (bei anderem Grund erneut, sonst alle 30 min) und die Erholung ebenfalls („Abruf klappt wieder“); die Fahrzeugliste wird so lange neu auf die Platte geschrieben, bis es einmal gelungen ist. Bricht die Verbindung zum Gesichts-Dienst ab, steht die Wiederholung im Log und im Zähler `face.retry`. Die Zeile der Kamera-Uhren nennt die Zahl der gelesenen Uhren und entfällt, wenn keine gelesen wurde. Der Diagnose-Hinweis wird ohne Zahlen verglichen (die Zähler darin wandern). `repo-access.ts` findet die Ursache auch bei „Network is unreachable“, „No route to host“ und geändertem Host-Schlüssel.
- Netzwerk-Prüfung: Dauer des letzten und des längsten Laufs stehen in der Antwort von `/api/network` des lokalen Dashboards (Feld `vlanCheck`), ein Lauf ab 15 s kommt ins Log (höchstens alle 30 min). Der erste Lauf beginnt 45 s nach dem Hub-Start, die weiteren im eingestellten Takt ab dem Start (bei 300 s also nach 0:45, 5:00 und 10:00); damit lassen sie sich weiter mit Abbrüchen der Livebilder vergleichen, obwohl der Normalfall nur noch gezählt wird.

### Zweites Gegenlesen (25.11.)

Zwei weitere unabhängige Durchgänge über den ganzen Stand (Ereignisfluss im Hub, Anzeige in der Cloud), danach eine Gegenprobe der Nachbesserungen. Kein kritischer oder hoher Befund; alles Gefundene ist eingearbeitet.

- **Nach einer längeren Cloud-Störung liefen Regeln zu alten Ereignissen.** Beginne, die hinter einer gescheiterten Meldung warteten, gingen nach der Erholung in Serie hinaus und lösten ihre Regeln aus. Nachbau mit 1, 3 und 8 Stunden Störung: je 145 Regel-Läufe zu Ereignissen, die älter als 2 Minuten waren. Jetzt geht ein Beginn höchstens 30 s alt an die Cloud (`START_MAX_AGE_MS`, `tidyOutbox`, Tests). Läuft das Ereignis noch, trägt die Cloud es über die Liste der laufenden Ereignisse nach, ohne Regeln und ohne Push. Wie lange ein Beginn gewartet hat, misst zusätzlich eine Uhr, die niemand stellt (`performance.now()`): Ein Zurückstellen der Hub-Uhr lässt keinen alten Beginn mehr durch. Bei einem einzelnen Aussetzer laufen die Regeln weiter, der wartende Beginn geht mit dem nächsten Versuch hinaus.
- **Volle Warteschlange (400 Einträge):** Je Kamera und Art bleiben die Enden stehen, die in der Cloud ein offenes Ereignis schließen: das erste, das hinter einem wartenden Beginn und das erste nach einem Beginn aus einer Meldung, die der Hub als gescheitert sah, die Cloud aber verarbeitet haben kann (`UnconfirmedStarts`). Allein aus diesem letzten Grund bleiben höchstens 50 Enden stehen (eine halbe Meldung), damit jüngere an die Reihe kommen. Was verworfen wird, steht als Summe im Log: eine Zeile mit der ersten gelungenen Meldung, eine zweite, sobald die Warteschlange abgearbeitet ist. Zähler `camera.event_start_stale`. In den Nachbauten (bis 13 Stunden Störung; Zufallsläufe mit verlorenen, hängenden und verarbeiteten, aber als gescheitert gewerteten Meldungen) stimmen alle Enden, und kein Ereignis wird doppelt angelegt. Ereignisse, die ganz in eine Störung fallen, stehen danach wie bisher nicht in der Cloud.
- **Gesichtserkennung nach einem zweiten Fahrzeug:** Zieht ein Fahrzeug-Burst direkt den nächsten nach, wartet der Nachhol-Lauf der Gesichtserkennung beide ab und findet die Kamera danach frei.
- **Fahrzeug-Erkennung einer Kamera abgeschaltet:** Ein laufendes Fahrzeug-Ereignis endet dann nach dem Nachlauf (`aiAlarmState`).
- **Anzeige überall gleich:** Kontrollzentrum, Räume und Assistent zeigen ein offenes Ereignis nur bis zur letzten Meldung seiner Kamera als laufend (`shownEndedAt`, `shownAsRunning`). Auf der geöffneten Räume-Seite gelten „jetzt“ und „läuft“ bis zwei Minuten nach dem Abruf, danach steht das Alter der Angabe. „Zuletzt“ zählt auch ein langes Ereignis, das nach einem kürzeren derselben Kamera endete (`roomEventInputs`, Tests). Folge: Nach einem gewöhnlichen Durchgang nennt die Kamera-Zeile im Raum öfter „Bewegung“ statt „Person“, weil reine Bewegung 60 s nachläuft; Personen stehen im Raum weiter eigens. Der Assistent nennt je Ereignis, ob es noch läuft (`running`, `lastActivityAt`; ein seit über einem Tag offenes Ereignis zählt nur diesen einen Tag), und offene Ereignisse behalten ihren Platz in seiner Liste (`withOpenEvents`, höchstens 50).
- **Kleinere Punkte im Hub:** Das Lebenszeichen wird nach einem Schreibfehler entfernt (eine Log-Zeile je Grund, die Erholung einmal), es läuft nie mehr als ein Schreibversuch zugleich. Als Dauer der Netzwerk-Prüfung zählt die Abfrage der Switches. Der SNMP-Lauf vergleicht Name, Zahl der Ports und ob die MAC-Tabelle leer ist; die wandernde Zahl der MAC-Adressen löst keine Zeile mehr aus. Schreibt git nur seinen Nachsatz, nennt der Update-Zugang dessen erste Zeile. Ein gescheiterter Abruf der Gesichter-Liste steht einmal je Grund im Log, dann alle 30 min. Die Zeile der Kamera-Uhren nennt die eben gelesenen Uhren, entfernte Kameras zählen nicht mehr mit.
- `README.md`: Die Kamera-Liste gilt für den ganzen Account; jeder Hub fragt alle aktivierten Kameras ab und führt ihre Ereignisse. Bevor ein zweiter Hub Kameras übernimmt, braucht es eine Zuordnung von Kameras zu einem Hub.

### Nächster Schritt

- Nach dem Update Log holen und vergleichen: Anteil der Personen-Ereignisse mit Pipeline (vorher 71 %), Zeilen je Tag (vorher rund 10.000), Bewegungs-Ereignisse je Tag (vorher rund 2.400), offene Ereignisse in der Cloud (soll: nur laufende).
- An der Kamera Eingang `alpr.deferred` und die Zeilen „wartet (Pipeline läuft)“ mit „unterbrochen (Fahrzeug geht vor)“ vergleichen: Die Wartezeit eines Fahrzeugs soll höchstens ein Bild lang sein.
- Regeln mit Auslöser „Bewegung“ feuern wie bisher am Beginn eines Ereignisses. Mit dem längeren Nachlauf gibt es weniger Beginne; wer eine solche Regel anlegt, die bei anhaltender Bewegung nachlösen soll, braucht dafür einen eigenen Takt.
- Zeilen „Kamera-Event-Upload: N Beginne nicht mehr gemeldet“ und der Zähler `camera.event_start_stale` sollen nur nach einer echten Störung der Cloud auftauchen. Stehen sie ohne Störung im Log, dauern Abfrage-Runden länger als 30 s, oder die Uhr des Hubs ist vorgesprungen.

## 2026-11-25 (Gesamtprüfung Hub und Kamera-Erkennung, Teil 2: Betrieb bei Störungen)

### Befund

Grundlage: dieselben 54 Stunden Hub-Log wie in Teil 1, dazu ein Nachbau auf dem Entwicklungsrechner: der unveränderte Hub-Code gegen vier Kamera-Attrappen und eine Cloud-Attrappe (135 s; eine Kamera antwortet 80 s lang nicht, die Cloud ist 50 s lang weg).

- **Ohne Cloud keine Kamera-Abfrage.** Jede Runde lud zuerst die Kamera-Liste neu, sobald sie älter als 60 s war; scheiterte das, endete die Runde, bevor eine Kamera gefragt wurde. Im Nachbau: 0 Abfragen in 38 s, 15 Zeilen „Kamera-Poll-Fehler“, eine Person vor Kamera 3 blieb unbemerkt. Im Log der 54 Stunden kam kein so langer Ausfall vor (Aussetzer nur sekundenlang).
- **Eine hängende Kamera hielt alle auf.** Die Runde wartete auf die langsamste Kamera (Zeitlimit 8 s). Im Nachbau: 2 Abfragen je Kamera in 26 s statt 13. Im Log passt dazu: am 24.11. ab 14 Uhr UTC lagen 27 % der Ereignis-Zeilen außerhalb des 2-Sekunden-Rasters, in derselben Stunde 18 Zeitüberschreitungen einer einzelnen Kamera; sonst 0 bis 6 %. Wie lange eine Abfrage dauert, wurde nirgends gemessen.
- **Ein Auftrag, dessen Bearbeitung eine Ausnahme wirft, beendete den Hub** (unbehandelte Ablehnung, der Hub beendet sich dann absichtlich). Betroffen waren unter anderem Aufträge in den ersten Sekunden nach einem Start, solange die Kamera-Liste noch nicht geladen ist. Im Fenster kein Fall (0 Zeilen „FATAL“).
- **Update und Neustart aus der Cloud räumten nicht auf.** 4 Neustarts in 54 Stunden, alle durch Updates: 0 Zeilen „Improve-Snapshot (exit)“ gegenüber 4 „(boot)“, die Zähler der Sitzung waren jedes Mal weg. Ein vom Hub eingeschaltetes Weißlicht wäre angeblieben (sein Ausschalt-Timer lebt nur im Speicher; kein Neustart fiel in ein Lichtfenster).
- **Die Suche nach einer Kamera unter neuer Adresse lief unbegrenzt im Minutentakt**, ohne Zeile im Log und ohne Schutz gegen überlappende Läufe. Eine Kamera fehlt seit dem 14.11. Der Router beantwortet dabei kein SNMP: Jeder Abruf seiner ARP-Tabelle wartete rund 6 s auf das Zeitlimit, zwei- bis dreimal je Suche.
- Drei Fehler-Abnehmer fehlten (Start von Gesichts- und Mäher-Dienst, Eingabe des Kennzeichen-Dienstes), und ein beschädigter Schlüssel für das lokale Dashboard hätte den Start des Hubs in eine Schleife geschickt. Beides nicht beobachtet, aus dem Code abgeleitet.

### Änderungen

- `cameras.ts`: Jede Kamera wird für sich abgefragt (höchstens 6 gleichzeitig). Der 2-Sekunden-Takt stößt nur an, was fällig ist; Bild-Pipelines, Regeln und die Meldung an die Cloud starten, sobald die eine Kamera geantwortet hat. Meldungen eines Takts gehen weiter gemeinsam hinaus (250 ms Sammelzeit).
- Eine Kamera, die nicht antwortet, ist im nächsten Takt nach dem Ende ihrer Abfrage wieder dabei, auch nach Stunden (`pollDue`, Tests): eine hängende (Zeitlimit 8 s) alle 8 bis 10 s, eine, die erst nach 5 s scheitert, alle 6 s, eine, die sofort ablehnt (HTTP-Fehler, Verbindung abgewiesen: sie fährt gerade hoch), alle 2 s. Das sind die Abstände, die sich vor der Umstellung aus der Dauer der Runde ergaben; einen festen größeren Abstand gibt es nicht, er verzögerte nur die erste Abfrage nach der Rückkehr der Kamera. Innerhalb eines Takts kommen die Kameras ohne langen Fehlversuch (ab 4 s) zuerst an die Reihe (`pollOrder`, `failStreakAfter`, Tests). Die Früherkennung zählt damit so viele Fehlversuche je Ausfall wie vor der Umstellung (Tests).
- Die Kamera-Liste lädt im Hintergrund. Gewartet wird nur, solange noch keine Kamera bekannt ist. Scheitert der Abruf, läuft die Abfrage mit dem letzten Stand weiter, der nächste Versuch folgt nach 15 s (`configRefreshPlan`, Tests). Im Log steht die Störung einmal und dann alle 10 Minuten, dazu „Kamera-Liste: Cloud wieder erreichbar“.
- Dauer der Abfragen, gemessen an den Kameras, die geantwortet haben: `STATE.cameras` zeigt den Höchstwert der letzten 5 Minuten samt Kamera (`pollMaxMs`, `pollSlowest`, `pollSlow`). Antworten ab 4 s zählt `camera.poll_slow`, dazu je Kamera höchstens alle 10 Minuten eine Zeile „Abfrage dauerte …“. Eine Kamera, die gar nicht antwortet, steht als nicht erreichbar im Log und im Status (`camera.unreachable`) und zählt hier nicht mit.
- Ohne Cloud holt der Hub je Kamera höchstens alle 30 s ein Anzeige-Bild: Die Drossel gilt ab dem Bild, auch wenn der Upload scheitert. Dasselbe gilt für die Personen-Pipeline nach einem gescheiterten Upload. Die Zeile „Auto-Snapshot Kamera N fehlgeschlagen“ kommt je Kamera und Grund höchstens alle 5 Minuten, gezählt wird jedes Mal (`camera.snapshot_fail`).
- Suche unter neuer Adresse: je Kamera nur ein Lauf zur selben Zeit, Abstand 1 Minute, nach 10 Minuten Ausfall 5 Minuten, nach einer Stunde 15 Minuten (`relocateIntervalMs`, Tests). Der Schritt über die Kamera-Anmeldung läuft nur in der ersten Stunde. Jeder Wechsel der Stufe steht einmal im Log, jeder Lauf zählt als `camera.relocate_search`. Der Ausfallbeginn je Kamera steht in `hub/.cache/cameras-down.json` (nur Kamera-ID und Zeit, geschrieben bei Beginn und Ende eines Ausfalls) und überlebt den Neustart: Die Stufen zählen weiter, und die nächste Suche kommt am nächsten Punkt eines Rasters, das vom Ausfallbeginn an im Abstand der Stufe läuft (`relocateAtStart`, Tests). Nach einem Start vergeht so höchstens ein Abstand bis zur nächsten Suche, auch wenn der Hub öfter neu startet, als die Stufe lang ist; eine Suche je Start gibt es nicht.
- `netmap.ts`: Ein gescheiterter Abruf der Router-ARP-Tabelle wird 2 Minuten gemerkt, so lange wie ein gelungener.
- `task-guard.ts` (neu, Tests): Ein Auftrag, dessen Bearbeitung wirft, wird als fehlgeschlagen gemeldet; der Hub läuft weiter. Ein Ergebnis, das sich nicht übertragen lässt, geht ohne Nutzdaten hinaus statt gar nicht.
- `shutdown.ts` (neu, Tests): ein Weg für jedes Beenden (Update, Neustart aus der Cloud, Signal, unerwarteter Fehler). Vom ersten Augenblick an holt der Hub keine neuen Aufträge ab und schaltet kein Weißlicht mehr ein. Aufräumer laufen nebeneinander, zusammen höchstens 3 s: Mäher-Dienst stoppen, Diagnose-Stand sichern, ein vom Hub eingeschaltetes Weißlicht ausschalten. Wer sich erst während des Aufräumens anmeldet, läuft noch mit. Was nicht fertig wurde, steht im Log („Aufräumen unvollständig: weisslicht:3“).
- Weißlicht beim Fahrzeug-Burst (`vehicle-light.ts`, neu, Tests): Aufräumer, Timer und ein Merker auf der Platte stehen, bevor der Einschalt-Befehl an die Kamera geht. Der Merker liegt in `hub/.cache/lights-on.json` (nur Kamera-ID und Zeit) und wird nach dem Ausschalten gelöscht. Endet der Prozess, solange ein Licht brennt, schaltet der nächste genau diese Lichter einmal aus, sobald die Kamera bekannt und erreichbar ist und dort kein Burst läuft („Weißlicht aus (nachgeholt)“, Zähler `alpr.spotlight_late_off`). Ist ein gemerktes Licht dann schon aus, entfällt nur der Merker („Weißlicht war schon aus – Merker gelöscht“). Ebenso holt der Hub das Ausschalten nach, wenn die Kamera es am Ende eines Bursts ablehnt. Beginnt ein Burst, während dieser Ausschalt-Befehl unterwegs ist, schaltet er das Licht selbst wieder ein und am Ende aus, auch wenn die Kamera es noch als brennend meldet (`burstSwitchesLight`, Tests). Ein Merker älter als 24 Stunden wird verworfen, ohne die Kamera anzufassen (`lightMarkStep`, Tests). Ein Licht ohne Merker gilt als von Hand eingeschaltet und bleibt unberührt; wer es über die Cloud von Hand schaltet, übernimmt es.
- Fehler-Abnehmer für den Start von Gesichts- und Mäher-Dienst und für die Eingabe des Kennzeichen-Dienstes. Das lokale Dashboard fällt bei unbrauchbarem Schlüssel auf HTTP zurück.

Im Nachbau mit den Änderungen: Während eine Kamera hängt, 13 Abfragen je übriger Kamera in 26 s (die hängende 2 bis 3). Ohne Cloud 19 bis 23 Abfragen in 38 s, die Person vor Kamera 3 wird erkannt und die Bild-Pipeline startet. Zum Ausfall selbst stehen zwei Zeilen im Log (Kamera-Liste, Ereignis-Meldung) statt 16. Flackert dabei an einer Kamera die Bewegung (je 2 s an und aus, 60 s ohne Cloud), kommt eine Zeile „Auto-Snapshot … fehlgeschlagen“ dazu, bei 2 Bildern (eines je 30 s). Nach der Rückkehr der Cloud gehen Meldungen nach 8 bis 11 s wieder hinaus, die Kamera-Liste folgt nach rund 12 s. Ein Szenario mit Fahrzeug und Person an derselben Kamera läuft wie vorher (Kennzeichen-Burst zuerst).

Rückkehr einer Kamera mit einem Fahrzeug im Bild, gegen dieselben Attrappen, in Klammern der Stand vor der Umstellung im selben Ablauf: Eine Kamera, die 21 Abfragen lang hing und 1 s nach Beginn der letzten zurückkommt, wird 7,0 s danach wieder abgefragt (9,0 s), und das erste Burst-Bild entsteht gleich darauf. Die laufende Abfrage endet dabei mit dem Zeitlimit kurz vor oder kurz nach einem Takt; beide Stände fragen die hängende Kamera deshalb im Wechsel alle 8 oder 10 s. Eine Kamera, die 61 s lang erst nach 5 s scheiterte, wird in dieser Zeit alle 6,0 s gefragt (6,0 s) und 0,0 s nach ihrer Rückkehr (0,0 s); bei 7 s alle 8,0 s (8,0 s) und nach 4,0 s (4,0 s). Eine, die 241 s lang mit HTTP 503 ablehnte, nach 0,1 s (0,1 s).

Start mit einem gemerkten Ausfall, die Suche im Netz durch eine Attrappe ersetzt: Ist die Kamera seit 3 h 14 min weg, kommt die erste Suche 68,5 s nach dem Start, mit der ersten gescheiterten Abfrage nach dem Rasterpunkt 3 h 15 min. Startet der Hub nach 45 s noch einmal, sucht er am selben Rasterpunkt (76,1 s nach dem zweiten Start). Ist sie seit 5 min 20 s weg, kommt die Suche nach 48,3 s.

Beenden gegen eine Kamera-Attrappe mit Weißlicht: Brennt das Licht, wenn der Hub endet, ist es beim Prozessende aus, auch wenn der Einschalt-Befehl noch unterwegs war. Beantwortet die Kamera das Ausschalten nicht, endet der Hub nach 3 s mit der Zeile „Aufräumen unvollständig: weisslicht:1“, und der nächste Start schaltet das Licht mit seinem zweiten Takt aus (rund 4 s). Ein Licht ohne Merker bleibt dabei an. Meldet die Kamera in genau diesem Takt ein Fahrzeug, brennt das Licht im Burst und ist danach aus (Attrappe, die Schaltbefehle der Reihe nach in 60, 150 und 400 ms ausführt); ein Burst, der vor dem Nachholen beginnt, nutzt das brennende Licht sofort, und es geht nach ihm aus.

### Nächster Schritt

- Nach dem Update Log holen: Zeilen „Abfrage dauerte“ und Zähler `camera.poll_slow` zeigen, welche Kamera wie oft langsam antwortet. `camera.relocate_search` soll für eine dauerhaft fehlende Kamera nach der ersten Stunde des Ausfalls bei 4 je Stunde liegen, über Neustarts hinweg bei höchstens 5 in 60 Minuten. Vor jedem „Hub startet“ soll eine Zeile „Improve-Snapshot (exit)“ stehen. Steht dort „Aufräumen unvollständig: weisslicht:…“, soll kurz nach dem Start „Weißlicht aus (nachgeholt)“ folgen oder, wenn das Licht schon aus war, „Weißlicht war schon aus – Merker gelöscht“.
- Ereignisse, die während eines Cloud-Ausfalls beginnen und enden, werden wie bisher nicht nachgemeldet; was bei der Rückkehr der Cloud noch läuft, trägt sie über die Liste der laufenden Ereignisse nach (Teil 1). Die Regeln auf dem Hub (Notbetrieb) und die Bild-Pipelines sehen jetzt alle.
- Offen: Überwachung des Gesichts-Dienstes mit Neustart bei ausbleibender Antwort, und eine Lint-Regel für Hintergrund-Aufrufe ohne Fehlerbehandlung in `hub/`.

## 2026-11-25 (Gesamtprüfung Hub und Kamera-Erkennung, Wächter: Uhrzeit, Merkliste, Sperrzeit, Zustellung, Bildmodell-Ausfall)

### Befund

Grundlage: dieselben 54 Stunden Hub-Log (250 Bewertungen des Wächters, 132 Alarme) und ein Nachbau auf dem Entwicklungsrechner: der echte Wächter-, Zustell- und Zustands-Code gegen Attrappen für Kamera, Bildmodell, Tracker und Telegram, die Uhr im Zeitraffer.

- **Die Uhrzeit-Funktion des Assistenten lieferte keine Zahl.** Die Stunde wurde aus dem deutsch formatierten Text gelesen („16 Uhr“), jeder Vergleich damit fiel aus. Im Log: 6 Alarme „Eingestempelt: …, aber nachts und ohne Arbeitskleidung“ am hellen Tag (22.11. 16:02 und 16:04; 23.11. 08:20, 08:47, 08:54, 09:30). Kameras ohne Raum mit Betriebszeit wurden im Nachtfenster nicht bewacht. Die Ruhezeit 22–7 Uhr galt nie, die Belegung maß nie.
- **Eine gemeldete Person galt nach dem ersten Wiedersehen 8 Stunden als „schon gesehen“** statt 20 Minuten: 13 Entscheidungen „Schon gesehen: bereits gemeldet“, bei 4 lag der Eintrag 75 bis 267 Minuten zurück. Bei mehreren Personen im Bild wurden alle Beschreibungen unter einem Namen gemerkt.
- **Nach jeder Bewertung war die Kamera 3 Minuten gesperrt, auch nach einem leeren Bild.** Nachstellung ab 23.11. 00:20: 357 Auslöser, 224 bewertet, 133 übergangen (37 %), 27 der 50 Auslöser nach leerem Ergebnis kamen später als 60 s. Übergangene Auslöser wurden weder gezählt noch geloggt.
- **Zustellung:** Jede Nachricht hatte genau einen Versuch, Fehler wurden verschluckt (132 Alarme, 0 Zeilen über gesendete oder gescheiterte Alarm-Nachrichten). Am 23.11. rund 70 s ohne Internet („Telegram: fetch failed“), zufällig ohne Alarm in dem Fenster. Der Tagesbericht galt als erledigt, bevor er gesendet war.
- **Bildmodell:** Scheiterte der Aufruf, endete die Bewertung ohne Nachricht; nach „Modell nicht gefunden“ bewertete der Wächter bis zum Neustart nichts mehr. Der Zustands-Wächter prüfte das Bildmodell nicht (aus dem Code abgeleitet, im Fenster kein Ausfall).
- **Zustand über Neustarts:** Der Stand des Zustands-Wächters lag nur im Speicher. Nach jedem der 4 Neustarts wurde jeder weiter bestehende Befund erneut gemeldet, für Erledigtes kam keine Entwarnung.
- **Dauer des Bildmodells:** vom Auslöser bis zum Personen-Urteil im Median 67,8 s (p90 105,6 s, n=135), die Nahaufnahme allein 45,6 s. Wofür die Zeit vergeht, stand nirgends.

### Änderungen

- `agent/quiet.ts`: `berlinHour()` liest die Stunde über `formatToParts` (0 bis 23, sonst Fehler). Damit greifen Tagsüber-Regel für eingestempeltes Personal (6–20 Uhr), Nachtfenster für Kameras ohne Betriebszeit (22–6 Uhr, derzeit nur die Kamera Imbisscontainer), Ruhezeit (22–7 Uhr) und Messzeit der Belegung. Startzeile „Assistent: Ortszeit Stunde …“.
- `occupancy.ts`: `HUB_OCCUPANCY_ALERTS` kennt `on`, `off` und `shadow`; ohne Angabe Probelauf (Zeile „Probelauf, nichts gesendet“, Zähler `occupancy.shadow_alert`).
- `agent/people-rules.ts` (neu, Tests): Arten der Merkliste. *Gemeldet* endet 20 Minuten nach dem Alarm und wird nicht verlängert, *freigegeben* und *Mitarbeiter* gelten 8 Stunden, Mitarbeiter-Einträge zählen nachts nicht. Neue Beschreibungen nur bei genau einer Person im Bild. Datei in einem Zug ersetzt (`atomic-file.ts`).
- `agent/sentinel-rules.ts`: Nach „unauffällig“, leerem Tracker oder Fehler sieht der Wächter im Nachtfenster schon nach 45 s wieder hin; der 3-Minuten-Takt bleibt. Höchstens zwei Bewertungen gleichzeitig, ein weiterer Auslöser wird bis zu 30 s erneut versucht; hält ein zusätzlicher Blick einen Platz, verfällt ein Auslöser des 3-Minuten-Takts nicht. Bilanz-Zeile je Stunde, Zähler `camera.sentinel_*`.
- `agent/outbox.ts`, `agent/dispatch.ts` (neu, Tests): Sende-Warteschlange je Chat, Versuche sofort, nach 5 s, 20 s, 60 s, dann alle 3 Minuten, höchstens 15 Minuten. Scheitert das Bild, geht der Alarm als Text mit seinen Knöpfen hinaus, auch wenn der letzte Bild-Versuch erst nach der Frist scheitert. Log-Zeile bei mehr als einem Versuch und bei jedem Fehlschlag. Ein Alarm ohne Zustellung wird 12 Stunden Befund „Wächter-Alarm nicht zugestellt“ (`.cache/agent-undelivered.json`). Der Tagesbericht gilt erst nach der Zustellung als erledigt.
- `agent/findings.ts`, `agent/watch-runner.ts` (neu, Tests): Der Stand des Zustands-Wächters liegt in `.cache/agent-watch.json` und übersteht einen Neustart; jede Meldung steht mit ihrem Schlüssel im Log.
- `agent/ollama.ts`, `agent/vision-rules.ts` (neu, Tests): Befund „Bildmodell nicht bereit“ bzw. „antwortet nicht (N Fehler in Folge)“, Wiederanlauf höchstens alle 5 Minuten. Scheitert der Aufruf bei einer Person im Standbild oder nachts, geht ein Alarm „ungeprüft, Bildmodell nicht erreichbar“ hinaus. `agent/vision-timing-rules.ts`: eine Zeile je Bewertung mit den Zeitangaben von Ollama.

### Nach dem Gegenlesen ergänzt (25.11.)

Ein unabhängiger Durchgang über den ganzen Stand fand 8 Punkte, einen mittleren und sieben niedrige; alle sind eingearbeitet.

- Alarm-Text auch dann, wenn ein Bild-Versuch über das Ende der 15 Minuten läuft (im Nachbau bei 45 s je Versuch: vorher kein Text, jetzt ein letzter Versuch als Text).
- Beenden des Hubs (höchstens 3 s): Offene Alarme stehen vor dem letzten Versuch in der Liste der nicht zugestellten und werden bei Zustellung wieder ausgetragen. Nach dem Neustart steht „Wächter: 1 Alarm beim letzten Beenden nicht zugestellt“ im Log. Probe mit hängendem Telegram: vorher nach 3 s nichts gespeichert, jetzt steht der Alarm in der Liste; antwortet Telegram nach 0,5 s, ist sie wieder leer.
- Die Knöpfe eines Alarms gelten 10 Minuten ab seiner Zustellung statt ab der Bewertung.
- Zustands-Wächter: Auf der Platte gilt ein Befund erst nach der Zustellung seiner Meldung als gemeldet; endet der Hub vorher, kommen Meldung oder Entwarnung nach dem Neustart erneut (Tests). Ein leerer Stand älter als 24 Stunden gilt still.
- Eine Kennzeichen-Frage aus der Ruhezeit steht im Zählerstand und kommt auch nach einem Neustart am Morgen (vorher erst nach 7 Tagen).
- „lade Modell“ steht beim Wiederanlauf des Bildmodells einmal bis zum nächsten Erfolg im Log, nicht alle 5 Minuten.
- Zweites Gegenlesen dieser Nachbesserungen, 5 Punkte, eingearbeitet: Die Knöpfe eines wartenden Alarms bleiben bis zu 16 Minuten über ihre Frist hinaus in der Liste, damit die Verlängerung bei der Zustellung sie noch findet (vorher nach 10 Minuten weggeräumt); bei mehreren Chats zählt die letzte Zustellung. Ein Alarm, den beim Beenden schon ein Chat erhalten hat, steht nicht mehr als nicht zugestellt in der Liste. Die Zeile „beim letzten Beenden nicht zugestellt“ kommt einmal, nicht bei jedem Neustart der folgenden 12 Stunden. Der Befund zu einem solchen Alarm verweist nicht mehr auf die Zentrale, weil er dort nicht steht. Mit `HUB_AGENT_VEHICLE_ASK=off` geht eine vorgemerkte Kennzeichen-Frage auch nach einem Neustart nicht hinaus.

### Nächster Schritt

- Nach dem Update Log holen: Startzeile mit der richtigen Stunde; 0 Zeilen „aber nachts und ohne Arbeitskleidung“ zwischen 6 und 20 Uhr (vorher 6 in 54 Stunden); Bilanz-Zeilen je Stunde; `camera.sentinel_skip_belegt` und „Auslöser verfallen“ bei 0.
- Zustellung: `camera.sentinel_send_*` gegen die Zeilen „AUFFÄLLIG“ halten, `camera.sentinel_alarm_lost` und „NICHT zugestellt“ bei 0. Nach jedem „Hub startet“ eine Zeile „Zustands-Wächter: Stand von vor N min übernommen“ und keine zweite Meldung zu einem schon gemeldeten Schlüssel.
- Bildmodell: aus den Zeilen „Bildmodell Übersicht …“ Median und p90 bestimmen und danach über die Punkte 2 bis 5 von WAE-5 entscheiden.
- Belegung: nach einigen Betriebstagen die Zeilen „(Probelauf, nichts gesendet)“ gegen den Andrang halten; passen die Schwellen, `HUB_OCCUPANCY_ALERTS=on` setzen.

## 2026-11-25 (Gesamtprüfung Hub und Kamera-Erkennung, Kennzeichen und Tor: Nachtlicht, Fahrzeugliste, Mehrheit, Lichtmodus, Kreise mit Umlaut, DoorBird-Zuweisung)

### Befund

Hub-Log 22.11. 11:58 bis 24.11. 17:42 UTC, Sichtungen ab 13.11.2026, Fahrzeugliste vom 25.11.:
- Nacht: Alle 6 Bursts mit Hub-Licht endeten 1,35 bis 2,31 s nach dem Einschalten mit „nicht mehr aktiv“, ohne ausgewertetes Bild; das Licht brannte 1,6 bis 2,6 s und war danach 5 min gesperrt. Von 35 Bursts im Dunkelfenster liefen 23 ohne Licht und ohne Zeile mit Grund. Keine Sichtung zwischen 17 und 7 Uhr trug ein Kennzeichen (0 von 86).
- 16 von 54 Bursts endeten beim ersten Bild, das Bild wurde ungelesen verworfen. Nach einer Toröffnung nahm der Hub noch 9 bis 16 s Bilder auf; Upload im Median 20,0 s nach Burst-Start.
- Fahrzeugliste ohne Höchstalter. Bei hängender Cloud wartete jedes Bild bis zu 30 s auf einen eigenen Abruf (Versuch: 20 Bilder, 20 Abrufe). Ein Nachladen überschrieb den lokalen Schaltzeitpunkt.
- Mehrheit: Eine einzelne Lesung mit einem Zeichen zu viel (0,82) sammelte fünf richtige Bilder ein.
- Weißlicht: Jeder Schaltbefehl setzte Lichtmodus 1 und eine Helligkeit, beim Ausschalten 100.
- Kreise mit Umlaut: Die Texterkennung liefert nur A bis Z, LÜD, LÜN, BÜR oder GÖ waren in keiner Schreibweise bekannt (1 Lesung ab 0,8 mit Kreis „GO“ verworfen).
- DoorBird: Ohne Zuweisung nahm der Hub die einzige DoorBird, die Telegram-Genehmigung legte Fahrzeuge ohne DoorBird an. Seit 25.11. 08:59 UTC haben alle 14 aktiven Fahrzeuge eine Zuweisung.

Entscheidungen vom 25.11.2026: nachts 7 s Licht, Lichtmodus nicht überschreiben, Kreise mit Umlaut, „Keine Türöffnung“ gilt, Fahrzeugliste ohne Cloud höchstens 7 Tage.

### Änderungen

- `vehicle-light-rules.ts`, `vehicle-burst-rules.ts`, `cameras.ts`: Im Licht-Burst mindestens 8 Bilder (`HUB_VEHICLE_LIGHT_MIN_FRAMES`, 0 = wie bisher); das erste Bild wird nie ungelesen verworfen; Licht aus direkt nach dem letzten Bild; Sperre erst nach 8 ausgewerteten Bildern ohne Kennzeichen und ohne Fahrzeug ab Mindestfläche. „Kennzeichen sicher“ beendet einen Licht-Burst erst ab der Mindestzahl, eine Schaltung zwei Bilder später. Im Dunkeln je Burst eine Zeile „dunkel – Weißlicht an“ oder „kein Weißlicht (Grund)“, ohne zusätzliche Kamera-Abfrage; je Burst eine Endzeile mit Bildzahl und Grund; je Licht-Burst „mit Weißlicht N von M Bildern mit Lesung“.
- Mehrheit: Eine längere Lesung bekommt die Bilder der kürzeren nur, wenn sie selbst auf mindestens 2 Bildern oder so vielen wie die kürzere steht; Abweichungen von der früheren Regel stehen im Log (`alpr.consensus_longer_single`). Einzelbilder unter 0,95 ohne Mehrheit werden nur gezählt (`alpr.single_weak`).
- `whitelist-rules.ts` (neu), `plate.ts`, `vehicle-actuate.ts`: ein gemeinsamer Abruf mit 8 s Frist, alle Bilder warten zusammen höchstens 1,5 s, nach einem Fehler 60 s nicht; Cache mit Zeitpunkt des letzten gelungenen Abrufs; Fehler mit Ursache und Alter im Log; der neuere Schaltzeitpunkt je Fahrzeug bleibt (Werte über 5 min in der Zukunft zählen nicht). Nach `HUB_WHITELIST_MAX_AGE_H` (Standard 168) ohne gelungenen Abruf öffnet kein Kennzeichen mehr, auch nicht ersatzweise über die Cloud; Befund an die Cloud (Push und Telegram), sobald sie erreichbar ist, Entwarnung beim ersten Abruf.
- `spotlight-rules.ts` (neu), Kiosk `webcams/lib/spotlight-param.ts`, Steuerzentrale und Kiosk-Bedienfeld: Schalten ändert nur an und aus, Lichtmodus und Helligkeit gehen so zurück, wie die Kamera sie meldet. Ohne lesbaren Stand der frühere Befehl mit stündlicher Zeile (`camera.spotlight_fallback`); `HUB_SPOTLIGHT_LEGACY` bzw. `WEBCAMS_SPOTLIGHT_LEGACY` stellt ihn ganz her.
- `plate-cities.ts`, `plate-match.ts`, Cloud `src/lib/plate-match.ts`, `src/lib/vehicles.ts`: 30 Kreise mit Umlaut werden ohne Umlaut gelesen erkannt und mit Umlaut angezeigt; ein Listen-Eintrag mit Umlaut trifft die Lesung ohne Umlaut nur bei allen Zeichen gleich, genau einem passenden Eintrag und ohne mögliche Verwechslung mit einem anderen Kreis. Hub und Cloud prüfen dieselben 21 Fälle.
- `vehicle-actuate-rules.ts` (neu), `agent/vehicle-approval-rules.ts` (neu), Cloud `allowed-vehicle-service.ts` und POST `/api/hub/allowed-vehicles`: Das Tor öffnet nur die zugewiesene DoorBird (`HUB_DOORBIRD_FALLBACK` stellt den Rückfall her); ohne DoorBird und ohne Shelly eine Zeile je Fahrzeug und Stunde (`alpr.no_actuator`). Die Telegram-Genehmigung schickt bei genau einer DoorBird deren ID mit und verspricht das Öffnen nur, wenn die Cloud sie bestätigt. Lieferdienst, Aufträge aus der Cloud und Offenhalten bleiben unverändert.
- Upload-Zeile mit gesendeter und Original-Größe, Warnung über 4 MB.
- Gegengelesen aus zwei Blickwinkeln (11 Punkte, 10 behoben), danach Stand von main zusammengeführt und die Nachbesserungen noch einmal gegengelesen (7 niedrige Punkte, 6 behoben): Quelle des Befunds „Fahrzeugliste zu alt“ je Hub, damit ein zweiter Hub ihn nicht schließt; nach einer Zeitüberschreitung gilt sein Stand als unbekannt, die Entwarnung geht vorsorglich hinaus; Push-Texte nennen bei Befunden des Hubs nicht mehr die Netzwerk-Prüfung; eine vorgemerkte Kennzeichen-Frage lädt vorher die Kamera-Liste; ein Schaltzeitpunkt mehr als 5 min in der Zukunft sperrt das Fahrzeug nicht; „Shelly zugewiesen“ gilt nur mit IP-Adresse oder Shelly-Cloud-Daten. 651 Hub-Tests, 650 grün, 1 übersprungen.

### Nächster Schritt

Nach einer Woche Betrieb am Hub-Log zählen:
- Bursts im Dunkeln: Zeilen „dunkel – Weißlicht an“ und „kein Weißlicht (…)“ zusammen gleich der Zahl der Bursts im Dunkeln (vorher 23 von 35 ohne Angabe); der gemeldete Lichtmodus soll über eine Nacht gleich bleiben, `camera.spotlight_fallback` bei 0.
- Nutzen des Lichts: `alpr.light_frames` und Sichtungen 17 bis 7 Uhr mit Kennzeichen (vorher 0 von 86). Bleiben beleuchtete Bilder ohne Lesung, `HUB_SPOTLIGHT_LEGACY=1` versuchen und den Lichtmodus in der Reolink-App prüfen.
- `alpr.first_frame_seen` gegen `alpr.first_frame_empty` (vorher 16 von 54 verworfen); „geschaltet (Frame n)“ und Abstand Öffnung bis Upload (vorher Median 20 s).
- `alpr.consensus_longer_single` und `alpr.single_weak`, danach über Einzelbilder unter 0,95 entscheiden.
- `alpr.whitelist_stale` und `alpr.no_actuator` bei 0; nach einer Telegram-Genehmigung „genehmigt (DoorBird 11)“ im Log.
- Nachts `alpr.burst_end_error` beobachten: Bricht ein Licht-Burst regelmäßig vor dem 8. Bild ab, greift die 5-Minuten-Sperre des Lichts nicht; dann nach zwei solchen Bursts in Folge sperren.
- Danach: Sperrzeit eines Fahrzeugs auch setzen, wenn die Cloud ersatzweise geöffnet hat; erst dann die 60-s-Regel aus den Schalt-Pfaden nehmen.

## 2026-11-25 (Gesamtprüfung Hub und Kamera-Erkennung, Wächter zweite Runde: Bewertung einer Person, ein Alarm mit einem Ton, Einstellung je Kamera, ein Meldeweg in der Nacht, Zeit des Bildmodells)

### Befund

Grundlage: dieselben 54 Stunden Hub-Log (148 Personen-Entscheidungen, 132 Alarme), CameraEvent und die Sichtungen der Cloud ab 11.11.2026, Log vom 25.11. 11:21 bis 11:28 Uhr für die Zeitmessung.

- **„Verhalten wirkt verdächtig“** (WAE-7): 26 von 148 Personen-Entscheidungen (17,6 %), alle zwischen 07:19 und 21:30 Uhr; Halle 2 6 von 12, Übungslift 4 von 6, Drehkreuz 4 von 5. Anlässe: Tasche, Rucksack, Kisten, Karton, Heizkörper, Teller, Gießkanne, Einkaufswagen, Kapuze; rund 6-mal „hantiert an Tür“. Bei 3 der 26 lag ein Whitelist-Treffer vor.
- **Gesicht als Entwarnung** (PERS-3): 7 Entwarnungen mit Scores 0,469 bis 0,686 (4 unter 0,60, 3 davon mit 2 Personen im Bild). Fremde Nicht-Treffer erreichten hochgerechnet bis 0,526 und direkt bis 0,447. Es galt ein Fenster von 90 s vor dem Auslöser, je Kamera zählte nur der letzte Treffer.
- **Ein Blick in der Nacht** (WAE-3): Von 14 PERSON-Ereignissen zwischen 21 und 5 UTC wurden 11 angesehen, 6 davon nach einem Bild als „unauffällig“ abgelegt. Bei 5 von 34 Tracker-Gegenchecks lag an derselben Kamera ein Gesichts-Fund im Fenster.
- **Nachrichten** (WAE-10): Je Alarm zwei bis vier Foto-Nachrichten mit Ton, bei 132 Alarmen mindestens rund 257. Beide Nacht-Alarme sahen aus wie Tages-Alarme. Die Knöpfe lagen nur im Speicher; in 54 h wurde keiner ausgeführt, verfallene Tipps standen nicht im Log.
- **Kamera Eingang** (WAE-2): 73 der 132 Alarme, fast alle tagsüber (60-mal „Niemand eingestempelt“, Spaziergänger auf dem Uferweg). Eine Einstellung je Kamera gab es nicht.
- **Zwei Meldewege** (WAE-13): Die Cloud-Überwachung meldet 22–7 Uhr an 11 Kameras parallel zum Wächter. Push und Telegram schrieben die ganze Sperrzeit-Map zurück und überschrieben sich: an einer Kamera 5 Sichtungen in 14 min, das zweite Foto schon nach 2:53 min; an einer anderen der Telegram-Schlüssel einen Monat alt.
- **Raumdaten ohne Alter** (WAE-11): Ein Raum mit Saison Mai bis September hing am letzten Stand; an einer Kamera 117 PERSON-Ereignisse ohne Bewertung, danach 245 Wächter-Zeilen.
- **Zeit des Bildmodells** (WAE-5): Übersicht 18 bis 27 s bei 517 bis 1.474 Antwort-Token, Nahaufnahme 42 bis 83 s bei 3.268 bis 5.012 Token, einmal Abbruch nach 120 s. Erwartet sind 60 bis 300 Token JSON. Laut Ollama-Bibliothek ist `qwen3-vl:8b` die Thinking-Ausgabe (gleicher Digest wie `qwen3-vl:8b-thinking`), die Instruct-Ausgabe heißt `qwen3-vl:8b-instruct` (6,2 GB).

Entscheidungen vom 25.11.2026: Kamera Eingang nur nachts bewachen (E01), „verdächtig“ enger fassen (E03), ein Alarm = eine Nachricht mit Ton (E04), nur ein klarer Gesichtstreffer entwarnt (E05), nachts meldet an bewachten Kameras nur der Wächter (E06), Meldung „wird voll“ an (E07).

### Änderungen

- **Bewertung einer Person** (`agent/sentinel-rules.ts`, `sentinel.ts`, `people.ts`, `cameras.ts`, Tests):
  - Die Nahaufnahme fragt `handlung` mit festen Werten ab; Rucksack, Einkaufstasche, Kapuze oder Mütze bei Kälte und Hund an der Leine gelten als „keine“. Klettern, Tür/Fenster/Schloss, Verstecken, das alte `verdaechtig: ja` und nicht zuordenbare Werte geben immer Alarm, der Grund nennt die Handlung.
  - „Trägt etwas“ gibt keinen Alarm nur bei starkem Gesicht und höchstens einer Person, bei Freigabe aller Personen im Bild oder bei tagsüber passend eingestempeltem Personal. Eine Vermummung entlasten nur Freigabe oder Personal am Tag, bei genau einer Person, kein Gesicht.
  - Ein Gesicht entwarnt allein nur ab 0,60 ohne Hochrechnung oder ab 0,70, bei höchstens einer Person (Fenster 10 s vor dem Auslöser, der stärkste Treffer zählt). Ein schwacher Treffer braucht ein zweites Signal, der Grund lautet „Vermutlich bekannt (Score …)“ ohne Namen und ohne neue 8-h-Freigabe. Die Sperrliste zählt weiter ab 90 s und gewinnt immer. Das Hub-Ereignis trägt `upscaled`.
  - Nachts gilt „unauffällig“ bei PERSON erst, wenn der Tracker auf dem ersten Bild und auf Standbildern 3 s und 8 s danach niemanden sieht (parallel zum Bildmodell). Das Tracker-Veto und „Nahaufnahme leer“ gelten nicht, wenn die Gesichtserkennung ab 90 s vor dem Auslöser ein Gesicht gemeldet hat; gewartet wird höchstens 30 s, mit fester Rundenzahl.
- **Nachrichten** (`agent/telegram.ts`, `outbox.ts`, `outbox-rules.ts`, `dispatch.ts`, `alarm-rules.ts` neu):
  - Nur die Nahaufnahme mit Text und Knöpfen kommt mit Ton, Übersicht und Folgebilder still. Ist der Alarm in einem Chat gescheitert, klingelt dort genau ein Bild.
  - `alarmLevel`: nachts (auch bei nicht lesbarer Stunde), gesperrte Person oder harte Handlung beginnen mit „‼️ DRINGEND (Grund)“; Zähler `camera.sentinel_alarm_dringend`.
  - Knöpfe tragen Kamera und Sekunde des Versands (`cam:<id>:spot:<s>`), gelten nach einem Neustart: Neues Bild unbegrenzt, Licht an 60 min, Sirene 10 min. Licht und Sirene schalten je Alarm einmal, ein zweiter Tipp bekommt „Schon ausgeführt“. Abgelaufene Tipps stehen im Log.
- **Einstellung je Kamera**: Cloud-Spalte `Camera.sentinelMode` (Migration `20261125080000_camera_sentinel_mode`, additiv) mit „wie der Raum“ (Standard), „nur nachts“, „aus“; wählbar unter Kameras und im Hub-Dashboard. `agent/sentinel-mode-rules.ts`: „nur nachts“ gilt auch mit `HUB_AGENT_SENTINEL=always` nur im Nachtfenster, „aus“ nie; jede Abweichung und Änderung steht im Log.
- **Belegung**: `HUB_OCCUPANCY_ALERTS` ohne Angabe = on; `shadow` und `off` bleiben wählbar.
- **Ein Meldeweg in der Nacht**:
  - Cloud `src/lib/surveillance-cooldown.ts`, `surveillance.ts`: Sperrzeit atomar in einem UPDATE je Schlüssel; Push und Telegram werden abgewartet, Telegram an alle Chats gleichzeitig (`surveillance-send.ts`); `/api/hub/person-sightings` und `/api/hub/vehicle-sightings` haben 30 s Laufzeit.
  - Der Hub meldet mit dem Lebenszeichen die Kameras, deren aktuelle Person der Wächter wirklich bewertet (`agent/sentinel-cover-rules.ts`, `cameraDuty`; eine Bewertung ohne Ergebnis zählt höchstens 5 min). Nicht in der Liste: Sperrzeit nach einer Bewertung, wartender Auslöser, belegte Plätze, Stundenlimit, Bildmodell nicht bereit, gestörte Telegram-Zustellung (auch nach einem Uhrsprung), anstehender Update-Neustart, Takt seit 30 s still.
  - Beleg je Sichtung: Der Hub hängt `sentinel=1` an den Upload, wenn der Wächter genau diese Person gerade bewertet oder gemeldet hat (`vouchFor`, `vouchParam`, `hub/src/sentinel-vouch.ts`), nie bei einem Treffer der Gallery. Die Cloud schweigt nur mit Beleg und einer Liste bis 2 min alt, die die Kamera nennt; gesperrte Personen und Fahrzeuge meldet sie immer. Ab Werk ist das aus (`HUB_SENTINEL_CLOUD_QUIET`): Die Cloud meldet wie früher selbst, der Zähler `face.sighting_sentinel_beleg_aus` zählt, wie oft sie geschwiegen hätte. Log-Kürzel `[surveillance hub-waechter]`, Zähler `HubAgent.status.sentinelMuted`.
  - Lebenszeichen laufen nacheinander. Der Update-Neustart meldet vorher eine leere Liste und wartet höchstens 3 min auf laufende Bewertungen. Kennzeichen-Fragen laufen neben dem Takt des Wächters (Puffer 300 Ereignisse) und halten ihn nicht mehr an.
- **Raumdaten**: `nextOperatingChange` und Öffnungsspannen in `src/lib/operating-hours.ts` (auch an der doppelten Stunde im Oktober), `GET /api/hub/rooms` liefert `nextChangeAt` und `spans`. Ein veralteter Stand gilt bis zum nächsten Wechsel, danach wird bewacht bzw. das Nachtfenster gilt (`agent/sentinel-rooms-rules.ts`). Abruf-Fehler einmal je Grund im Log, ab 30 min Befund „Raumdaten seit N min alt“; jeder Wechsel der Bewachung im Log, Tagesvorschau mit „Heute bewacht: …“.
- **Zeit des Bildmodells** (nur messen): Die Zeitzeile nennt je Aufruf Zeichen des Antworttexts, Leerraum, Länge eines Denktexts und `done_reason`. `HUB_AGENT_VISION_NUM_PREDICT` ist vorbereitet (Standard keine Grenze; ein Abbruch an der Grenze zählt als Fehler des Bildmodells, Zähler `camera.sentinel_model_cut`). Modell und Prompts unverändert.
- Gegengelesen aus zwei Blickwinkeln (17 Punkte, 16 behoben, einer begründet belassen: Vermummung mit erkanntem Gesicht gibt weiter Alarm), danach zweimal die Nachbesserungen mit dem Stand von main (9 und 4 Punkte; daraus Beleg je Sichtung, Schalter ab Werk aus, Kennzeichen-Fragen neben dem Takt, Knöpfe und Zustellung bei Uhrsprung). Alarm-Knöpfe: ein zweiter Tipp während des Schaltens bekommt „Wird gerade ausgeführt …“, ein Fehlschlag geht an alle Chats, die getippt haben. 774 Hub-Tests, 773 grün, 1 übersprungen.

### Nächster Schritt

- Nach dem Deploy bei der Kamera Eingang „Wächter: Nur nachts“ wählen; im Hub-Log muss die Änderung stehen, danach zwischen 6 und 22 Uhr 0 Alarme dieser Kamera (vorher 36 bis 37 je Tag).
- Eine Woche Hub-Log: Anteil „Verhalten wirkt verdächtig“ (vorher 17,6 %, Ziel unter 5 %), Werte der Zeile „Handlung …“, vor allem „unklar“ (über 2 % heißt Wortliste nachschärfen); „kein Alarm – Gesicht erkannt“ mit kleinstem Score ab 0,60; `sentinel_second_look_*`, `sentinel_tracker_face`, `sentinel_calm_face`; Nacht-Alarme je Nacht.
- Zustellung: je Alarm genau ein Ton (Probe am Handy), `camera.sentinel_alarm_dringend` gegen die Alarme 22–6 Uhr, Knopf-Tipps gegen „Erledigt“, „abgelaufen“ und „nicht erneut ausgeführt“.
- Meldeweg (Schalter aus): eine Woche `face.sighting_sentinel_beleg_aus` gegen `_gelistet_ohne_beleg` und die Wächter-Alarme halten; Zeilen „selbst meldet die Cloud an“ und „Telegram-Zustellung gestört“; mehr als 10 Wechsel der Liste je Nacht heißt flattern. Vor dem Einschalten von `HUB_SENTINEL_CLOUD_QUIET`: Die Cloud soll erst schweigen, wenn der Hub das Ergebnis der Bewertung zu dieser Sichtung bestätigt hat, und sonst nach kurzer Frist selbst melden. Danach je Nacht Zeilen `[surveillance hub-waechter]` im Cloud-Log, je Zeile eine Bewertung im Hub-Log.
- Belegung: Startzeile „Meldungen an (Standard; …)“; steht `HUB_OCCUPANCY_ALERTS=shadow` in der `.env`, bleibt der Probelauf.
- Bildmodell: ein bis zwei Tage Zeitzeilen auswerten; viele Token ohne Zeichen oder ein Denktext heißt, den Wechsel auf `qwen3-vl:8b-instruct` entscheiden (vorher `ollama pull`). Erwartet: Auslöser bis Urteil im Median unter 30 s (heute rund 68 s). Erst danach `HUB_AGENT_VISION_NUM_PREDICT` als Sicherheitsnetz setzen.

## 2026-11-25 (Gesamtprüfung Hub und Kamera-Erkennung, Personen-Ablauf: Bildserie, Rückfahrt des Zooms, Übergabe an die Handsteuerung, Zoom nur wenn nützlich, Folgen nur bei geschlossenem Raum, Bildgröße, Wiederholungen zählen)

### Befund

Grundlage: 54 Stunden Hub-Log, Gegenprüfung am Stand c17f98f, Sichtungen der Cloud ab 11.11.2026.

- **Bildserie endet beim ersten Aussetzer** (PERS-13): 247-mal „übersprungen (nicht mehr aktiv …)“ bei rund 663 Pipeline-Starts (37 je 100), davon 49 vor dem ersten Bild und 56/85/57 nach Versuch 1/2/3. 81 der 247 trafen ein weiterlaufendes Ereignis. Vor dem ersten Bild wartete die Pipeline 1 s, und sie schrieb ihren Roh-Zustand in `cam.states`, aus dem die Abfrage die Flanken erkennt. Signal bis erster Upload (n = 301): Median 9,2 s, p90 19,3 s, Maximum 86 s. Gesicht bei Versuch 1: 195 von 292. Zusatzbilder hatten 15 s Zeitlimit.
- **Zoom kann hereingezoomt stehen bleiben** (PERS-7): Die Rückfahrt wurde genau einmal versucht und die Ausgangsstellung danach gelöscht, auch aus der Datei für den Neustart. Lief schon das Hineinzoomen ins Zeitlimit, galt die Kamera als „nicht bewegt“. Nach Hand während der Nahaufnahme fuhr nach der Sperre niemand zurück. Im Log 0 Vorkommen; betroffen wären vor allem die Zonen-Kameras Eingang und Halle 2.
- **Wettlauf mit der Handsteuerung** (PERS-14, Teil 1): Kam die Hand, während Grundstellung und Tracking gelesen wurden, schaltete der Hub das Folgen trotzdem ein; die Kamera lief dem Bediener bis zu 120 s davon.
- **Optischer Zoom für Gesichter** (PERS-8): 19 Fahrten mit Faktor ×1,2 bis 2,4 (18 davon höchstens ×1,6), danach 0 Treffer, alle besten Werte höchstens 0,355. 15-mal `closeup_skip` gegen 3 echte Nahaufnahmen; der Wächter am Eingang sah 71-mal digital und 3-mal optisch.
- **Folgen** (PERS-14, Teil 2): 201 Starts (Gastro 94, Shop 73, Übungslift 34). Treffer mit Folgen 9 von 135, ohne Folgen 8 von 214.
- **Bildgröße** (PERF-4): Am Eingang im Mittel 838 KB je Sichtungsbild, 47 % aller Bytes, im Mittel 75 MB pro Tag.
- **Wiederholungen** (PERS-9/PERF-5): 2.181 Sichtungen; 27 % folgten binnen 90 s auf die vorige an derselben Kamera, 46 % binnen 3 min (zusammen 465 MB), 58 % binnen 5 min. In 23 von 27 erkannten Paaren war es dieselbe Person.

Entscheidungen vom 25.11.2026: Wiederholungen derselben Person nicht speichern, erst eine Woche zählen (E13), Zoom-Fahrt nur wenn nützlich (E14), Schwenk-Kameras folgen nur bei geschlossenem Raum (E15), Personenbilder 1280 px (E16).

### Änderungen

- **Bildserie** (`person-pipeline-rules.ts` neu, `cameras.ts`, Tests):
  - Erstes Bild sofort, vor den Versuchen 2 bis 4 weiter 1,2 s Abstand.
  - `pipelineShouldStop`: Abbruch erst nach 4 s ohne PERSON (Zähler `face.signal_gap`). Mitgezählt wird die letzte reguläre Abfrage mit Person (`nextLastActiveAt`). Die Pipeline schreibt nicht mehr in `cam.states`.
  - Zusatzbilder mit 5 s Zeitlimit, `face.skip_inactive` mit Feld `after`. Vorrang des Kennzeichen-Bursts unverändert.
- **Rückfahrt des Zooms** (`camera-motion.ts`, `camera-motion-rules.ts`, `cameras.ts`, Tests):
  - Die Ausgangsstellung bleibt bis zur gelungenen Rückfahrt gemerkt, auch in `.cache/camera-motion.json` (ein älterer Hub liest die Datei weiter). `tick()` versucht es alle 30 s über die Warteschlange der Kamera; nach dem ersten und 10 weiteren Fehlversuchen Hub-Ereignis „Zoom steht nicht in Grundstellung“. Bleibt nur die Antwort aus, liest der Hub die Stellung; steht sie auf der Ausgangsstellung, ist die Rückfahrt erledigt (`camera.zoom_restore_unconfirmed`).
  - Der Zoom gilt schon vor dem ersten Befehl als verstellt; Abbruch-Check direkt vor dem Hineinzoomen.
  - Nach Hand oder Regel bleibt der Zoom während der Sperre stehen und fährt danach zurück, wenn er noch auf einer Position der Automatik steht (`shouldRestoreZoom`), sonst „Zoom inzwischen verstellt … – bleibt so“. Die Wartezeit übersteht einen Neustart.
  - Solange eine Rückfahrt aussteht, gibt es keine neue optische Nahaufnahme; Halteverbot und Parkfläche warten über `atHome()`. Der Kennzeichen-Burst wartet nur auf laufende Bewegung (auch einen gerade unterwegs befindlichen Versuch der Rückfahrt) und den Fokus (`settled`), höchstens 3 s.
  - Zähler `camera.zoom_restore_retry`, `_ok`, `_skip`, `_fail`.
- **Übergabe an die Handsteuerung**:
  - Sperre unmittelbar vor dem Einschalten des Trackings erneut geprüft (`follow.start_blocked`), `takeOver` über die Warteschlange der Kamera. CAMERA_PTZ, CAMERA_ZOOM und die Regel „Kamera steuern“ warten nur, solange das Tracking des Hubs an ist oder gerade eingeschaltet wird, die Hand höchstens 2 s (`HAND_HANDOVER_MAX_MS`, `camera.hand_handover_late`).
  - Die Regel schickt Preset und Tracking über die Befehls-Warteschlange der Kamera (nie gleichzeitig mit Grundstellung oder Zoom, sonst -13). Kommt Hand oder Regel, während ein Folgen endet, fährt der Hub nicht mehr in die Grundstellung (`follow.home_skip_hold`).
  - Bleibt beim Einschalten des Trackings die Antwort aus, liest der Hub den Zustand; an oder unbekannt gilt als Folgen (`follow.start_unconfirmed`). Lässt es sich nicht ausschalten und meldet die Kamera nicht „aus“, bleibt das Folgen gemerkt, auch über einen Neustart; alle 30 s ein gezählter Versuch (ein zusätzlicher bei einem Befehl von Hand zählt nicht), nach zehn das Hub-Ereignis „Tracking lässt sich nicht ausschalten“ (`follow.off_retry`, `follow.off_fail`). Während der Sperre einer Regel versucht der Hub es nicht; liest die Regel den Zustand, gehört das Tracking ihr, und sie behandelt ein „an“ als vom Hub (`follow.handed_rule`). Nach einem Neustart warten Regeln, bis die Kameras zurückgestellt sind.
- **Zoom nur wenn nützlich** (E14): `opticalWorth`: Fahrt für ein Gesicht nur, wenn Größe × Faktor mindestens 64 px ergibt, ohne bekanntes Gesicht ab Faktor 2 (`camera.closeup_skip_face`). Nach einer Planung ohne Fahrt 15 s Pause an jeder Kamera; der 2-min-Abstand der Zonen-Kameras zählt ab einer Fahrt, ohne Fahrt kein neuer Fokus-Zeitpunkt. Die Nahaufnahme des Wächters bleibt (Faktor ab 1,3), ein Gesichtsverzicht sperrt ihn nicht. Das optische Gesicht ersetzt das bisherige nur bei Treffer oder besserer Güte (`takeOpticalFace`, `face.optical_kept`); `faceViaZoom` nutzt die Personenboxen der Nahaufnahme.
- **Folgen nur bei geschlossenem Raum** (E15): `followRoomBlocked`; den Raumzustand liefert der Wächter (`camera-room.ts`, ohne Import-Zyklus), unbekannt heißt Nachtfenster des Wächters (`HUB_AGENT_SENTINEL_NIGHT`, Standard 22-6). Rückschalter `HUB_FOLLOW_ALWAYS` (ab Werk aus). Zähler `follow.skip_open`, `follow.start` mit `room`.
- **Bildgröße** (E16): `image-rules.ts` neu, Sichtungsbilder 1280 px mit Qualität 75, auch von der DoorBird (`HUB_PERSON_SNAPSHOT_MAX_PX` 640 bis 3840, `HUB_PERSON_JPEG_QUALITY` 50 bis 95; 1600 und 82 = früherer Stand). Übrige Bilder bleiben bei 82, die Gesichtserkennung arbeitet weiter mit dem Original.
- **Wiederholungen zählen** (E13): `shouldStoreSighting` in `face-rules.ts`: dieselbe erkannte Person an derselben Kamera binnen 5 min, oder ein unbekanntes Gesicht mit Kosinus ab 0,5 zu einem Upload der letzten 10 min, das nicht mindestens 1,3-fach besser ist. Ausnahmen: gesperrte Personen und 22 bis 7 Uhr nach der Uhr des Hubs. `HUB_SIGHTING_REPEAT=count` (Standard) lädt jede Sichtung hoch und zählt nur (`face.repeat_known`, `_unknown`, `_exempt` mit `gapS` und `sim` in improve.jsonl), `skip` lässt Wiederholungen weg, `off` wertet nicht aus (`sightingAction`).
- **Wächter**: Die Log-Zeile zur Liste der bewachten Kameras richtet sich nach `HUB_SENTINEL_CLOUD_QUIET`; ab Werk „… – die Cloud meldet unbekannte Personen weiter selbst (HUB_SENTINEL_CLOUD_QUIET aus)“.
- README und `.env.example`. Gegengelesen aus zwei Blickwinkeln (10 Punkte, 9 behoben, bei einem nur die Beschreibung korrigiert), danach die Nachbesserungen unabhängig geprüft (4 Punkte: 3 behoben, die Einheit der Gesichtsgröße im Gesichts-Dienst vereinheitlicht das Paket Gesichts-Qualität; danach 6 weitere zum gemerkten Tracking, zur Übergabe an eine Regel und zum Neustart, behoben). 872 Hub-Tests, 871 grün, 1 übersprungen.
- Simulation gegen den Ausgangsstand: erstes Bild 0,0 statt 1,0 s nach dem Signal; Flackern eine Pipeline mit 4 Bildern statt Abbruch und zweiter Pipeline; Zoom-Störungen Endstellung 0 statt 12; Rückfahrt ohne Antwort und danach Fahrzeuge: Burst sofort mit 12 Bildern (Basis 13); Hand während des Folge-Starts: kein Tracking, Befehl sofort; Burst-Beginn im Szenario „Person vor Fahrzeug“ unverändert.

### Nächster Schritt

- Bildserie, eine Woche Hub-Log: `face.skip_inactive` je 100 Pipeline-Starts (vorher 37, Ziel unter 25) und die Verteilung von `after`; Anteil „Gesicht bei Versuch 1“ (vorher 67 %; fällt er an den Schwenk-Kameras deutlich, dort den Vorlauf wieder einführen); Signal bis Upload, Median und p90 (vorher 9,2 und 19,3 s).
- Zoom: Zeilen „Zoom zurück (Versuch …)“, „Zoom wieder in der Ausgangsstellung“, „Zoom inzwischen verstellt“ und das Hub-Ereignis „Zoom steht nicht in Grundstellung“ (erwartet 0 bis wenige je Woche); `camera.zoom_restore_fail` größer 0 heißt Kamera am Gerät prüfen. `face.optical_match` gegen `face.optical` (bleibt es bei 0, den Gesichts-Zoom ganz abschalten), `camera.closeup_skip_face` mit `size` und `gain` (danach 64 px prüfen), am Eingang optische gegen digitale Nahaufnahmen des Wächters (vorher 3 gegen 71) und `camera.closeup_skip` je Stunde.
- Folgen und Hand: `follow.start` nach `room` und `follow.skip_open` je Kamera (deutlich weniger als 201 Starts tagsüber), `follow.start_blocked`, `camera.hand_handover_late` Ziel 0; `follow.start_unconfirmed`, `follow.off_retry`, `follow.off_fail`, `follow.handed_rule` und `follow.home_skip_hold` (erwartet 0 bis wenige je Woche).
- Bildgröße: mittlere Größe der Sichtungsbilder je Kamera in der Cloud, Ziel am Eingang deutlich unter 838 KB, gesamt unter 75 MB pro Tag.
- Wiederholungen: `face.repeat_*` mit `gapS` und `sim` je Kamera. Liegen `repeat_known` und `repeat_unknown` bei 40 bis 58 % der Sichtungen und zeigt eine Stichprobe dieselbe Person, `HUB_SIGHTING_REPEAT=skip` entscheiden (Ersparnis rund 46 % der Bytes). Vorher klären: Das Überwachungsfenster der Cloud ist einstellbar (Voreinstellung 22 bis 8 Uhr) und lässt sich von Hand scharf schalten, der Hub kennt beides nicht; dafür den Zustand der Cloud additiv an den Hub geben. Außerdem hängen Auslösen und Melden bei Erkennung in der Cloud am Upload.
- Offen zur Bestätigung: Rückfahrt des Zooms nach Handsteuerung (weicht vom Plan vom 06.11.2026 ab); an Schwenk-Kameras fährt danach nur der Zoom zurück, nicht der Schwenk.

## 2026-11-25 (Gesamtprüfung Hub und Kamera-Erkennung, Gesichts-Qualität: kleine Gesichter aus dem Originalbild, bestes Bild der Serie, Galerie lernt nur aus guten Treffern, Log-Zeilen)

Entscheidungen des Betreibers vom 25.11.2026: E17 „kleine Gesichter aus dem Originalbild an“ und E10 „Galerie lernt nur noch aus guten Treffern: nur bei klarem, nicht hochgerechnetem Gesicht ab 64 Pixeln, bei gesperrten Personen nie von selbst; der Bestand wird nicht automatisch gelöscht“.

**Befund**

- PERS-1: Der Gesichtsdienst verkleinert jedes Bild über 1920 px und schneidet kleine Gesichter (rescue_zoom, small_keep, ROI-Zoom) aus dem verkleinerten Bild aus. Im Hub-Log (54 h): 2.447 Anfragen, 280 rescue_zoom (Median 31,9 px im Original, 141 unter 32 px), 235 small_keep, 390 von 670 Zoom-Versuchen ohne Treffer. Verloren geht die Auflösung bei den Merkmalen: Im Labor lag die eigene Ähnlichkeit bei 4K und 24 px bei 0,46 statt 0,58, bei 32 px bei 0,59 statt 0,70; 24-px-Gesichter wurden nie erkannt. Betroffen sind vor allem die 4K-Kameras (Eingang, Halle 2); bei 2560 bis 2880 px gehen nur 17 bis 33 % der Kantenlänge verloren. Die Suche selbst hängt nicht daran (InsightFace sucht ohnehin mit 960 px).
- PERS-6: faceQuality setzte fehlende Frontal- und Schärfewerte mit 1,0 an. small_keep lieferte beide nicht und gewann so 36 von 41 Vergleichen gegen ein Rescue-Gesicht. Die Größe von small_keep stand im Suchbild, die anderer Sorten im Kamerabild.
- PERS-2: Die Cloud lernte nach jedem Treffer ab Score 0,50 ein Sample dazu (bis 20 je Person, Ähnlichkeit unter 0,8), ohne die Güte des Gesichts zu kennen, auch bei gesperrten Personen. Galerie: 107 Samples, davon 64 selbst gelernt (kleinster Score 0,515, Median 0,592, 36 unter 0,60). 249 Treffer in 14 Tagen, Median 0,60; gelernt wurde aus 37. Auch die Zuordnung von Hand übernahm Merkmale ohne Güteprüfung.
- PERS-11: Log-Zeilen sagten „klares Gesicht“ ohne Sorte und Größe, die Upload-Zeile nannte die Originalgröße statt der gesendeten, der Beinahe-Treffer-Hinweis zählte hochskalierte Gesichter mit und riet zum Senken der Schwelle. Die README nannte CoreML, der Dienst rechnet auf der CPU.

**Änderungen**

Hub, Gesichtsdienst (`hub/face/server.py`):
- Schalter `FACE_NATIVE` (on, shadow, off; Standard on). Bei Bildern über 1920 px rechnen Rescue-Zoom, small_keep und ROI-Zoom aus dem Original (Landmarken ins Original übertragen, ausgerichtet, Merkmal). In on gilt das neue Merkmal, das bisherige geht als `embedding_scaled` mit; in shadow umgekehrt (`embedding_native`). `compared` nennt den zweiten Weg.
- Findet der Weg über das Original kein Gesicht, gilt in on für dieses Bild der bisherige (Zähler `face.native_face_old`). Scheitert er, trägt die Antwort `native_error` (Zähler `face.native_error`): in on gilt der bisherige Weg ohne Vergleich, in shadow fällt nur der Vergleich weg.
- 0, false, aus, no, nein schalten ab; 1, true, an, ein, ja, yes gelten als on; ein unbekannter Wert gilt als on mit Hinweiszeile. Die Stufe steht in der Startzeile und in /health.
- `upscaled` und alle Schwellen bleiben wie bisher.
- small_keep liefert frontal und sharp. `size` steht für jede Sorte in Pixeln des Kamerabilds, `size_scaled` im Suchbild.
- Mehrzeit: Beide Wege laufen für jedes Bild über 1920 px ohne direkt gefundenes Gesicht, auch ohne jedes Gesicht. Labor 4K ohne Gesicht: 1,2 s mit 7 Detektor-Aufrufen (off) gegen 1,5 bis 1,6 s mit 9 (on).

Hub, Auswertung (`hub/src/face-rules.ts`, `face.ts`, `cameras.ts`, `doorbird.ts`, `improve-log.ts`, `person-crop.ts`):
- faceQuality: fehlende Frontal- oder Schärfewerte zählen 0,5, small_keep wird mit 0,25 gewichtet.
- compareWays, fuseOther, oneWayFaceCounter, otherOnlyVerdict: Zähler `face.native_same`, `native_new_only`, `native_old_only`, `native_other_person`, `native_face_old`/`native_face_new` (und `_match`). Eine Log-Zeile „Gesichts-Vergleich: …“ nur bei abweichendem Ergebnis, mit beiden Bestwerten, Schwelle und Listenart, ohne Namen. In einer Serie wird jedes Bild nach seiner Rolle zugeordnet.
- Im Zweifel Alarm: Trifft in Stufe on nur das bisherige Merkmal eine Person der Sperrliste, gilt dieser Treffer samt Merkmal (noteOtherWay, appliedScore, Zähler `face.native_blacklist_kept`), auch bei der Prüfung vor dem Zoom und bei der Nahaufnahme.
- Gemittelte Serie: Gemittelt wird wie bisher über alle Bilder derselben Person, die Schwelle richtet sich nach dem besten Bild. Steckt ein hochgerechnetes Bild im Merkmal, meldet das Hub-Ereignis die Sichtung dem Wächter als hochgerechnet (strengere Entwarnung).
- Mit jeder Personen-Sichtung (Kameras und DoorBird) gehen `faceSize`, `faceUpscaled`, `faceDetScore` und `faceMargin` (Abstand zur zweitbesten Person, galleryMargin) an die Cloud. `faceSize` ist die Größe in dem Bild, aus dem das Merkmal stammt (embedSize): Direkt gefundene Gesichter werden im Suchbild bis 1920 px eingebettet, ein Gesicht mit 100 px auf einer 4K-Kamera zählt also 50 px. Bei einer gemittelten Serie gilt die Güte des schwächsten eingegangenen Bilds.
- faceLabel nennt Sorte, Größe und det (z. B. „Mini-Gesicht (rescue_zoom, 32 px, det 0.66)“). „Upload OK“ und „Personen-Sichtung hochgeladen“ nennen die gesendete Bildgröße, das Original und die Güte („Gesicht 96 px direkt, Abstand 0.153“).
- Der Beinahe-Treffer-Hinweis kommt erst ab 5 Beinahe-Treffern direkt erkannter Gesichter in 24 h und rät nicht mehr zum Senken der Schwelle.
- Gesichter aus dem Kopf-Ausschnitt tragen das Kennzeichen headCrop.

Cloud:
- Migration `20261125213000_person_sighting_face_quality`: PersonSighting bekommt faceSize, faceUpscaled, faceDetScore und faceMargin, alle nullable, nur ADD COLUMN. `src/lib/face-quality.ts` prüft jeden Wert für sich, sonst null. Die Route speichert sie an jeder Sichtung.
- Lernregel (`src/lib/face-clusters.ts`, `person-profile.ts`): automatisch gelernt wird nur bei direkt gefundenem Gesicht ab 64 px im Bild des Merkmals, Score ab 0,60 und Abstand ab 0,10, nur bei Personen der Whitelist, nicht ohne Güte-Angaben. Grenze 20 Samples und Ähnlichkeit 0,8 wie bisher. Log „[face auto-learn] … gelernt“ oder „nicht gelernt, grund=…“ ohne Namen.
- Zuordnung von Hand (`persons.ts`, `unknown-persons.ts`) und „Profil optimieren“ (`person-profile.ts`): gute Gesichter werden zuerst Sample, hochgerechnete nur, wenn weder die Auswahl noch das Profil etwas Besseres hat; Log „[face zuordnung]“. „Profil optimieren“ bestimmt Fehlgriffe weiter mit allen Sichtungen. Vorhandene Samples bleiben unverändert.
- Übergang: Ist die Cloud vor dem Hub neu, lernt die Galerie bis zum Hub-Update nicht von selbst (grund=guete_fehlt). Ein älterer Hub wird weiter angenommen.

Prüfung: Typprüfung Hub und Cloud ohne Fehler, Hub-Tests 890 (889 grün, 1 übersprungen), Cloud-Tests face-quality/face-clusters/tenant-models 23 grün, compileall und Secret-Scan ohne Befund. Labor mit synthetischen Szenen: 290 Szenen ohne Abweichung (on entspricht dem Weg über das Original, off und shadow dem bisherigen Dienst); Treffer bei 4K und 24 px 0 % → 43 bis 54 %, bei 32 px 67 bis 79 % → 81 bis 96 %, 0 Fehltreffer, höchste fremde Ähnlichkeit 0,433 → 0,450 (Schwelle hochgerechnet 0,55). Fehlerwege 25 von 25.

**Nächster Schritt** (nach 7 Tagen Betrieb mit on)

- improve.jsonl: `face.native_new_only` gegen `native_old_only` (erwartet new deutlich größer), `face.native_other_person`, `face.native_blacklist_kept` und `face.native_error` sollen 0 sein, `native_face_old` (Rückfälle). Ist `native_other_person` größer als 0 oder old größer als new: `FACE_NATIVE=shadow` setzen und die Sichtungen prüfen.
- Takt: Abstand der Zeilen „Personen-Snapshot <4K-Kamera>: Versuch N/4 ohne Gesicht“ Woche davor gegen Woche danach, dazu `face.skip_inactive` und `face.signal_gap`.
- Cloud-Log `[face auto-learn]` je grund zählen: `guete_fehlt` nach dem Hub-Update etwa 0, „gelernt“ deutlich unter 37 in 14 Tagen, neue Samples mit Score ab 0,60, faceUpscaled = false und faceSize ab 64. An den 4K-Kameras lernt die Galerie erst ab etwa 128 px im Kamerabild.
- SQL: Verteilung von faceUpscaled, faceSize und faceMargin bei Treffern, Anteil lernbarer Treffer.
- Vergleiche mit der Zeit davor: Größen von small_keep stehen bei 4K jetzt etwa doppelt so hoch, „[face] zoom miss“ erscheint je Bild für beide Wege.
- Sind die Zähler eindeutig: den zweiten Weg in on abschalten (Rechenzeit).

## 2026-11-26 (Gesamtprüfung Hub und Kamera-Erkennung, Speicher und Cloud-Last: Vorschaubilder bei Bewegung, Parkmeldung, Hub-Status, Löschfristen, Gesichter-Galerie, Personal-Abgleich)

Entscheidungen des Betreibers vom 25.11.2026: „Vorschaubilder bei reiner Bewegung seltener speichern: höchstens alle 5 Minuten und in 960 Pixeln, bei Person und Fahrzeug bleibt alles, wie es ist“ (Ja), „Unbekannte Personen kürzer aufbewahren“ (7 Tage) und „Fotos vom Drehkreuz-Scan kürzer aufbewahren“ (90 Tage). Vor dem ersten Löschen fragt der Betreiber im Chat nach; dieser Stand baut nur die Möglichkeit, eingestellt ist keine Frist.

**Befund**

- PERF-1/ERG-5: Jede rohe MOTION- oder ANIMAL-Flanke holte ein Anzeige-Bild nach Camera.snapshot, gedrosselt nur auf 30 s je Kamera, mit 1280 px bei Qualität 82 (34 bis 340 KB, im Mittel 163 KB). CameraEvent 17. bis 23.11.: im Mittel 2.673 MOTION/ANIMAL-Starts am Tag, 1.617 davon mit mehr als 30 s Abstand je Kamera, 332 mit mehr als 5 min; rund die Hälfte zwischen 22 und 7 Uhr. Das ganze WAL lag bei rund 1,1 GB am Tag, Bewegungsbilder, Tracker-Bilder und Bildkopien zusammen bei 30 bis 55 %.
- PERF-6/BETR-8/PARK-3: Die Parkmeldung machte alle 30 s vier Aufrufe (Park-Kameras sicherstellen mit Zugangsdaten, Meldung, ganze Kamera-Liste, Tracker-Bild), rund 11.500 am Tag. Die Antwort der Cloud wurde nicht geprüft, ein hängender Lauf konnte sich mit dem nächsten überlappen.
- PERF-2/NETZ-9: HubAgent.status war 48,5 KB groß, davon 47,6 KB Switch-Rohdaten (Port-Listen, MAC-Tabellen), die niemand aus dem Status liest. Jede der rund 5.850 Meldungen am Tag schrieb sie neu (12,3 KB in 7 TOAST-Chunks), in zwei Anweisungen (upsert und Zusammenführen).
- PERF-3/PERS-4: Scan-Fotos hingen per Cascade am Scan und damit an dessen 365 Tagen (ScanSnapshot 7.881 Zeilen, 3.149 MB, 7.812 älter als 90 Tage, kein Bild im Blob-Speicher). Sichtungen ohne zugeordnete Person hatten dieselbe Frist wie zugeordnete (30 Tage): 4.357 von 4.891 Sichtungen (2.146 MiB), davon 3.470 älter als 7 Tage (1.698 MiB).
- PERF-10: Die Gesichter-Galerie (107 Merkmale, 219 KB binär) ging als JSON mit Zahlen-Arrays hinaus, rund 1,1 MB je Abruf bei gut 140 Abrufen am Tag, fast immer mit demselben Bestand.
- PERF-12: Personal-Abgleich rund um die Uhr jede Minute (1.440 Abrufe am Tag, jeder fragt emp-control live); die Belegung fragte die Drehkreuz-Zahlen auch ab, wenn alle Räume geschlossen waren; das README-Schaubild nannte Heartbeat 30 s und Task-Abruf 2 s; drei seltene Abfragen luden ganze Zeilen samt Bild oder Status.

**Änderungen**

Hub, Vorschaubild (`camera-poll-rules.ts`, `image-rules.ts`, `image.ts`, `cameras.ts`, `improve-log.ts`):
- Die bestehende Drossel snapshotJobFor entscheidet über die reinen Funktionen autoSnapshotDue und snapshotPlan. Reine Bewegung (MOTION oder ANIMAL, solange an der Kamera weder Person noch Fahrzeug aktiv ist, im letzten Zustand stand oder im Nachlauf eines offenen Ereignisses ist: personOrVehicleActive) holt ein Bild höchstens alle 300 s, sobald eines angekommen ist; das erste nach dem Start geht sofort, bis dahin gilt 30 s.
- Das Vorschaubild bei reiner Bewegung hat 960 px und Qualität 70 und wird immer verkleinert, auch unter 200 KB (shrinkNeeded, minBytes). Alle anderen Bildwege behalten 1280 px, Qualität 82 und die 200-KB-Schranke.
- Schalter `HUB_MOTION_SNAPSHOT_MIN_S` (300) und `HUB_MOTION_SNAPSHOT_MAX_PX` (960); je 0 bedeutet das Verhalten vor diesem Paket.
- Zähler `camera.preview_upload`, `camera.preview_bytes`, `camera.preview_skip`; die Fehlerzeile nennt den Kamera-Namen.
- Unverändert: Personen- und Fahrzeug-Sichtungen, Kennzeichen-Burst, CAMERA_SNAPSHOT, SCAN_SNAPSHOT, DoorBird, Halteverbot, Wächter, Takt des Tracker-Bilds.

Hub, Parkmeldung (`parking-rules.ts`, `parking.ts`, `index.ts`):
- reportParking liegt in parking.ts. ensureDue: Park-Kameras werden beim Start, bei geändertem Fingerabdruck (id, ip, port, channel, username, Passwort gesetzt ja oder nein) und sonst stündlich sichergestellt.
- Die Kamera-Nummer kommt aus cameraIdByHost; fehlt sie, lädt der Hub die Kamera-Liste neu, höchstens alle 5 min.
- Ein Lauf zur Zeit (Zähler `parking.busy`), `res.ok` wird geprüft (`parking.report_fail` statt der improve-Zeile `parking.fail`), Fehler und Erholung je einmal im Log. Neu auch `parking.frame`, `parking.frame_nocam`, `parking.report_skip`.
- Vorbereitet, ab Werk ohne Wirkung: `HUB_PARKING_IDLE_REPORT_S` (30 = jede Meldung) und `HUB_PARKING_FRAME_IDLE_S` (0 = Bild bei jedem Lauf).

Cloud, Hub-Status (`src/lib/hub-status.ts`, `src/lib/hub-agent-status.ts`, Routen heartbeat, parking, switch):
- status.snmp enthält je Switch nur die Kurzfassung (snmpStatusSummary: host, sysName, polledAt, ports, portsUp, macs, error). Der Abgleich in die Switch-Tabellen bekommt weiter die vollen Listen.
- writeHubAgentStatus schreibt jede Meldung in einer parametrisierten Anweisung INSERT … ON CONFLICT … DO UPDATE mit Konto-Filter und gibt nur die id zurück; jeder Schreiber ändert nur seinen Schlüssel (mergeHubStatus als reine Regel, in SQL gleich umgesetzt). Ein alter Status mit Rohdaten wird beim nächsten Schreiben gekürzt, ohne Migration. Die Antworten der Routen bleiben gleich.

Cloud, Löschfristen (`data-retention-config.ts`, `data-retention-rules.ts`, `data-retention-batches.ts`, `data-retention.ts`, Karte Löschfristen):
- Teil-Fristen „Unbekannte Personen“ (personSightingsUnknown) und „Scan-Fotos“ (scanSnapshots), ab Werk null („Wie Personen“, „Wie Scans“) und damit ohne eigenen Lösch-Schritt.
- retentionCutoffs: Ohne die neuen Schlüssel ergeben sich exakt die bisherigen Stichtage und Bedingungen. Eine Teil-Frist läuft nur, wenn sie kürzer ist als die übergeordnete.
- Mit gesetztem Wert: Löschen in Portionen zu 500 über die IDs, höchstens 2.000 je Schritt und Lauf, innerhalb von 90 s; bei Scan-Fotos nur das Foto (der Scan bleibt), bei Sichtungen nur die ohne zugeordnete Person. Ein Rest steht im Ergebnis und im Cloud-Log („[retention] … übrig“).

Gesichter-Galerie (`src/lib/face-gallery-rules.ts`, Route person-embeddings, `hub/src/gallery-rules.ts`, `hub/src/face.ts`):
- Version aus Anzahl, höchster id, jüngstem createdAt der Merkmale und jüngstem updatedAt der aktiven Personen. Mit `?v=` und gleichem Bestand antwortet die Route `{ unchanged: true, version }`, mit `?enc=b64` kommen die Merkmale als Base64 (Float32 LE); ohne Parameter wie bisher.
- Der Hub merkt sich die Version, holt stündlich und nach einer unpassenden Antwort den ganzen Bestand und nimmt Base64 und Zahlen-Array an. Zähler `face.gallery_full`, `face.gallery_unchanged`, `face.gallery_bytes`, `face.gallery_dropped`.

Personal und Belegung (`staff-sync-rules.ts`, `staff.ts`, `occupancy-rules.ts`, `occupancy.ts`, `README.md`):
- Nachts (23 bis 6 Uhr Ortszeit) alle 4 min, wenn niemand eingestempelt ist und der letzte Abruf geklappt hat. Die Personal-Übersicht gilt dann erst ab 8 statt 5 min als veraltet (staffStaleAfterMs), damit ein Ausfall sie nachts nie früher veraltet als im Minuten-Takt. Nach einem Fehlschlag nachts nach 15 s erneut, solange der Stand nicht veraltet ist, danach jede Minute. Abstand mit der monotonen Uhr ab dem Start des letzten Abrufs, höchstens ein Takt.
- Kein Drehkreuz-Abruf der Belegung, wenn der Takt nichts misst (Zähler `occupancy.areas_skip`); auf Nachfrage im Chat weiter.
- README-Schaubild mit den Standardwerten des Codes; drei Abfragen holen nur die nötigen Spalten.

Cloud, Räume (`src/components/raeume/shared.tsx`, `room-summary.ts`, `room-widgets.tsx`): Der Hinweis „Kamera ohne Bild“ und das Abzeichen „Live“ der Kachel gelten ab 10 statt 5 min (SNAPSHOT_FRESH_MS), weil das Vorschaubild bei reiner Bewegung bis zu 5 min alt sein darf. Die Karte Löschfristen sagt bei den Teil-Fristen, dass sie nur kürzer wirken.

Prüfung: Typprüfung Hub und Cloud ohne Fehler, ESLint ohne Befund. Hub-Tests 943 (942 grün, 1 übersprungen). Cloud-Tests data-retention-batches, data-retention-rules, face-gallery-rules, hub-agent-status, hub-status: 39 grün. Wegwerf-Postgres 16: 1.500 Zufallsfälle SQL gleich mergeHubStatus, 1.500 gleichzeitige Schreibungen ohne Verlust, WAL je Parkmeldung 12,3 → 1,5 KB (synthetischer Status). 20.000 Konfigurationen ohne die neuen Schlüssel: 0 Abweichungen der Stichtage, 0 neue Lösch-Schritte. Simulation: reine Bewegung 9 → 3 Vorschaubilder in 135 s; Bewegung neben einer Person, Fahrzeug, „Person vor Fahrzeug“ und Standard mit denselben Uploads und Bildabrufen wie vorher; mit `HUB_MOTION_SNAPSHOT_MIN_S=0` dieselben Zeitpunkte wie vorher; Parken: Sicherstellen 6 → 1, ein HTTP 500 wird einmal geloggt. Aus zwei Blickwinkeln gegengelesen, sechs Punkte nachgebessert (Bewegung neben Person oder Fahrzeug, kleine Nachtbilder, Personal-Abgleich bei gestellter Uhr und nach Fehlschlägen, Testlücken), danach unabhängig nachgeprüft und drei weitere Punkte behoben (Grenze zum Veralten im Nacht-Takt, Frischegrenze der Raum-Kacheln, Hinweis zu Teil-Fristen). Nachstellung des Personal-Abgleichs: Ausfälle von 75 bis 239 s in jeder Lage nach dem letzten guten Abruf machen die Übersicht nie veraltet, ein Ausfall von einer Stunde nie früher als im Minuten-Takt.

**Nächster Schritt** (nach 7 Tagen Betrieb)

- improve.jsonl: `camera.preview_upload` je Tag (vorher 1.600 bis 2.700 Bewegungsbilder, erwartet einige Hundert), `camera.preview_bytes / camera.preview_upload` deutlich unter 163 KB, `camera.snapshot_fail`. Kameras mit einer Person ohne Gesicht behalten den 30-s-Takt.
- Parkmeldung: `parking.report` und `parking.frame` je etwa 2.880 am Tag wie vorher; `parking.report_fail`, `parking.busy`, `parking.frame_nocam` etwa 0.
- Vercel: /api/hub/cameras/ensure von etwa 2.880 auf etwa 24 am Tag, GET /api/hub/cameras rund 2.880 weniger, /api/hub/staff etwa 1.125 statt 1.440.
- Neon: `octet_length(status::text)` von HubAgent unter 2.000 nach der ersten Meldung; Zuwachs der TOAST-Tabellen von HubAgent und Camera je Stunde; WAL am Tag (vorher rund 1,1 GB).
- Galerie: `face.gallery_unchanged` etwa 120 am Tag, `face.gallery_full` etwa 24 plus Änderungen, `face.gallery_bytes` unter 10 MB am Tag, `face.gallery_dropped` 0.
- Galerie: Das Auslösen eines Shelly an einer erkannten Person ändert updatedAt der Person und damit die Version; zählen, wie oft `face.gallery_full` deshalb kommt, und gegebenenfalls nur Namen, Liste und Aktiv-Stand in die Version nehmen.
- Löschfristen: vor dem Eintragen die Zahl der betroffenen Zeilen und MB für 7 und 90 Tage abfragen, im Chat nachfragen, erst dann 7 bzw. 90 Tage wählen. Danach `deleted.personSightingsUnknown` und `deleted.scanSnapshots` je Nacht (höchstens 2.000), der Rest ist nach etwa 2 bzw. 4 Nächten abgearbeitet.
- Ob `HUB_PARKING_IDLE_REPORT_S` und `HUB_PARKING_FRAME_IDLE_S` eingeschaltet werden, entscheidet der Betreiber; ein Bild-Abstand bis 240 s hält „Live“ auf der Parkfläche.

## 2026-11-26 (Gesamtprüfung Hub und Kamera-Erkennung, Regeln: Zeit-Regeln je Termin mit Nachholen, Nachtfenster, echter Erfolg im Verlauf, Selbstabschaltung, Messpunkte, Notbetrieb mit Rolltoren, Bewegungs-Regeln direkt vom Hub)

Entscheidungen des Betreibers vom 25.11.2026: „Zeit-Regeln nachholen und melden“ (E40), „Hub schließt Rolltore im Notbetrieb“ (E41), „Bewegungs-Regeln direkt vom Hub“ (E42) und „Nachtfenster ab dem Abend“ (E43), jeweils Ja. Beide neuen Hub-Schalter stehen ab Werk an, wie entschieden.

**Befund**

- REG-1/REG-10: Der Regel-Cron läuft alle 5 Minuten; alle 12 Läufe seit 07.11. gelangen und starteten 8,5 s bzw. 41 bis 43 s nach der Marke, Dauer 4.390 bis 9.016 ms. Eine Zeit-Regel war nur in genau der Cron-Minute fällig: Ein verspäteter oder gescheiterter Lauf ging spurlos verloren. Krumme Zeiten wie 07:03 und Sonnenzeiten mit großem Versatz nach Mitternacht liefen nie.
- REG-12: Nachtfenster und ein Betriebsende nach Mitternacht wurden gegen den Kalendertag des Augenblicks geprüft, nicht gegen den Tag, an dem die Nacht oder der Betriebstag beginnt. Alle 3 Regeln haben alle Wochentage, live war noch keine betroffen.
- REG-2: Der Verlauf zählte übergebene oder abgelehnte Befehle als Erfolg (Regel 1: 25 von 25 Läufen „erfolgreich“, ohne dass die Annahme durch das Gerät geprüft wurde). Eine Fehlschaltung konnte eine Folgeregel starten.
- REG-8: „Ruhe im Raum“ löste in einer Ruhephase bei jedem Takt aus, auch in Räumen ohne Kamera (23 Räume, 6 mit Kamera). Im Aquapark rund 600 Bewegungs-Ereignisse in 24 h, reine Bewegung taugt dort nicht als Aktivität.
- REG-11: Bewegungs-Regeln mit „Klingel (DoorBird)“ ließen sich nicht speichern, Prüfung und Dialog kannten die Ereignisart nicht.
- REG-9: Folgeregeln und Regeln „Gerät geschaltet“ starteten ohne Warten und liefen nicht sicher zu Ende; Schaltungen über das Hub-Dashboard und den Hub-Assistenten meldete der Hub der Cloud nicht.
- REG-5: Die Selbstabschaltung wirkte nur bei GARDENA-Ventilen. Shelly-Schalter und -Licht blieben mit „Selbstabschaltung (Sek.)“ dauerhaft an; bei Hue und Antrieben stand das Feld ohne Wirkung im Dialog.
- REG-4: Rolltor-Läufe 4.390 bis 9.016 ms (Mittel 6,5 s), Bewegungs-Regel 1: 9.146 bis 72.291 ms. Ohne Ereigniszeit im Verlauf war nicht zu trennen, was Kamera, Cloud und Gerät kosten. Bewegungs-Regeln liefen immer über Hub, Cloud und Shelly Cloud bzw. einen Hub-Auftrag.
- REG-13: Rolltor-Befehle aus der Cloud warteten auf das Zeitlimit des LAN-Statusabrufs. Der Plan für den Notbetrieb wertete je Regel und 48 h 1.441 Zeitpunkte aus, der Hub holte ihn 96-mal am Tag (1,2 bis 1,35 s je Zeit-Regel). Rund 2.084 Kamera-Starts in 24 h mit je 2 Abfragen, auch ohne Bewegungs-Regel. Zeitzonen-Helfer 103 bzw. 46 µs je Aufruf statt rund 9 µs mit wiederverwendetem Formatter.
- REG-7: Im Notbetrieb galt nur das Lebenszeichen als Kontakt; Termine aus der Karenz vor dem Ausfall führte niemand aus. Der Merker lag nur im Speicher, ein Neustart konnte einen Termin wiederholen oder verlieren. Rolltore schloss nur die Cloud: Bei Ausfall des Standort-Internets blieben sie offen, bis die Cloud zurückkam.
- REG-14: Die Rückkehr der Kamera-Szenen hing an einem Timer im Speicher und ging bei einem Neustart verloren.

**Änderungen**

- Cloud, Fälligkeit (`src/lib/rule-due.ts`, neu): Ein Termin ist von seiner Zeit bis 30 Minuten danach fällig, solange kein Lauf gelungen ist; wiederholt werden nur die Aktionen, die für diesen Termin noch fehlen. Hue- und Kamera-Aufträge zählen erst mit ihrem Ergebnis: offen heißt kein zweiter Auftrag, gescheitert oder verfallen heißt nachholen. Nach der Frist genau eine Meldung „Termin verpasst“ per Push und Telegram. Sicherheitsnetz: 30 Minuten nach Betriebsende schließt die Cloud einmal, was eine Regel „Betriebsbeginn“ geöffnet hat und kein Schließen gefolgt ist; „im Betrieb“ gilt nach beiden Regeln, Öffnungen zählen erst ab Anlegen der schließenden Regel; es schließt nur. Anlegen oder Zeitplan-Ändern setzt den Vermerk auf jetzt, nichts Früheres wird nachgeholt. Solange der Hub einen Termin selbst geschaltet haben kann (angekündigte Termine im Lebenszeichen), wartet die Cloud bis zu 60 Minuten auf seine Meldung; danach „nicht bestätigt“ mit der Zeit des letzten Lebenszeichens. Jede neue Abfrage filtert nach Konto, der Cron gleicht Hub-Aufträge Konto für Konto ab. Spalten RoomRule.lastOccurrenceAt und lastMissedAt (additiv).
- Cloud, Zeitfenster: `windowWeekday` in `src/lib/tz-time.ts`; der Morgenteil eines Nachtfensters und ein Betriebsende nach Mitternacht zählen für den Tag, an dem sie beginnen, in der Cloud und im Hub-Plan (`hub/src/rule-plan-rules.ts`). Sonnenzeiten nach dem lokalen Kalendertag.
- Cloud, Verlauf (`src/lib/rule-run-rules.ts`): Erfolg nur, wenn jede Aktion vom Gerät angenommen wurde. Hue und „Kamera steuern“ stehen bis zum Ergebnis des Hubs als „an Hub übergeben“; Folgeregeln danach erst mit Ergebnis DONE. Folgeregeln werden nach dem eigenen Verlauf abgewartet (Tiefe 1), „Gerät geschaltet“ läuft über `after()`.
- Cloud, „Ruhe im Raum“ (`idleDue`): einmal je Ruhephase, nur Kameras des Raums, neue Regeln ab Werk nach Person oder Fahrzeug, wählbar im Dialog. Gemeinsame Liste der Ereignisarten (`src/lib/rule-event-types.ts`) mit Klingel.
- Selbstabschaltung (`src/lib/rule-timer.ts`, `hub/src/rooms-rules.ts`): GARDENA mit Laufzeit, Shelly Schalter und Beleuchtung schalten nach `autoOffSec` ab, sonst kein Regel-Timer; Dialog zeigt das Feld nur, wo es wirkt.
- Messpunkte: RoomRuleRun.eventAt und startedAt (Migration `20261126120000`), `ms` je Aktion; Hub-Log je Regel mit Antwortzeit der Cloud.
- Weniger Rechenarbeit: kein LAN-Statusabruf für Rolltore aus der Cloud, wenn ein Shelly-Cloud-Zugang da ist; Plan nur an Wechselstellen ausgewertet (3 bis 18 statt 1.441 je Regel, Ergebnis gleich über 48 h und beide Zeitumstellungen); Regel-Version (RoomRule.configChangedAt, Migration `20261126150000`, dazu ein Fingerabdruck von Kameras, Geräten, Zeitzone und Ort in derselben Abfrage) im Lebenszeichen, der Hub holt den Plan sofort bei neuer Version, sonst alle 6 h; Bewegungs-Regeln einmal je Meldung, ohne Regel keine Abfrage; Formatter je Zeitzone wiederverwendet.
- Hub, Notbetrieb (`hub/src/outage-rules.ts`, `hub/src/rules.ts`, `hub/src/cloud-contact.ts`): Jeder gelungene Aufruf zählt als Kontakt. Erlaubnisliste: Der Hub schaltet im Notbetrieb nur Licht, Schalter (Shelly Beleuchtung oder Schalter mit IP) und Hue ein und aus, Kamera-Szenen, und Rolltore zu; Türöffner, Drehkreuze, Taster und Shellys ohne Kategorie fasst er nie an, er öffnet nichts. Termine ab dem letzten Kontakt der Reihe nach, Termine bis 6 Minuten davor nur in sicherer Richtung (Aus, Zu) und nur, wenn kein späterer Termin dasselbe Gerät schaltet. Ein gescheitertes Aus oder Zu versucht er höchstens dreimal, 60 s auseinander, in der Frist; eine Wiederholung gilt erst als Erfolg, wenn dem Termin nichts mehr fehlt. Merker atomar in `.cache/rule-outage.json`. Nach der Rückkehr meldet der Hub seine Läufe sofort; im Notbetrieb geschaltete Bewegungs-Regeln stehen am Ereignis, damit die Cloud sie nicht noch einmal schaltet.
- Hub, Rolltore (`hub/src/cover-rules.ts`, `cover-interlock-cases.ts`, `shelly.ts`, `rooms.ts`; Cloud `src/lib/cover-constants.ts`): Im Notbetrieb nur die Aktion „zu“ einer Zeit-Regel, nur im eigenen Netz, mit derselben Verriegelung wie die Cloud (gemeinsame Testfälle); fehlt ein Zustand für die Verriegelung, schließt der Hub nicht und meldet den Lauf als gescheitert. Schalter `HUB_EMERGENCY_COVER_CLOSE` (an; 0, false, nein, no, aus, off = wie vorher; ein unbekannter Wert steht einmal im Log).
- Hub, Bewegungs-Regeln direkt (`src/lib/rule-executor.ts` `decideExecutor`, `hub/src/motion-rules.ts`): Die Cloud kennzeichnet im Plan eine Regel nur, wenn jede Aktion ein Shelly-Relais mit Kategorie Beleuchtung oder Schalter, ein Hue-Licht oder eine Kamera-Szene ist und die Bedingungen gleich auswertbar sind. Der Hub schaltet sie beim Ereignis selbst (Frist 5 s), nennt die Regeln mit dem Ereignis (kein Ereignis geht hinaus, solange seine Entscheidung offen ist), die Cloud überspringt genau diese und trägt den Lauf ein. Alte Cloud: der Hub schaltet nichts selbst; alter Hub: die Cloud schaltet alles. Scheitert das lokale Schalten, gibt der Hub an die Cloud ab. Schalter `HUB_RULES_LOCAL_MOTION` (an; 0, false, nein, no, aus, off = alles über die Cloud).
- Hub, Szenen-Rückkehr (`hub/src/scene-return-rules.ts`): Zeitpunkte in `.cache/scene-returns.json`, eine beim Start fällige Rückkehr läuft, sobald die Kamera-Liste da ist; Einträge über 24 h werden verworfen und geloggt.

**Nächster Schritt**

- SQL nach dem Deploy: je Regel und Betriebstag genau ein gelungener Lauf „Betriebsbeginn“ und „Betriebsende“, kein doppelter Lauf je Termin; Zeilen „Termin verpasst“ und „Sicherheitsnetz nach Betriebsende“ nur, wo erwartet. „nicht bestätigt“ nur nach Ausfällen über 90 min.
- SQL: `triggeredAt - eventAt` und `triggeredAt - startedAt` je Auslöser, Bewegungs-Regeln getrennt nach „hub:motion“ und „motion“. Ziel Rolltor-Lauf in der Cloud um 2,5 s statt 6,5 s. Paare aus „hub:motion“ und „motion“ zum selben Ereignis: erwartet 0.
- Hub-Log eine Woche: `rules.motion_local` gegen `rules.motion_cloud`, `rules.motion_local_failed` und `rules.motion_local_late`; Zeilen „vom Ereignis bis geschaltet“ gegen „Antwort der Cloud nach“; `rules.cover_close`, `rules.cover_close_failed`, `rules.outage_failed` und `rules.outage_retry` je Ausfall; `rules.plan_fetch` etwa 4 am Tag plus einer je Regel-Änderung (statt 96); `rules.triggered_unnamed` bei 0.
- „Regeln: N Läufe aus dem Notbetrieb an die Cloud gemeldet“ soll Sekunden nach „Cloud wieder erreichbar“ erscheinen; „Kamera-Szenen: N Rückkehr nach dem Neustart wartet auf die Kamera-Liste“ soll nach der Rückkehr der Cloud verschwinden.
- Bewusst offen: Im Teilausfall kann ein Rolltor ein zweites „zu“ bekommen, „Notbetrieb: Rolltor … geschlossen“ steht dann zusätzlich zum Lauf der Cloud. Last der zusätzlichen Abfrage der Regel-Version je Lebenszeichen in Neon beobachten. Wiederholungen im Notbetrieb liegen nur im Speicher, ein Neustart beendet sie. Die Klingel nennt im Notbetrieb noch keine Regeln am Ereignis. Pi-Aktionen im Verlauf erst nach Rückmeldung des Pi als Erfolg werten.

## 2026-11-26 (Gesamtprüfung Hub und Kamera-Erkennung, Halteverbot und Parken: Dauerparker seltener melden, Ansage mit Frist, Takt nach Lage, Beweisbild-Ausschnitt, gemeinsamer Tracker-Aufruf, Belegung bis 200 Personen, Vergleich auf dem Ausschnitt, Diagnose, Parkfläche „unbekannt“, Tor-Automatik getrennt)

Entscheidungen des Betreibers vom 25.11.2026: „Dauerparker seltener melden“ (E30), „Halteverbot seltener prüfen“ (E31), „Beweisbild-Ausschnitt“ (E32) und „Halle 2 zählt ohne zu öffnen“ (E25), jeweils Ja. Zu E25: „Zählen und Öffnen an Halle 2 trennen … Voreinstellung auf „nicht öffnen“, geöffnet wird nur bei ausdrücklicher Angabe.“

**Befund**

- PARK-1: Ein Dauerparker wurde alle 10 min je Fahrzeug neu gemeldet, angesagt und mit Bild gespeichert.
  - 06.11.: 81 Meldungen in 4,5 h (17:55 bis 22:22, 76 im Ansagefenster); 07./08.11.: 41 (20:08 bis 01:17, 21 nach 22 Uhr).
  - 100 der 122 Meldungen waren Wiederholungen (Vorgänger 590 bis 650 s früher), 22 Erstmeldungen. 128 Bilder, zusammen 30 MB, keines mit Kennzeichen.
  - Die Sperre der Cloud (Map im Speicher, 10 min) bremste nur Push und Telegram: höchstens 56 statt 122. Ansage (96 im Fenster) und Historie liefen ungebremst.
  - Ein Cloud-Fehler galt trotzdem als gemeldet. Jeder Neustart (mindestens 7 zwischen 13. und 24.11.) ergab eine neue Erstmeldung.
- PARK-2: Die Sende-Schleife der Ansage wartete ohne Frist auf `drain`. Im Loopback-Nachbau blieb sie mit FIN wie mit RST nach 10 bis 11 von 100 Paketen stehen. Im Betrieb nicht aufgetreten: 39.369 Durchläufe lückenlos, camera.talk_ok 2, kein talk_fail.
- PARK-6/PERF-11: Takt 20 s rund um die Uhr, 4.320 4K-Bilder am Tag. Diagnose 24.11. (6,3 h): clear 1.133, waiting 1, skip_moved 5, also rund 99,5 % leer. Ersparnis im Winter rund 40 bis 65 %; der schlechteste Fall für die Erkennung ist ein ganzer Ruhetakt.
- PARK-8: Keine Tests für die Halteverbot-Regeln, parseZone doppelt (vision.ts, noparking.ts).
- PARK-12: Das Beweisbild war die auf 1280 px verkleinerte Übersicht; das Fahrzeug war darin 113 bis 182 px breit, im 4K-Original 340 bis 545 px. 129 NO_PARKING-Sichtungen ohne Kennzeichen, 205 bis 595 KB je Bild.
- PARK-7: /classify wurde an vier Stellen mit 5, 5, 6 und 5 s Zeitlimit aufgerufen, nur der Fahrzeug-Pfad schickte die PIN mit. Der Personen-Pfad verschluckte Fehler ohne Zeile und Zähler. Hub-Log 54 h (31.194 Zeilen): 34-mal „Tracker sieht keine Person“, kein vision.fail. Bei hängendem Tracker wartete ein Burst mit 9 Bildern bis zu 45 s.
- PARK-5: detectPersons kappte bei 20 Boxen. Seilbahn A und B (voll ab 25, je eine Kamera) erreichten „voll“ nie.
- PARK-4: Der Tracker rechnete mit imgsz 640 aus 1280 px. Ein Pkw belegt 0,7 bis 1,8 % der Bildfläche; dokumentiert sind conf 0,38 bis 0,50 bei 0,71 %. Abrisse der Spur sind nicht belegt (07./08.11. über 2 h stabil), deshalb erst nur zählen.
- PARK-9: noparking.fail 18 bei 23.998 Durchläufen (14. bis 20.11., 0,075 %) und 4 bei 8.309 (20. bis 22.11.) hielten den Hinweis tagelang offen. Die Kandidaten-Phase war unsichtbar (22.11.: Meldung nach 160 statt 140 s). Fehler der Belegung lagen nur im Speicher, die Antwort der Cloud wurde verworfen, die Zähler standen nach jedem Neustart bei null.
- PARK-11: Der Tracker setzte im Fehlerzweig last_update neu. Der Hub meldete die alte Zahl (ohne Tracker 0) und lud das alte Bild hoch, die Cloud setzte lastSeenAt. „Kamera seit 10 min nicht gesehen“ konnte für Halle 2 deshalb nicht anschlagen.
- PARK-13: vehicleGate.enabled startete immer den Ausfahrt-Assist (0 auf mindestens 1 nach 8 Bildern, conf ab 0,2, höchstens alle 45 s, dann /api/vehicle-gate/open). openDoorbird stand ab Werk auf true, und das Schema verlangte DoorBird oder ein Gerät. Hub-Log 54 h: 3 DoorBird-Öffnungen, alle nach einem Kennzeichen der Liste; Öffnungen über die Kiosk-Route stehen dort nicht.

**Änderungen**

- Hub, Halteverbot-Regeln (`hub/src/noparking-rules.ts`, neu, mit Tests; `hub/src/zone-rules.ts` mit parseZone und inside für vision.ts, noparking.ts und occupancy.ts):
  - Wiedererkennung: Eine Box gilt als dasselbe Fahrzeug (IoU ab 0,4, Diagnose reacquired), wenn seine Stelle höchstens 3 min (SAME_VEHICLE_GAP_MS) oder höchstens 2 Prüfungen in Folge unverdeckt leer und höchstens 15 min verdeckt war. Ein schon gemeldetes Fahrzeug wird bis 15 min beobachteter Zeit nach der letzten Sichtung auch nach längerer Leere übernommen, wenn die Box fast deckungsgleich ist (SAME_SPOT_IOU 0,75, Diagnose mit tight). Sonst ist die Box ein neues Fahrzeug mit eigener Standzeit, eigener Meldung und eigener Folge (reacquired_new mit Lücke).
  - Als leer zählt eine Prüfung für ein Fahrzeug nur, wenn keine Fahrzeug-Box seine Box überdeckt; ein Lieferwagen davor ist keine Leere. Zeiten ohne Beobachtung zählen nicht als leer: Hub aus, Abstand über 5 min bzw. das 2,5-Fache des längsten Takts, Kamera nicht in Grundstellung, Tracker weg, Fehler oder hängender Durchlauf.
  - Jedes Fahrzeug hat eine eigene Kennung (erste Sichtung und Nummer im Durchlauf), die im Zustand steht. Je Fahrzeug höchstens 2 Ansagen und ein Bild. Nachricht beim ersten Fahrzeug, Erinnerungen nach 30, 60 und 120 min, zwischen 22 und 7 Uhr keine Nachricht (HUB_NOPARK_NOTIFY_FROM/TO). Eine Folge endet, wenn keines ihrer gemeldeten Fahrzeuge mehr wiedererkannt werden kann; ein neues Fahrzeug, das vorher fällig wird, beginnt eine eigene Folge. Eine Folge beginnt nur mit einem fälligen Fahrzeug, ein schon gemeldetes löst keine zweite Erstmeldung aus.
  - Cloud-Versuche je Eintrag mit festem Schlüssel: sofort, nächster Durchlauf, nach 90 s, 8 min und 20 min, danach aufgegeben. Ein neu fälliges Fahrzeug bekommt einen eigenen Eintrag, Wiederholungen schicken Übersicht und Ausschnitt des ersten Versuchs (im Speicher, höchstens 2 h; noparking.retry_first_image) mit retry=1, die Cloud setzt dann kein neues Kamerabild.
  - Takt nach Lage (`checkDelay`): leer 60 s, nachts 120 s, mit Fahrzeug 20 s; die VEHICLE-Meldung der Kamera holt die nächste Prüfung auf spätestens 20 s vor (`hub/src/cameras.ts`). Ein Timer für die Schleife (`hub/src/check-loop.ts`), der nächste Termin bleibt auch bei einem Uhrsprung im Rahmen. Rückfall: HUB_NOPARK_FIXED_INTERVAL=1.
  - Zustand in `.cache/noparking.json`: direkt nach der Entscheidung und vor dem Melden gesichert, bei unverändertem Zustand alle 5 min aufgefrischt, beim Beenden immer geschrieben (höchstens 2 s Warten auf den laufenden Durchlauf), vor dem Laden nie. Gemeldete Fahrzeuge bleiben 3 h nach der letzten Sichtung gemerkt, die Datei wird bis 3 h Alter angenommen; die Zeit bis zur ersten Prüfung nach dem Start zählt nicht als leer. Nach einem Neustart keine zweite Erstmeldung.
  - Ausschnitt in voller Auflösung zur ersten Meldung (`evidenceRect`, `unionBox`).
  - HUB_NOPARK_REPEAT_MINUTES entfällt.
- Hub, Ansage (`hub/src/camera-talk-rules.ts`, `hub/src/camera-talk.ts`): endet bei close oder error, drain-Frist 5 s, Gesamtfrist Ansagelänge plus 10 s, Warteschlange je Kamera, say und afconvert mit 15 s. Das Halteverbot wartet höchstens 20 s auf die Ansage, ein Durchlauf wird nach 90 s freigegeben (noparking.stuck).
- Cloud, Halteverbot (`src/lib/parking-violations-rules.ts`, neu, mit Tests; `src/lib/parking-violations.ts`; Route `/api/hub/parking-violations`): Der Hub entscheidet über Nachricht, Speichern und Erinnerung; für ältere Hubs bleibt eine Sperre in der Datenbank (9 min). Schlüssel je Eintrag und je Nachricht (VehicleSighting.reportKey, Camera.noParkNotifyKey, Migration `20261127090000_parking_report_keys`), damit ein wiederholter Versuch nichts doppelt anlegt oder verschickt. Die Nachricht wird erst nach allen Abfragen beansprucht; ging nachweislich nichts hinaus, wird der Schlüssel freigegeben (502 „Nachricht nicht zugestellt“), der Hub legt den Ausschnitt trotzdem in der Historie ab und versucht die Nachricht erneut. Ausschnitt über eine eigene Route, Spalten VehicleSighting.evidence und evidenceBlob (Migration `20261126180000_vehicle_sighting_evidence`), Fahrzeuge-Seite und Dialog zeigen ihn; gespeichert wird er nur einmal (bedingtes Update je Konto). Zur ersten Nachricht geht genau ein Ausschnitt an Telegram, auch nach einer verlorenen Antwort und bei einem nachts gespeicherten Fahrzeug, dessen Nachricht um 7 Uhr kommt (Marke „+e“ am Nachrichten-Schlüssel, Parameter evidenceKey). Beide Migrationen additiv.
- Hub, Tracker-Aufruf (`hub/src/tracker-client.ts` und `tracker-client-rules.ts`, neu; umgestellt `vision.ts`, `person-crop.ts`, `live-people.ts`): ein Aufruf mit PIN und Zeitlimit HUB_VISION_TIMEOUT_MS (6 s), Zähler tracker.<aufrufer>.ok, .fail und .off, nach 2 Fehlern 30 s aus (tracker.down und tracker.up je Wechsel).
- Hub, Belegung (`person-crop-rules.ts`, `occupancy.ts`): Die Zählung nutzt bis zu 200 Personen, sonst bleibt 20. Test: „voll“ ist an jedem voreingestellten Messpunkt erreichbar.
- Tracker (`webcams/tracker/classify_roi.py`, neu, mit Tests): /classify mit optionalem Ausschnitt und imgsz bis 1280; ohne die Angaben wie vorher.
- Hub, Vergleich auf dem Ausschnitt (`hub/src/noparking-shadow-rules.ts`, neu): Jeder 10. Durchlauf und jeder Durchlauf mit Kandidat fragt zusätzlich mit Hüllrechteck plus 15 % und imgsz 1280. Nur gezählt (noparking.shadow_same, _more, _less und die Summen der Sicherheit), die Meldung hängt nicht daran. HUB_NOPARK_SHADOW, ab Werk an.
- Hub, Diagnose: `improve-rules.ts` (neu) mit Hinweisen erst ab 2 % Fehleranteil und mindestens 5 Fehlern oder 3 in Folge; Tagessummen in `.cache/improve-daily.json`, Abschnitt „Heute“. `noparking-diag-rules.ts` (neu): first_seen, miss, found, lost, reacquired, reacquired_new und left (mit Lücke und Zahl der leeren Prüfungen); alert und remind mit der Antwort der Cloud. Belegung mit cam_fail und Grund, Zeile „ruht an …; misst an …“ nur beim Wechsel; parking.tracker_down nur beim Wechsel.
- Parkfläche: Der Tracker lässt lastUpdate im Fehlerfall stehen (`worker_state.py`). Der Hub meldet dann count null und „unbekannt“ und kein Bild (`parking-rules.ts`, `parking.ts`, Dashboard). Die Cloud setzt „zuletzt gesehen“ bei Parkbildern nur mit live=1 und zeigt „Belegung unbekannt“; count bleibt für alte Tabs eine Zahl.
- Tor-Automatik: Neues Feld vehicleGate.openDoorbirdConfirmed, ab Werk false; nur der Kiosk-Schalter „DoorBird öffnen“ setzt es. Tracker (`webcams/tracker/vehicle_gate.py`, neu, mit Tests) und Kiosk-Route `/api/vehicle-gate/open` öffnen die DoorBird nur damit. Ein altes openDoorbird: true allein zählt nur, mit eigener Startzeile je Kamera („alte Einstellung openDoorbird ignoriert, im Kiosk ‚DoorBird öffnen‘ einschalten“); ausdrücklich gewählte Geräte öffnen wie bisher. Zählflächen brauchen kein Gerät mehr. Der Tracker meldet die Betriebsart je Fläche in /counters (gate); der Hub zeigt sie als Plakette „nur zählen“ oder „Tor öffnet bei Fahrzeug“, ohne Angabe „Tor-Automatik unbekannt“, und schreibt eine Zeile beim Wechsel. READMEs von Hub und Tracker nennen die Voreinstellung.

**Prüfung**

- Hub-Tests 1.233 (1.232 grün, 1 übersprungen), Tracker-Tests 22 grün, Cloud-Tests `src/lib` 1.368 grün (Halteverbot 23), Kiosk-Tests 107 grün, Typprüfung von Hub und Cloud ohne Fehler.
- Teil-A-Regeln gegen den alten Code: 335.666 Fälle gleich, wo das Verhalten gleich bleiben soll. Hinweise gegen die alten Regeln an 200.000 Zählerständen gleich.
- Abläufe nachgestellt: A steht 130 min, 10 min leer, dann B 60 min an fast derselben Stelle (B wird eigens gemeldet); A 80 s, 5 min leer, B 40 s (keine Meldung); 4 min Erkennungsaussetzer und 5 min Verdeckung durch einen Lieferwagen (A behält 2 Ansagen und 1 Bild); 15 min Verdeckung mit Blindzeit oder Neustart und mit einem zweiten Fahrzeug dazwischen (je eine Erstmeldung je Fahrzeug); Takt 330 s und 480 s mit Aussetzern (1 Bild, 2 Ansagen; die Folge endet); nachts zwei leere Prüfungen bei stehendem Fahrzeug (keine zweite Meldung); zwei Fahrzeuge im selben Durchlauf (eigene Schlüssel); verlorene Antwort, danach B fällig (je eine Sichtung); Neustart nach 16 min (keine zweite Erstmeldung); Wiederholung nach Wegfahrt (Bild des ersten Versuchs); Tracker-Start mit alter und neuer Einstellung.

**Nächster Schritt** (Cloud zuerst, dann Hub; danach Neustart von Tracker und Kiosk-App; 7 Tage beobachten)

- Halteverbot je Belegung genau eine Zeile `Halteverbot <Kamera>: … · Cloud: ok (Sichtung N, Push n, Telegram n) · Ausschnitt WxH px: ok`, danach höchstens eine weitere mit „Ansage“ je Fahrzeug und höchstens „Erinnerung 1–3“. NO_PARKING-Sichtungen je Abend etwa gleich der Zahl der Fahrzeuge (Ausgangsstand 81 an einem Abend), alle neuen mit Ausschnitt, keine Nachricht zwischen 22 und 7 Uhr.
- Zähler noparking: alert etwa gleich der Zahl der Fahrzeuge, remind höchstens 3 je Belegung, report_fail nur bei Cloud-Störungen und zeitlich gestreckt, stuck 0, evidence_fail und evidence_none etwa 0, „(schon vorhanden)“ und „Nachricht schon verschickt“ selten, camera.talk_fail.
- Takt: tick_short plus tick_long etwa 1.200 am Tag bei leerer Fläche (statt 4.320). Erstmeldung bei Einfahrt mit VEHICLE der Kamera nach 120 bis 140 s; Fälle über 180 s zeigen eine Einfahrt ohne VEHICLE.
- Im Log darf nach dem Ausrollen der Cloud kein „ältere Cloud“ mehr stehen.
- Tor-Automatik: Startzeile `vehicle-gate[…]` im Tracker-Log und „Parkfläche Halle: …“ im Hub-Log lesen. Steht dort „alte Einstellung openDoorbird ignoriert“, zählt Halle 2 nur; soll das Tor bei Fahrzeugen öffnen, schaltet der Betreiber „DoorBird öffnen“ im Kiosk ein. Kiosk-Audit `vehicle-gate-open` je Tag vor und nach der Änderung, erwartet 0 bei „zählt nur“. „Tor-Automatik unbekannt“ darf nach dem Neustart des Trackers nicht mehr stehen.
- Tracker: tracker.<aufrufer>.fail unter 2 % der Aufrufe, tracker.*.off nur in Ausfallphasen, tracker.down und tracker.up paarweise, kein Burst wartet länger als 2 × 6 s.
- Vergleich auf dem Ausschnitt: shadow_same, _more und _less, mittlere Sicherheit Ausschnitt gegen ganzes Bild. Umschalten erst, wenn _less etwa 0 ist und _more echte Fahrzeuge sind.
- Diagnose: Halteverbot-Zeilen in improve.jsonl je Tag wenige Dutzend statt eines Eintrags je Durchlauf; der Hinweis „Halteverbot-Prüfung schlägt fehl“ bei 18 von 24.000 nicht mehr offen; „Heute“ zählt nach einem Neustart weiter.
- Belegung: in der Saison occupancy.alert an Seilbahn A und B ab 25 Personen. Parkfläche: parking.frame_skip_error im Normalbetrieb etwa 0, bei einem Stromausfall „Belegung unbekannt“ und nach 10 min die Offline-Prüfung für Halle 2.
- Bewusst offen: Kurzparker unter dem Ruhetakt (60 s, nachts 120 s) werden bei 2:30 min tagsüber in 12 von 24, nachts in 6 von 24 Fällen erkannt; Abhilfe ist die Fahrzeug-Meldung der Kamera oder HUB_NOPARK_FIXED_INTERVAL=1. Nach der Erinnerung bei 120 min kommt für weitere Fahrzeuge derselben Folge keine Nachricht mehr. Ein anderes Fahrzeug, das innerhalb von 15 min fast deckungsgleich an derselben Stelle hält, gilt als das vorige. Setzt die Erkennung bei einem noch nicht gemeldeten Fahrzeug länger als 3 min aus, beginnt seine Standzeit neu. Ein gescheiterter Push mit offenem Ausgang hält den Nachrichten-Schlüssel, die Nachricht wird dann nicht wiederholt. Die Cloud zeigt die Tor-Einstellung noch nicht.

## 2026-11-26 (Gesamtprüfung Hub und Kamera-Erkennung, Netzwerk und Geräte: Tor offen halten endet sicher, DoorBird verbindet zuerst neu, Kamera-Liste ohne Internet, abgelehnte Zugangsdaten, Switch-Abfrage, Soundweb, Auto-Scan, Shelly, Update-Neustart, Kamera-Uhren lesen)

Entscheidungen des Betreibers vom 25.11.2026: „Tor offen halten endet sicher“ (E26), „Kamera-Liste für den Start ohne Internet sichern“ (E27), „Abgelehnte Zugangsdaten nicht endlos probieren“ (E45), „Update-Neustart wartet auf einen ruhigen Moment“ (E47), „Kamera-Uhren stellen“ (E49, zuerst nur lesen; umgestellt wird erst nach Rückfrage im Chat) und Soundweb „Bleiben, seltener anwählen“ (E51). Keine neuen Schalter.

**Befund**

- NETZ-5: Der Hub las das Ende des Offenhaltens nur aus der Kamera-Liste (alle 60 s) oder aus einem einzelnen Auftrag. Ging der verloren, taktete er bis zu 12 h weiter. Ein gescheiterter Impuls wartete einen ganzen Takt (50 s). Ein Auftrag über /api/hub/tasks konnte eine deaktivierte DoorBird offen halten und wurde bei einem Fehlschlag nicht zurückgenommen.
- NETZ-3: Nach einem Abbruch der Dauerverbindung suchte der Hub zuerst eine neue Adresse (Ping-Sweep und Router-Abfrage), erst danach verband er neu. Lücken im Log: 23.11. 57,5 s, 24.11. 51,9 s. Antwortete nach einem DHCP-Wechsel unter der alten Adresse ein anderes Gerät per HTTP, suchte der Hub nie nach der neuen Adresse.
- NETZ-6: Antwortete die Cloud beim Start nicht, kannte der Hub weder Kameras noch DoorBird. In der Simulation „Kamera-Liste 503 bis s 20“: 0 Abfragen in 20 s, erste Abfrage bei s 34.
- NETZ-8: Abgelehnte Zugangsdaten wurden endlos wiederholt; die Kamerasuche schickte die Zugangsdaten einer vermissten Kamera an jede passende Adresse des Scans.
- NETZ-13: Die Auswertung von SNMP, ARP, Soundweb und Gerätetyp hatte keine Tests.
- NETZ-7: Abfrage und Walk liefen gleichzeitig auf denselben Switch, die VLAN-Prüfung zur selben Zeit. Ein ausgefallener Switch war in der Cloud nicht zu sehen, eine leer gelieferte MAC-Tabelle wurde wie eine echte gespeichert.
- NETZ-10: Zwei nicht erreichbare Soundweb-Prozessoren ohne Regler wurden mindestens 1.440-mal am Tag angewählt und 1.440-mal gemeldet.
- NETZ-11: Der Auto-Scan schrieb jedes gesehene Gerät einzeln; ein unvollständiger Scan zählte alle Fehlenden hoch und löschte unzugeordnete beim zweiten Mal.
- NETZ-12: Jedes Gerät mit Port 80 bekam alle 15 min eine Tasmota-Probe (96 am Tag), auch Kameras, DoorBirds und Switches, alle gleichzeitig. Die Hersteller-Suche für Hue und Nuki lief alle 10 min. Jeder Shelly-Status kostete eine zusätzliche Anfrage an /shelly.
- BETR-4: Der Update-Neustart wartete nur auf Bewertungen des Wächters, nicht auf Kennzeichen-Burst, Ansage oder Auftrag.
- ERG-12: GetNtp lief alle 30 min (48 am Tag je Kamera), eine Abweichung um ganze Stunden war nicht als Zeitzone erkennbar.

**Änderungen**

- Tor offen halten (`hub/src/hold-rules.ts`, neu; `hub/src/doorbird.ts`; Cloud `src/lib/door-hold.ts`, Routen `api/hub/cameras/[id]/door-hold`, `api/cameras/[id]/door-hold`, `api/hub/tasks`): Die Antwort auf jede Impuls-Meldung trägt den Sollzustand (until). Der Hub beendet das Offenhalten, wenn die Cloud es nicht mehr kennt, und übernimmt eine Verlängerung, nie über die bisherige Obergrenze. Die Antwort gilt nur für genau das Offenhalten, zu dem der Impuls gehörte. Antwortet die Cloud nicht, läuft der Takt bis zum lokal bekannten Ende. Ein gescheiterter Impuls wird nach 3, 8 und 20 s wiederholt, aber nur, wenn er sicher nicht angekommen ist (Fehlerantwort der DoorBird oder keine Verbindung); nach einem Zeitlimit geht es im normalen Takt weiter, damit kein zweiter Impuls ein fahrendes Tor trifft (`fastRetrySafe`). Gelingt eine Wiederholung, beginnt der Takt ab ihr neu (vorher konnten zwei gelungene Impulse 19 s auseinander liegen). /api/hub/tasks lehnt das Offenhalten einer deaktivierten DoorBird ab, ein gescheiterter Start wird zurückgenommen.
- DoorBird (`hub/src/camera-poll-rules.ts` shouldRelocate, httpAnswerOutcome): Nach einem Abbruch verbindet der Hub ab 3 s neu, eine neue Adresse sucht er erst nach zwei Netzfehlern in Folge, im Hintergrund und höchstens einmal je Minute. Antwortet unter der Adresse ein Gerät mit anderer MAC, zählt das als Netzfehler und nicht als abgelehnte Zugangsdaten (Zähler doorbird.foreign_answer). Die Zeile „wieder erreichbar“ nennt die Dauer der Lücke.
- Kamera-Liste (`hub/src/camera-cache-rules.ts`, neu; `hub/src/cameras.ts`; `hub/src/atomic-file.ts`): Kopie in `.cache/cameras.json`, von Anfang an Modus 0600, einmal am Tag und bei Änderung geschrieben, höchstens 14 Tage alt verwendet. Aus der Kopie öffnet der Hub keine Tür, hält nichts offen und lässt keinen Lieferdienst ein (nur melden). Sobald die Cloud antwortet, ersetzt ihre Antwort die Kopie.
- Abgelehnte Zugangsdaten (`hub/src/auth-latch.ts`, `auth-latch-store.ts`, neu; `doorbird.ts`, `shelly.ts`): Nach zwei Ablehnungen derselben Zugangsdaten keine Versuche mehr, außer einem einzelnen je 24 h. Neue Zugangsdaten, eine neue Adresse oder ein Erfolg lösen die Sperre. Bei der DoorBird zählen nur Ablehnungen der Dauerverbindung: Eine Ablehnung beim Öffnen oder beim Bild kann an einer fehlenden Berechtigung für genau diese Funktion liegen (etwa Relais 2) und sperrt nicht (Zähler doorbird.auth_rejected_function). Ist die MAC der Gegenstelle gerade nicht lesbar, zählt eine Ablehnung ebenfalls nicht. Antwortet beim einzelnen Versuch niemand oder ein anderes Gerät, sucht der Hub sofort nach der DoorBird. Zustand in `.cache/auth-latch.json` (0600, nur Fingerabdruck). Log-Zeile, Hub-Ereignis und Meldung über /api/hub/alerts.
- Kamerasuche (`hub/src/camera-probe-rules.ts`, neu): nur Adressen im letzten Subnetz der Kamera und im Kamera-Netz, nie die Adresse eines anderen eingerichteten Geräts, je Adresse höchstens einmal am Tag, nach einer Ablehnung dort nie wieder mit denselben Daten.
- Parser-Tests: `hub/src/snmp.test.ts`, `netmap.test.ts`, `soundweb-protocol.test.ts`, `scanner.test.ts`; in den Modulen nur Funktionen exportiert.
- Switch-Abfrage (`hub/src/snmp-rules.ts`, `snmp.ts`, `vlan-check.ts`; Cloud `src/lib/snmp-ingest.ts`, `src/lib/hub-status.ts`, Route `api/hub/switch`): eine Abfrage je Switch zur Zeit, VLAN-Prüfung bei Start plus 150 s und dann alle 300 s, leere MAC-Tabelle nach gefüllter als Teilausfall (die vorige bleibt), ein ausgefallener Switch steht mit Fehler in der Cloud und löscht dort keine Zuordnung. Log nur bei Änderung, stündlich eine Bilanz (snmpRunSummary).
- Soundweb (`hub/src/soundweb-rules.ts`, `soundweb.ts`; Cloud `src/lib/soundweb.ts`): Anwählen nach 10 schnellen Versuchen alle 5 min, nach einer Stunde alle 15 min, ohne Regler von Anfang an alle 15 min; getrennte Geräte nur bei Wechsel und alle 10 min gemeldet; ein Auftrag verbindet sofort. Die Geräte bleiben eingerichtet.
- Auto-Scan (`src/lib/network-scan-diff.ts`, `network-scan-ingest.ts`; `hub/src/scanner-rules.ts`): unveränderte Geräte in einer Schreibung, Ping-Zeit erst ab 20 ms Abweichung, alles an das Konto gebunden. Ein Scan mit weniger als der Hälfte der zuletzt gesehenen Geräte (partial) löscht und zählt nichts.
- Shelly und Geräteliste (`hub/src/shelly-rules.ts`, `shelly.ts`, `smart-devices-rules.ts`, `smart-devices.ts`): Generation je Gerät 1 h gemerkt; ein verlorener Aus-Befehl wird einmal nach 400 ms wiederholt, ein An-Befehl nur, wenn die Verbindung gar nicht zustande kam (sonst startete eine am Gerät eingestellte Selbstabschaltung neu); nie Umschalten, Türöffner, Tore oder Taster, und nicht, wenn inzwischen ein neuerer Befehl kam. Keine Tasmota/Hue-Proben an Kameras, DoorBirds und Switches, andere Geräte ohne Treffer einmal am Tag, höchstens 8 gleichzeitig; Hersteller-Suche alle 6 h und beim Öffnen der Geräteliste; eine Hue-Kopplung wird nur gelöscht, wenn unter der Adresse die eigene Bridge antwortet.
- Update-Neustart (`hub/src/updater-rules.ts` restartAllowed, `updater.ts`): wartet bis zu 2 min, solange ein Kennzeichen-Burst, eine Ansage oder ein Auftrag läuft, danach wie bisher bis zu 3 min auf den Wächter. Neustart aus der Cloud und Beenden durch das System bleiben sofort.
- Kamera-Uhren (`hub/src/camera-clock.ts`, `cameras.ts`): Art der Abweichung (Zeitzone, Drift, ok), Zeit-Einstellungen einmal am Tag mit lesenden Befehlen, Plan je Kamera mit Abweichung als eine Zeile „(nicht umgestellt)“ im Log und in der Diagnose. An den Kameras wird nichts umgestellt.

**Prüfung**

- Hub-Tests 1.413 (1.412 grün, 1 übersprungen), vorher 1.233. Typprüfung von Hub und Cloud ohne Fehler, ESLint auf den geänderten Cloud-Dateien ohne Befund.
- Simulation „Kamera-Liste 503 bis s 20“: 9 statt 0 Abfragen je Kamera im Fenster, erste Sichtung bei s 4 statt s 36; im Standardlauf Abfragen je Kamera gleich wie die Basis.
- Rückbau-Proben: Die neuen DoorBird-Tests scheitern mit dem alten Verhalten.
- Unabhängige Gegenprüfung mit nachgestellten Abläufen: 7 Punkte, 5 behoben (Sperre durch Ablehnung einer einzelnen Funktion, Sperre durch ein anderes Gerät bei nicht lesbarer ARP-Tabelle, Takt nach gelungener Wiederholung, An-Befehl des Shelly, fehlende Fehlercodes EHOSTDOWN und Verbindungs-Zeitlimit), 2 zur Kenntnis (siehe unten); die Nachbesserung noch einmal unabhängig geprüft, mit Mutationsproben für die neuen Tests. Die Abläufe danach: Relais 1 und die Dauerverbindung bleiben bei einer Ablehnung von Relais 2 oder Bild; Impulse bei 0, 50 ✗, 53 ✗, 61 ✗, 81 ✓, dann 131 s statt 100 s; ohne lesbare ARP-Tabelle keine Sperre.

**Nächster Schritt** (eine bis zwei Wochen beobachten)

- Tor offen halten: doorbird.hold_adopt, doorbird.hold_retry, hold_end mit Grund. Kein Eintrag „offen gehalten“ im Dashboard ohne Impulse im Hub-Log. Gescheiterte DOORBIRD_HOLD-Aufträge gegen doorHoldError abgleichen.
- DoorBird: doorbird.monitor_gap_ms je monitor_ok, Ziel Lücke unter 10 s im Median; doorbird.foreign_answer erwartet 0 (sonst DHCP-Reservierung prüfen).
- Kamera-Liste: camera.cache_loaded und camera.cache_rejected.
- Zugangsdaten: auth_rejected, auth_locked und auth_released je Gerät; camera.probe, probe_rejected und probe_skipped je Tag.
- Switches: snmp.partial_<host> und snmp.fail_<host>; mehr als ein Teilausfall am Tag heißt Zeitlimit oder Walk-Größe prüfen.
- Soundweb: Versuche je Tag ohne Regler etwa 96 statt mindestens 1.440, Meldungen getrennter Geräte 144 statt 1.440.
- Geräteliste: smart.probe je Tag und smart.probe_skip_known; shelly.switch_retry gegen switch_retry_ok.
- DoorBird-Funktionen: doorbird.auth_rejected_function; mehr als 0 heißt Berechtigung des Hub-Benutzers für Relais oder Bild in der DoorBird-App prüfen.
- Update: Zeilen „Update: Neustart nach … Warten auf …“; erreicht mehr als einer von zehn Neustarts die 2 min, den Auftragstyp prüfen.
- Kamera-Uhren: Zeilen „Kamera-Uhr …“ sammeln und dem Betreiber den Plan vorlegen; umgestellt wird erst nach seinem Ja. Ziel: alle Kameras im Takt, keine mit „Zeitzone“.
- Auto-Scan: Zeilen „unvollständig“; mehr als eine am Tag heißt Scan-Zeitlimit oder VLAN-Erreichbarkeit prüfen.
- Bewusst offen: Der einzelne Versuch je 24 h nach einer Sperre geht über den Wortlaut der Zusage hinaus, damit sich eine Sperre löst, wenn der Fehler am Gerät lag. Die regelmäßige Abfrage eingerichteter Reolink-Kameras mit falschem Passwort ist nicht gesperrt, nur die Kamerasuche. Ein Lösen über einen neu gespeicherten Eintrag ohne geänderte Zugangsdaten ist nicht verdrahtet. Die Ping-Zeit kann bis 20 ms vom zuletzt gemessenen Wert abweichen. Im ungünstigsten Fall dauert ein Update-Neustart 5 statt 3 min, der neue Code liegt in dieser Zeit schon auf der Platte. Eine DoorBird in einem gerouteten Netz, deren MAC der Hub nicht nachschlagen kann, wird nach abgelehnten Zugangsdaten nicht gesperrt (wie vor dieser Änderung). Die Frist „eine fremde Adresse einmal am Tag“ der Kamerasuche gilt für alle Kameras gemeinsam.

## 2026-11-26 (Gesamtprüfung Hub und Kamera-Erkennung, Livebilder Teil 1: RTSP nur lokal, Personen-Boxen nur auf frischem Bild, weniger Last in der Großansicht, Safari-Aufbau gestaffelt, go2rtc-Wächter ehrlich, tote Kamera ruhig, neue Oberfläche nach Update)

Prüfung „Livebilder“ (Log-Fenster 22.11. 11:58 bis 26.11. 20:00 UTC). Keine Kamera- oder Netzwerk-Einstellung geändert; neu ist nur der Schalter HUB_GO2RTC_YAML=0.

**Befund**

- LIVE-1: Die von der Kiosk-App erzeugte go2rtc.yaml setzte keine Lausch-Adresse für den RTSP-Server von go2rtc (nur api, log, webrtc, streams). Einziger Abnehmer im Repo ist der Tracker über rtsp://127.0.0.1:8554. Der Hub ergänzte die Datei nur um `ffmpeg:` und schrieb die Lausch-Adressen von go2rtc nirgends ins Log.
- LIVE-4: Lieferte go2rtc kein frisches Bild, rechnete die Großansicht die Personen-Boxen auf dem letzten bekannten Bild (nach einem Neustart vom Datenträger, Alter unbekannt) und trug Namen weiter. Das Feld `stale` wertete die Zentrale nicht aus. Auslöser kommen vor: 13 Meldungen „ohne Daten“ in 4,3 Tagen, einmal 52 und einmal 70 min lang.
- LIVE-5: Die Boxen kamen etwa jede 1,2 s aus dem Hauptstream (4K-JPEG über ffmpeg, der Tracker rechnet ohnehin mit 640 px), jedes Bild landete zusätzlich unter hub/.cache/frames/. Solange abgefragt wurde, holte eine Auffrischung alle 45 s Bilder aller Sub-Streams, die niemand anzeigt. Hochgerechnet je Stunde offener Großansicht bis zu 3.000 Box-Bilder und 1.040 Vorschaubilder ohne Abnehmer.
- LIVE-6: In Safari scheiterte der erste Verbindungsaufbau bei 17 von 24 Kacheln (Chrome am selben Mac 0 von 60). Alle Kacheln verbanden im selben Moment, der Neuversuch kam erst nach 15 s Zeitlimit, die Kacheln waren rund 19 s schwarz. Die Meldung der Kachel nannte weder Dauer noch Kandidat.
- LIVE-7: Von 13 Meldungen „ohne Daten“ waren 8 nach genau einem Takt (2 min) wieder in Ordnung; ein fallender Byte-Zähler nach einem Neuaufbau zählte als Stillstand. Die letzte Gutmeldung lautete „wieder alle 35 Streams in Ordnung“, obwohl zwei Kameras aus waren; geprüft werden nur Streams mit Zuschauern. Kameras ohne Stream oder Streams ohne Kamera sah der Wächter nicht. Die Kurzfassung für hub_status rechnete gegen eine leere Vergleichsliste.
- LIVE-9: Die Kachel einer seit dem 14.11. abgeschalteten Kamera versuchte ohne Ende alle 15 s eine Verbindung. Am 22.11. waren das 42 Proxy-Zeilen „HTTP 500“ mit drei wechselnden Fehlertexten und 13 Kachel-Meldungen, 55 von 184 Live-Zeilen des Tages, rund 16 Zeilen je Stunde bei offener Zentrale. Den Fehlertext von go2rtc übernahm der Proxy bis 160 Zeichen ins Log, ohne Quell-URLs zu maskieren.
- LIVE-10: Der Hub hatte in 54 h 18 Updates ohne Neustart; offene Tabs und Home-Bildschirm-Apps liefen mit dem alten Oberflächen-Code weiter (25.11. zwei Proxy-Fehlerzeilen ohne passende Kachel-Meldung).

**Änderungen**

- RTSP-Server (`webcams/lib/go2rtc.ts`, `webcams/infra/go2rtc.example.yaml`, `webcams/README.md`; Hub `hub/src/ffmpeg-yaml.ts` withLoopbackRtsp, planGo2rtcYaml, go2rtcExposure, `hub/src/ffmpeg-setup.ts`): RTSP-Server von go2rtc nur noch über 127.0.0.1, der Tracker liest lokal (`rtsp:\n  listen: "127.0.0.1:8554"`). Der Hub ergänzt den Block in einer yaml ohne Top-Level-`rtsp:` (ein vorhandener bleibt unverändert) zusammen mit `ffmpeg.bin` in einer Schreibung; go2rtc startet nur neu, wenn sich der Inhalt ändert. Beim Start und wenn der Wächter (alle 2 min) eine geänderte Datei sieht, etwa vom Kiosk mit älterem Stand. Schlüssel in Anführungszeichen (`"rtsp":`) und ein BOM vor der ersten Zeile zählen als vorhanden. Der Kiosk übernimmt beim Neuschreiben einen vorhandenen `ffmpeg:`-Block (existingFfmpegBlock), sonst folgte jedem Speichern im Admin ein zweiter Neustart durch den Hub. Scheitert das Schreiben, kommt die Zwischendatei weg, die Zeile erscheint je Dateistand einmal, der nächste Versuch mit der nächsten Änderung. Nur auf macOS wie bisher; `HUB_FFMPEG_SETUP=0` lässt nur ffmpeg aus, `HUB_GO2RTC_YAML=0` jedes Lesen und Schreiben der yaml (`hub/.env.example`). Eine Zeile „go2rtc: API 127.0.0.1:1984, RTSP 127.0.0.1:8554“, Zähler camera.go2rtc_exposed, wenn eine Adresse nicht lokal ist. WebRTC-Port 8555 unverändert.
- Personen-Boxen (`hub/src/live-people-rules.ts` boxesUsable, `live-people.ts`, `ui/dashboard.js`): Nur ein frisch geholtes Bild, höchstens 3 s alt, geht an den Tracker. Sonst kein Tracker-Aufruf, keine Namen, die letzten Boxen bleiben unberührt, Antwort `persons: null, people: 0, label: null, stale: true` (Zähler camera.boxes_stale). Die Zentrale blendet dann Boxen und Personen-Badge aus und zeigt „Personen: kein aktuelles Bild“.
- Last der Großansicht (`ui/rtc-rules.js` boxStream, `hub/src/frame-cache.ts`): Boxen aus dem Sub-Stream, der Hauptstream nur ohne Sub-Stream. Keine Kopie mehr auf der Platte, keine Auffrischung im Hintergrund. /api/go2rtc/frame.jpeg liefert weiter Einzelbilder (Zwischenspeicher im Speicher). Zähler tracker.live.ms_sum (Bild plus Tracker, Mittel je tracker.live.ok).
- Verbindungsaufbau der Kacheln (`ui/rtc-rules.js` rtcTimeoutMs, gatePlan, pickCandidate; `ui/dashboard.js`; `hub/src/go2rtc-status-rules.ts` clientReport): erster Versuch 6 s Zeitlimit, weitere 15 s (Mäher immer 15 s), nach „ice-timeout“ sofort neu. Höchstens 3 Kacheln beginnen gleichzeitig, jede gibt ihren Platz spätestens nach 2 s frei (früher, sobald sie verbunden ist); die Großansicht verbindet ohne Wartezeit. Die Meldung an /api/go2rtc/client trägt `ms` (Angebot bis „connected“) und bei „ice-timeout“ und „abbruch“ den gewählten oder zuletzt geprüften Kandidaten der Gegenseite (Typ, Adresse, Port, Zustand). Der Hub nimmt die Felder nur nach festen Mustern auf: „Aufbau 4,2 s, Kandidat host 192.168.1.10:8555 in-progress“.
- go2rtc-Wächter (`hub/src/go2rtc-status-rules.ts` liveProblems, confirmStalls, streamCoverage, coverageLine, watchOkLine; `go2rtc-status.ts`, `index.ts`): Ein fallender Byte-Zähler gilt als Neuaufbau, „ohne Daten“ erst nach zwei Blicken in Folge. Abgleich über den Host ohne RTSP: Kameras ohne Stream, Streams ohne Kamera, Streams einer Kamera, die offline ist; eine Zeile bei Änderung (Zähler camera.stream_coverage), ab 60 s nach dem Start. Gutmeldung nennt, was geprüft wurde: „go2rtc: alle 4 angesehenen Streams liefern Daten (31 ruhen, 2 Kameras offline)“. Die Kurzfassung (hub_status.live) übernimmt den Befund des letzten Blicks und den Abgleich (coverage).
- Tote Kamera (`ui/rtc-rules.js` tileRetryDelay, reconnectNow; `go2rtc-status-rules.ts` webrtcFailureStep, webrtcOkStep, maskUrlAuth; `dashboard.ts`): Wartezeit online 2, 4, 8, dann 15 s; ist die Kamera laut Hub offline, nach dem ersten Fehlschlag 120 s; wird sie wieder erreichbar, verbindet die Kachel sofort. Die Großansicht behält die kurzen Wartezeiten. Proxy-Zeilen je Stream: die erste sofort, danach höchstens stündlich „weiter ohne Bild (N Versuche seit HH:MM), zuletzt …“. Eine gelungene Anfrage beendet die Zählung erst, wenn der letzte Fehlschlag mindestens 10 min zurückliegt; eine Kamera, die abwechselnd Bild liefert und scheitert, bleibt so bei der stündlichen Zeile. Hatte der Stream mindestens 10 min Bild, kommt eine neue Störung sofort als erste Zeile (webrtcOkStep). Ebenso die Kachel-Meldung „signal: …“, das Echo dieser Fehler aus dem Browser, mit „live“ als Erfolg (sonst alle 5 min je Stream und Art wie bisher). Im Fehlertext wird vor dem Kürzen und Loggen `//benutzer:passwort@` zu `//***@` (alles bis zum letzten `@` vor dem Host, auch mit `/` im Passwort), Werte von `user=`, `password=`, `token=` und ähnlichen Parametern zu `***`.
- Neue Oberfläche nach Update (`dashboard.ts` uiVersion, `hub/src/ui-stamp.ts`, `ui/rtc-rules.js` shouldReload, `ui/dashboard.js`, `dashboard.html`, `dashboard.css`, `sw.js`): Stand aus den rohen ETags von dashboard.html, dashboard.js, dashboard.css und rtc-rules.js. Der Hub setzt ihn beim Ausliefern in die Seite ein (`<meta name="hub-ui">`, das ETag der Seite folgt dem Stand), /api/status liefert den aktuellen als `ui`. Die Seite vergleicht jede Minute sowie beim Sichtbarwerden. Neu geladen wird nur, wenn der Tab wieder sichtbar wird und weder Großansicht, Dialog, Vollbild noch der Bereich Aktionen offen ist, höchstens einmal je Stand; sonst der Hinweis „Neue Version, neu laden“. rtc-rules.js wird als eigene Datei ausgeliefert und vom Service Worker wie dashboard.js vorgehalten (Cache hub-shell-v2).

**Prüfung**

- Hub-Tests 1.450 (1.449 grün, 1 übersprungen), vorher 1.413; neu `hub/src/rtc-rules.test.ts` (lädt `ui/rtc-rules.js` wie der Browser) und `ui-stamp.test.ts`, Fälle in `ffmpeg-yaml.test.ts` (auch Schlüssel in Anführungszeichen, BOM, Schalter), `go2rtc-status-rules.test.ts` (auch Maskierung, flatternde Kamera, Grenzen), `live-people-rules.test.ts`. Kiosk-Tests 115 grün (`webcams/tests/go2rtc-yaml.test.ts`: `rtsp:` mit Loopback, ffmpeg-Block bleibt beim Neuschreiben). Typprüfung von Hub, Cloud und Kiosk ohne Fehler, Geheimnis-Suche ohne Befund.

**Messpunkte** (die nächsten Wochen)

- RTSP: Beim Start eine Zeile „go2rtc: API 127.0.0.1:1984, RTSP 127.0.0.1:8554“; camera.go2rtc_exposed erwartet 0. Gegenprobe am Hub-Rechner: `lsof -nP -iTCP:8554 -sTCP:LISTEN` zeigt 127.0.0.1. tracker.*.ok je Tag unverändert (der Tracker liest weiter). „go2rtc.yaml ergänzt: rtsp“ nach dem ersten Start heißt: Der Kiosk schreibt mit älterem Stand, Kiosk neu bauen. „ergänzt: ffmpeg“ ist einmal normal (erste yaml ohne ffmpeg-Pfad); kommt es nach einem Speichern im Admin wieder, übernimmt der Kiosk den Block noch nicht (Kiosk neu bauen). „go2rtc.yaml nicht ergänzt“ heißt: Datei nicht schreibbar, Rechte am Hub-Rechner prüfen.
- Personen-Boxen: camera.boxes_stale im Verhältnis zu tracker.live.ok; tracker.live.ms_sum / tracker.live.ok als Aufwand je Abfrage. Bei offener Großansicht im Sub-Stream kein Zuschauer der Boxen auf dem Hauptstream.
- Safari: Anteil „ice-timeout“ bei Versuch 0 beim Öffnen der Zentrale (vorher 17 von 24) und „Aufbau … s“ in den Zeilen „live“ und „bild-ok“ (vorher rund 19 s bis zum Bild). Die Kandidaten-Angaben zeigen, ob Safari an 127.0.0.1 oder an einer LAN-Adresse hängen bleibt.
- go2rtc-Wächter: Anteil der Meldungen „ohne Daten“, die nach einem Takt wieder in Ordnung sind (vorher 8 von 13), erwartet 0. Zeilen „kein Stream für Kamera“ und „Stream ohne Kamera“ sammeln; jede ist ein Zuordnungsfehler zwischen Cloud und Kiosk.
- Tote Kamera: Zeilen je Stunde für eine abgeschaltete Kamera bei offener Zentrale, vorher rund 16, jetzt höchstens 2 (eine Zeile des Proxys, eine Kachel-Meldung).
- Neue Oberfläche: Zu jeder WebRTC-Fehlerzeile des Proxys gibt es eine passende Kachel-Meldung „Zentrale (…)“.

**Bewusst offen**

- Weitere Punkte warten auf eine Entscheidung.

## 2026-11-26 (Gesamtprüfung Hub und Kamera-Erkennung, Livebilder Teil 1b: go2rtc-API wie im Kiosk auf 127.0.0.1)

**Befund**

- Der aktuelle Kiosk-Stand schreibt in die go2rtc.yaml `api: listen: "127.0.0.1:1984"`, ältere Stände nicht. Der Hub ergänzte bisher nur `ffmpeg:` und `rtsp:`; die Zeile beim Start („go2rtc: API …, RTSP …“) zeigt seit Teil 1, welche Adressen gelten.

**Änderungen**

- `hub/src/ffmpeg-yaml.ts` withLoopbackApi, apiLoopbackAllowed, kioskGo2rtcUrl, isLoopbackUrl; `hub/src/ffmpeg-setup.ts`: Fehlt der Block `api:`, hängt der Hub ihn mit `listen: "127.0.0.1:1984"` an. Steht im Block eine einzeilige `listen`-Zeile ohne 127.0.0.1 (etwa ":1984", auch leer, `null` oder `~`, was go2rtc als ":1984" liest), ersetzt er nur deren Wert, der Port bleibt. Gelesen wird nur die Ebene des ersten Kinds. Ein Block ohne `listen`-Zeile, die Kurzform `api: { … }`, mehrzeilige oder besondere Werte (Block-Skalar, Anker, Tag) und `""` (API aus) bleiben unverändert. Die Startzeile liest leere Werte jetzt wie go2rtc. Erreicht der Neustart go2rtc nicht, sagt die Startzeile das; die Datei gilt dann ab dem nächsten Start von go2rtc.
- Nur wenn der Hub (HUB_GO2RTC_URL) und der Kiosk (settings.go2rtcUrl in webcams/config.json) go2rtc über 127.0.0.1 oder localhost ansprechen (::1 zählt nicht, die API lauscht danach nur auf 127.0.0.1); ist die Kiosk-Konfiguration nicht lesbar, bleibt die Datei. Dann steht in der Startzeile „(API bleibt so: Hub oder Kiosk sprechen go2rtc nicht über 127.0.0.1 an)“.
- Gleicher Ablauf wie in Teil 1: eine Schreibung, Neustart von go2rtc nur bei Änderung, beim Start und wenn sich die Datei ändert. Kein neuer Schalter (`HUB_GO2RTC_YAML=0` schaltet auch das ab). WebRTC-Port 8555 unverändert, die Zentrale und der Kiosk holen Signalisierung und Standbilder weiter über ihre Proxys.

**Prüfung**

- Neue Fälle in `hub/src/ffmpeg-yaml.test.ts`: Wert ersetzen (Port, Anführungszeichen, Kommentar, CRLF, BOM, leer, `null`, `~`), Block anhängen, lokale und unklare Fälle unverändert (mehrzeilig, Anker, Tag, Kurzform, tiefer eingerückt), fremder `listen` eines anderen Blocks, Kopf mit Kommentar, Freigabe nur mit 127.0.0.1 oder localhost, zweiter Durchlauf ohne Änderung. Unabhängig gegengelesen (Gegenprobe mit dem yaml-Parser von go2rtc), die Befunde behoben.

**Messpunkte**

- Startzeile nach dem Update: „go2rtc: API 127.0.0.1:1984, RTSP 127.0.0.1:8554 (go2rtc.yaml ergänzt: api; …)“, danach camera.go2rtc_exposed 0. Steht „API bleibt so“, nutzt Hub oder Kiosk eine andere go2rtc-Adresse; dann am Hub-Rechner die Einstellung im Kiosk-Admin prüfen.
- Livebilder in Zentrale und Kiosk, Vorschaubilder und tracker.*.ok je Tag unverändert.

## 2026-11-27 (Gesamtprüfung Hub und Kamera-Erkennung, Livebilder Teil 2: Livebild und Vorschau je Kamera)

Neue Einstellung je Kamera „Livebild und Vorschau“ (Cloud: Camera.liveMode). Gesetzt wird sie im Kamera-Formular der Cloud; im Code steht für keine Kamera ein Wert, alle Kameras bleiben „automatisch“, bis der Betreiber umstellt. Erkennung, Wächter, Gesichter, Kennzeichen, Tracker und Parkfläche laufen in jedem Modus weiter.

**Befund**

- Jede Kamera hatte genau einen Umgang mit Bildern: Die Zentrale baute für jede Kachel sofort ein Livebild auf, Bewegung schickte ein Vorschaubild in die Cloud, und die Cloud zeigte es in Kameras, Kontrollzentrum, Räumen, Tor-Dialog, Gerät, Parkfläche und als Ersatzbild am Scan. Eine Kamera nur auf Wunsch zu zeigen oder gar nicht, ging nur über Deaktivieren, und damit endete auch die Erkennung.
- Der Proxy der Zentrale (/api/go2rtc/webrtc, /api/go2rtc/frame.jpeg, /api/live/boxes) gab jeden Stream heraus, den go2rtc kennt, auch einen, der zu keiner Kamera gehört.

**Änderungen**

- Werte: leer oder "AUTO" = automatisch (wie bisher), "CLICK" = nur auf Tippen, "OFF" = aus. Ein unbekannter Wert gilt in Cloud und Hub wie „nur auf Tippen“. Migration `20261127100000_camera_live_mode` (eine Spalte, kein Wert gesetzt).
- Cloud (`src/lib/camera-live-mode.ts` mit Tests): Formular „Livebild und Vorschau“ mit Hinweis je Wert; die API prüft den Wert wie beim Wächter (ungültig: 400). Wer auf „nur auf Tippen“ oder „aus“ stellt, löscht im selben Update das gespeicherte Vorschaubild. Eingehende Bilder (`/api/hub/cameras/[id]/snapshot`, Personen-, Fahrzeug- und Halteverbot-Meldungen) setzen dann nur noch „zuletzt gesehen“; die Snapshot-Route antwortet trotzdem mit Erfolg (`skipped: "liveMode"`), damit ein älterer Hub weder neu versucht noch Fehler loggt. `/api/cameras/[id]/snapshot` liefert 404, Schnappschuss-Aufträge (Kameras, Kontrollzentrum, Tor-Dialog, MCP camera_snapshot) werden mit 400 abgelehnt, ein Scan legt keinen SCAN_SNAPSHOT-Auftrag an, und `/api/hub/scan-snapshots` verwirft ein Bild solcher Kameras.
- Cloud-Oberfläche: „aus“ zeigt keine Bildfläche (Kontrollzentrum mit Name, Hinweis „Livebild und Vorschau aus“ und allen Tasten für Steuerung, Tür und Offenhalten, nur ohne Bild; Räume ohne Kamera-Kachel, Tor-Dialog nur mit der Taste, in der Kameraliste eine Zeile „Livebild und Vorschau aus“). „nur auf Tippen“ zeigt statt eines Bildes den Satz „Livebild nur in der Zentrale auf Tippen“; Live-Video aus dem LAN startet im Kontrollzentrum und im Tor-Dialog nicht. Der Hinweis „Kamera ohne Bild“ in den Räumen zählt nur noch Kameras mit „automatisch“.
- Hub (`hub/src/live-mode-rules.ts` readLiveMode, previewUploadAllowed, allowedStreams, streamAllowed mit Tests): Die Einstellung kommt mit der Kamera-Liste und bleibt in der lokalen Kopie (`hub/.cache/cameras.json`). Kein Vorschaubild bei Bewegung (Zähler camera.preview_live_mode), kein Bild auf Anfrage (CAMERA_SNAPSHOT), kein Bild beim Klingeln der DoorBird, kein Bild zum Scan (SCAN_SNAPSHOT, `skipped: "liveMode"`).
- Freigabe der Streams (`hub/src/stream-gate.ts` mit Tests, eingebunden in `dashboard.ts`): Livebild, Standbild und Personen-Boxen nur für erlaubte Streams, sonst 403. Gesperrt ist ein Stream einer Kamera mit „aus“ (bei gemeinsamem Host gewinnt „aus“) und, sobald die Kamera-Liste bekannt ist, ein Stream ohne Kamera. Mäher-Streams bleiben erlaubt. Der Stream `doorbird` gehört der Kamera mit seinem Host; passt keine, gehört er jeder DoorBird ohne eigenen Stream. Die Stream-Liste dafür ist höchstens 10 s alt, bei einem unbekannten Namen wird sie neu gelesen. Das Zonen-Bild unter Erkennung liefert bei „aus“ 403.
- Zentrale (`ui/rtc-rules.js` liveModeOf, tileShown, zentraleCams, tapExpired, liveAllowed, tapExpiry, modeChanges mit Tests; `ui/dashboard.js`, `dashboard.html`, `dashboard.css`, `sw.js` Cache hub-shell-v3): `/api/overview` trägt `liveMode` je Kamera und DoorBird. „aus“: keine Kachel, keine Großansicht, kein Sprung aus Räumen oder „Gerade erkannt“. „nur auf Tippen“: Kachel mit Name und „Livebild zeigen“, ohne WebRTC, Standbild oder Boxen. Nach dem Tippen läuft das Livebild, bis „Livebild beenden“ gedrückt wird, die Zentrale verlassen oder die Seite verdeckt wird, höchstens 5 Minuten; nach dem Neuladen ist es aus (gemerkt wird nur im Speicher). Die Großansicht folgt denselben Regeln mit eigener Taste; ein Tippen in der Kachel gilt dort mit, „Livebild beenden“ dort beendet auch das Tippen der Kachel. Ändert sich die Einstellung einer Kamera (in beide Richtungen), verfallen ihre Tippen, Kachel und Großansicht werden neu aufgebaut. Eine Boxen-Abfrage, die erst nach dem Ende des Livebilds zurückkommt, zeichnet nichts. „Gerade erkannt“ zeigt eine Kamera mit „aus“ als reinen Text. Der Schnappschuss in die Cloud steht nur bei „automatisch“ (Großansicht und Gerätekarten; sonst steht dort die Einstellung).
- Kachel „KI“ (`agent/activity-rules.ts` activityImageView, imageModeByName mit Tests; `agent/activity.ts`): Bilder richten sich nach der Einstellung ihrer Kamera. Bei „aus“ kommt der Eintrag ohne Bild, `/api/agent/activity/img/<id>` antwortet 404; bei „nur auf Tippen“ steht „Bild zeigen“, das Bild erscheint erst nach dem Tippen auf den Eintrag. Der Text bleibt immer. Die Kamera steht bei Wächter-Einträgen und Alarmen in `where`; Bilder, die an Telegram gehen (Alarm und Zusatzbilder, Assistent, Kennzeichen-Frage, Belegung), tragen sie jetzt mit (`camera`, nur fürs Protokoll). Einträge ohne bekannte Kamera (ältere Einträge, umbenannte Kameras) zeigen ihr Bild erst auf Tippen, sobald eine Kamera nicht auf „automatisch“ steht; Bilder aus Nachrichten von Personen bleiben. Ändert sich eine Einstellung, lädt die Kachel neu. Wächter, Bildmodell und Telegram-Alarme sind unverändert.

**Prüfung**

- Hub-Tests 1.482 (1.481 grün, 1 übersprungen), vorher 1.457; neu `hub/src/live-mode-rules.test.ts` (10, davon zwei DoorBirds), `hub/src/stream-gate.test.ts` (5: 403 für „aus“, durch für automatisch, Mäher und `doorbird`), Fälle in `rtc-rules.test.ts` (5), `agent/activity-rules.test.ts` (2), `camera-cache-rules.test.ts` (1) und `camera-poll.test.ts` (2: Bewegung an Kameras mit „nur auf Tippen“ und „aus“ ohne Bild und Upload; CAMERA_SNAPSHOT und uploadSnapshot dort `skipped: "liveMode"`, Gegenprobe mit einer automatischen Kamera). Cloud-Tests 1.399 grün, neu `src/lib/camera-live-mode.test.ts` (7). Typprüfung von Cloud und Hub ohne Fehler, Geheimnis-Suche ohne Befund.

**Messpunkte** (die nächsten Wochen)

- camera.preview_live_mode je Tag gegen camera.preview_upload: Nach dem Umstellen einer Kamera sinken die Vorschaubilder um ihren Anteil, „zuletzt gesehen“ bleibt frisch.
- Zeilen mit HTTP 403 vom Proxy der Zentrale: Jede ist ein Stream ohne Kamera oder eine Kamera mit „aus“; tauchen sie ohne Umstellung auf, passen Kamera-Host und go2rtc nicht zusammen (vergleiche „Stream ohne Kamera“ im go2rtc-Wächter).
- Nach dem Update in der Zentrale: Kachel einer Kamera mit „nur auf Tippen“ ohne Bild bis zum Tippen, nach 5 Minuten wieder ohne Bild.

**Bewusst offen**

- Der Wächter bewertet Kameras mit „nur auf Tippen“ und „aus“ weiter wie bisher, und seine Alarmfotos gehen weiter an Telegram (Alarm, Übersicht, Bildserie). Die Einstellung betrifft dort nur die Zentrale (Kachel „KI“).
- Der Öffnungswunsch der DoorBird (`maybeSendGateAlert` in `doorbird.ts`, über die Cloud) schickt sein Foto weiter an Telegram, auch bei „nur auf Tippen“ und „aus“.
- Der Hub-Assistent holt Bilder weiter, wenn jemand ausdrücklich danach fragt (Telegram, Werkzeuge camera_snapshot und look_at_camera); in Telegram kommen sie wie bisher, unter „KI“ folgen sie der Einstellung. Ebenso unverändert: Bilder von Personen- und Fahrzeug-Sichtungen, Beweisbilder des Halteverbots, schon gespeicherte Scan-Bilder und das Bild der Parkfläche vom Tracker (die Cloud speichert es bei „nur auf Tippen“ und „aus“ nicht).
- go2rtc selbst bleibt im LAN erreichbar; die Sperre gilt für den Proxy der Zentrale, nicht für einen direkten Zugriff auf go2rtc (go2rtc.yaml und Kiosk unverändert).
- Das Tippen bei „nur auf Tippen“ prüft der Hub nicht selbst: `/api/go2rtc/webrtc`, `/api/go2rtc/frame.jpeg` und `/api/live/boxes` geben einen erlaubten Stream jederzeit heraus; wann das Bild startet, entscheidet die Oberfläche.
- Die Zuordnung Stream zu Kamera geht über den Host; mehrere Kanäle an einem Host sind nicht abgebildet. Teilt sich eine Kamera mit „nur auf Tippen“ den Host mit einer Kamera mit „automatisch“, kann ihr Bild über den Stream der automatischen Kamera erscheinen. Teilt sich eine Kamera mit „automatisch“ den Host mit einer Kamera mit „aus“, bekommt sie 403. Dasselbe gilt für den Stream `doorbird`: Gehört er per Host einer DoorBird mit „nur auf Tippen“, zeigt eine automatische DoorBird ohne eigenen Stream ihn trotzdem sofort.
