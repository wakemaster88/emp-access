# Webcams Dashboard

Lokales TV-Dashboard für Reolink-Cams, Doorbird, Zeiterfassung und beliebige Web-Widgets.
Läuft komplett offline auf einem Mac, der per HDMI am TV hängt.

## Features

- **Reolink-Cams** mit WebRTC (~150 ms Latenz) über go2rtc
  - PTZ-Steuerung mit Hold-Buttons + Tastatur-Shortcuts
  - Spotlight, IR-Modus, Sirene mit Bestätigungs-Dialog + Cooldown
  - Presets 1–4 (Klick / Shift+Klick zum Speichern)
  - Modell-spezifische Buttons (E1 Pro, RLC-810A/811A/823A, GO PT Ultra)
  - Auto-Snapshot-Fallback für Battery-Cams
  - Sub-Stream im Grid, Main-Stream im Fokus → 10+ Cams gleichzeitig möglich
- **Doorbird-Klingel**
  - Webhook-Empfang
  - Vollbild-Klingel-Overlay mit Live-Stream
  - „Tür öffnen" mit Hold-to-confirm (1 s) + Ring-Window-Schutz (90 s)
  - Two-Way-Audio (Push-to-talk)
  - Klingelton + Auto-Hide
- **Beliebige Tile-Typen**: iFrame (Zeiterfassung etc.), Bild-Refresh, Uhr
- **Admin-Bereich** für komplette Konfiguration via Web-UI
- **Audit-Log** für alle Steuerungs- und Klingelvorgänge
- **Auto-Start beim Login** via macOS LaunchAgents

## Voraussetzungen

```bash
brew install node pnpm go2rtc
```

## Schnellstart

```bash
./scripts/setup.sh        # installiert Deps, baut, legt Default-Configs an
pnpm start                # http://localhost:3000
```

Im Browser **/admin** öffnen und Cams + Doorbird konfigurieren.

## Architektur

```
TV ◀── HDMI ── Mac
                ├─ Safari (Vollbild) → http://localhost:3000
                ├─ Next.js 16 (next start)  Port 3000 (nur 127.0.0.1)
                └─ go2rtc                API Port 1984 (nur 127.0.0.1)
                       │                 WebRTC-Medien Port 8555
                       └─ Reolink + Doorbird (LAN)
```

Der Browser spricht nie direkt mit der go2rtc-API: Signalisierung und
Standbilder laufen über die Next-App (`/api/go2rtc/webrtc`,
`/api/go2rtc/frame.jpeg`), das Video selbst kommt per WebRTC von go2rtc.

## Workflow

1. **Cams anlegen** in `/admin/cams` (manuell, IP + Login). „Verbindung testen" prüft sofort.
2. Beim Speichern wird `infra/go2rtc.yaml` automatisch generiert und go2rtc neu geladen (sofern erreichbar).
3. **Widgets** in `/admin/widgets` für Cams, iFrames, Bilder, Uhr.
4. Optional: **Layouts** in `/admin/layouts` mit benannten Position-Sets, sonst Auto-Grid.
5. **Doorbird** in `/admin/doorbird`: API-User, Webhook-URL kopieren, Test-Klingel.
6. Dashboard auf `/` zeigt alles. Klick auf Cam → Fokus-Modus mit Steuer-Panel.

## Tastatur-Shortcuts (im Dashboard)

| Taste | Aktion |
|---|---|
| `1`–`0` | Reolink-Widget Nr. 1–10 in Fokus |
| `Esc` | Fokus zurück |
| `F` | Vollbild |
| `←/→/↑/↓` | PTZ der Fokus-Cam (halten) |
| `+/-` | Zoom optisch |
| `Q/W/E/R` | Preset 1–4 anfahren |
| `Shift+Q…R` | Preset 1–4 speichern |
| `L` | Spotlight toggle |
| `Alt+S` | Sirene-Dialog |

## Auto-Start am Mac (für TV-Kiosk)

```bash
./scripts/install-launchagents.sh   # Next.js + go2rtc + Safari beim Login
./scripts/energy-setup.sh           # Mac geht nie schlafen, Auto-Restart
```

Logs: `~/Library/Logs/webcams/`

Stoppen: `./scripts/uninstall-launchagents.sh`

## Tile-Typen

