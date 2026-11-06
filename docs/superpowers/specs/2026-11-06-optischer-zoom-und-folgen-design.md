# Optischer Zoom und automatisches Folgen bei Personen

Stand: 06.11.2026. Betrifft den lokalen Hub (`hub/`).

## Ziel

Bei einer Person soll der Hub den optischen Zoom nutzen, wo die Kamera einen hat, und Schwenk-Kameras sollen der Person automatisch folgen. Das gilt immer, auch im laufenden Betrieb. Der digitale Zoom bleibt als Ersatz.

## Ist-Zustand (Befunde)

- Gesichtserkennung (`uploadPersonSnapshot` in `cameras.ts`): Vollbild, sonst digitaler Kopf-Ausschnitt (`faceViaZoom` in `person-crop.ts`). Die Kamera bewegt sich nie.
- Wächter (`agent/sentinel.ts`, nur bei geschlossenem Raum bzw. nachts): digitaler Ausschnitt um alle Personen (`groupCrop`). Optischer Zoom (`closeUp`) nur ohne YOLO-Boxen und blind auf 60 % zur Bildmitte. Seit Commit `a346114` (05.11.) so, weil der Mitte-Zoom Personen am Rand verfehlte. Die README beschreibt noch den alten Stand („optisch, PTZ folgt vorher“).
- Folgen: nur im Wächter, nur bei Schwenk-Kameras, erst nach Bildmodell und Alarm-Entscheid. Im Hub-Log 21-mal „Szene, folgen an, zurück nach 180 s“ an Übungslift und Shop seit 05.11. 13:27 UTC, ohne Fehler. Zwischen Ereignis und Einschalten liegen 30–60 s (z. B. 06:30:49 Zoom, 06:31:15 folgen an). Beobachtet: Die Kamera folgt trotzdem nicht. Ursache offen: zu spät eingeschaltet und/oder Tracking-Einstellung in der Kamera (Zielarten, Grenzen).
- Snapshot seit 05.11. 17:11 UTC: `face.none` 265, `face.skip_no_face` 29, `face.zoom` 7, `face.zoom_face` 1, `face.person_nomatch` 17, `face.ok` 16. Hinweis: „Gallery-Treffer knapp unter der Schwelle“. Vergrößerte Ausschnitte bekommen eine strengere Schwelle, optische Nahaufnahmen nicht.

## Kameras (CAMERA_CAPS vom 06.11.)

| Id | Kamera | Modell | Schwenken | Zoom | Rolle |
|---|---|---|---|---|---|
| 2 | Gastro | E1 Pro | ja | nein | folgen; Belegung |
| 3 | Halle | RLC-823S1 | ja | ja | folgen, Nahaufnahme |
| 4 | Seilbahn B | RLC-811A | nein | ja | Nahaufnahme; Belegung |
| 5 | Übungslift | RLC-823A 16X | ja | ja | folgen, Nahaufnahme; Belegung |
| 7 | Shop | E1 Pro | ja | nein | folgen |
| 9 | Eingang | RLC-811A | nein | ja | Zonen-Kamera |
| 10 | Drehkreuz | RLC-811A | nein | ja | Nahaufnahme; Belegung |
| 13 | Halle 2 | RLC-811A | nein | ja | Zonen-Kamera (Parkfläche) |

Ohne Zoom und Schwenkkopf: Aquapark (Duo 3), Umkleide (RLC-810A), Imbisscontainer (RLC-510A). Seilbahn A (192.168.1.69) antwortete nicht.

## Entscheidungen

1. Optisch zoomen und folgen immer, auch im Betrieb.
2. Zonen-Kameras zoomen nur kurz (höchstens 6 s) und folgen nie. Ihre Zonen-Auswertungen pausieren so lange.
3. Folgen bis die Person weg ist, höchstens 2 Minuten, danach Grundstellung und 1 Minute Pause.
4. Folgen über das Tracking der Kamera (Reolink `aiTrack`), keine eigene Nachführung des Hubs.
5. Die Belegungszählung ist keine Zone. Sie wartet, bis die Kamera in Grundstellung ist.

