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

### Offen

- Visuell nicht gesehen: die gerenderte Karte im Dashboard braucht eine Session, geprüft sind Datenpfad, Typen und Build.
- Karteileiche `imac-von-aaron` in der Cloud löschen, dann ist die Hubliste sauber.
- Der Hub ist macOS-gebunden (launchd, `vm_stat`, Swift-Vision-OCR im Kennzeichen-Fallback). Für Linux-Hubs müssten `install/`, `system-metrics.ts` und `plate.ts` Alternativen bekommen.

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