| Typ              | Verwendung                                            |
| ---------------- | ----------------------------------------------------- |
| `reolink`        | Live-Stream einer Reolink-Cam (WebRTC, Snapshot-Fallback) |
| `iframe`         | Beliebige Web-URL (Zeiterfassung, Wallboards)         |
| `image-refresh`  | Bild-URL mit festem Polling-Intervall                 |
| `clock`          | Datum/Uhrzeit                                         |

## Reolink-Capabilities pro Modell

| Modell | PTZ | Zoom | Spot | Sirene | 2-Way |
|---|---|---|---|---|---|
| E1 Pro | ✅ | digital | – | – | ✅ |
| RLC-810A | – | digital | – | – | – |
| RLC-811A | – | optisch | ✅ | – | – |
| RLC-823A | ✅ | optisch | ✅ | ✅ | ✅ |
| GO PT Ultra | ✅ | digital | ✅ | ✅ | ✅ |
| Duo 3 | – | digital | ✅ | ✅ | ✅ |

Die **Duo 3** liefert ein 180°-Panorama (~32:9): Kacheln rendern das Bild
ungecroppt (`object-contain`) und das Auto-Grid gibt ihr automatisch die
doppelte Breite. In benannten Layouts einfach eine doppelt breite Position
zuweisen.

Das Steuer-Panel blendet automatisch nur die Buttons ein, die das Modell beherrscht.

## Sicherheit

- **Admin-PIN** (Einstellungen → PIN): sobald gesetzt, verlangen alle Seiten
  und API-Routen entweder das Login-Cookie (`/login`, hält 365 Tage — Kiosk
  loggt sich einmal ein) oder den Header `x-admin-token: <PIN>`
  (Sidecar/Skripte). Webhooks (Doorbird/Telegram/emp-access) haben eigene
  Secrets und bleiben offen. Ohne PIN ist alles offen (wie bisher).
- Der Python-Sidecar (Port 8088) verlangt bei gesetzter PIN denselben Token
  (`x-admin-token`) für alle Endpunkte außer `/health`.
- `config.json` enthält Passwörter und ist `.gitignore`d.
- Cam-/Doorbird-Credentials verlassen den Server nie (alle Aufrufe über `/api/`-Routen).
- API-Routen und die Dashboard-Seite maskieren **alle** Secrets zu `***`
  (Cam-/Doorbird-Passwort, Admin-PIN, Telegram-Bot-Token, emp-access-API-Token,
  Webhook-Secrets). Kommt `***` beim Speichern zurück, bleibt der gespeicherte
  Wert stehen (`lib/config-secrets.ts`).
- **go2rtc-API nur auf Loopback** (`api.listen: "127.0.0.1:1984"`). `origin: "*"`
  bleibt vorerst, weil die Kamera-Seite der Cloud-App go2rtc direkt aus dem
  Browser dieses Macs abfragt. `/api/config` und `/api/streams` von go2rtc enthalten die
  RTSP-URLs samt Passwörtern im Klartext und haben keine Anmeldung — sie
  dürfen im LAN nicht erreichbar sein. Next-Server, Hub und Sidecar laufen
  auf demselben Mac und nutzen `http://127.0.0.1:1984`; die
  **go2rtc-URL in den Einstellungen muss deshalb auf `127.0.0.1` (oder
  `localhost`) zeigen**, nicht auf die LAN-IP des Macs. Der RTSP-Port 8554
  und der WebRTC-Port 8555 von go2rtc sind unverändert.
- Tür öffnen nur innerhalb des Ring-Fensters (Default 90 s) — **serverseitig
  erzwungen** (abschaltbar unter Admin → Doorbird), plus Hold-to-confirm 1 s.
  Nur ein echtes Klingeln (DoorBird-Webhook mit Secret) öffnet das Fenster;
  die Test-Klingel im Admin zeigt nur das Overlay.
  ALPR-Auto-Open und Ausfahrt-Zone sind ausgenommen (Whitelist +
  Confirm-Frames + Cooldown bzw. Zone + Cooldown) — aber nur, wenn sich der
  Aufrufer als Tracker-Sidecar ausweist: Header `x-internal-token` mit dem
  `internalToken` aus der `config.json`. Die Next-App erzeugt das Token beim
  Start automatisch, der Sidecar liest es aus derselben Datei; es wird über
  keine API ausgeliefert. Ein Request ohne gültiges Token gilt als UI-Klick
  (`source` im Body wird ignoriert); `/api/vehicle-gate/open` lehnt ihn ab.
