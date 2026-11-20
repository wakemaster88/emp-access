# Funktionen ohne eigene Doku

Kurzbeschreibungen der Funktionen, die weder im Haupt-README noch in
`hub/README.md` stehen. Die Hub-Assistent-Funktionen (Wächter,
Früherkennung, Belegung, Energie, Mäher) beschreibt `hub/README.md`.

## Warenwirtschaft (18.11.2026)

Neue Menügruppe „Warenwirtschaft“ mit vier Seiten:

- **Artikel** (`/warenwirtschaft/artikel`): Bezeichnung, Kategorie, Einheit, EK netto (Cent), Bestand, Artikel-Nr., Lieferant, Bild. Lagerwert = Bestand × EK.
- **Inventur** (`/warenwirtschaft/inventur`): laufende Zählung jederzeit, optional nur einzelne Kategorien. Soll = Bestand beim Anlegen, Abweichung wird bewertet.
- **Stichtagsinventur** (`/warenwirtschaft/stichtag`): alle aktiven Artikel zu einem Datum (Vorschlag 31.12.), Bruch wird extra bewertet, Zusammenfassung je Kategorie wie das Excel-Blatt, CSV-Export und PDF-Inventurliste für Ablage und Steuerberater (Kopf mit Betrieb und Stichtag, Tabelle je Kategorie mit Zwischensumme, Gesamtwert netto, Unterschriftszeile; vor dem Festschreiben als „vorläufig“ gekennzeichnet). Pro Datum gibt es nur eine Stichtagsinventur.
- **Inventar** (`/warenwirtschaft/inventar`): Inventarverzeichnis wie die Excel-Vorlage, Blätter Gastronomie, Strandbad, Wasserski, Events, Büro & Shop, Übernachtung; Menge je Jahr (`InventoryAssetCount`), Zählung direkt in der Tabelle.

„Festschreiben“ übernimmt gezählte Mengen als Artikelbestand und sperrt die Inventur. Zeilen (`StocktakeLine`) halten Name, Einheit und Preis als Momentaufnahme, damit alte Inventuren gleich bleiben.

Zählen am Handy (Zähl-Link): Beim Anlegen einer Inventur entsteht ein Link `/zaehlen/<token>` (32 Byte, `Stocktake.countToken`, 14 Tage gültig). Auf der Zählseite gibt es QR-Code, Kopieren, Teilen, „Neuer Link“ (alter wird ungültig) und „Sperren“. Mitarbeiter geben einmal ihren Namen ein (`StocktakeLine.countedBy`) und zählen ohne Login. Sie sehen nur diese Inventur, ohne EK-Preise und ohne Soll (blinde Zählung). Festschreiben macht den Link ungültig. API: `/api/zaehlen/[token]` (GET, PATCH), Verwaltung `/api/warenwirtschaft/stocktakes/[id]/link` (POST, DELETE). Die Zählseite im Büro gleicht sich alle 30 Sekunden ab. Handy-Liste kompakt (eine Zeile je Artikel, Bruch per Schalter, bei Stichtagsinventur an). Fehlende Artikel legen Mitarbeiter am Handy an (`POST /api/zaehlen/[token]/articles`, höchstens 100 je Inventur, ohne Preis, Hinweis in `Article.note`); im Büro steht dann „EK fehlt“.

Inventar zählen am Handy: ein Zähl-Link für alle Blätter `/zaehlen/inventar/<token>` (`InventoryCountLink` mit `group = "*"`, siehe `ALL_GROUPS`/`groupFilter` in `src/lib/inventory-count-link.ts`; 14 Tage, Zähljahr = `defaultAssetYear`). Karte „Zählen am Handy · Inventar“ oben auf der Inventar-Seite über den Blatt-Tabs. Am Handy: Auswahl „Blatt“ mit Stand je Blatt, neue Posten landen im gewählten Blatt. Ältere Links je Blatt funktionieren weiter. Am Handy außerdem: Menge fürs Zähljahr, Vorjahr als Hilfe, Bereich-Filter, fehlende Posten anlegen (`POST …/assets`), `InventoryAssetCount.countedBy`.

