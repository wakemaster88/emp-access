# EMP Access

Zutritts- und Betriebssystem für einen Freizeitstandort: Drehkreuze und Türen
mit Ticket-Scan, Kassen-Kiosk, Schließanlage, Kameras mit Personen- und
Kennzeichenerkennung, Beschallung, Bewässerung, Netzwerkinventar und
Raumregeln – als Multi-Mandanten-Cloud auf Vercel mit Neon Postgres.

## Architektur

Vier Laufzeitumgebungen in einem Repository:

| Teil | Ordner | Läuft wo | Aufgabe |
| --- | --- | --- | --- |
| Cloud | `src/` | Vercel (Region `fra1`), Neon Postgres | Dashboard, öffentliche Token-Seiten (Monitor, Kiosk, Scanner), API für Geräte und Integrationen, Crons |
| Hub | `hub/` | Mac vor Ort (launchd) | Kameras, DoorBird, Gesichter, Kennzeichen, Netzwerkscan; verbindet sich nur ausgehend |
| Scanner-Pi | `raspberry-pi/emp_scanner` | Raspberry Pi am Drehkreuz | USB-Scanner, Relais, Heartbeat |
| Audio-Pi | `raspberry-pi/emp_audio` | Raspberry Pi am Verstärker | Musik, Durchsagen, Snapcast |

Hub und Pis aktualisieren sich selbst aus `origin/main`; neu gestartet wird
nur, wenn sich ihr eigener Ordner geändert hat.

**Mandantentrennung.** Jede Anfrage bekommt über `tenantClient(accountId)`
(`src/lib/prisma.ts`) einen Prisma-Client, der jede Query auf den Account
einschränkt und beim Anlegen den `accountId` setzt. Der rohe Client ist Cron,
Super-Admin und den öffentlichen Token-Endpunkten vorbehalten, die den Account
selbst mitgeben. Die RLS-Policies in der Datenbank bleiben bestehen, greifen
für die Owner-Rolle der App aber nicht – `npx tsx scripts/db-rls-check.ts`
zeigt den Ist-Zustand.

**Auth.** Dashboard per E-Mail/Passwort (bcrypt, Sperre nach zehn
Fehlversuchen, optional TOTP), JWT-Sitzung eine Woche mit Revalidierung gegen
die Datenbank alle fünf Minuten. Maschinen nutzen das Account-API-Token
(Hub, Integrationen) oder ein Geräte-Token pro Pi (nur Geräte-Endpunkte,
Gerätedetail → *Geräte-Token*). Öffentliche Seiten (Monitor, Kiosk, Scanner,
Mitarbeiter-PWA, Schlüsselprotokoll) laufen über zufällige URL-Token; die
schreibenden Endpunkte sind pro Token gebremst.

**Bilder und PDFs** liegen im Vercel-Blob-Speicher (privat), die Datenbank
hält nur den Pfad. Altbestand in den Bytes-Spalten zieht
`npx tsx scripts/migrate-images-to-blob.ts` um; der nächtliche Cron räumt
verwaiste Dateien weg.

## Entwicklung

```bash
npm install
npx prisma generate
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint
npm test             # node:test in src/lib/*.test.ts
```

Umgebungsvariablen (lokal in `.env`, auf Vercel unter Settings → Environment
Variables): `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (Migrationen),
`AUTH_SECRET`, `AUTH_URL`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, optional
`XAI_API_KEY` (TTS), `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/
`VAPID_SUBJECT` (Web-Push), `TWO_FACTOR_KEY`.

**Datenbank.** Schema in `prisma/schema.prisma`, Migrationen in
`prisma/migrations`. Der Vercel-Build (`scripts/vercel-build.mjs`) führt
`prisma migrate deploy` nur für Production aus; Preview-Deployments migrieren
nur mit `PREVIEW_MIGRATE=1` (setzen, wenn die Neon-Integration pro Preview
eine eigene Branch anlegt). Nach Schema-Änderungen `npm run tenant-models`
ausführen, damit die Liste der Mandanten-Modelle stimmt (CI prüft das).