- Tür-, Licht- und Sirenen-Routen prüfen den `Origin`-Header: fremde Seiten
  im Kiosk-Browser (iFrame-Widgets) können sie nicht auslösen.
- Der Embed-Proxy (`/api/embed/…`) reicht Login-Cookie, `x-admin-token` und
  internes Token der App nicht an die eingebettete Seite weiter.
- Sirene mit Bestätigungs-Dialog, Dauer-Wahl, Cooldown 60 s, Max-Dauer 30 s, Audit-Log.

## Tests

```bash
pnpm test                 # vitest: Auth, Tür-Öffnen-Policy, Secret-Maskierung, go2rtc-yaml, Embed-Proxy
pnpm exec tsc --noEmit    # Typecheck (inkl. Tests, nichts ausgenommen)
```

## Nach einem Update auf dem Mac

Der Hub zieht den Checkout automatisch nach, baut und startet die Kiosk-Dienste
aber nicht neu. Nach einem Update, das `webcams/` betrifft:

```bash
cd webcams
pnpm install --frozen-lockfile && pnpm build
launchctl kickstart -k gui/$UID/com.local.webcams           # Next.js
launchctl kickstart -k gui/$UID/com.local.webcams-tracker   # Sidecar (liest internalToken)
```

Damit eine geänderte go2rtc-Konfiguration greift (z. B. API nur noch auf
Loopback): in **Admin → Einstellungen** prüfen, dass die go2rtc-URL
`http://127.0.0.1:1984` lautet, dann **„yaml schreiben & reloaden"** klicken
(schreibt `infra/go2rtc.yaml` neu und startet go2rtc neu). Kontrolle:

```bash
lsof -nP -iTCP:1984 -sTCP:LISTEN     # muss 127.0.0.1:1984 zeigen, nicht *:1984
launchctl kickstart -k gui/$UID/com.local.go2rtc   # falls noch *:1984
```

Jedes Neuschreiben der yaml entfernt den `ffmpeg:`-Block, den der Hub dort
einträgt; er kommt beim nächsten Hub-Start zurück
(`launchctl kickstart -k gui/$UID/com.emp-access.hub`).

## Datei-Struktur

```
webcams/
├─ app/
│  ├─ admin/                     # Admin-UI
│  ├─ api/{cams,widgets,layouts,settings,doorbird,events,go2rtc,config}
│  ├─ layout.tsx
│  └─ page.tsx                   # Dashboard
├─ components/
│  ├─ tiles/                     # WebRTC, Snapshot, iFrame, Clock
│  ├─ admin/                     # Forms, Nav, Page-Header
│  ├─ ui/                        # Button, Input, Dialog, Toast, Switch …
│  ├─ cam-control-panel.tsx
│  ├─ dashboard.tsx
│  ├─ doorbird-listener.tsx
│  ├─ doorbird-overlay.tsx
│  └─ wake-lock.tsx
├─ lib/
│  ├─ types.ts                   # zod schemas + REOLINK_CAPS
│  ├─ config.ts                  # config.json load/save
│  ├─ reolink.ts                 # API client + token cache
│  ├─ reolink-control.ts         # PTZ/Spot/IR/Siren wrappers
│  ├─ doorbird.ts                # Doorbird HTTP API
│  ├─ event-bus.ts               # SSE pub/sub
│  ├─ config-secrets.ts          # Secrets maskieren / beim Speichern wiederherstellen
│  ├─ internal-token.ts          # Shared Secret Next ↔ Sidecar
│  ├─ same-origin.ts             # Origin-Prüfung für Tür/Licht/Sirene
│  ├─ audit.ts                   # rolling audit log
│  └─ go2rtc.ts                  # yaml-Generator + reload + Proxy-Helfer
├─ infra/
│  ├─ go2rtc.example.yaml        # Vorlage
│  └─ go2rtc.yaml                # generiert (gitignored)
├─ scripts/
│  ├─ setup.sh                   # Install-Wizard
│  ├─ install-launchagents.sh    # Auto-Start aktivieren
│  ├─ uninstall-launchagents.sh
│  ├─ start-safari-fullscreen.sh # AppleScript: Safari im Vollbild
│  └─ energy-setup.sh            # pmset für Dauerbetrieb
├─ config.example.json
├─ config.json                   # gitignored
└─ README.md
```

## Lizenz

Privat / intern.