Fotos am Handy: in beiden Zählseiten öffnet das Kamera-Symbol bei Artikeln oder Posten ohne Bild die Kamera; das Foto wird auf 512 px verkleinert und als Data-URL gespeichert (`Article.image` mit `imageSource` „Foto vom Handy (Name)“, `InventoryAsset.image`). Vorhandene Bilder werden über den Link nie überschrieben (409).

Produktfotos: der Cron `tick-5min` (Job `articleImages`) sucht für Artikel ohne Bild bei Open Food Facts (höchstens 6 je Lauf wegen des Suchlimits von etwa 10 pro Minute) und übernimmt ein Foto nur, wenn alle wesentlichen Wörter des Namens passen. Bildnachweis steht in `Article.imageSource` („Open Food Facts, CC BY-SA 3.0 · Link“) und wird im Artikel angezeigt. Im Artikel-Dialog: „Bild suchen“ (Kandidaten wählen) oder eigenes Foto.

Excel-Import (`/api/warenwirtschaft/import`, Taste „Excel importieren“ auf Artikel und Inventar): eigener kleiner .xlsx-Leser ohne Fremdpaket (`src/lib/xlsx-read.ts`), Blatterkennung in `src/lib/warenwirtschaft-import.ts`. Vorhandene Einträge bleiben unverändert, eine Datei darf mehrfach geladen werden. Ein Datum im Kopf der Inventurliste („Inventur zum 31.12.2025“) wird als festgeschriebene Stichtagsinventur übernommen. Die Excel-Daten selbst (Preise, Bestände) liegen nicht im öffentlichen Repo.

## Gamification für Abo-Fahrer, Etappe 1 (15.11.2026)

- Seite Gäste › Kunden App (`/gamification`, Menüpunkt seit 20.11.2026 so benannt, nur Admins) mit den Reitern
  Auswertung, Meilensteine, Gutscheine und Einstellungen. Ab Werk aus: ohne
  `GamificationConfig.enabled` wird nichts gezählt und nichts ausgegeben.
- Ein **Start** ist ein GRANTED-Scan eines Abo-Tickets an einem Gerät mit
  `Device.countsAsStart` (z. B. Drehkreuz Seilbahn A), ein **Besuchstag** ein
  Berliner Kalendertag mit mindestens einem Start. Der Scan-Endpunkt
  (`api/devices/pi/scan`) ruft `recordStart` auf, ohne zu warten. Gespeichert
  werden nur Tagessummen je Ticket (`RiderDayStat`), keine Einzelzeiten.
- **Meilensteine** (`Milestone`): Besuchstage, Starts oder Wochen in Serie, je
  Saison (Kalenderjahr) oder Monat, optional mit Gutschein. Vergabe einmal je
  Ticket und Zeitraum (`MilestoneAward`, eindeutig). Starts zählen für
  Meilensteine nur bis zur Tagesobergrenze (Standard 10).
- **Leistungs-Gutscheine**: `Voucher.kind = BENEFIT` mit `label`. Sie geben
  keinen Zutritt und erzeugen kein Ticket (Drehkreuz lehnt ab), sondern werden
  nur entwertet: Scan am Check-in-Monitor oder Code/Klick unter Gutscheine.
  Die bisherigen Gutscheine sind `ACCESS` und verhalten sich wie zuvor.
- „Statistik neu berechnen“ baut die Tagessummen des laufenden Jahres aus den
  Scans neu auf und vergibt dabei nichts. Verlässliche Starts gibt es erst seit
  dem Drehkreuz (21.08.2026).
- Rechenlogik mit Tests in `src/lib/gamification.ts`, Datenbank-Seite in
  `src/lib/gamification-service.ts`.

