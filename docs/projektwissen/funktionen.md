# Funktionen ohne eigene Doku

Kurzbeschreibungen der Funktionen, die weder im Haupt-README noch in
`hub/README.md` stehen. Die Hub-Assistent-Funktionen (Wächter,
Früherkennung, Belegung, Energie, Mäher) beschreibt `hub/README.md`.

## Menü und Modulaufteilung (11.11.2026)

- Sieben Bereiche mit je drei bis sechs Modulen: Übersicht (Dashboard,
  Live-Monitor, Auswertung), Gäste, Angebot (inkl. Monitore), Zutritt
  (Scanner, Scan-Historie, Schließanlage), Kameras & Sicherheit (Überwachung,
  Kameras, Kontrollzentrum, Personen, Fahrzeuge), Gebäude & Technik,
  Verwaltung (Mitarbeiter, E-Mail, Einstellungen).
- Suche „Modul suchen“ oben in der Seitenleiste, Logik in
  `src/lib/nav-search.ts` (Umlaute egal, Wortanfänge, Stichworte je Eintrag
  in `nav-config.ts`).

## Update-Hinweis nach Deployments (13.11.2026)

- Jeder Build bekommt eine Kennung (`NEXT_PUBLIC_BUILD_ID` = Vercel-Deployment-ID, sonst Commit; `next.config.ts`). `/api/version` liefert die des laufenden Deployments, öffentlich und ungecacht.
- `src/components/layout/update-prompt.tsx` (Root-Layout) vergleicht beim Zurückholen in den Vordergrund, bei Fokus, nach Wiederverbinden und alle 5 Min. Weicht die Kennung ab: Dialog „Neue Version verfügbar“ mit „Jetzt aktualisieren“ / „Später“ (30 Min Pause), nie über einer schon offenen Ebene.
- Kiosk-Seiten (`/monitor/`, `/resource-monitor/`, `/scanner/`, `/checkin/`) fragen nicht, sondern laden neu, sobald 1 Min niemand getippt hat.
- Aktualisieren holt den neuen Service Worker (`SKIP_WAITING`) und lädt neu. Das hilft vor allem der installierten PWA auf iOS, die sonst beim Zurückholen den alten Stand weiterzeigt. Ein Schleifenschutz verhindert erneutes Laden für dieselbe Version innerhalb von 10 Min.
- Lokal und in der CI ist die Kennung `dev`, dort erscheint der Hinweis nie.

## MCP-Schnittstelle für KI-Assistenten (PR #100, 10.11.2026)

- `POST /api/mcp`: Claude und andere KI-Clients fragen EMP-Access ab und
  schalten je nach Token-Stufe Raumgeräte. Details in `docs/mcp.md`.
- Eigene MCP-Tokens unter Einstellungen → MCP-Schnittstelle, Stufen
  `read`, `operate`, `access`. `access` (Türen, Tore, Schlösser,
  Drehkreuze, Sirene) ist noch nicht freigeschaltet. Netzwerkänderungen
  gibt es auf keiner Stufe.
- Hub-Werkzeuge laufen als Hub-Task `AGENT_TOOL` mit eigener Freigabeliste
  auf dem Hub; schaltende Aufrufe meldet die Cloud in Telegram.

## Vereinsportal (PR #94, #96, 08.11.2026)

- Jeder Verein bekommt einen geheimen Link `/verein/<token>`, ohne Passwort.
  Backoffice unter Vereine · Buchungen: Portal einrichten,
  Monatsabrechnung, CSV, „abgerechnet“ mit Rechnungsnummer.
- Eine Buchung erzeugt einen ANNY-Blocker (`SlotBlock`, Grund „Verein
  <Name>“), ein Zeitfenster-Ticket für den Zutritt und eine
  `VereinSlotBooking` mit Preis-Schnappschuss. Preis pro Slot je Verein und
  Service (`VereinBookableService`).
- Zugang (DoorBird-Tor, Tür per Shelly) gilt nur im Slot plus Vor- und
  Nachbereitung (`portalLeadMinutes`/`portalTrailMinutes`, Standard 30/30).
  Taste „Öffnen“ im Portal; das Tor öffnet über den Hub-Task `DOORBIRD_OPEN`.
- Storno durch den Verein bis `portalCancelHours` (48 h) vorher, danach nur
  im Backoffice. Stornierte Buchungen werden nicht berechnet.