**Crons** (`vercel.json`): `audio-schedules` minütlich, `tick-5min`
(Raumregeln, Bewässerung, Geräte-Offline-Check, Telegram-Tagesbericht),
`anny-sync` stündlich, `email-automations` täglich, `cleanup` nachts
(abgelaufene Tickets, Löschfristen, Blob-GC). Alle verlangen
`Authorization: Bearer <CRON_SECRET>`.

**Skripte** in `scripts/`: Prüf- und Wartungswerkzeuge; einmalige
Datenkorrekturen liegen in `scripts/archive/`.

## Telegram Tagesbericht (Vercel Cron)

1. **Umgebungsvariable `CRON_SECRET`** in Vercel anlegen (z. B. 32 Zeichen Zufall), **Production** (und ggf. Preview) aktivieren, danach **Redeploy**.
2. Ohne `CRON_SECRET` antwortet `/api/cron/tick-5min` mit **503** – der Job läuft dann nicht sichtbar „erfolgreich“.
3. Vercel sendet bei Cron-Aufrufen `Authorization: Bearer <CRON_SECRET>`. Der Wert muss **exakt** mit der Variable übereinstimmen.
4. Der Bericht wird gesendet, sobald der 5-Minuten-Tick die in den Einstellungen gewählte **Berliner Uhrzeit** erreicht hat; pro Tag genau einmal (`dailyReportLastSentAt`), ein verspäteter Tick holt ihn bis 20 Minuten nach.
5. Test manuell:  
   `curl -s -H "Authorization: Bearer DEIN_CRON_SECRET" "https://deine-domain.vercel.app/api/cron/tick-5min"`

## Push-Benachrichtigung „Gerät offline" (PWA / Web-Push)

Alle 5 Minuten prüft `/api/cron/tick-5min`, ob Geräte offline gegangen
(oder wieder online gekommen) sind, und sendet Web-Push an alle im Dashboard
registrierten Browser/PWA-Geräte. Pro Offline-Episode gibt es genau eine
Benachrichtigung (Zustandsübergang, kein Spam).

**Einrichtung:**

1. VAPID-Schlüsselpaar erzeugen: `npx web-push generate-vapid-keys`
2. In Vercel als Umgebungsvariablen anlegen (Production, danach Redeploy):
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` – Public Key
   - `VAPID_PRIVATE_KEY` – Private Key
   - `VAPID_SUBJECT` – Kontakt, z. B. `mailto:admin@deine-domain.de`
3. `CRON_SECRET` muss gesetzt sein (siehe Telegram-Abschnitt) – der Cron nutzt dieselbe Auth.
4. Im Dashboard unter **Einstellungen → Push-Benachrichtigungen** auf jedem
   gewünschten Gerät „Auf diesem Gerät aktivieren" drücken.
   - **iPhone/iPad:** Die Seite muss zuerst über Safari **zum Home-Bildschirm
     hinzugefügt** und von dort geöffnet werden, sonst erlaubt iOS kein Web-Push.
5. Pro Gerät die Überwachung einschalten: Gerätedetail → **Bearbeiten** →
   **Offline-Benachrichtigung** (Opt-in, Standard: aus). Nur Geräte mit
   aktiviertem Schalter lösen Push-Meldungen aus.
5. Test manuell:  
   `curl -s -H "Authorization: Bearer DEIN_CRON_SECRET" "https://deine-domain.vercel.app/api/cron/tick-5min"`

**Erkennung je Gerätetyp:** Raspberry Pi über Heartbeat (`lastUpdate` älter als
5 Min = offline), Shelly über die Shelly Cloud, GARDENA über die GARDENA Cloud.
Nuki wird nicht geprüft. Shelly-Geräte ohne Cloud-Anbindung (nur lokale IP)
können von Vercel aus nicht erreicht und daher nicht überwacht werden.

## Audio (Musik & Durchsagen)

Zentrale Beschallung über Zonen-Abspieler. Jede **Zone** ist ein Raspberry Pi
mit angeschlossenem Verstärker; gesteuert wird alles im Dashboard unter
**Audio**. Musik und Ansagen liegen im Blob-Storage, die Pis halten die Dateien
lokal vor und spielen auch ohne Internetverbindung weiter.

**Umgebungsvariablen (Vercel → Settings → Environment Variables):**

- `BLOB_READ_WRITE_TOKEN` – Vercel Blob. Ohne den Token schlagen Uploads und
  das Rendern von Sprachansagen fehl (die API antwortet dann mit 501).
- `XAI_API_KEY` – Text-zu-Sprache für Durchsagen (xAI, `POST /v1/tts`, deutsch).
  Gleicher Text mit gleicher Stimme wird gecacht, es fällt also nur beim ersten
  Mal ein Aufruf an. Die Stimmenauswahl im Dialog kommt aus
  `GET /v1/tts/voices`, damit dort nichts steht, was die API ablehnt.
- `CRON_SECRET` – wird von `/api/cron/audio-schedules` mitgenutzt (minütlich).

**Zone einrichten:**

1. Unter **Geräte → Gerät hinzufügen** die Hardware **Audio-Player** wählen
   (Typ `AUDIO_PLAYER`). Die Gerätedetails zeigen danach das Konfigurations-JSON
   für den Pi.
2. Unter **Audio → Zonen** eine Zone anlegen und das Gerät zuordnen.
3. **Quelle** wählen – das ist, was der Start-Knopf abspielt:
   - *Playlist* → die eingestellte Standard-Playlist
   - *Webradio* → die eingetragene Stream-URL, z. B.
     `https://stream.bigfm.de/sunsetlounge/mp3-128/homepage/`. Immer die
     Sender-URL eintragen, nicht die Adresse, auf die sie weiterleitet – die
     enthält einen Sitzungsschlüssel und läuft ab.
   - *Keine Musik* → Zone macht ausschließlich Durchsagen