## Kunden-App für Abo-Fahrer, Etappe 2 (15.11.2026)

- Eigene Oberfläche unter `/app` (dunkles Wassersport-Design in
  `src/app/app/rider.css`, bewusst ohne die ui-Bausteine der Verwaltung).
  Als PWA installierbar: Manifest je Fahrer, der globale Service Worker
  (`public/sw.js`) liefert Offline-Seite und Cache.
- **Anmeldung** auf `/app` seit 20.11.2026 nur per E-Mail (Aaron: Karte und
  Geburtsdatum war schlecht, es soll auch ohne Abo gehen). Siehe Abschnitt
  „Anmeldung per E-Mail“ unten. Ergebnis ist der persönliche Link
  `/app/<token>`; beim ersten Öffnen werden Passkey oder Passwort eingerichtet.
- Fahrer ohne Geburtsdatum oder Kartennummer bekommen den Link an der Kasse:
  Gäste › Kunden App › Fahrer › App-Link (QR-Code und Link zum Kopieren).
- Für neue Kunden steht oben unter Gäste › Kunden App › Fahrer ein fester
  QR-Code auf `/app` mit A4-Aushang zum Drucken (`src/lib/app-poster.ts`,
  seit 20.11.2026).
- `RiderProfile` bündelt die Abo-Tickets einer Person (Vorname, Nachname und
  Geburtsdatum gleich) und trägt Spitzname und Ranglisten-Einwilligung
  (`showInRanking`, ab Werk aus).
- Seiten: Start (Abo mit Gültigkeit, offene Gutscheine, Stufe, Besuchstage,
  Starts, Serie, weitere Ziele), Gutscheine (QR-Code zum Entwerten an der
  Kasse), Profil (Abo und enthaltene Bereiche, Spitzname, Aussteigen).
- **Aussteigen** löscht Tagessummen und Meilensteine der Person, setzt
  `Ticket.gamificationOptOut` (danach wird nichts mehr gezählt) und entfernt
  das Profil. Verdiente Gutscheine bleiben gültig. Eine neue Anmeldung hebt
  den Ausstieg wieder auf.
- Datenbank-Seite in `src/lib/rider-app.ts`.

## Challenges und Angebote, Etappe 3 (15.11.2026)

- **Challenges** (Gäste › Kunden App › Challenges) haben einen festen
  Zeitraum, eine Kennzahl (Besuchstage, Starts, Wochen in Serie) und optional
  einen Gutschein. Zwei Arten:
  - **Aufgabe erfüllt** (`TASK`): wer die Schwelle im Zeitraum erreicht,
    gewinnt sofort (beim Start am Drehkreuz oder beim Öffnen der App).
  - **Top X** (`TOP_X`): nach dem Endtag gewinnen die Besten. Bei Gleichstand
    auf dem letzten Gewinnerplatz gewinnen alle Gleichauf-Liegenden. Die
    Auswertung läuft genau einmal (`Challenge.settledAt`), ausgelöst vom
    nächsten Start, vom Reiter Challenges oder von der Kunden-App. Danach
    sind Bedingung und Zeitraum gesperrt.
- Gezählt wird je Person: Tickets mit gemeinsamem App-Profil bilden eine
  Einheit, der Gewinn (`ChallengeAward`) hängt am jüngsten Ticket.
- In der Kunden-App: Reiter Challenges mit eigenem Fortschritt und Rangliste.
  Mit Namen erscheint nur, wer einen Spitznamen gesetzt und der Rangliste
  zugestimmt hat. Alle anderen stehen als „Anonym“ in der Liste.
- **Angebote** (`RiderOffer`, Reiter Angebote): Titel, Text und optionaler
  Zeitraum. Höchstens drei erscheinen oben auf der Startseite der App.
- Logik in `src/lib/challenge-service.ts` und `src/lib/rider-challenges.ts`,
  Rechenregeln mit Tests in `src/lib/gamification.ts`.