- Wunschzeit-Anfragen: Ohne freien Slot fragt der Verein eine Zeit an
  (Status `REQUESTED`). Freigabe im Backoffice (Karte „Anfragen“) oder per
  Telegram-Taste (`vreq:ok|no:<id>`); beides läuft über
  `finalizeVereinBooking`.
- „Gebucht von“ ist Pflicht, „Bemerkung“ für Teilnehmer und Hinweise.
- Slot-Logik geteilt in `src/lib/service-slots.ts` und
  `src/lib/slot-blocks.ts`.

## Räume-Seite (PR #44–#50, #63, #67)

- Tabs je Raum, Lagebild, Tab „Ohne Raum“; Ansicht in der URL
  `?raum=<id>|ohne-raum`.
- Widgets: Klima, Beleuchtung, Beschallung, Überwachung, Ereignisse,
  Betriebszeit, Regeln & Abläufe, Mähroboter, Bewässerung.
- Klimaverlauf: Tabelle `ClimateSample`, Fühler im LAN liest der Hub
  (`hub/src/climate.ts`), H&T-Fühler kommen per Webhook
  `/api/climate/report`; Seite `/raeume/klima`.
- Szenen = `RoomRule` mit Auslöser `MANUAL`; Klima übersteuern mit Ablauf
  über `RoomClimate.overrideC/overrideUntil`.
- Klimaregelung je Raum (`src/lib/room-climate.ts`, Cron alle 5 min):
  Hysterese, Absenkung, Vorheizen und Nachlauf um die Betriebszeit,
  Shelly-Abschaltung nach 15 min ohne Bestätigung, Heizung aus bei altem
  Fühlerwert.
- Hue: Geräte vom Typ `HUE_LIGHT`, Schaltbefehle als Hub-Task `HUE_SET`.
  Gruppen (`hueLightId` = `g<id>`) schalten über `/groups/<id>/action`.
  Der Hub meldet gekoppelte Lampen und Gruppen alle 10 min an die Cloud
  (`/api/hub/hue-sync`, zunächst ohne Raum).
- Platzhalter in Durchsagen: `{uhrzeit}`, `{oeffnung}`, `{schluss}`,
  `{minuten}`.

## Wer arbeitet gerade (PR #76, #90)

Die Cloud liest den Live-Monitor von emp-control, der Hub fragt alle 60 s
`/api/hub/staff` und cacht es in `hub/.cache/staff.json`. Zentrale-Kachel
„Im Dienst“, Ansicht `#mitarbeiter`. Sichtungen werden einer Person nur
zugeordnet, wenn es eindeutig ist (Gesichtstreffer, bestätigtes Etikett,
oder genau eine Person eingestempelt).

## Tagesvorschau (PR #85)

`GET /api/hub/day-preview?date=` liefert ANNY-Buchungen des Tages (Gäste,
Slots, Spitzen, Gruppen ab 5, Verleih) und das Wetter von Open-Meteo. Der
Hub schickt sie um 07:30 vor dem Tagesbericht per Telegram, ergänzt um die
Schichten aus emp-control. Telegram: `/heute`, `/morgen`.

## Zentrale-Kachel „KI“ (PR #91)

`hub/src/agent/activity.ts` sammelt in einem Ringpuffer (200 Einträge,
40 Bilder) alles, was der Assistent sendet und empfängt, Werkzeugaufrufe
und Wächter-Bewertungen. API `/api/agent/activity?since=`. Was über
`sendText`/`sendPhoto` geht, landet automatisch dort; anderes mit
`recordActivity()` eintragen.

## Gesperrte Geräte (PR #92)

Netzwerk → Geräte → „Gesperrte Geräte“ (`BlockedNetworkDevice`,
`/api/network/blocked`). Sieht der Scan eine gesperrte MAC, kommt höchstens
alle 6 h eine Telegram-Meldung. Das Sperren selbst passiert in Insight,
siehe [Netzwerk](netzwerk.md#insight-fallstricke).

## Lieferdienst-Erkennung (PR #23, #24, #32)

Erkennung von DHL, UPS, GLS, DPD, Hermes und Amazon an der Aufschrift der
Transporter an der Einfahrt. Pro Kamera Modus Aus / Melden / Tor öffnen,
Zeitfenster standardmäßig Mo–Sa 07–20 Uhr. Regelaktion „Kamera steuern“
(Preset, Tracking, Rückkehr), Auslöser auch „Klingel (DoorBird)“.