4. Lautstärken setzen: *Musik* (Grundpegel), *Durchsage* und *Ducking*
   (Musikpegel während einer Ansage). Der Pi hebt Ansagen vor der Wiedergabe auf
   einen einheitlichen Pegel an, weil Sprachdateien von Natur aus leiser sind als
   gemasterte Musik. Setzt sich eine Ansage trotzdem nicht durch, gehört der
   Ducking-Pegel weiter herunter – nicht die Durchsage weiter hoch.
5. Überlappen sich Zonen akustisch, bei allen dieselbe **Sync-Gruppe**
   eintragen – die Abspieler laufen dann über Snapcast synchron.

Die Quelle bleibt beim Stoppen erhalten; `sourceKind` in der Datenbank ist
dagegen der Ist-Zustand, den der Pi nach Neustart oder Durchsage wieder
aufnimmt.

**Mithören:** Der Kopfhörer-Knopf auf einer Zonenkarte spielt deren Quelle auf
dem eigenen Gerät – bei Webradio denselben Stream, bei einer Playlist deren
Titel, beginnend beim zuletzt gemeldeten. Es läuft immer nur eine Zone.

Das ist kein Abhören des Verstärkerausgangs: ob am Lautsprecher wirklich Ton
ankommt, sagt das Mithören nicht. Durchsagen sind nicht dabei, die laufen als
eigener Job auf dem Pi. Bei Playlists ist es außerdem nicht taktgleich, weil der
Pi keine Wiedergabeposition meldet, sondern nur alle 60 Sekunden einen Titel.

**Durchsagen zu festen Zeiten** (Tab **Zeitpläne**): Ein Zeitplan besteht aus
Aktion, Uhrzeit und Wochentagen. Für *Durchsage abspielen* muss die Ansage
vorher unter **Vorlagen** gespeichert sein – nur Vorlagen stehen in der Auswahl.
Mehrere Zeiten am Tag sind mehrere Zeitpläne; eine Zeitplanzeile ist ein Termin.
Neben `ANNOUNCE` gibt es `PLAY` (Playlist starten, z. B. zur Öffnung), `STOP`
(Betriebsschluss) und `VOLUME`.

Ausgewertet wird minütlich per Cron, und zwar in der Zeitzone des Accounts
(`Account.timezone`, ohne Eintrag Europe/Berlin) – Sommerzeit wird also
mitgenommen. Verzögerte oder ausgefallene Cron-Ticks holt ein Fenster von fünf
Minuten nach, `lastRunAt` verhindert dabei die Wiederholung: pro Tag löst ein
Termin genau einmal aus. Kommt der Tick über fünf Minuten hinaus nicht, fällt der
Termin bewusst aus, statt deutlich zu spät zu kommen. Prüfen lässt sich die
Zeitrechnung mit `npx tsx scripts/audio-schedule-check.ts`.