## Saisonrückblick und Rangliste für Bildschirme, Etappe 4 (15.11.2026)

- **Saisonrückblick** in der Kunden-App (`/app/<token>/rueckblick`, mit
  `?jahr=` auch für das Vorjahr): Besuchstage, Starts mit Rekordtag, längste
  Serie, stärkster Monat, Lieblings-Wochentag, erreichte Stufe und der
  Vergleich „öfter da als x % der Abo-Fahrer“ (nur ab 10 Vergleichswerten
  und ab 50 %). Rechenregel `seasonRecap` in `src/lib/gamification.ts`.
- **Rangliste für einen Bildschirm** (`/rangliste/<token>`): Saison nach
  Besuchstagen und bis zu zwei laufende Top-X-Challenges, lädt alle fünf
  Minuten neu. Ein- und Ausschalten unter Kunden App › Einstellungen
  (`GamificationConfig.displayToken`); nach dem Abschalten gilt der Link
  nicht mehr. Gezeigt wird nur, wer Spitzname und Zustimmung gesetzt hat.
  Alle anderen zählen für die Plätze mit, erscheinen aber nicht.

## Anmeldung an der Kunden-App, Etappe 5 (15.11.2026)

- Der Link `/app/<token>` ist nur noch die **Einladung**. Beim ersten Öffnen
  richtet der Fahrer unter `/app/<token>/einrichten` einen Passkey oder ein
  Passwort (mindestens 8 Zeichen) ein. Danach öffnet der Link allein die App
  nicht mehr, sondern führt zu `/app/<token>/anmelden`.
- Sitzung: signiertes Cookie `rider_session` (HMAC mit `AUTH_SECRET`, 180
  Tage, `src/lib/rider-session.ts`). Alle Seiten unter `[token]/(app)` und
  die Profil-Schnittstelle verlangen sie (`requireRider`, `riderApiSession`
  in `src/lib/rider-auth.ts`). Eine Anmeldung hinterlegen darf beim ersten
  Mal jeder mit dem Link, danach nur die angemeldete Person.
- Passkeys liegen in `RiderPasskey` und nutzen dieselben Bausteine wie die
  Admin-Passkeys (`@simplewebauthn`, Einmal-Challenges in `PasskeyChallenge`).
- Schutz: fünf falsche Passwörter sperren die Anmeldung für 15 Minuten, dazu
  die Anfragebremse je IP und je Link.
- **Zugang zurücksetzen** (Passwort vergessen, Handy weg): Gäste ›
  Gamification › Fahrer › App-Link › Zugang zurücksetzen. Löscht Passwort
  und Passkeys, beendet alle Sitzungen (`sessionVersion`) und gibt einen
  neuen Link aus; der alte gilt nicht mehr. Statistik und Gutscheine bleiben.


## Push und Verlängerungs-Hinweis in der Kunden-App, Etappe 6 (15.11.2026)

- Im Profil der App schaltet der Fahrer **Benachrichtigungen** je Gerät selbst
  ein (Karte `src/components/rider/rider-push.tsx`). Die Karte erscheint nur,
  wenn Web-Push eingerichtet ist (dieselben VAPID-Schlüssel wie für das
  Dashboard). iPhone und iPad brauchen dafür die App auf dem Home-Bildschirm.
- Abos liegen in `RiderPushSubscription`, getrennt von `PushSubscription`:
  Betriebsmeldungen für Mitarbeiter gehen nie an Fahrer. Höchstens 10 Geräte
  je Profil; als Adresse sind nur die Push-Dienste der Browser erlaubt
  (`isPushServiceUrl` in `src/lib/rider-push.ts`).
- Gesendet wird nur an die betroffene Person und nur bei einem **neuen
  Gutschein** (Meilenstein oder Challenge, `notifyVoucher`). Der Versand läuft
  neben dem Scan her und hält ihn nicht auf. „Statistik neu berechnen“ vergibt
  keine Gutscheine und meldet deshalb auch nichts.
