This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Telegram Tagesbericht (Vercel Cron)

1. **Umgebungsvariable `CRON_SECRET`** in Vercel anlegen (z. B. 32 Zeichen Zufall), **Production** (und ggf. Preview) aktivieren, danach **Redeploy**.
2. Ohne `CRON_SECRET` antwortet `/api/cron/telegram-report` mit **503** – der Job läuft dann nicht sichtbar „erfolgreich“.
3. Vercel sendet bei Cron-Aufrufen `Authorization: Bearer <CRON_SECRET>`. Der Wert muss **exakt** mit der Variable übereinstimmen.
4. Der Bericht wird nur gesendet, wenn die **Berliner Uhrzeit** (HH:mm) mit der in den Einstellungen gewählten Zeit übereinstimmt (Cron alle 15 Minuten).
5. Test manuell:  
   `curl -s -H "Authorization: Bearer DEIN_CRON_SECRET" "https://deine-domain.vercel.app/api/cron/telegram-report"`

## Push-Benachrichtigung „Gerät offline" (PWA / Web-Push)

Alle 5 Minuten prüft `/api/cron/device-offline-check`, ob Geräte offline gegangen
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
   `curl -s -H "Authorization: Bearer DEIN_CRON_SECRET" "https://deine-domain.vercel.app/api/cron/device-offline-check"`

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
- `CRON_SECRET` – wird von `/api/cron/audio-schedules` mitgenutzt (alle 5 Min).

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
   (Musikpegel während einer Ansage).
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
  (Sensor, Audio-Zone).
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
| Sensor / Audio-Zone | `SENSOR` / `AUDIO` | keine |

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
