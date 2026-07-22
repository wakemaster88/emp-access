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
                ├─ Next.js 16 (next start)  Port 3000
                └─ go2rtc                Port 1984
                       └─ Reolink + Doorbird (LAN)
```

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
- API-Routen maskieren Passwörter zu `***`.
- Tür öffnen nur innerhalb des Ring-Fensters (Default 90 s) — **serverseitig
  erzwungen** (abschaltbar unter Admin → Doorbird), plus Hold-to-confirm 1 s.
  ALPR-Auto-Open ist ausgenommen (Whitelist + Confirm-Frames + Cooldown).
- Sirene mit Bestätigungs-Dialog, Dauer-Wahl, Cooldown 60 s, Max-Dauer 30 s, Audit-Log.

## Tests

```bash
pnpm test    # vitest: Auth, Tür-Öffnen-Policy, Embed-Proxy-Rewrites
```

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
│  ├─ audit.ts                   # rolling audit log
│  └─ go2rtc.ts                  # yaml-Generator + reload
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