- Schnittstellen: `/api/rider/<token>/push` (GET, POST, DELETE, nur mit
  Sitzung) und `/api/rider/push/renew` für den Service Worker, wenn der
  Push-Dienst ein Abo austauscht. „Zugang zurücksetzen“ löscht auch die
  Push-Abos des Fahrers.
- **Verlängerungs-Hinweis**: Das Dashboard der App zeigt in den letzten 30
  Tagen der Laufzeit und nach dem Ablauf eine Karte mit dem Enddatum
  (`renewalHint` in `src/lib/gamification.ts`). Es geht keine Nachricht raus.


## Tagesgäste in der Kunden-App und Abo-Rechner, Etappe 7 (15.11.2026)

- Ausgangslage 2026: 3.643 Wakeboard-Tagestickets, davon 3.066 ohne Namen an
  der Kasse verkauft. Eine E-Mail-Adresse gibt es nur bei rund 165 Gästen aus
  der Online-Buchung.
- Entscheidung von Aaron (15.11.2026): Tagesgäste kommen **nur über die
  E-Mail-Adresse am Ticket** in die App. Die zuerst gebauten Wege „Ticket
  selbst scannen“ und „QR-Code an der Kasse“ sind wieder entfernt.
- Einstellungen (Gäste › Kunden App › Einstellungen): „Tagestickets in der
  App“ wählt die Ticket-Typen, optional mit Preis; dazu der Preis je Abo
  (`GamificationConfig.dayServiceIds`, `servicePrices`, `subscriptionPrices`).
  Ab Werk ist nichts gewählt.
- Woher die Adresse kommt (`Ticket.email`):
  - aus der Online-Buchung,
  - am **Shop-Monitor**: im Ticket unter dem Namen („E-Mail hinzufügen“,
    Bereich Person) und beim Verkauf als freiwilliges Feld,
  - im **Backend**: Ticket bearbeiten, oder Gamification › Fahrer, Karte
    „Tagesgäste“ (Code scannen und Adresse eintragen, Liste aller Adressen der
    Saison mit Ändern und Entfernen, Schnittstelle
    `/api/gamification/day-guests`).
- Weg in die App (`src/lib/day-guest.ts`):
  - Der Gast gibt auf `/app` seine Adresse ein (`/api/rider/mail-link`). Die
    Antwort ist immer dieselbe, damit niemand Adressen abfragen kann.
  - Steht die Adresse an einem Tagesticket dieser Saison, geht eine Mail mit
    Link `/app/mail/<schlüssel>` an genau diese Adresse (Konto, Adresse und
    Ablauf mit HMAC signiert, 48 Stunden gültig). Höchstens eine Mail in
    10 Minuten und fünf am Tag je Adresse; jede steht im Mail-Protokoll
    (`EmailSend`). Voraussetzung ist der eingerichtete E-Mail-Versand.
  - Erst beim Öffnen des Links kommen alle Tagestickets der Adresse in ein
    Profil, dann geht es wie beim Abo zum Einrichten von Passkey oder
    Passwort. Gibt es zu der Adresse schon ein Profil (auch eines Abos), wird
    dieses genutzt.
  - Spätere Tickets mit derselben Adresse zählen von selbst mit: beim Scan am
    Start-Gerät, wenn die Kasse die Adresse einträgt und beim Öffnen der App
    (`adoptDayTickets`). Wer ausgestiegen ist, wird dabei nicht wieder
    aufgenommen; das geht nur über einen neuen Link.
  - Ändert die Kasse die Adresse eines Tickets, verlässt es das Profil der
    alten Adresse (`dayTicketEmailChanged`), etwa nach einem Tippfehler.
