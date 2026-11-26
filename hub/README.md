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
- **Bilder** gehen verkleinert in die Cloud (1280 px, JPEG-Qualität 82); das
  Original bleibt lokal für Gesichts- und Kennzeichen-Pipeline. Das
  Sichtungsbild einer Person speichert die Cloud mit 1280 px und Qualität 75
  (`HUB_PERSON_SNAPSHOT_MAX_PX` 640–3840, `HUB_PERSON_JPEG_QUALITY` 50–95,
  ungültige Werte ergeben den Standard; `image-rules.ts`): Die
  Gesichtserkennung rechnet mit dem Original und schickt ihr Merkmal mit,
  das Bild dient der Anzeige und als Beleg. `HUB_PERSON_SNAPSHOT_MAX_PX=1600`
  und `HUB_PERSON_JPEG_QUALITY=82` stellen die frühere Größe her.
- **Vorschaubild bei reiner Bewegung** (Bewegung oder Tier ohne Person,
  Fahrzeug oder Klingel): Die Kachel in der Cloud bekommt höchstens alle
  5 Minuten je Kamera ein neues Bild, mit 960 px und JPEG-Qualität 70, auch
  wenn das Kamerabild unter den 200 KB liegt, ab denen alle anderen Bilder
  verkleinert werden (`HUB_MOTION_SNAPSHOT_MIN_S`, Standard 300, 0 = alle
  30 s; `HUB_MOTION_SNAPSHOT_MAX_PX`, Standard 960, erlaubt 320–1280,
  0 = 1280 px mit Qualität 82 und der 200-KB-Schranke; ungültige Werte
  ergeben den Standard; Regeln `autoSnapshotDue` und `snapshotPlan` in
  `camera-poll-rules.ts`, `motionPreviewSettings` und `shrinkNeeded` in
  `image-rules.ts`). Meldet die Kamera dabei eine
  Person oder ein Fahrzeug (auch ein Ereignis im Nachlauf,
  `personOrVehicleActive`), ist es keine reine Bewegung: Das Bild kommt wie
  bisher alle 30 s mit 1280 px. Das erste Bild nach dem Start kommt sofort,
  bis eines angekommen ist, gilt der Abstand von 30 s. Person, Fahrzeug, Klingel,
  Scan, Halteverbot und Wächter behalten Takt, Größe und Qualität ihrer
  Bilder. Zähler `camera.preview_upload`, `camera.preview_bytes` (gesendete
  Bytes) und `camera.preview_skip` (Bild, das ohne die 5 Minuten
  hochgeladen worden wäre).
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
- **Gesichter**: InsightFace-Sidecar (`face/server.py`, `buffalo_l`, nur
  Erkennung und Merkmale). Der Dienst rechnet auf der CPU; CoreML ist
  abgeschaltet, weil es bei `buffalo_l` Shape-Fehler wirft.
  Gesucht wird in dem auf 1920 px verkleinerten Bild. Kleine Gesichter
  (Rescue-Zoom, `small_keep`, ROI-Zoom) rechnet der Dienst aus dem
  Originalbild der Kamera. Schalter `FACE_NATIVE` in `hub/.env` (der Hub
  startet den Dienst mit seiner Umgebung):
  - `on` (Standard): Es gilt das Merkmal aus dem Original; das bisherige aus
    dem verkleinerten Bild rechnet der Dienst mit. Findet der Weg über das
    Original in einem Bild kein Gesicht oder scheitert er, gilt dort der
    bisherige Weg.
  - `shadow`: beide Merkmale, es gilt das aus dem verkleinerten Bild.
  - `off`: nur der Weg über das verkleinerte Bild; ebenso `0`, `false`,
    `aus`, `no` und `nein`.

  `on` gilt auch für `1`, `true`, `an`, `ein`, `ja`, `yes` und einen leeren
  Wert, ebenso für jeden anderen Wert, dann mit der Zeile
  „[face] FACE_NATIVE=… unbekannt – es gilt on“.

  In `on` und `shadow` wertet der Hub beide Merkmale eines Gesichts mit
  derselben Schwelle gegen die Galerie (`compareWays` in `face-rules.ts`).
  Zähler je Sichtung: `face.native_same` (gleiches Ergebnis),
  `face.native_new_only` (nur das Merkmal aus dem Original ist bzw. wäre ein
  Treffer), `face.native_old_only` (nur das bisherige),
  `face.native_other_person` (beide treffen verschiedene Personen); je Bild
  `face.native_face_new` bzw. `face.native_face_old`, wenn nur ein Weg ein
  Gesicht fand (`…_match`: es wäre ein Treffer), `face.native_blacklist_kept`
  (Stufe `on`: nur das bisherige Merkmal trifft eine Person der Sperrliste;
  dieser Treffer gilt, im Zweifel Alarm) und `face.native_error`,
  wenn der Weg über das Original scheiterte (Zeile „[face] Weg über das
  Originalbild fehlgeschlagen: …“, auch wenn das Merkmal der Notlösung
  `small_keep` nicht gelingt); dann gilt für das Bild der bisherige Weg ohne
  Vergleich, in `shadow` fällt nur der Vergleich weg. Eine Log-Zeile
  „Gesichts-Vergleich: …“ mit beiden Bestwerten, Schwelle, Listenart und
  Sorte des Gesichts (ohne Namen) gibt es nur, wenn das Ergebnis abweicht.
  Schwellen und die strengere Bewertung hochskalierter Gesichter bleiben in
  allen Stufen gleich. Es gilt das Ergebnis des verwendeten Merkmals, mit
  einer Ausnahme: Trifft in `on` nur das bisherige Merkmal eine Person der
  Sperrliste, gilt dieser Treffer samt Merkmal (`noteOtherWay` und
  `appliedScore` in `face.ts`, auch bei der Prüfung vor dem Zoom). Ein
  Gesicht, das nur der bisherige Weg findet und das zu keinem Gesicht aus
  dem Original passt, gibt der Dienst in `on` nicht weiter (gezählt als
  `face.native_face_new` beim anderen Gesicht). Die Stufe steht in der
  Startzeile des Dienstes
  (`[face] buffalo_l bereit (…, cpu, native=on)`) und in `/health`; der
  Vergleich betrifft nur Bilder über 1920 px Kantenlänge. Die Zeilen
  „[face] zoom …“ nennen den Weg: „(Original)“ oder „aus N px
  (verkleinert)“.

  Rechenzeit: In `on` und `shadow` rechnet der Dienst beide Wege für jedes
  Bild über 1920 px, in dem die Suche kein direkt brauchbares Gesicht findet,
  auch für ein Bild ganz ohne Gesicht (Person von hinten, leere Szene): Die
  zwei vergrößerten Bildausschnitte laufen dann je Weg einmal. Im Labor
  (3840×2160, Bild ohne Gesicht, CPU) sind das 9 statt 7 Aufrufe des
  Detektors und rund 1,5–1,6 s statt 1,2 s je Bild. Solche Bilder kommen
  bei jedem Versuch der Personen-Serie ohne Gesicht vor, ebenso bei den
  Zusatzbildern zum besten Bild und bei der optischen Nahaufnahme, wenn dort
  kein direktes Gesicht gefunden wird; der Abstand der Bilder einer Serie
  wächst entsprechend (im Log an den Zeitstempeln der Zeilen „Versuch N/4
  ohne Gesicht“ abzulesen). `FACE_NATIVE=off` rechnet nur einen Weg.

  Gesichtsgrößen (`size`) zählen für jede Sorte in Pixeln des Kamerabilds
  (`size_scaled`: im verkleinerten Bild, darauf beziehen sich die
  Mindestgrößen des Dienstes), beim Kopf-Ausschnitt (`faceViaZoom`) in
  Pixeln des vergrößerten Ausschnitts. Das beste Bild einer Serie wählt
  `faceQuality` (`face-rules.ts`) aus Detektor-Sicherheit, Größe,
  Frontalität und Schärfe; fehlt ein Messwert, gilt 0,5, hochskalierte
  Gesichter zählen halb, die Notlösung `small_keep` ein Viertel. Die
  Merkmale aller Bilder derselben Person werden gemittelt
  (`fuseEmbeddings`); die Schwelle richtet sich nach dem besten Bild. Steckt
  ein hochgerechnetes Bild im Merkmal, meldet das Hub-Ereignis die Sichtung
  dem Wächter als hochgerechnet (strengere Entwarnung).

  Zeilen ohne Treffer nennen Sorte, Größe und Sicherheit des Gesichts
  (`faceLabel`, z. B. „Mini-Gesicht (rescue_zoom, 32 px, det 0.66)“),
  „Upload OK“ die Größe des gesendeten Bilds und dahinter das Original. Der
  Hinweis zu Beinahe-Treffern im Improve-Snapshot kommt erst ab fünf
  Beinahe-Treffern direkt gefundener Gesichter in 24 h, gezählt seit dem
  Start des Hubs (`nearMissHint`).

  Mit jeder Personen-Sichtung (Kameras und DoorBird) schickt der Hub die Güte
  des Gesichts als Query-Parameter mit (`sightingQualityParams` in
  `face-rules.ts`): `faceSize` (Größe in dem Bild, aus dem das Merkmal
  stammt, `embedSize`: bei direkt gefundenen Gesichtern im verkleinerten
  Suchbild bis 1920 px, ein Gesicht mit 100 px auf einer 4K-Kamera zählt
  also 50 px; bei hochgerechneten im Kamerabild; fehlt beim
  Kopf-Ausschnitt), `faceUpscaled` (1/0), `faceDetScore` und `faceMargin`
  (Abstand zur zweitbesten Person aus demselben Abgleich wie `matchScore`,
  `galleryMargin`; fehlt ohne zweite Person). Bei einer gemittelten Serie
  gelten Größe und hochgerechnet des schwächsten Bilds, das ins Merkmal
  einging (`fuseEmbeddings` → `series`): Steckt ein hochgerechnetes Bild im
  Merkmal, geht `faceUpscaled=1` mit. Die Cloud speichert die Angaben an
  der Sichtung und lernt nur aus klaren Treffern dazu: direkt gefunden, ab
  64 px, Score ab 0,60, Abstand ab 0,10, nur bei Personen der Whitelist,
  nie bei gesperrten (`src/lib/face-clusters.ts`, Log „[face auto-learn] …
  grund=…“). Bei der
  Zuordnung von Hand und bei „Profil optimieren“ werden gute Gesichter
  zuerst Sample, hochgerechnete nur ohne Besseres (Log „[face
  zuordnung]“). „Upload OK“ nennt die gesendete Güte, z. B. „Gesicht 96 px
  direkt, Abstand 0.153“. Eine Cloud, die die Parameter nicht kennt, nimmt
  die Sichtung wie bisher an.

  Bei einer Person holt der Hub das erste Bild sofort, bis zu drei weitere im
  Abstand von 1,2 s; ein Aussetzer des Personen-Signals beendet die Serie
  nicht, erst 4 s ohne Signal (`person-pipeline-rules.ts`, Zähler
  `face.signal_gap`, `face.skip_inactive`). Zusatzbilder für das beste Bild
  warten höchstens 5 s auf die Kamera.
  Wiederholungen (Regel `shouldStoreSighting` in `face-rules.ts`): Der Hub
  merkt sich je Kamera die Uploads der letzten 10 Minuten (Zeit, Person oder
  Merkmal, Güte; nur im Arbeitsspeicher, höchstens zehn). Eine Sichtung ist
  eine Wiederholung, wenn dieselbe erkannte Person dort vor weniger als
  5 Minuten hochgeladen wurde oder ein unbekanntes Gesicht einem dieser
  Uploads ähnelt (Kosinus ab 0,5) und nicht deutlich besser ist (unter
  1,3-facher Güte). Gesperrte Personen und die Überwachungszeit 22–7 Uhr
  Ortszeit sind ausgenommen (nach der Uhr des Hubs; Stunde nicht lesbar: wie
  Überwachungszeit). Zeitplan und Schalter der Überwachung in der Cloud fragt
  der Hub dafür nicht ab; dort ist das Fenster einstellbar (Voreinstellung
  22–8 Uhr), und sie lässt sich von Hand scharf schalten. Vor `skip` beides
  abgleichen.
  `HUB_SIGHTING_REPEAT=count` (Standard) zählt nur, hochgeladen wird jede
  Sichtung: Zähler `face.repeat_known`, `face.repeat_unknown` (in skip nicht
  hochgeladen) und `face.repeat_exempt` (trotzdem gespeichert), je Fall in
  `improve.jsonl` mit Kamera, Abstand in Sekunden (`gapS`) und Ähnlichkeit.
  `skip` lädt Wiederholungen nicht hoch (die 30-s-Drossel der Kamera gilt
  dann wie nach einem Upload), `off` wertet nicht aus.

  Galerie (`refreshGallery` in `face.ts`, Regeln in `gallery-rules.ts`):
  Der Hub lädt die Merkmale der aktiven Personen beim Start, fest alle
  15 Minuten und bei einer Personen-Sichtung oder Klingel, wenn der letzte
  Abruf älter als 5 Minuten ist oder seitdem am Hub angelernt wurde. Er
  schickt die Version des geladenen Bestands mit (`?v=`); hat sich nichts
  geändert, antwortet die Cloud nur „unverändert“, und der Hub behält seine
  Galerie.
  Die Version ändert sich mit jedem neuen oder gelöschten Merkmal und jeder
  Änderung an einer aktiven Person (anlegen, umbenennen, sperren,
  deaktivieren, löschen, zuordnen, lernen). Einmal pro Stunde und nach
  einer Antwort, die nicht zur geschickten Version passt, holt der Hub den
  ganzen Bestand ohne Version. Die Merkmale kommen als Base64 (Float32 little
  endian, `?enc=b64`) statt als Zahlen-Array; eine ältere Cloud kennt weder
  Version noch Base64 und liefert wie bisher alles, der Hub nimmt beide
  Formen an. Die Zeile „Face-Gallery: N Embeddings“ steht nur bei geändertem
  Bestand im Log, ohne Namen und Merkmale. Zähler `face.gallery_full`,
  `face.gallery_unchanged`, `face.gallery_bytes` (empfangene Bytes) und
  `face.gallery_dropped` (Einträge ohne brauchbares Merkmal).
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
- **Parken**: YOLO-Tracker-Zonen (`vehicleGate`) → Cloud, alle 30 s
  (`parking.ts`, Regeln in `parking-rules.ts`). Ein Lauf zur Zeit: Hängt
  die Cloud, fällt der nächste aus (Zähler `parking.busy`). Die Park-Kameras
  der Kiosk-Konfiguration stellt der Hub beim Start, bei geänderter Liste
  (id, ip, port, channel, username) und sonst einmal je Stunde in der Cloud
  sicher (`ensureDue`). Die Kamera-Nummer für das Tracker-Bild kommt aus der
  Kamera-Liste des Hubs; fehlt die Kamera dort, lädt er die Liste neu,
  höchstens alle 5 min (Zähler `parking.frame_nocam`). Lehnt die Cloud die
  Meldung ab, zählt `parking.report_fail`; Fehler und Erholung stehen je
  einmal im Log. Vorbereitet, ab Werk ohne Wirkung:
  `HUB_PARKING_IDLE_REPORT_S` (Standard 30 = jede Meldung; länger = nur bei
  geänderter Zählung, Tracker-Zustand oder Fehlertext und sonst nach so
  vielen Sekunden) und `HUB_PARKING_FRAME_IDLE_S` (Standard 0 = Tracker-Bild
  bei jedem Lauf; sonst bei geänderter Zählung und sonst nach so vielen
  Sekunden), beide 0–3600, ungültige Werte ergeben den Standard. Die
  Anzeige in der Cloud zeigt das Alter der Zählung in Sekunden; längere
  Werte machen sie dort sichtbar älter.
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
- **Zustellung** (`dispatch.ts`, Warteschlange `outbox.ts`, Regeln in `outbox-rules.ts`): Alarme des Wächters mit Bildern, ihre Zusatzbilder, die Meldungen des Wächters, Tagesvorschau und Tagesbericht gehen über eine Sende-Warteschlange im Speicher, je Chat in der Reihenfolge des Einreihens. Der erste Versuch geht sofort hinaus, die weiteren nach 5 s, 20 s, 60 s und dann alle 3 Minuten, höchstens 15 Minuten lang. Wiederholt wird bei Netzfehler, Zeitüberschreitung, HTTP 5xx und 429 (mit der Wartezeit, die Telegram nennt), nicht bei anderen 4xx. Lehnt Telegram das Bild eines Alarms ab oder läuft die Frist ab, geht der Alarm als Text mit seinen Knöpfen hinaus, auch wenn ein Versuch mit Bild erst nach dem Ende der Frist scheitert; das Bild steht dann in der Zentrale unter KI. Die Bewertung der nächsten Kamera wartet nicht auf die Zustellung. Im Log steht jede Zustellung, die mehr als einen Versuch gebraucht hat („Wächter: Alarm Eingang zugestellt nach 3 Versuchen (25 s)“), und jede Nachricht, die nicht angekommen ist („… NICHT zugestellt nach 9 Versuchen (15 min 0 s): fetch failed“); Zähler `camera.sentinel_send_ok|retry|text|failed`, `camera.sentinel_image_*`, `agent.watch_send_*`, `agent.preview_send_*`, `agent.report_send_*`. Ein Alarm, der keinen Chat erreicht hat, steht 12 Stunden als Befund „Wächter-Alarm nicht zugestellt: Kamera Uhrzeit“ beim Wächter (sofort gemeldet, auch in der Ruhezeit, ohne Entwarnung; Zähler `camera.sentinel_alarm_lost`; die Liste liegt in `.cache/agent-undelivered.json` und übersteht einen Neustart). Hat eine Meldung des Wächters keinen Chat erreicht, kommen ihre Befunde und Entwarnungen bei der nächsten Prüfung erneut, auch nach einem Neustart. Ist kein Chat gekoppelt, bleibt der Alarm im KI-Protokoll der Zentrale, im Log steht dazu höchstens eine Zeile je Stunde. Vor dem Beenden des Hubs geht ein Alarm, der noch auf seinen nächsten Versuch wartet, ein letztes Mal als Text hinaus. Weil das Beenden nur 3 s wartet, steht jeder offene Alarm vorher schon in der Liste der nicht zugestellten und wird bei Zustellung wieder ausgetragen; nach dem Neustart steht dazu einmal „Wächter: 1 Alarm beim letzten Beenden nicht zugestellt“ im Log. Ein Alarm, den schon ein Chat erhalten hat, gilt dabei als zugestellt. Nur der Alarm selbst kommt mit Ton; Übersicht und Bildserie gehen mit `disable_notification` hinaus, bei jeder Wiederholung gleich. Hat der Alarm einen Chat nicht erreicht, kommt dort das erste Zusatzbild, das ankommt, mit Ton, weil es dann die erste Nachricht des Alarms ist; die weiteren kommen still. So klingelt ein Alarm in jedem Chat einmal. Die Frist der Knöpfe beginnt mit dem Sendeversuch, der ankommt, auch wenn der Alarm in der Warteschlange gewartet hat.
- **Sprachnachrichten** (`voice.ts`): werden lokal mit whisper.cpp in Text umgewandelt (Homebrew `whisper-cpp`, Modell `HUB_AGENT_WHISPER_MODEL`, Vorgabe `large-v3-turbo`, ~1,6 GB in `.cache/whisper`, OGG → WAV per ffmpeg). Der Bot zeigt kurz, was er verstanden hat, und antwortet dann wie auf eine Textnachricht. Audio verlässt den Hub nicht.
- **Bilder** (`ollama.ts`, `sentinel.ts`): Zweites Ollama-Modell `HUB_AGENT_VISION_MODEL` (Vorgabe `qwen3-vl:8b`, ~6 GB). Werkzeug `look_at_camera` sieht sich ein aktuelles Kamerabild an; Fotos im Chat wertet es ebenfalls aus. Ausgaben des Modells laut Ollama-Bibliothek (Stand November 2026, ollama.com/library/qwen3-vl): `qwen3-vl:8b` (auf diese Größe zeigt auch `latest`) hat denselben Digest wie `qwen3-vl:8b-thinking` (`9cf69da2b16d`), ist also die Thinking-Ausgabe mit Denkschritt; die Instruct-Ausgabe heißt `qwen3-vl:8b-instruct` (gleich `qwen3-vl:8b-instruct-q4_K_M`, Digest `70e58e37beb1`, ebenfalls 6,2 GB, Q4_K_M). Ob bei einem Modell ein Denktext anfällt, zeigt die Zeitzeile des Wächters (siehe „Zeitmessung des Bildmodells“). Für einen Wechsel das Modell vorher mit `ollama pull <Tag>` laden und dann `HUB_AGENT_VISION_MODEL` setzen; sonst lädt der Hub es beim Start selbst, und bis der Download fertig ist, bewertet der Wächter keine Kamera-Ereignisse.
- **Wächter mit Bildern** (`sentinel.ts`, Regeln in `sentinel-rules.ts`): Beginnt ein Personen- oder Fahrzeugereignis an einer Kamera, deren Raum gerade geschlossen ist (ohne Betriebszeit: im Nachtfenster `HUB_AGENT_SENTINEL_NIGHT`, Vorgabe 22–6), bewertet das Bildmodell das Standbild. Auffälliges geht per Telegram raus: die Nahaufnahme mit Text und den Knöpfen „Neues Bild“, „Licht an“, „Sirene“ (mit Ton), danach Übersicht und zwei Folgebilder im Abstand von 4 s (ohne Ton). Im Nachtfenster, bei einer gesperrten Person und bei einer harten Handlung (Klettern, Hantieren an Tür, Fenster oder Schloss, Verstecken) beginnt der Alarm mit „‼️ DRINGEND (Grund)“, die Log-Zeile „AUFFÄLLIG“ endet dann mit „[dringend: …]“ (Regel `alarmLevel` in `alarm-rules.ts`, Zähler `camera.sentinel_alarm_dringend`); sonst zeigt ‼️ wie bisher das Urteil „hoch“ des Bildmodells. Die Knöpfe tragen Kamera und Frist in ihren Daten (`cam:<id>:snap`, `cam:<id>:spot:<Sekunde>`, `cam:<id>:siren:<Sekunde>`, Sekunden seit 1970) und gelten auch nach einem Neustart des Hubs: „Neues Bild“ unbegrenzt, „Licht an“ 60 Minuten, „Sirene“ 10 Minuten ab dem Versand der Nachricht, auf die Sekunde genau. Ein Tipp, der nicht mehr gilt, steht im Log („Assistent: Knopf „Sirene“ (Kamera 9) abgelaufen: gilt 10 min, die Nachricht ist 14 min alt“). Licht und Sirene nur per Knopf aus einem gekoppelten Chat, nie automatisch, und je Alarm einmal: Ein zweiter Tipp (Doppeltipp oder der zweite Chat mit demselben Alarm) bekommt „Schon ausgeführt“ und steht im Log („Assistent: Knopf „Sirene“ (Kamera 9) nicht erneut ausgeführt: schon vor 12 s geschaltet, nach dem Versand dieser Nachricht“); scheitert das Schalten, versucht es der nächste Tipp wieder. „Neues Bild“ lässt sich beliebig oft tippen. Nach einer Bewertung ist die Kamera 3 Minuten gesperrt. Hat die Bewertung nichts ergeben (unauffällig, niemand im Bild, Fehler), sieht der Wächter im Nachtfenster schon nach 45 Sekunden wieder hin; diese zusätzlichen Blicke verschieben den 3-Minuten-Takt nicht, nutzen nur, was vom Stundenlimit `HUB_AGENT_SENTINEL_MAX_PER_HOUR` (30, über alle Kameras) übrig ist, und zählen selbst nicht mit. Nach einem Alarm sind es immer 3 Minuten. Höchstens zwei Bewertungen laufen gleichzeitig; ein weiterer Auslöser wird bis zu 30 Sekunden lang erneut versucht. Hält einer der zusätzlichen Blicke einen Platz, verfällt ein wartender Auslöser des 3-Minuten-Takts nicht: Er wird bewertet, sobald ein Platz frei ist. Für jede Stunde mit Auslösern steht eine Bilanz im Log, z. B. „Wächter 23–0 Uhr: 23 Auslöser, 14 bewertet (davon 3 nach kurzer Sperrzeit), 9 übergangen (Abstand 8, Limit 0, belegt 1); 6 Alarm, 5 unauffällig, 3 Tracker leer“. `HUB_AGENT_SENTINEL=off` schaltet ab, `=always` bewertet auch im Betrieb. Je Kamera gibt es die Einstellung „Wächter“ (Cloud unter Kameras oder lokales Dashboard bei den Fahrzeug-Einstellungen; Regeln in `sentinel-mode-rules.ts`): *wie der Raum* (Standard, wie oben), *nur nachts* (allein das Nachtfenster entscheidet, die Betriebszeit des Raums zählt nicht; ist die Stunde nicht lesbar, gilt die Kamera als bewacht) oder *aus* (die Kamera wird nicht bewertet). Eine ältere Cloud ohne das Feld und jeder unbekannte Wert ergeben den Standard. Jede Kamera, die abweicht, steht beim Start und bei jeder Änderung einmal im Log („Wächter: Kamera Eingang: Wächter nur nachts (22-6 Uhr)“). `=always` bewertet nur die Kameras *wie der Raum* rund um die Uhr: *nur nachts* bleibt beim Nachtfenster, *aus* gilt immer (Regel `modeAlways`). Gesichts- und Kennzeichenerkennung hängen nicht an dieser Einstellung; eine Kamera auf „aus“ zählt nie als bewacht (siehe „Ein Meldeweg in der Nacht“).
- **Bildmodell fällt aus** (`ollama.ts`, `sentinel.ts`, `watch.ts`, Regeln in `vision-rules.ts`): Der Zustands-Wächter meldet „Bildmodell nicht bereit“ (länger als 60 Sekunden nicht bereit, mit dem Grund) und „Bildmodell antwortet nicht (N Fehler in Folge)“: Jeder gescheiterte Aufruf zählt, der erste gelungene setzt den Zähler zurück und bringt die Entwarnung. Solange der Wächter mit Bildern eingeschaltet ist, ist das ein Alarm und kommt bei der nächsten Prüfung, auch in der Ruhezeit; mit `HUB_AGENT_SENTINEL=off` ist es eine Warnung, mit `HUB_AGENT_VISION=0` gibt es keinen Befund. Ist das Bildmodell nicht bereit, bewertet der Wächter keine Kamera-Ereignisse und stellt es aus seinem Takt höchstens alle 5 Minuten neu bereit (lädt das Modell, wenn es in Ollama fehlt; die Zeile „lade Modell“ kommt dabei einmal bis zum nächsten Erfolg). Im Log steht eine Zeile je Wechsel: „Wächter: Bildmodell nicht bereit (…), Kamera-Ereignisse werden so lange nicht bewertet; Wiederanlauf alle 5 Minuten“ und „Wächter: Bildmodell wieder bereit, Kamera-Ereignisse werden wieder bewertet“. Scheitert der Aufruf zum Übersichtsbild (Ollama nicht erreichbar, Zeitüberschreitung, Fehlerantwort), entscheidet die Regel `onVisionError`: Bei einem Personen-Auslöser, auf dessen Standbild der Tracker mindestens eine Person sieht, oder im Nachtfenster geht der Alarm mit dem Vermerk „ungeprüft, Bildmodell nicht erreichbar“ hinaus, mit dem Standbild, der Bildserie und den Knöpfen „Neues Bild“, „Licht an“, „Sirene“ (ohne Nahaufnahme, ohne Knopf „Ist in Ordnung“ und ohne Eintrag in der Merkliste); ein genehmigtes Fahrzeug bleibt ohne Alarm. Sonst bleibt es beim Befund. Danach gilt die Sperrzeit wie nach einem Fehler (im Nachtfenster 45 Sekunden, sonst 3 Minuten). Log: „Wächter: Eingang AUFFÄLLIG (ungeprüft): Person von der Kamera gemeldet (Tracker sieht 1 Person) – ungeprüft, Bildmodell nicht erreichbar“.
- **Raumdaten für den Wächter** (`rooms.ts`, `sentinel.ts`, Regeln in `sentinel-rooms-rules.ts`): Ob eine Kamera bewacht wird, hängt an der Betriebszeit ihres Raums. Die Cloud liefert dazu je Raum „offen“ und den nächsten Wechsel (`nextChangeAt`). Ein Stand jünger als 10 Minuten gilt wie geliefert. Ein älterer (Abruf scheitert, Stand von der Platte nach einem Neustart ohne Cloud) gilt bis zum nächsten Wechsel weiter; danach wird ein Raum, der offen war, als geschlossen behandelt (die Kamera wird bewacht), und ein Raum, der geschlossen war, fällt auf das Nachtfenster zurück. Ohne `nextChangeAt` (ältere Cloud, kein Wechsel in Sicht) entscheidet bei einem älteren Stand das Nachtfenster. Ein veralteter Stand schaltet die Bewachung so nie ab. Der Platten-Cache trägt den Zeitpunkt seines Abrufs. Scheitert der Abruf, steht das einmal je Grund im Log („Räume: Abruf fehlgeschlagen (HTTP 503), es gilt der Stand vom 25.11., 17:55“), der nächste Erfolg ebenfalls („Räume: Abruf wieder erfolgreich“); ab 30 Minuten meldet der Zustands-Wächter „Raumdaten seit N min alt“ (Warnung).
- **Ein Meldeweg in der Nacht** (`sentinel.ts`, Regeln in `sentinel-cover-rules.ts`, Cloud: `src/lib/hub-sentinel.ts`): Jeder Takt des Wächters hält fest, welche Kameras er gerade nachweislich bewacht: Wächter mit Bildern an, ein Chat gekoppelt, Zustellung an Telegram nicht gestört (kein Alarm seit 60 s unterwegs, ohne einen Chat erreicht zu haben, keiner in den letzten 15 Minuten verloren, der Bot holt seit höchstens 2 Minuten erfolglos Updates ab; Regel `deliveryTrouble` in `outbox-rules.ts`), Kamera nicht auf „aus“ und gerade bewacht (Raum geschlossen, ohne Betriebszeit im Nachtfenster, „nur nachts“ im Nachtfenster, `=always`), Bildmodell bereit (beantwortet es Aufrufe nicht, nur im Nachtfenster, wo der Alarm dann ungeprüft hinausgeht), Stundenlimit nicht erreicht. Dazu muss der Wächter bewerten, was die Kamera gerade sieht, oder einen neuen Auslöser dort sofort bewerten können (Regel `cameraDuty`): Eine Kamera fehlt in der Liste, solange dort ein Personen-Ereignis andauert, das keine laufende Bewertung abdeckt (ohne Auslöser, übergangen, verfallen oder ohne Alarm bewertet; nach einem Alarm gilt es während der Sperrzeit als gemeldet), solange ihre Sperrzeit läuft, ein Auslöser für sie wartet oder beide Plätze für Bewertungen belegt sind. Das Lebenszeichen meldet die Liste jede Minute als Feld `sentinel` (`{ at, cameras }`); lief der Takt seit 30 Sekunden nicht, ist sie leer. Fällt eine Kamera aus der Liste, geht das Lebenszeichen sofort hinaus. Die Cloud legt die Liste je Hub in `HubAgent.status.sentinel` ab. Die Überwachung der Cloud (Web-Push und Telegram) schweigt zu einer unbekannten Person nur, wenn der Upload der Sichtung den Beleg `sentinel=1` trägt und die Liste höchstens 2 Minuten alt ist und die Kamera nennt. Den Beleg hängt der Hub unmittelbar vor dem Upload an, wenn der Wächter genau diese Person gerade bewertet oder für sie einen Alarm gesendet hat (Regeln `vouchFor` und `vouchParam`), nie bei einem Treffer der Gallery. Ab Werk ist das aus (`HUB_SENTINEL_CLOUD_QUIET`, nur `on` schaltet ein): Dann meldet die Cloud unbekannte Personen wie früher selbst, und der Zähler `face.sighting_sentinel_beleg_aus` zählt, wie oft sie geschwiegen hätte. Gesperrte Personen und Fahrzeuge meldet die Cloud immer selbst, ebenso jede Sichtung ohne Beleg (auch von einem älteren Hub). Zähler je Upload: `face.sighting_sentinel_beleg`, `_beleg_aus`, `_gelistet_ohne_beleg`, `_ohne_beleg`, `_treffer`. Hub-Log bei jeder Änderung, mit eingeschaltetem Schalter: „Wächter: meldet der Cloud 3 bewachte Kamera(s) – unbekannte Personen dort nur noch über den Wächter: … (selbst meldet die Cloud an: Kasse – Sperrzeit nach der letzten Bewertung)“ bzw. „Wächter: Cloud meldet unbekannte Personen wieder an allen Kameras selbst (Bildmodell nicht bereit)“; ab Werk (aus): „Wächter: meldet der Cloud 3 bewachte Kamera(s): … – die Cloud meldet unbekannte Personen weiter selbst (HUB_SENTINEL_CLOUD_QUIET aus)“ bzw. „Wächter: meldet der Cloud keine bewachte Kamera mehr (…)“. Cloud-Log je unterbliebener Meldung: „[surveillance hub-waechter] account=1 Kamera 8: Telegram zu unbekannter Person nicht gesendet – Wächter des Hubs „…“ bewacht die Kamera (Meldung vor 42 s), Nr. 17“; der Zähler steht in `HubAgent.status.sentinelMuted`.
- **Bewachungs-Zustand** (`sentinel.ts`, Regeln in `sentinel-guard-rules.ts`): Bewacht ist eine Kamera, wenn der Wächter ein Ereignis an ihr bewerten würde (Einstellung „Wächter“, Raum, Nachtfenster, `=always`). Beim Start steht im Log, welche Kameras bewacht sind und warum („Wächter: beim Start bewacht: Kasse, Gastro (Raum Shop geschlossen); Lager (ohne Betriebszeit, Nachtfenster 22-6 Uhr)“, dazu „… nicht bewacht: …“), danach jeder Wechsel einer Kamera mit Grund („Wächter: Bewachung aus: Kasse (Raum Shop offen)“, „Wächter: Bewachung an: Eingang (Raum Strandbad geschlossen (Raumdaten veraltet))“). Kameras, die im selben Takt aus demselben Grund wechseln, stehen in einer Zeile. Die Tagesvorschau (morgens und auf /heute) hat eine Zeile „Heute bewacht: Strandbad ganztägig (Eingang); Shop bis 10:00 und ab 18:00 (Kasse); nachts bis 06:00 und ab 22:00 (Lager). Nicht bewacht: Büro (Wächter aus).“ Für Räume gilt die Zeit außerhalb ihrer Öffnungszeiten von heute (Raumdaten `spans`, heute und morgen); fehlen sie (ältere Cloud, Raumdaten älter als gestern), steht der Zustand von jetzt da („Shop jetzt, Öffnungszeiten von heute fehlen“). Ob das Bildmodell gerade bereit ist, steht nicht in diesen Zeilen, sondern in denen zur Liste für die Cloud (siehe „Ein Meldeweg in der Nacht“).
- **Zeitmessung des Bildmodells** (`ollama.ts`, `sentinel.ts`, Regeln in `vision-timing-rules.ts`): Der Hub liest aus jeder Antwort des Bildmodells die Zeitangaben von Ollama (`total_duration`, `load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration`). Zu jeder Bewertung des Wächters steht damit eine Zeile im Log, beide Aufrufe zusammen: „Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token, 280 Zeichen); Nahaufnahme 41,0 s (…); Auslöser bis Urteil 67,8 s“. Bei der Antwort steht, wofür die Antwort-Token verbraucht wurden: die Länge des Antworttexts (`message.content`) in Zeichen, mit „davon … Leerraum“, wenn Leerzeichen und Zeilenumbrüche mindestens die Hälfte ausmachen; die Länge eines Denktexts aus `message.thinking` oder aus einem Denkblock `<think>…</think>` im Antworttext (dann „(im Antworttext)“, der Block zählt nicht zum Antworttext); und `done_reason`, wenn er nicht „stop“ ist. Beispiel: „Antwort 47,0 s/3837 Token, 412 Zeichen, Denktext 14 800 Zeichen, done_reason length“. Vom Denktext steht nur die Länge im Log, nie der Inhalt. „Rest“ ist Zeit, die Ollama keinem Abschnitt zuordnet (zum Beispiel Warten auf einen laufenden Aufruf); „im Hub“ steht dabei, wenn der Hub mindestens eine Sekunde länger misst als Ollama; „von 8192 Token“ steht bei Bild+Prompt, sobald das Kontextfenster zu 90 % gefüllt ist; ein gescheiterter Aufruf steht als „gescheitert nach 120,0 s“ da. „Auslöser“ ist der Takt, in dem der Wächter das Ereignis der Kamera gesehen hat (höchstens 3 Sekunden nach dem Ereignis). Zähler im Verbesserungslog: `camera.sentinel_model_call` (beantwortete Aufrufe), `camera.sentinel_model_error`, `camera.sentinel_model_cut` (an der Obergrenze abgebrochen, siehe unten), `camera.sentinel_model_slow` (ab 30 s), `camera.sentinel_model_cold` (Modell erst geladen, ab 1 s), `camera.sentinel_model_ctx` (Kontextfenster zu 90 % gefüllt), `camera.sentinel_verdict` (Bewertungen mit Antwort) und `camera.sentinel_verdict_late` (letzte Antwort später als 30 s nach dem Auslöser). An den Aufrufen selbst ändert die Messung nichts.
- **Obergrenze der Antwort** (`ollama.ts`, Regeln in `vision-timing-rules.ts`): `HUB_AGENT_VISION_NUM_PREDICT` begrenzt die Antwort-Token je Bewertung des Wächters (Ollama `num_predict`, Übersicht und Nahaufnahme); Standard ist keine Grenze, und die Anfrage an Ollama bleibt dann wie sie ist. Nur eine ganze Zahl ab 1 gilt, jeder andere Wert gilt als keine Grenze. Ist die Variable gesetzt, steht beim ersten Bereitstellen des Bildmodells eine Zeile im Log („Assistent: Bildmodell: höchstens 400 Antwort-Token je Bewertung des Wächters (HUB_AGENT_VISION_NUM_PREDICT)“ bzw. „… „abc“ ist keine ganze Zahl ab 1 – keine Grenze“). Fragen und Fotos im Chat bleiben ohne Grenze. Bricht eine Antwort an der Grenze ab (`done_reason` „length“), zählt der Aufruf wie ein gescheiterter: Beim Übersichtsbild entscheidet `onVisionError` (Person im Bild oder Nachtfenster: Alarm „ungeprüft“), bei der Nahaufnahme entscheidet `decidePerson` ohne Antwort des Bildmodells, und der Befund „Bildmodell antwortet nicht“ zählt den Aufruf mit. Zeitzeile: „Übersicht an der Grenze abgebrochen 9,1 s (… Antwort 8,0 s/400 Token, 1210 Zeichen, done_reason length); Auslöser bis Abbruch 12,3 s“. Eine Grenze nur setzen, wenn die Zeitzeile ohne Grenze zeigt, dass die Antworten des Modells darunter bleiben.
- **Personen: Mitarbeiter oder nicht?** (`sentinel.ts`, `people.ts`, Regeln `decidePerson` in `sentinel-rules.ts`): Bei einer Person holt der Wächter eine Nahaufnahme (optisch über `personCloseUp`, sonst digital), bewertet sie (Anzahl, Arbeitskleidung, Tätigkeit, verdächtiges Verhalten) und gleicht sie mit den eingestempelten Mitarbeitern aus emp-control (`staff.ts`) ab. Den Stempelstand holt der Hub jede Minute über die Cloud; nachts (23–6 Uhr Ortszeit) alle 4 Minuten, solange laut letztem Stand niemand eingestempelt ist und der letzte Abruf geklappt hat (Regel `staffSyncDelayMs` in `staff-sync-rules.ts`). Wer eingestempelt ist, wird auch nachts jede Minute abgeglichen. Die Personal-Übersicht gilt als veraltet, wenn der Stand älter ist als 5 Minuten, im Nacht-Takt als 8 Minuten (`staffStaleAfterMs`): So macht ein Ausfall der Cloud sie nachts nie früher veraltet als im Minuten-Takt. Scheitert nachts ein Abruf, kommt der nächste Versuch nach 15 s, solange der Stand nicht veraltet ist, danach jede Minute. Der Abstand läuft auf einer Uhr, die niemand stellt (`staffSyncWaitMs`): Wird die Uhr des Rechners gestellt, verschiebt das den Abgleich nicht. Kein Alarm, wenn höchstens so viele Personen da sind wie eingestempelt und sie Arbeitskleidung tragen oder es tagsüber (6–20 Uhr) ist, oder wenn die bestehende Gesichtserkennung einen Whitelist-Treffer hat. Verdächtiges Verhalten, Blacklist-Treffer, mehr Personen als eingestempelt oder niemand eingestempelt → Alarm mit Nahaufnahme und Übersichtsbild.
- **Digitaler Zoom auf Personen** (`person-crop.ts`, Geometrie in `person-crop-rules.ts`): Der Tracker liefert Personen-Boxen (`/classify` → `persons`), ffmpeg schneidet den Bereich aus dem hochaufgelösten Kamerabild aus und vergrößert ihn. Die Gesichtserkennung prüft Kopf-Ausschnitte, wenn im Vollbild kein Gesicht oder kein Treffer war (strengere Schwelle wie bei hochskalierten Gesichtern). Gesichtserkennung und Wächter nutzen ihn, wenn die optische Nahaufnahme nicht geht oder nicht lohnt.
- **Folgen und optische Nahaufnahme** (`camera-motion.ts`, Regeln in `camera-motion-rules.ts`): Schwenk-Kameras (Gastro, Shop, Halle, Übungslift) schalten beim ersten Personen-Signal das Tracking der Kamera ein (`bSmartTrack`; `aiTrack` ist bei diesen Modellen nicht der Schalter), nur wenn ihr Raum geschlossen ist: derselbe Stand aus den Raumdaten, nach dem der Wächter bewacht (`camera-room.ts`, eingetragen von `startSentinel`). Ist er unbekannt (keine Raumdaten, Kamera ohne Raum mit Betriebszeit, Assistent aus), folgt die Kamera nur im Nachtfenster `HUB_AGENT_SENTINEL_NIGHT` (Regel `followRoomBlocked`; Zähler `follow.start` mit `room` offen, geschlossen oder unbekannt, `follow.skip_open`). `HUB_FOLLOW_ALWAYS=on` folgt wie früher auch bei offenem Raum. Die Nahaufnahme des Wächters zentriert unabhängig davon, die der Gesichtserkennung nur, wenn die Kamera folgen darf. Das Folgen dauert höchstens 2 Minuten, dann zurück in die Grundstellung (Wachposition der Kamera, sonst Preset „Grundstellung“) und 1 Minute Pause. Fehlt die Wachposition, speichert der Hub die aktuelle Stellung, sobald die Kamera 10 Minuten unbewegt war. Kameras mit Zoom-Objektiv zoomen für Gesichtserkennung und Wächter gezielt heran: Schwenk-Kameras nach dem Zentrieren, reine Zoom-Kameras nur so weit, dass die Person im Bild bleibt (unter 1,3-fach bleibt es digital). Für die Gesichtserkennung fährt der Zoom nur, wenn das Gesicht danach voraussichtlich mindestens 64 px groß ist (Größe in Pixeln des Kamerabilds mal Faktor; ohne Gesicht erst ab Faktor 2), Regel `opticalWorth`; das Gesicht der Nahaufnahme ersetzt das bisherige nur mit Treffer oder höherer Güte (`takeOpticalFace` in `person-pipeline-rules.ts`), und der Kopf-Ausschnitt nutzt die Personen-Boxen der Nahaufnahme. Für den Wächter gilt weiter der Mindestfaktor 1,3. Der Abstand zwischen zwei Nahaufnahmen zählt ab dem Zoom-Befehl; ein Versuch ohne Fahrt (nichts zu planen, lohnt nicht) pausiert nur 15 s, ein leeres Ergebnis gilt 10 s. Verzichtet nur die Gesichtserkennung, plant der Wächter selbst (Zähler `camera.closeup_skip_face`, `face.optical`, `face.optical_match`, `face.optical_kept`). Zonen-Kameras (Kennzeichen, Halteverbot, Lieferdienste, Parkfläche) zoomen höchstens 6 s und höchstens alle 2 min (gezählt ab der Fahrt; nach einem Versuch ohne Fahrt auch dort nur 15 s Pause, und die Kamera gilt gleich wieder als in Grundstellung), folgen nie; Halteverbot, Parkfläche und Belegung warten bzw. halten so lange. Handsteuerung (Zentrale, Cloud, Assistent) bricht ab und sperrt 5 min, Regeln „Kamera steuern“ gehen vor. Laufende Bewegungen stehen in `hub/.cache/camera-motion.json` und werden nach einem Neustart zurückgestellt. Abschalten: `HUB_CAMERA_AUTOFOLLOW=off`, `HUB_CAMERA_AUTOZOOM=off`.
- **Übergabe an die Handsteuerung und Rückfahrt des Zooms** (`camera-motion.ts`, Regeln `shouldRestoreZoom` und `zoomReturnGivenUp` in `camera-motion-rules.ts`): Ein Befehl von Hand (Schwenken, Zoom) geht erst an die Kamera, wenn die Automatik sie abgegeben hat (Tracking des Hubs aus), höchstens nach 2 s (Zähler `camera.hand_handover_late`); ein Folgen, das gerade startet, schaltet der Hub dann nicht mehr ein, ein gerade eingeschaltetes schaltet er gleich wieder aus. Gewartet wird nur, solange das Tracking des Hubs an ist oder gerade eingeschaltet wird, sonst geht der Befehl sofort hinaus. Eine Regel „Kamera steuern“ wartet ebenso, dann aber ohne Obergrenze: Sie liest danach den Zustand des Trackings und stellt ihn am Ende wieder her; ihre Befehle gehen wie die der Automatik über die Warteschlange der Kamera, nie gleichzeitig mit einer Fahrt in die Grundstellung oder einem Zoom-Befehl. Kommt Hand oder Regel, während ein Folgen endet, fährt der Hub nicht mehr in die Grundstellung (Zähler `follow.home_skip_hold`). Bleibt beim Einschalten des Trackings die Antwort aus, liest der Hub den Zustand: Steht es an (oder bleibt es unbekannt), gilt es als Folgen und wird wie eines beendet (Zähler `follow.start_unconfirmed`). Lässt es sich nicht ausschalten und meldet die Kamera nicht „aus“, bleibt das Folgen gemerkt, auch über einen Neustart, und der Hub versucht es alle 30 s erneut, höchstens zehnmal (ein zusätzlicher Versuch bei einem Befehl von Hand zählt nicht), danach steht im Lagebild „Tracking lässt sich nicht ausschalten“ (Zähler `follow.off_retry`, `follow.off_fail`). Übernimmt in dieser Zeit eine Regel, versucht der Hub es während ihrer Sperre nicht weiter. Liest die Regel den Zustand, gehört das Tracking ab dann ihr: Der Hub vergisst sein Folgen, und die Regel behandelt ein „an“ als vom Hub, vorher also „aus“ (Zähler `follow.handed_rule`); liest sie nicht, geht es nach ihrer Sperre weiter. Nach einem Neustart warten Regeln, bis der Hub die Kameras zurückgestellt hat. Die Stellung des Zooms vor einer Nahaufnahme bleibt gemerkt (auch in `hub/.cache/camera-motion.json`), bis die Kamera die Rückfahrt angenommen hat: Der Hub versucht es alle 30 s erneut, höchstens zehnmal, danach steht im Lagebild „Zoom steht nicht in Grundstellung“ (Zähler `camera.zoom_restore_retry`, `_ok`, `_fail`). Bleibt nur die Antwort der Kamera aus, liest der Hub die Stellung: Steht der Zoom schon in der Ausgangsstellung, ist die Rückfahrt erledigt (Zähler `camera.zoom_restore_unconfirmed`). Bis dahin gilt die Kamera nicht als in Grundstellung: Halteverbot und Parkfläche warten wie während einer Nahaufnahme. Der Kennzeichen-Burst wartet darauf nicht, nur auf eine laufende Nahaufnahme, ein Folgen, einen gerade unterwegs befindlichen Versuch der Rückfahrt oder den Fokus nach der Rückkehr (höchstens 3 s). Übernimmt Hand oder Regel während der Nahaufnahme, bleibt der Zoom stehen und fährt nach der Sperre zurück, wenn er noch dort steht, wo die Automatik ihn hingestellt hat; ein inzwischen verstellter Zoom bleibt (Zähler `camera.zoom_restore_skip`). An Schwenk-Kameras fährt dabei nur der Zoom zurück, die Schwenkstellung bleibt bis zum nächsten Folgen. Solange eine Rückfahrt aussteht, macht die Kamera keine neue optische Nahaufnahme (der digitale Zoom übernimmt).
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

