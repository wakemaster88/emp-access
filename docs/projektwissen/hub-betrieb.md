# Hub-Betrieb

Ergänzt [`hub/README.md`](../../hub/README.md) um den konkreten Betrieb am
Standort.

## Maschine

- **Seit 05.11.2026:** Mac Studio (Apple M5 Max, 64 GB) im Technikraum,
  per Kabel am Core-Switch, WLAN aus. Er hat die feste Adresse des alten
  iMac übernommen (manuell gesetzt plus DHCP-Reservierung im Router), weil
  Router-Regeln, SNMP-Freigaben, go2rtc und die iPhones diese Adresse kennen.
- `HUB_NAME` ist unverändert der des iMac, damit der Hub-Eintrag in der
  Cloud bleibt. Der alte Cloud-Eintrag des iMac ist verwaist und kann
  gelöscht werden.
- Headless: automatische Anmeldung (FileVault aus), Bildschirmfreigabe/VNC
  und SSH. Bei aktivem „Entfernte Verwaltung“ funktionierte die
  Bildschirmfreigabe nicht, deshalb ist sie aus.
- Remote Control für Claude startet nach der Anmeldung über
  `~/repos/start-remote-control.command` (Anmeldeobjekt, wartet auf DNS,
  läuft in einer Schleife). Repo liegt unter `~/repos/emp-access`, Claude
  CLI unter `~/.local/bin/claude`.
- Auf dem Mac Studio blockiert die Sicherheitsprüfung von Remote Control
  Downloads und das Installieren von LaunchAgents. Solche Schritte führt
  Aaron selbst im Terminal aus. Der Hub-Prozess selbst darf Pakete laden
  (Ollama, Modelle, ffmpeg).
- Der Hub hat keine GitHub-Schreibrechte; er zieht nur `main`.
- Der iMac ist abgeschaltet, seine LaunchAgents liegen in
  `~/LaunchAgents-alt` (Rückfallebene), danach löschen.

## Dienste (launchd, Benutzersitzung)

| Dienst | Aufgabe |
| --- | --- |
| `com.emp-access.hub` | Hub (Node), Dashboard Port 8787 (HTTP + HTTPS) |
| `com.local.go2rtc` | Streams, WebRTC Port 8555 |
| `com.local.webcams` | Kamera-Kiosk / Admin (Port 3000) |
| `com.local.webcams-tracker` | YOLO-Tracker (Port 8088) |
| `com.local.webcams-safari` | Safari-Kiosk |

Python-Umgebungen: Face, ALPR und Tracker mit Python 3.12 (onnxruntime
fehlt für 3.14), Mäher-Dienst mit Python ≥ 3.13. `face/install.sh` nimmt das
Standard-`python3`, deshalb mit
`PATH="$(brew --prefix python@3.12)/libexec/bin:$PATH"` aufrufen.

## Logs

- Hub: `~/Library/Logs/emp-hub.log` und `emp-hub.error.log` (Zeitstempel
  UTC). Auch aus der Cloud abrufbar (Netzwerk → Lokaler Hub → Log abrufen).
- go2rtc: `~/Library/Logs/webcams/go2rtc.log`.
- Log-Kürzung: `~/repos/log-trim.sh` mit LaunchAgent `com.local.log-trim`
  (kopiert und kürzt ab 10 MB, 5 Generationen).

## Dashboard und PWA

Port 8787 spricht HTTP und HTTPS. Die lokale CA in `hub/.tls/` wurde vom
iMac übernommen, damit iPhones und iPads ihr weiter vertrauen. Wird sie neu
erzeugt, muss jedes Gerät die CA neu installieren (`/ca.crt`, dann in den
Zertifikatsvertrauenseinstellungen einschalten). Von außerhalb des Hubs
braucht das Dashboard `HUB_DASHBOARD_TOKEN`.

## Streams und Zentrale

- go2rtc-Namen sind Slugs wie `cam-halle-2`; der Hub ordnet sie über die IP
  den Kameras zu. Kacheln nutzen `_sub`, die Großansicht `_main` (fällt nach
  8 s ohne Bild auf `_sub` zurück).
- Substreams sind H.264 640×360 mit 10 fps; die 4K-Hauptstreams der
  RLC-811A und der Duo 3 sind H.265.
- **STUN ist aus** (`webrtc: ice_servers: []` in `go2rtc.yaml`, Generator
  PR #95). Mit STUN dauerte die WebRTC-Antwort auf dem Mac Studio teils
  über 5 s je Kamera.
- **Achtung:** `webcams/config.json` (Quelle für `go2rtc.yaml` über
  `/admin`) war am 05.11. nicht mit `go2rtc.yaml` synchron (alte
  Kamera-Adressen). Vor dem Speichern in `/admin` abgleichen, sonst werden
  falsche Adressen zurückgeschrieben.
- Mäher-Kameras: nur der `_h264`-Stream liefert ein Bild im Browser und
  Standbilder; auf dem rohen H.265-Stream scheitert `frame.jpeg`.

## Kameras: Schwenken und Zoom

| Modell | Kann |
| --- | --- |
| RLC-823S1, RLC-823A 16X | Schwenken, Zoom, Presets, Scheinwerfer, Sirene |
| E1 Pro | Schwenken, Presets |
| RLC-811A | nur Zoom |
| Duo 3 | Weitwinkel, kein Zoom |

- RLC-811A bestätigen `PtzCtrl ZoomInc/ZoomDec`, bewegen sich aber nicht.
  Sie zoomen nur über `StartZoomFocus` mit `op: ZoomPos` (Bereich aus
  `GetZoomFocus`, sonst 0–33). Der Hub setzt das um (PR #74).
- PTZ-Befehle pro Kamera nacheinander schicken; gleichzeitiges Bewegen und
  Stoppen ergab `rspCode -13`.
- Tracking schaltet bei diesen Modellen `bSmartTrack`, nicht `aiTrack`.
- Der Hub liest alle 30 Minuten die Kamera-Uhr (nur lesend) und zeigt eine
  Abweichung über 3 s an. NTP an den Kameras einschalten nur mit Aarons OK.

## Fallstricke im Code

- **Prisma 7.4:** `in` zusammen mit `mode: "insensitive"` liefert **nichts**
  (mit Postgres 16 nachgestellt). Dadurch stand der Online-Status aller
  Netzwerk-Clients zwei Monate still. MACs immer über `src/lib/mac.ts`
  (`macSpellings`, `normalizeMac`) vergleichen (PR #43).
- Shelly-Heizungen brauchen Kategorie `SCHALTER`; ohne Kategorie wird ein
  Gerät als Türöffner mit 3-s-Impuls behandelt.
- `shellyId` mit und ohne `_1` landen beide auf Kanal 0 (mögliche
  Dubletten, nicht geprüft).
- `PersonSighting.seenAt` ist naive UTC-Zeit.
- Ein Netzwerk-Scan von Hand entspricht einem `HubTask` vom Typ
  `NETWORK_SCAN` mit Status `PENDING` (wie die Taste in der Oberfläche).