- Gezählt wird erst, wenn der Gast den Link geöffnet hat. Jeder Tag mit
  Tagesticket ist ein Besuchstag; Starts kommen aus den Scans am Start-Gerät,
  ohne Scan zählt ein Start (`syncDayTicketStat`), weil nicht jede Bahn ein
  Drehkreuz hat. Eine Buchung für mehrere Personen zählt als ein Besuchstag,
  die Starts aller Tickets werden addiert.
- Meilensteine gelten je Person: alle Tickets eines Profils zählen zusammen
  (`awardMilestones`). Das betrifft auch Abo-Fahrer mit zwei Tickets.
- **Abo-Rechner**: Gäste ohne Abo sehen ab dem dritten Besuch „Deine Besuche
  dieser Saison haben … gekostet, das Abo … kostet …“ (`aboCalculation`).
  Je Tag zählt das teuerste Ticket. Er erscheint nur, wenn für jedes Ticket
  und mindestens ein Abo ein Preis hinterlegt ist. Verglichen wird mit dem
  günstigsten Abo.
- Noch offen: Tagesgäste erscheinen nicht in der Auswertung der Verwaltung.

## Familie in der Kunden-App, Etappe 8 (15.11.2026)

- Wunsch von Aaron: Die App muss auch als Familie gehen, Kinder ohne eigenen
  Login, Ehepartner geteilt.
- Eine Familie (`RiderFamily`) bündelt Profile eines Kontos
  (`RiderProfile.familyId`, `familyAdult`). Gezählt wird weiter **je Person**:
  Statistik, Meilensteine, Challenges und Gutscheine gehören dem Mitglied.
  Regeln in `src/lib/rider-family.ts`, höchstens 10 Mitglieder.
- **Erwachsene** haben einen eigenen Zugang, sehen alle Mitglieder und
  wechseln oben auf jeder Seite zwischen ihnen. Beim Partner sehen sie Abo,
  Statistik und Gutscheine; Einstellungen und Zugang ändert jeder nur selbst.
- **Kinder** brauchen keinen eigenen Zugang. Erwachsene ändern Spitznamen und
  Ranglisten-Einwilligung des Kindes, sonst nichts. Bekommt ein Kind einen
  Gutschein, erfahren es auch die Erwachsenen per Push.
- Kind hinzufügen (Profil › Familie): mit Kartennummer und Geburtsdatum des
  Kindes, oder die Eltern öffnen angemeldet den persönlichen Link des Kindes
  von der Kasse und wählen „Zu meiner Familie hinzufügen“. Geht nur bei
  Profilen ohne eigenen Zugang; wer einen hat, braucht die Einladung.
- Partner einladen: Link `/app/familie/<schlüssel>` (HMAC, 7 Tage). Der
  Partner meldet sich mit seinem eigenen Zugang an und tritt bei.
- Jeder kann die Familie im Profil verlassen, Erwachsene können Kinder
  entfernen. Ohne Erwachsene oder mit nur einem Mitglied löst sich die
  Familie auf (`tidyFamily`).
- Zugriff: `riderRelation` in `src/lib/rider-auth.ts` ("self", "manage",
  "view"). Seiten erlauben alle drei, `riderApiManage` Eltern und die Person
  selbst, `riderApiSession` nur die Person selbst (Zugang, Push, Löschen).
- Noch offen: Die Verwaltung zeigt Familien nicht an.


## Kunden-App lokal und schnell (16.11.2026)

- Seiten angemeldeter Fahrer liegen im Service-Worker-Cache
  `emp-rider-<Version>` (`public/sw.js`): die App öffnet sofort mit dem
  letzten Stand, auch ohne Netz (Gutschein-QR an der Kasse). Der Server
  bleibt führend: der Service Worker erneuert die Seite im Hintergrund,
  `RiderSync` (`src/components/rider/rider-sync.tsx`) holt frische Daten,
  wenn die Seite älter als 15 s ist, nach 60 s im Hintergrund und wenn das
  Netz zurückkommt.