## Begriffe

- **Zonen-Kamera:** Reolink-Kamera mit `vehicleDetection`, `noParkDetection`, gesetztem `deliveryMode` oder als Parkfläche in der Kiosk-Konfiguration (Abgleich über den Host). Heute: Eingang, Halle 2.
- **Grundstellung:** bei Zoom-Kameras die Zoom-Position vor der Bewegung, bei Schwenk-Kameras die Reolink-Wachposition (siehe unten).
- **In Grundstellung:** keine automatische Bewegung aktiv und seit der Rückkehr mindestens 3 s vergangen (Fokus).

## Design

### Koordinator `camera-motion.ts`

Hält je Kamera, wer sie bewegt, und die Grundstellung. Logik ohne Ein-/Ausgabe in `camera-motion-rules.ts` mit Tests.

- Besitzer: `hand` (Zentrale/Cloud: `CAMERA_PTZ`, `CAMERA_ZOOM`), `rule` (`CAMERA_SCENE`), `follow`, `closeup`. Vorrang: `hand` > `rule` > Automatik.
- `hand` gilt 5 Minuten nach dem letzten Befehl. Eine laufende Automatik bricht sofort ab: Hat der Hub das Tracking eingeschaltet, schaltet er es aus, fährt aber nicht zurück.
- `rule` gilt für die Dauer der Szene (bis zur Rückkehr bzw. bis zum Einschalten des Folgens).
- Abfrage `atHome(cameraId)` für die Auswertungen mit festem Bildausschnitt.
- Alle Kamerabefehle laufen weiter über `ptzSerial`.
- Laufende Bewegungen stehen in `hub/.cache/camera-motion.json` (Kamera, Art, gemerkte Zoom-Position, Tracking vorher, Start). Beim Hub-Start werden sie zurückgestellt.

### Folgen (Schwenk-Kameras)

- Auslöser: steigende Flanke von `PERSON` an einer Schwenk-Kamera, dort, wo heute die Pipelines starten (`cameras.ts`).
- Voraussetzungen: `HUB_CAMERA_AUTOFOLLOW` nicht `off`, kein `hand`/`rule`, keine Pause, keine Zonen-Kamera, Grundstellung bekannt.
- Tracking-Einstellungen: einmal je 6 h `GetAiCfg` lesen und protokollieren. Fehlt `aiTrack`/`bSmartTrack`, kann die Kamera nicht folgen (Hinweis im Snapshot). Ist Personen-Verfolgung als Zielart vorhanden und aus, schaltet der Hub nur diese ein. Andere Werte schreibt er nicht.
- Start: Tracking an. War es schon vorher an (dauerhaft in der Kamera eingestellt), greift der Hub weder beim Start noch beim Ende ein.
- Ende: `PERSON` entprellt beendet (6 s Ruhe, `HUB_EVENT_END_HOLD_MS`) oder 120 s seit Start. Neue Personen verlängern nicht über 120 s hinaus. Dann Tracking aus, Grundstellung anfahren, 60 s Pause.
- Der Wächter schaltet das Folgen nicht mehr selbst. Die Telegram-Zeile „Kamera folgt“ richtet sich nach dem Zustand im Koordinator.

### Grundstellung bei Schwenk-Kameras

1. Wachposition lesen (`GetPtzGuard`). Ist eine gesetzt, Rückkehr über `SetPtzGuard` mit `cmdStr: "toPos"`.
2. Keine gesetzt: aktuelle Stellung einmalig als Wachposition speichern (`cmdStr: "setPos"`), nur wenn die Kamera seit 10 Minuten unbewegt ist (nach Hub-Start zählt der Start als Bewegung). Bis dahin folgt die Kamera nicht. Ins Log schreiben.
3. Keine Wachposition möglich: Preset mit Namen „Grundstellung“ (ohne Groß-/Kleinschreibung).
4. Sonst: Diese Kamera folgt nicht, Hinweis im Snapshot.