Jede Zeitplankarte zeigt den nächsten Termin („heute 18:30") und den letzten Lauf.
Dazu warnt sie, wenn der Termin nichts bewirken wird: Zielzone ohne Abspieler,
Abspieler offline, gelöschte oder leere Playlist, oder ein `PLAY` mitten in der
Ruhezeit der Zone. Diese Fälle fallen sonst erst zur Uhrzeit auf – und dann
merkt sie niemand, weil ja gerade nichts passiert.

Steht nach dem ersten Termin noch „noch nie ausgeführt", liegt es am Cron oder an
`CRON_SECRET`. Lief er, hinterlässt er einen Eintrag im Tab **Verlauf**, dort mit
dem Etikett *Zeitplan*. Befehle an Zonen ohne Abspieler holt niemand ab; sie
werden nach fünf Minuten als *hängt* markiert und zählen zum Filter „Nur
Probleme".

**Geräte-Schnittstelle** (Auth wie bei den Scanner-Pis über das Account-Token):

- `GET /api/devices/audio?id=<deviceId>` – Zonenkonfiguration und offene Jobs
- `POST /api/devices/audio` – Heartbeat mit Ist-Zustand und Job-Rückmeldungen

**Pi-Client:** `raspberry-pi/emp_audio` spricht diese Schnittstelle. Installation
und Fehlerbehebung stehen in [raspberry-pi/README-audio.md](raspberry-pi/README-audio.md).

## Markisen und Rolltore (Antriebe mit zwei Fahrtrichtungen)

Geräte der Funktion **Markise** oder **Rolltor** werden nicht als Relais
geschaltet, sondern gefahren: Auf, Stopp, Zu. Dahinter steckt ein Shelly mit
zwei getrennten Relais – ein Kanal je Fahrtrichtung.

**Einrichten:** Beim Anlegen oder Bearbeiten des Geräts die Funktion *Markise*
bzw. *Rolltor* wählen und im Abschnitt **Antrieb** hinterlegen, welcher
Shelly-Kanal auf-, welcher zufährt, sowie die volle Fahrzeit in Sekunden.

**Wichtig zur Sicherheit:** Beide Relais dürfen nie gleichzeitig anziehen, sonst
arbeitet der Motor gegen sich selbst. Die Steuerung schaltet deshalb vor jeder
Fahrt zuerst die Gegenrichtung ab, wartet eine halbe Sekunde und zieht erst dann
das Zielrelais an. Lässt sich die Gegenrichtung nicht abschalten, startet die
Fahrt gar nicht erst. Deshalb müssen Auf und Zu zwingend auf unterschiedlichen
Kanälen liegen; das prüfen Formular und API.

Die Fahrzeit geht als Shelly-eigener Auto-Off-Timer mit. Das Relais fällt damit
auch dann wieder ab, wenn die Verbindung mitten in der Fahrt abreißt. Eine
zusätzliche Absicherung im Gerät selbst (Auto-Off in den Shelly-Einstellungen)
schadet trotzdem nicht.

Antriebe lassen sich auch in **Szenen und Automationen** verwenden – dort stehen
statt Ein/Aus/Toggle die Aktionen Auf, Stopp und Zu zur Auswahl.

**Über die API** (Account-Token, siehe Einstellungen → Eigene API):

- `GET /api/devices` und `GET /api/devices/[id]` liefern bei Antrieben
  zusätzlich `coverUpChannel`, `coverDownChannel` und `coverRuntimeSec`.
- `POST /api/devices/[id]/action` mit `{"action":"close"}` bzw. `"stop"` fährt
  zu oder hält an. Passt die Aktion nicht zum Gerät, antwortet die API mit 400.
- Antwortet sie mit `"sent": false`, wurde der Befehl angenommen, aber nicht
  zugestellt; das Feld `error` nennt den Grund.

## Taster (schaltet für eine feste Dauer ein)

Ein Gerät der Funktion **Taster** bleibt nicht an, bis jemand ausschaltet: Ein
Druck schaltet das Relais ein, nach der eingestellten **Einschaltdauer** fällt es
von selbst wieder ab. Gedacht für alles, was nur kurz laufen soll – Außendusche,
Wasserhahn, Torimpuls.

**Einrichten:** Beim Anlegen oder Bearbeiten die Funktion *Taster* wählen und im
Abschnitt **Taster** die Einschaltdauer in Sekunden hinterlegen (1 bis 1800,
Vorgabe 30). Ohne eigenen Wert gilt die Vorgabe – ein Taster bliebe sonst
dauerhaft an.

Den Timer übernimmt der Shelly selbst (`toggle_after` bzw. `timer`), nicht der
Server. Das Relais fällt deshalb auch dann wieder ab, wenn die Verbindung direkt
nach dem Einschalten abreißt. Aus demselben Grund gibt es einen Taster nur mit
einem Shelly, nicht mit einem Raspberry Pi.

Bedient wird er mit **Betätigen** (startet den Impuls) und **Ausschalten**
(bricht ihn vorzeitig ab), über die API mit `{"action":"open"}` bzw.
`{"action":"reset"}`.

**Abgrenzung zum Schalter:** Ein *Schalter* und eine *Beleuchtung* bleiben nach
dem Einschalten an, bis jemand ausschaltet. Nur *Taster* und Zugangsgeräte
(Tür, Drehkreuz – kurzer Türöffner-Impuls) bekommen einen Auto-Off-Timer.

## Geräte über die API steuern

Damit ein fremdes System die richtigen Knöpfe anbieten kann, liefert jedes
Gerät aus `GET /api/devices` und `GET /api/devices/[id]` seine Bedienung mit:

```json
{
  "id": 12, "name": "Markise Terrasse", "type": "SHELLY", "category": "MARKISE",
  "control": "COVER",
  "controls": [
    { "action": "open",  "label": "Ausfahren", "role": "primary" },
    { "action": "stop",  "label": "Stopp",     "role": "secondary" },
    { "action": "close", "label": "Einfahren", "role": "secondary" }
  ],
  "actions": ["open", "stop", "close"]
}
```

- **`control`** ist das Bedienmodell: `DOOR`, `TURNSTILE`, `LOCK`, `SWITCH`,
  `LIGHT`, `PULSE`, `COVER`, `VALVE`, `SENSOR` oder `AUDIO`.
- **`controls`** sind die Knöpfe in Anzeigereihenfolge – der Hauptbefehl steht
  vorn (`role: "primary"`), `role: "danger"` markiert Eingriffe wie NOT-AUF.
  Eine leere Liste heißt: Das Gerät wird nicht über Aktionen gesteuert
  (Sensor). Audio-Zonen haben Start/Stopp; Lautstärke und Quelle kommen über
  `POST /api/devices/[id]/audio`.
- **`actions`** ist die weiter gefasste Liste der Befehle, die der Endpunkt
  annimmt. Ein Schalter versteht z. B. auch `emergency`, ein Antrieb nimmt
  `reset` als Synonym für `stop`. Für eine Oberfläche ist `controls` richtig.

Ein Auszug, wie sich die Gerätetypen unterscheiden:

| Gerät | `control` | Knöpfe |
| --- | --- | --- |
| Tür (Pi) | `DOOR` | Öffnen |
| Drehkreuz | `TURNSTILE` | Öffnen, NOT-AUF |
| Nuki Smart Lock | `LOCK` | Tür öffnen, Abschließen |
| Shelly-Schalter | `SWITCH` | Einschalten, Ausschalten |
| Beleuchtung | `LIGHT` | Anschalten, Ausschalten |
| Taster | `PULSE` | Betätigen, Ausschalten |
| Markise | `COVER` | Ausfahren, Stopp, Einfahren |
| Rolltor | `COVER` | Öffnen, Stopp, Schließen |
| GARDENA-Ventil | `VALVE` | Bewässern, Stopp |
| Sensor | `SENSOR` | keine |
| Audio-Zone | `AUDIO` | Start, Stopp |

Abspieler (`AUDIO_PLAYER`) liefern zusätzlich `audio` (Zone, Titel, Lautstärke,
aktuelle Quelle). Lautstärke, Playlist, einzelner Titel oder Stream-URL gehen
über `POST /api/devices/[id]/audio` mit `{ "action": "PLAY"|"STOP"|"VOLUME", ... }`.
Die Mediathek steht unter `GET /api/audio/library` (Playlists und Musiktitel).

Die Zuordnung liegt in `src/lib/device-controls.ts` und wird von der
Mitarbeiter-PWA und der API gemeinsam genutzt – die App zeigt also genau die
Knöpfe, die auch die API meldet. `npx tsx scripts/device-controls-check.ts`
prüft, dass jeder gemeldete Knopf vom Action-Endpunkt angenommen wird.

## Zwei-Faktor-Anmeldung (Admin-Login)

Jeder Admin kann seine Anmeldung unter **Sicherheit** in der Seitenleiste um
einen Einmalcode aus einer Authenticator-App absichern (TOTP nach RFC 6238,
sechs Stellen, 30 Sekunden – Google Authenticator, Microsoft Authenticator,
1Password, Aegis und alle anderen gängigen Apps).

**Einrichten:** Passwort bestätigen, QR-Code scannen (oder das Secret abtippen),
einen Code aus der App eingeben. Danach erscheinen einmalig zehn
**Wiederherstellungscodes** – die Rückfalltür, wenn das Handy weg ist. Jeder
davon funktioniert genau einmal.

**Anmeldung:** Nach E-Mail und Passwort fragt der Login nach dem Code. An dieser
Stelle wird auch ein Wiederherstellungscode akzeptiert.

**Wenn niemand mehr hineinkommt:**

- Mandanten-Benutzer: Der SUPER_ADMIN setzt den zweiten Faktor unter
  *Mandanten → Benutzer* zurück (Schild-Symbol in der Zeile).
- Der SUPER_ADMIN selbst: `npx tsx scripts/reset-2fa.ts admin@example.de`
  direkt am Server. `--list` zeigt vorher, wer 2FA aktiv hat.

**Was die Umsetzung absichert:**

- Nach fünf Fehlversuchen ist das Konto 15 Minuten gesperrt – sonst wären eine
  Million mögliche Codes schnell durchprobiert.
- Ein akzeptierter Code gilt nur ein einziges Mal, auch innerhalb seiner
  30 Sekunden.
- Das TOTP-Secret liegt mit AES-256-GCM verschlüsselt in der Datenbank; der
  Schlüssel kommt aus `AUTH_SECRET` (oder `TWO_FACTOR_KEY`, falls gesetzt). Ein
  Datenbank-Dump allein genügt also nicht, um fremde Codes zu erzeugen.
- Ändert sich `AUTH_SECRET`, sind bestehende Secrets unlesbar. Betroffene müssen
  ihre 2FA neu einrichten (Reset wie oben).

`npx tsx scripts/two-factor-check.ts` prüft die Umsetzung gegen die Testvektoren
aus RFC 6238 sowie Sperre, Einmaligkeit und Wiederherstellungscodes.

## Mobile und PWA

Jede Oberfläche lässt sich als App auf den Home-Bildschirm legen; erst so gibt
es auf iPhone und iPad Push-Nachrichten, Vollbild und ein Startbild.

- **Dashboard** (`/manifest.json`): Einstellungen → *App auf dem Handy* zeigt
  die passenden Schritte (Android: Installieren-Knopf, iOS: Teilen → Zum
  Home-Bildschirm). Auf Handys gibt es unten eine Tab-Leiste, offene Warnungen
  erscheinen als Zähler auf dem App-Symbol.
- **Kiosk, Scan-Monitor, Auslastung, Scanner** haben je Token ein eigenes
  Manifest (`/api/pwa-manifest/<art>/<token>`) mit dem Monitornamen; Kiosk und
  Monitore starten im Vollbild und halten den Bildschirm wach (Wake Lock).
- **Mitarbeiter-PWA** (`/m/<token>`): Manifest pro Person, Installationshinweis
  unten auf der Seite.
- **Offline**: Der Service Worker (`public/sw.js`) zeigt ohne Netz `/offline`
  statt der Browser-Fehlerseite und hält statische Dateien im Cache. `/api`
  wird nie gecacht. Bei Änderungen an `sw.js` die `VERSION`-Konstante anheben.
- **Startbilder und Maskable-Icons** liegen unter `public/splash` bzw.
  `public/icon-*-maskable.png` und werden mit `npm run pwa-assets` aus
  `logo.png`/`logo-dark.png` erzeugt (Geräteliste in `src/lib/pwa-splash.ts`).