- Datenschutz: höchstens 40 Seiten, höchstens 14 Tage alt. Abmelden,
  Anmelden und Familienänderungen löschen den Cache
  (`src/lib/rider-local.ts`); leitet der Server zur Anmeldung um, fliegen
  die Seiten dieses Fahrers raus. Neue Service-Worker-Version leert ihn.
- Tabs und Gutscheine werden samt Daten vorab geladen; sonst zeigt
  `loading.tsx` sofort einen Platzhalter.
- Logo-Animation „RIDE PASS“ beim Start (`rider-intro.tsx`), gut 1 s,
  einmal je Sitzung, entfällt bei „Bewegung reduzieren“.

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

## Klingel-Push (DoorBird)

Klingelt jemand an einer DoorBird, geht sofort ein Web-Push an alle
PWA-Geräte des Accounts („🔔 Es hat geklingelt“). Auslöser ist die
DOORBELL-Meldung des Hubs an `/api/hub/camera-events` (Hub liest die
DoorBird per `monitor.cgi`), an der DoorBird selbst ist nichts
einzurichten. Antippen öffnet `/?doorbird=<cameraId>`, die Tor-Ansicht im
Dashboard mit Livebild und Öffnen-Knopf. Meldungen älter als 2 Minuten
werden nicht mehr gepusht. Parallel bleibt das Telegram-Foto mit „Tor
öffnen“ (`/api/hub/doorbird-gate`). Code: `src/lib/doorbell-push.ts`.

## Kunden-App: Standort, Restlaufzeit und Abo-Shop (20.11.2026)

- Kopf der Startseite zeigt den Standort „Tuttenbrocksee“ (`RIDER_LOCATION`
  in `src/lib/rider-shop.ts`).
- Karte „Dein Abo“ mit den restlichen Tagen (Kalendertage Berlin bis zum
  Enddatum, `aboStatus`). In den letzten 30 Tagen gelb umrandet mit Knopf
  „Abo verlängern“. Ersetzt die Karte aus Etappe 6 („Sprich uns an der
  Kasse an“).
- Abgelaufen, gesperrt oder kein Abo: Karte mit Knopf zu `/app/<token>/abos`.
  Dort steckt der anny-Shop als offizielles Widget (`<a-organization-page>`
  von `cdn.anny.co`, Organisation `tuttenbrocksee`, Liste „Abonnements“),
  dasselbe wie auf tuttenbrocksee.com/shop. Buchen und Bezahlen laufen bei
  anny; das neue Abo kommt wie gewohnt über den ANNY-Sync.
- CSP in `next.config.ts` erlaubt dafür `cdn.anny.co` (Skript, Stil, Schrift)
  und Frames von `embed.anny.co`/`anny.co`.
- Karte „Auslastung jetzt“ (`src/lib/rider-occupancy.ts`): verschiedene Fahrer
  und Starts an Start-Geräten (`countsAsStart`) in der letzten Stunde, nur als
  Summen. Stufen nach Fahrern: 0 „Gerade ruhig“, 1–5 „Wenig los“, 6–14
  „Mittel“, ab 15 „Viel los“ (aus den Daten 21.08.–15.11.2026: Median 7,
  Spitze 34 je Stunde). Ohne Start-Gerät bleibt die Karte weg.

## Anmeldung per E-Mail, auch ohne Abo (20.11.2026)

- `/app` fragt nur die E-Mail-Adresse ab (`api/rider/mail-link`, Antwort immer
  gleich). `requestAppLink` in `src/lib/rider-onboarding.ts` schickt den Link
  `/app/mail/<schlüssel>` (signiert, 48 Stunden) an das Konto, in dem die
  Adresse an einem Profil, Abo oder Tagesticket bekannt ist. Ist sie nirgends
  bekannt, geht die Mail an das einzige Konto mit eingeschalteter Kunden App.
  Höchstens alle 10 Minuten und 5 Mal am Tag je Adresse.