Die Befehlsnamen der Wachposition werden im Diagnose-Schritt an den echten Kameras bestätigt.

### Optische Nahaufnahme

Eine Funktion `personCloseUp(cameraId)` für Gesichtserkennung und Wächter. Gleichzeitige Aufrufe teilen sich einen Lauf, das Ergebnis gilt 45 s (der Wächter fragt erst nach dem Bildmodell).

- Voraussetzungen: Kamera mit Zoom, `HUB_CAMERA_AUTOZOOM` nicht `off`, kein `hand`/`rule`, Abstand seit der letzten Nahaufnahme 30 s (Zonen-Kamera 2 min). Keine Nahaufnahme, wenn das Weitbild schon einen Gallery-Treffer hatte.
- Zonen-Kamera zusätzlich: nicht bei aktivem `VEHICLE`, laufendem Fahrzeug-Burst oder Lieferdienst-Prüfung. Beginnt `VEHICLE` während der Nahaufnahme, sofort zurück. Gesamtdauer höchstens 6 s.
- Vergrößerung: linear angenommen, `m(pos) = 1 + (M − 1) · (pos − min) / (max − min)`. `M` je Modell: RLC-811A 5, RLC-823A 16X 16, alle anderen 3. Die RLC-823S1 bleibt bei 3, bis ihr Faktor aus den protokollierten Messungen feststeht.
- Gewünscht: Person füllt 60 % der Bildhöhe, `m_w = 0,6 / box.h`, begrenzt auf `[1, M]`.
- Reine Zoom-Kamera: Der Zoom bleibt in der Bildmitte, das sichtbare Feld ist `1/m`. Die Box plus 3 % Rand muss drinbleiben: `m_max = min(0,5 / |Kante − 0,5|)` über alle vier Kanten. Erst die Gruppe aller Personen, sonst die größte Person, für die `min(m_w, m_max) ≥ 1,3` ist. Sonst keine Nahaufnahme.
- Schwenk-Kamera mit Zoom: Folgen läuft (oder wird gestartet), bis zu 3 s warten, bis die Box-Mitte höchstens 0,15 von der Bildmitte entfernt ist, dann wie oben rechnen. Kann das Folgen nicht laufen (Pause, kein Tracking, keine Grundstellung) oder zentriert es nicht rechtzeitig: wie eine reine Zoom-Kamera.
- Ablauf: Zoom-Position merken, Zielposition anfahren, 2,5 s Fokus, Bild, YOLO-Prüfung. Keine Person im Bild: einmal auf halbe Vergrößerung zurück und neues Bild, sonst aufgeben. Zonen-Kameras bekommen wegen der 6 s keinen zweiten Versuch. Danach zurück auf die gemerkte Position (bei laufendem Folgen auf die Zoom-Position vor der Nahaufnahme).
- Protokoll: erwartete und gemessene Vergrößerung (Box-Höhe nachher / vorher) mit Modell und Position, damit die Rechnung je Modell nachgeschärft werden kann.
- Gesichtserkennung: Nahaufnahme an `embedJpeg`, normale Schwelle (nicht `upscaled`). Ohne Gesicht: digitaler Kopf-Ausschnitt aus der Nahaufnahme, dann wie heute aus dem Weitbild.
- Wächter: nutzt `personCloseUp` statt `groupCrop`/`closeUp`. Ohne Ergebnis wie heute digital.

### Auswertungen mit festem Bildausschnitt

Prüfen `atHome` und überspringen sonst:

- Halteverbot (`noparking.ts`): Bild auslassen, die Standzeit bleibt erhalten.
- Parkfläche (`parking.ts`): letzten Wert der betroffenen Fläche halten, nicht melden.
- Kennzeichen und Lieferdienste: starten nicht, solange die Kamera bewegt ist. Die Nahaufnahme weicht ihnen aus (siehe oben).
- Belegung (`occupancy.ts`): bis 20 s auf die Grundstellung warten, sonst diese Kamera bis zur nächsten Runde auslassen.

## Fehlerbehandlung

- Jede Bewegung bekommt beim Start einen festen Rückkehrzeitpunkt. Die Rückkehr läuft auch bei Fehlern.
- Zoom fehlgeschlagen: digitaler Zoom wie heute, Zähler im Verbesserungslog.
- Tracking einschalten fehlgeschlagen: an dieser Kamera 10 Minuten kein neuer Versuch, Zähler im Verbesserungslog.
- Rückkehr fehlgeschlagen: Zähler `follow.home_fail`, Hinweis im Snapshot.

## Konfiguration

- `HUB_CAMERA_AUTOZOOM` (Standard an, `off` schaltet ab)
- `HUB_CAMERA_AUTOFOLLOW` (Standard an, `off` schaltet ab)

Zeiten (120 s, 60 s, 30 s, 2 min, 6 s, 5 min) sind Konstanten im Code.

## Umsetzung in drei Schritten

1. **Diagnose, nur lesen:** `CAMERA_CAPS` liefert zusätzlich `GetAiCfg` (Tracking) und die Wachposition. Nach dem Deploy für alle Kameras abfragen und im Journal festhalten.
2. **Koordinator und Folgen:** `camera-motion.ts`, Folgen beim ersten Signal, Grundstellung, Vorrang, Wiederherstellung nach Neustart, Umstellung des Wächters.
3. **Optische Nahaufnahme:** Zoom-Rechnung, `personCloseUp`, Anbindung an Gesichtserkennung und Wächter, `atHome` in den Auswertungen, README angleichen.

## Tests

- Unit-Tests der reinen Logik: Zoom-Ziel (Person am Rand ergibt keinen Zoom, Person in der Mitte bis `M`, Gruppe vor Einzelperson, 5- und 16-fach), Vorrang und Pausen, Ende des Folgens (Person weg, 120 s, Hand).
- Fake-Treiber in `camera-motion.test.ts` (einen Mock-Reolink gibt es im Repo nicht). Abläufe: Person, Folgen, Person weg, Grundstellung, Pause. Zonen-Kamera zoomt höchstens 6 s, Halteverbot überspringt. Hand bricht ab. Neustart mitten im Folgen stellt zurück.
- `tsc` Hub und Cloud, ESLint, `npm test`.

## Erfolgsmessung

Neue Zähler: `face.optical`, `face.optical_face`, `face.optical_match`, `follow.start`, `follow.end_gone`, `follow.end_max`, `follow.home_fail`.

Vergleich gegen den Snapshot vom 06.11. (digitaler Zoom: 8 Gesichter bei 265-mal ohne Gesicht im Vollbild). Ziele nach zwei Tagen Betrieb:

- `face.optical_face` / `face.optical` ≥ 50 %.
- Mehr Gesichter über die Nahaufnahme (`face.optical_face`) als über den digitalen Zoom (`face.zoom` + `face.zoom_face`) im selben Zeitraum.
- `follow.end_gone` > `follow.end_max`, `follow.home_fail` = 0.

## Nicht im Umfang

- Eigene Nachführung des Hubs per YOLO-Regelkreis.
- Anzeige „folgt“/„zoomt“ an der Kachel in der Zentrale.
- Feste Kalibrierung der Zoom-Kurve je Modell (nur Protokoll).
- Seilbahn A wieder erreichbar machen.

## Offen für die Live-Prüfung

- Ob das Tracking der RLC-823A 16X selbst zoomt. Falls ja, darf die Nahaufnahme während des Folgens nicht dagegen arbeiten.
- Ob E1 Pro und RLC-823S1 eine Wachposition unterstützen.
- Zoomfaktor der RLC-823S1.