- ohne Angabe oder `on` (auch `1`, `true`, `ja`; Vorgabe): Der Assistent meldet sich per Telegram mit Bild („👥 … wird voll“, später „✅ … entspannt sich“). Die Startzeile im Hub-Log sagt dann „Meldungen an (Standard; …)“.
- `off` (auch `0`, `false`, `nein`): Es wird gemessen, die Meldestufen werden nicht ausgewertet.
- `shadow` (Probelauf): Die fällige Meldung steht im Hub-Log („Belegung: … → Meldung (Probelauf, nichts gesendet)“) und im Zähler `occupancy.shadow_alert`, gesendet wird nichts. So lassen sich geänderte Schwellen an echten Messungen prüfen, bevor die Meldungen wieder hinausgehen. Ein unbekannter Wert gilt ebenfalls als Probelauf; die Startzeile meldet ihn als „nicht erkannt“.

Die erste Messung jedes Tages steht mit der Zahl der gemessenen Bereiche und der Summe der Personen im Log („Belegung: erste Messung heute: …“), die weiteren Messungen nicht.

Misst der Takt keinen Punkt (alle Räume geschlossen), holt er auch die Drehkreuz-Zahlen nicht aus der Cloud (Regel `areasRefreshDue`, Zähler `occupancy.areas_skip`); auf Nachfrage im Chat holt er sie immer.

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
4. **Wächter**: Vor dem Neustart meldet der Hub der Cloud eine leere Liste
   bewachter Kameras (die Cloud meldet unbekannte Personen dann selbst, siehe
   „Ein Meldeweg in der Nacht“). Laufen Bewertungen des Wächters, wartet der
   Neustart auf ihr Ende, höchstens 3 Minuten (Regel `restartStep` in
   `updater-rules.ts`); im Log „Update: Neustart wartet auf 1 laufende
   Bewertung(en) des Wächters (höchstens 3 min)“ und „Update: Bewertung des
   Wächters abgeschlossen, Neustart nach 42 s Warten“.

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
│  • Heartbeat 60s      ─┼─────────▶│ /api/hub/tasks (GET)      │
│  • Task-Poll 5s / 1s  ─┼─────────▶│ /api/hub/tasks/:id/result │
│  • Kameras / DoorBird  │          │ /api/hub/cameras …        │
│  • Face + ALPR + YOLO  │          │ HubAgent / HubTask (DB)   │
│  • Self-Update 5min    │          │                          │
└────────────────────────┘          └──────────────────────────┘
```

Auth läuft über das Account-API-Token (`Authorization: Bearer …`), wie bei
den Raspberry Pis.