- Nach dem Klick: Gibt es Abos mit dieser Adresse, die in keinem Profil
  hängen, zeigt `/app/willkommen/<schlüssel>` sie zur Auswahl (ein laufendes
  Abo ist vorgewählt). `api/rider/onboarding` ordnet nur Abos mit genau dieser
  Adresse zu, dazu ältere Abo-Tickets derselben Person und Tagestickets der
  Adresse. Ohne Auswahl oder ohne gefundenes Abo geht es ohne Abo weiter.
- `RiderProfile.email` hält die bestätigte Adresse. Ein Profil mit Adresse
  gilt auch ohne Ticket (`loadRider`, `findRiderAuthProfile`, `sessionRider`);
  die App zeigt dann „Du hast noch kein Abo“ mit dem Abo-Shop.
- Der alte Weg mit Kartennummer und Geburtsdatum (`api/rider/login`) ist
  entfernt. Der persönliche Link von der Kasse bleibt.
- Offen: Profile ohne Ticket erscheinen nicht in der Liste Kunden App ›
  Fahrer. Ein später gekauftes Abo holt der Kunde, indem er sich erneut per
  Mail-Link anmeldet und es auswählt.

## Abos über die E-Mail, Familienkonten, Etappe 1 (20.11.2026)

Aaron, 20.11.2026: Abos aus dem eigenen System und aus anny werden immer über
die E-Mail-Adresse gespeichert, Familienkonten sauber. Plan in vier Etappen:
Kundenkonto je E-Mail mit Personen (Variante B). Etappe 1 ändert keine
Bestandsdaten.

- E-Mail-Pflicht (`src/lib/abo-email.ts`): neue Abos brauchen eine Adresse
  (`POST /api/tickets`, Shop-Monitor), bei einem Abo lässt sie sich ändern,
  aber nicht entfernen (`PUT /api/tickets/[id]`, Shop-Monitor). Ältere Abos
  ohne Adresse bleiben bearbeitbar. Die Dialoge markieren das Feld.
- Abos › „Abos ohne E-Mail“ (`src/lib/abos-without-email.ts`): laufende Abos
  ohne Adresse mit Herkunft (Reepay-Import, manuell). Vorschlag, wenn andere
  Tickets mit gleichem Vor- und Nachnamen genau eine Adresse tragen.
  Eintragen über `PATCH /api/tickets/[id]/email` (ändert nur die Adresse).
- Familienkonten in anny: ein Konto je E-Mail; Name und Geburtsdatum des
  Kontoinhabers stehen auf jedem Abo des Kontos. Deshalb:
  - Abos mit gleichem Namen und Geburtsdatum kommen nur automatisch ins
    selbe Profil, wenn alle nacheinander laufen (höchstens 31 Tage
    Überschneidung, `samePersonAbos` in `src/lib/abo-person.ts`). Laufen zwei
    gleichzeitig, ist es ein Familienkonto: dann kommt nichts automatisch mit,
    der Kunde wählt seine Abos selbst. Gilt für `ensureRiderProfile` und
    `completeOnboarding`.
  - Karte und Foto erben (`choosePredecessor` in
    `src/lib/ticket-predecessor.ts`, ANNY-Sync und Kartenhinweis): läuft unter
    der Adresse ein Abo einer anderen Art, kommen nur beendete Tickets
    derselben Art in Frage. Verschiedene Karten zur selben Zeit heißen zwei
    Personen: nichts erben, die Kasse vergibt die Karte. Ersatzkarten
    nacheinander: die neueste gilt.
- Nächste Etappen: Kundenkonto (`Customer`) und Personen mit eigenem Namen
  und Geburtsdatum samt Übernahme der Bestandsdaten (2), Kasse und
  Verwaltung (3), Kunden-App mit Familie aus dem Konto (4).
