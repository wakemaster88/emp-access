# Funktionen ohne eigene Doku

Kurzbeschreibungen der Funktionen, die weder im Haupt-README noch in
`hub/README.md` stehen. Die Hub-Assistent-Funktionen (Wächter,
Früherkennung, Belegung, Energie, Mäher) beschreibt `hub/README.md`.

## Kalender der Betriebszeiten (20.11.2026)

- Seite `/betriebszeiten` hat zwei Tabs: „Profile“ (Karten wie bisher) und
  „Kalender“ über alle Bereiche (`src/components/betriebszeiten/operating-calendar.tsx`).
- Monat: je Tag eine Zeile pro Bereich mit Uhrzeit (Handy: nur farbige Balken),
  geschlossene Bereiche bleiben leer, Ausnahmetage gelb mit Punkt. Ein Tipp auf
  einen Tag zeigt darunter alle Bereiche mit Zeit und Saison bzw. Ausnahme.
- Woche: Zeitleiste je Tag und Bereich, Stundenbereich passt sich an die Woche an;
  Spannen über Mitternacht laufen am Folgetag ab 0 Uhr weiter.
- Farbe je Bereich aus `--chart-1` … `--chart-5` in Profil-Reihenfolge; Bereiche
  lassen sich über die Chips aus- und einblenden.
- Rechenlogik in `src/lib/operating-calendar.ts` (Monatsraster, KW, Tagesspannen),
  Öffnung je Tag weiter über `openingForDay` aus `src/lib/operating-hours.ts`.

## Veranstaltungen und Partnerzugang (20.11.2026)

Für die Rooftop Lounge und andere Räume, die für Feiern belegt werden.

- Eine Ressource wird unter Veranstaltungen · Einstellungen zum
  Veranstaltungsraum (`AccessArea.eventVenue`), mit Puffer für Auf- und Abbau
  (Standard 60 Min.) und höchster Personenzahl.
- Belegung unter `/veranstaltungen`: Termine (`VenueEvent`) nach Monat, mit
  Status Eingetragen, Bestätigt, Abgesagt und Abgerechnet. Zwei Termine im
  selben Raum dürfen sich samt Puffer nicht überschneiden; die Prüfung läuft
  serverseitig unter einer Sperre je Raum (`pg_advisory_xact_lock`). Termine
  über Mitternacht: Ende vor Beginn heißt Folgetag.
- Externe Partner (`EventPartner`) bekommen wie Vereine einen geheimen Link
  `/partner/<token>` (abschaltbar, neu erzeugbar, Anfragebremse, nicht
  indexiert). Sie sehen nur eigene Termine und deren Dokumente; fremde
  Termine nur als Zeitraum „belegt“, ohne Titel oder Veranstalter. Sie
  tragen ein, ändern und sagen ab bis `editLockHours` vor Beginn (Standard
  48 Std.) und melden die tatsächliche Personenzahl bis zur Schlussrechnung.
- Zusatzleistungen (`VenueExtra`) je Raum, pauschal, je Person oder je
  Stück, Preise netto. Gebuchte Leistungen speichern Name und Preis als
  Schnappschuss (`VenueEventExtra`); Preisänderungen gelten nur für neue
  Auswahl. Je Person zählt die tatsächliche Zahl, sonst die geplante.
- Dokumente aus DATEV (Auftragsbestätigung, Anzahlungs-, Schlussrechnung,
  Sonstiges) laden Admins als PDF bis 4 MB hoch (`VenueEventDocument`, privat
  im Blob-Speicher unter `event-docs/`, sonst in der DB). Keine
  DATEV-Schnittstelle. Eine Auftragsbestätigung bestätigt den Termin, eine
  Schlussrechnung markiert ihn als abgerechnet.
- Benachrichtigungen: Partner trägt ein, ändert, sagt ab oder meldet
  Personen → Push an alle Team-Geräte und Mail an „E-Mail an uns“. Wir
  bestätigen, sagen ab oder laden ein Dokument hoch → Mail an den Partner,
  ohne Anhang, nur mit Link. Verlauf je Termin (`VenueEventChange`).
- Rechte: Termine sehen und pflegen darf jedes Team-Konto; Räume, Preise,
  Partner-Links und Dokumente nur Admins.
- Datenschutz: Beim Termin nur Titel, optional Veranstalter (Firma) und
  Personenzahl, keine Gästelisten. Die PDFs sind Kopien; die Originale für
  die Aufbewahrung liegen in DATEV.

## Warenwirtschaft (18.11.2026)

Neue Menügruppe „Warenwirtschaft“ mit vier Seiten:

- **Artikel** (`/warenwirtschaft/artikel`): Bezeichnung, Kategorie, Einheit, EK netto (Cent), Bestand, Artikel-Nr., Lieferant, Bild. Lagerwert = Bestand × EK.
- **Inventur** (`/warenwirtschaft/inventur`): laufende Zählung jederzeit, optional nur einzelne Kategorien. Soll = Bestand beim Anlegen, Abweichung wird bewertet.
- **Stichtagsinventur** (`/warenwirtschaft/stichtag`): alle aktiven Artikel zu einem Datum (Vorschlag 31.12.), Bruch wird extra bewertet, Zusammenfassung je Kategorie wie das Excel-Blatt, CSV-Export und PDF-Inventurliste für Ablage und Steuerberater (Kopf mit Betrieb und Stichtag, Tabelle je Kategorie mit Zwischensumme, Gesamtwert netto, digitale Bestätigung statt Unterschriftszeile, Korrekturen und Protokoll im Anhang; vor dem Festschreiben als „vorläufig“ gekennzeichnet). Pro Datum gibt es nur eine Stichtagsinventur.
- **Inventar** (`/warenwirtschaft/inventar`): Inventarverzeichnis wie die Excel-Vorlage, Blätter Gastronomie, Strandbad, Wasserski, Events, Büro & Shop, Übernachtung; Menge je Jahr (`InventoryAssetCount`), Zählung direkt in der Tabelle.

„Festschreiben“ übernimmt gezählte Mengen als Artikelbestand und sperrt die Inventur. Zeilen (`StocktakeLine`) halten Name, Einheit und Preis als Momentaufnahme, damit alte Inventuren gleich bleiben.

Digitale Bestätigung statt Unterschrift (seit 20.11.2026, GoBD-orientiert, Aarons Wunsch): Zähler und Schreiber bestätigen jede Inventur mit ihrem eigenen Login (`POST /api/warenwirtschaft/stocktakes/[id]/sign`, Passkey über `sign/options`, ohne Passkey ersatzweise Passwort). Beide müssen verschiedene Personen sein. Gespeichert wird `StocktakeSignature` mit Name, E-Mail, Verfahren, Zeit und SHA-256-Prüfsumme der Liste (`src/lib/stocktake-log.ts`, `src/lib/stocktake-audit.ts`). Ändert sich danach eine Menge (App oder Zähl-Link), wird die Bestätigung aufgehoben. Festschreiben geht nur mit beiden Bestätigungen. Jede Eingabe, Bestätigung, das Festschreiben und Korrekturen stehen im Protokoll `StocktakeEvent` (wer, wann, alt, neu, über App oder Zähl-Link); es wird nur angehängt. Nach dem Festschreiben ändert nur noch eine Korrektur mit Begründung eine Zeile (`POST .../corrections`, Stift-Symbol an der Ist-Menge); der aktuelle Artikelbestand bleibt dabei unverändert. Ältere Inventuren ohne Bestätigung zeigen im PDF weiter Unterschriftszeilen für Zähler und Schreiber. Aufbewahrung: 10 Jahre (Daten und PDF).

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
  Meilensteine nur bis zur Tagesobergrenze (Standard 10). Seit dem 20.11.2026
  heißen sie Awards und können mehr, siehe „Awards in der Kunden-App“.
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
  `src/app/(rider)/app/rider.css`, bewusst ohne die ui-Bausteine der Verwaltung).
  Seit 21.11.2026 eigener Wurzelrahmen `src/app/(rider)/layout.tsx` ohne
  `globals.css` (nur Preflight in `rider-base.css`); alle anderen Seiten liegen
  unter `src/app/(main)/`. Kunden-Seiten dürfen deshalb keine Tailwind-Klassen
  oder ui-Bausteine nutzen. `/app` ist statisch, hat ein eigenes Manifest
  (`/app/manifest.webmanifest`) und den Update-Hinweis `RiderUpdatePrompt`.
  Als PWA installierbar: Manifest je Fahrer, der globale Service Worker
  (`public/sw.js`) liefert Offline-Seite und Cache.
- **Anmeldung** auf `/app` seit 20.11.2026 nur per E-Mail (Aaron: Karte und
  Geburtsdatum war schlecht, es soll auch ohne Abo gehen). Siehe Abschnitt
  „Anmeldung per E-Mail“ unten. Ergebnis ist der persönliche Link
  `/app/<token>`; beim ersten Öffnen werden Passkey oder Passwort eingerichtet.
- Fahrer ohne Geburtsdatum oder Kartennummer bekommen den Link an der Kasse:
  Gäste › Kunden App › Fahrer › App-Link (QR-Code und Link zum Kopieren).
- Für neue Kunden gibt es einen festen QR-Code auf `/app` mit A4-Aushang zum
  Drucken (`src/lib/app-poster.ts`, seit 20.11.2026), seit 21.11.2026 unter
  Gäste › Kunden App › Einstellungen › Aushang und Bildschirm.
- `RiderProfile` bündelt die Abo-Tickets einer Person (Vorname, Nachname und
  Geburtsdatum gleich) und trägt Spitzname und Ranglisten-Einwilligung
  (`showInRanking`, ab Werk aus).
- Seiten: Start (Abo mit Gültigkeit, offene Gutscheine, Stufe, Besuchstage,
  Starts, Serie, weitere Ziele), Gutscheine (QR-Code zum Entwerten an der
  Kasse), Profil (Abo und enthaltene Bereiche, Spitzname).
- **Aussteigen** (Statistik löschen) gab es bis 20.11.2026; Aaron hat es
  entfernt („statistik löschen darf es nicht geben“). `Ticket.gamificationOptOut`
  bleibt für frühere Ausstiege; eine neue Anmeldung hebt ihn auf.
- Datenbank-Seite in `src/lib/rider-app.ts`.

## Challenges und Angebote, Etappe 3 (15.11.2026)

- **Challenges** (Gäste › Kunden App › Aktionen; seit 21.11.2026 stehen
  Challenges und Angebote in einem Reiter) haben einen festen
  Zeitraum, eine Kennzahl (Besuchstage, Starts, Wochen in Serie) und optional
  einen Gutschein. Zwei Arten:
  - **Aufgabe erfüllt** (`TASK`): wer die Schwelle im Zeitraum erreicht,
    gewinnt sofort (beim Start am Drehkreuz oder beim Öffnen der App).
  - **Top X** (`TOP_X`): nach dem Endtag gewinnen die Besten. Bei Gleichstand
    auf dem letzten Gewinnerplatz gewinnen alle Gleichauf-Liegenden. Die
    Auswertung läuft genau einmal (`Challenge.settledAt`), ausgelöst vom
    nächsten Start, vom Reiter Aktionen oder von der Kunden-App. Danach
    sind Bedingung und Zeitraum gesperrt.
- Gezählt wird je Person: Tickets mit gemeinsamem App-Profil bilden eine
  Einheit, der Gewinn (`ChallengeAward`) hängt am jüngsten Ticket.
- In der Kunden-App: Reiter Challenges mit eigenem Fortschritt und Rangliste.
  Mit Namen erscheint nur, wer einen Spitznamen gesetzt und der Rangliste
  zugestimmt hat. Alle anderen stehen als „Anonym“ in der Liste.
- **Angebote** (`RiderOffer`, Reiter Aktionen): Titel, Text und optionaler
  Zeitraum. Höchstens drei erscheinen oben auf der Startseite der App.
- Logik in `src/lib/challenge-service.ts` und `src/lib/rider-challenges.ts`,
  Rechenregeln mit Tests in `src/lib/gamification.ts`.

### Foto-Challenges und Abstimmungen (21.11.2026)

Aaron: „challenges erweitern mit abstimmungen“ und „… mit bild upload“. Zwei
weitere Arten, angelegt wie die anderen unter Kunden App › Aktionen:

- **Foto-Challenge** (`PHOTO`): Im Zeitraum lädt jede Person ein Foto hoch
  (`ChallengeEntry`, eines je Person; ein neues ersetzt das alte, dessen
  Stimmen verfallen). Jede Person hat eine Stimme (`ChallengeVote`), nicht fürs
  eigene Foto, bis zum Ende änderbar. Stimmenzahlen erst nach dem Ende; bis
  dahin stehen die Fotos je Person in fester, anderer Reihenfolge. Nach dem
  Endtag gewinnen die `topCount` Fotos mit den meisten Stimmen (Gleichstand
  wie bei Top X, ohne Stimme kein Platz); der Gutschein hängt am jüngsten
  Ticket der Person. Hochladen nur mit Ticket.
- **Abstimmung** (`POLL`): Der Name ist die Frage, dazu 2 bis 6 Antworten
  (`ChallengeOption`). Eine Stimme je Person, bis zum Ende änderbar; das
  Ergebnis sieht, wer abgestimmt hat (alle nach dem Ende). Kein Gutschein.
  Antworten und Art sind ab der ersten Stimme fest.
- Abstimmen nur die angemeldete Person selbst (Eltern nicht für ihre Kinder);
  hochladen auch Eltern für ihr Kind. Am Foto steht für andere der Spitzname
  mit Zustimmung, sonst „Anonym“.
- Fotos verkleinert der Browser auf 1600 px. Die KI (xAI, wie beim Profilbild,
  `checkChallengePhoto` in `profile-photo-check.ts`, Log `[challenge-foto]`)
  lehnt nur Unpassendes ab; fällt sie aus, wird gespeichert. Ablage im
  Blob-Speicher (`challenge-photos/`), ohne Token als Bytes in der DB.
  Ausliefern nur an angemeldete Kunden desselben Kontos
  (`/api/rider/challenge-photo/<id>`).
- Das Personal blendet Fotos im Dialog der Challenge aus oder ein
  (`ChallengeEntry.hidden`): ausgeblendet sieht es nur die Person selbst, es
  zählt nicht.
- Code: `src/lib/challenge-voting.ts` (Laden, Abstimmen, Hochladen),
  `src/lib/challenge-voting-rules.ts` (Regeln mit Tests),
  `src/components/rider/rider-challenge-voting.tsx`.

## Saisonrückblick und Rangliste für Bildschirme, Etappe 4 (15.11.2026)

- **Saisonrückblick** in der Kunden-App (`/app/<token>/rueckblick`, mit
  `?jahr=` auch für das Vorjahr): Besuchstage, Starts mit Rekordtag, längste
  Serie, stärkster Monat, Lieblings-Wochentag, erreichte Stufe und der
  Vergleich „öfter da als x % der Abo-Fahrer“ (nur ab 10 Vergleichswerten
  und ab 50 %). Rechenregel `seasonRecap` in `src/lib/gamification.ts`.
- **Rangliste für einen Bildschirm** (`/rangliste/<token>`): Saison nach
  Besuchstagen und bis zu zwei laufende Top-X-Challenges, lädt alle fünf
  Minuten neu. Ein- und Ausschalten unter Kunden App › Einstellungen › Aushang
  und Bildschirm (`GamificationConfig.displayToken`); nach dem Abschalten gilt der Link
  nicht mehr. Gezeigt wird nur, wer Spitzname und Zustimmung gesetzt hat.
  Alle anderen zählen für die Plätze mit, erscheinen aber nicht.

## Anmeldung an der Kunden-App, Etappe 5 (15.11.2026)

- Der Link `/app/<token>` ist nur noch die **Einladung**. Beim ersten Öffnen
  richtet der Fahrer unter `/app/<token>/einrichten` einen Passkey oder ein
  Passwort (mindestens 8 Zeichen) ein. Danach öffnet der Link allein die App
  nicht mehr, sondern führt zu `/app/<token>/anmelden`.
- **Persönlich und nur bei neuem Konto** (20.11.2026, Aaron: „personalisiert.
  die seite nur funktioniert wenn konto noch nicht aktiv“): Die Seite grüßt
  mit Vornamen, nennt Betrieb und Abo („Dein Ride Abo läuft bis …“,
  `src/lib/rider-setup.ts`). Gehört die Person ohne eigene Adresse schon zu
  einem eingerichteten Zugang (Kind einer Familie, deren Erwachsene sich
  angemeldet haben, oder Person eines Kundenkontos, dessen Adresse einen
  Zugang hat; `riderHolder` in `src/lib/rider-auth.ts`), richtet der Link
  nichts mehr ein: Die Seite sagt, zu wem die Person gehört, und führt zu
  dessen Anmeldung. Auch die Schnittstellen für Passwort und Passkey lehnen
  dann ab (`mayManageCredentials`). Ist man auf dem Gerät schon angemeldet,
  heißt die Karte „Ist Lisa dein Kind?“; bei Volljährigen (Geburtsdatum der
  Person) erscheint sie nicht.
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
- **Passwort selbst zurücksetzen** (seit 20.11.2026): Auf `/anmelden` schickt
  „Passwort vergessen?“ einen Link an die Adresse des Zugangs (bestätigte
  Adresse, sonst Kundenkonto, sonst neuestes Ticket; `src/lib/rider-reset.ts`).
  `/app/<token>/neu/<schlüssel>` legt ein neues Passwort oder einen Passkey
  fest und meldet an. Der Schlüssel gilt 60 Minuten und nur einmal (Signatur
  über `sessionVersion` und Passwort-Hash, `src/lib/rider-reset-key.ts`);
  danach enden alle anderen Sitzungen. Höchstens alle 5 Minuten, 5 Mails am Tag.
  Ohne bekannte Adresse bleibt nur die Kasse.
- **Mail-Link meldet an** (seit 20.11.2026): Der Link aus „Link zur App
  schicken“ belegt die Adresse. Gehört sie dem Zugang und ist schon Passwort
  oder Passkey eingerichtet, ist man damit direkt angemeldet
  (`signInByMail`); vorher führte er zur Passwort-Abfrage.
- **Passkey ohne Link** (seit 20.11.2026): Startseite `/app` hat „Mit Passkey
  anmelden“; das Handy bietet die Passkeys der Domain an, der gewählte führt
  zur eigenen App (`/api/rider/passkey/options` und `/login`). Passkeys tragen
  im Handy-Menü den Namen der Person statt „Deine Saison“ (gilt für neue).


## Push und Verlängerungs-Hinweis in der Kunden-App, Etappe 6 (15.11.2026)

- Im Profil der App schaltet der Fahrer **Benachrichtigungen** je Gerät selbst
  ein (Karte `src/components/rider/rider-push.tsx`). Die Karte erscheint nur,
  wenn Web-Push eingerichtet ist (dieselben VAPID-Schlüssel wie für das
  Dashboard). iPhone und iPad brauchen dafür die App auf dem Home-Bildschirm.
- Abos liegen in `RiderPushSubscription`, getrennt von `PushSubscription`:
  Betriebsmeldungen für Mitarbeiter gehen nie an Fahrer. Höchstens 10 Geräte
  je Profil; als Adresse sind nur die Push-Dienste der Browser erlaubt
  (`isPushServiceUrl` in `src/lib/rider-push.ts`).
- Persönlich gesendet wird nur an die betroffene Person bei einem **neuen
  Award** (`notifyAward`, auch ohne Gutschein) oder einem **neuen Gutschein**
  aus einer Challenge (`notifyVoucher`). Der Versand läuft
  neben dem Scan her und hält ihn nicht auf. „Statistik neu berechnen“ vergibt
  keine Gutscheine und meldet deshalb auch nichts.
- Schnittstellen: `/api/rider/<token>/push` (GET, POST, DELETE, nur mit
  Sitzung) und `/api/rider/push/renew` für den Service Worker, wenn der
  Push-Dienst ein Abo austauscht. „Zugang zurücksetzen“ löscht auch die
  Push-Abos des Fahrers.
- **Verlängerungs-Hinweis**: Das Dashboard der App zeigt in den letzten 30
  Tagen der Laufzeit und nach dem Ablauf eine Karte mit dem Enddatum
  (`renewalHint` in `src/lib/gamification.ts`). Es geht keine Nachricht raus.

### Challenge-Ende mit Uhrzeit (22.11.2026)

Aaron zur Nikolaus-Foto-Challenge am 6.12.: „bis 18 uhr“. Eine Challenge kann
jetzt am Endtag zu einer Uhrzeit enden (`Challenge.endTime`, "HH:MM",
Europe/Berlin; leer = Mitternacht, Feld „Ende um“ im Dialog). Ab dieser Zeit
gilt sie als beendet (`challengeOver`/`challengePhase` in `gamification.ts`):
kein Hochladen und Abstimmen mehr, Stimmen sichtbar, und Top X/Foto werden beim
nächsten Aufruf der App oder Verwaltung bzw. beim nächsten Start ausgewertet.
Die App zeigt „heute bis 18 Uhr“, der Push „Am 06.12. bis 18 Uhr“.

### Push bei neuen Angeboten und Challenges (20.11.2026)

- Aaron: „bei neuen angeboten, challenges soll eine push nachricht an die
  kunden gehen“. Beim Anlegen in Kunden App › Angebote bzw. Challenges gibt es
  den Schalter **Push an Kunden senden** (bei neuen Einträgen an) mit Vorschau
  der Nachricht und der Zahl erreichbarer Kunden und Geräte.
- Gesendet wird **einmal** je Eintrag (`pushPlanned`, `pushedAt`, `pushSent`
  an `RiderOffer` und `Challenge`), an jedes Gerät mit eingeschalteten
  Benachrichtigungen. Bearbeiten meldet nichts erneut; ein noch nicht
  gesendeter Push lässt sich im Dialog wieder abschalten.
- Nie gesendet: Titel mit „TEST:“, ausgeschaltete Einträge, abgelaufene
  Zeiträume, Konten mit ausgeschalteter Kunden-App, ohne VAPID-Keys (lokal).
- Zeitpunkt: Angebot, sobald es in der App sichtbar ist („Sichtbar ab“),
  Challenge sofort (sie erscheint schon vor dem Start). Nur 9 bis 21 Uhr
  Berlin; sonst übernimmt der 5-Minuten-Cron (`runAnnouncementTick`) am
  Morgen. Ein ausgeschalteter Eintrag mit Push-Plan meldet sich beim
  Einschalten.
- Code: Regeln und Texte `src/lib/rider-announce-rules.ts` (mit Tests),
  Versand `src/lib/rider-announce.ts`; der Eintrag wird vor dem Senden als
  gesendet markiert, damit Speichern und Cron nie doppelt melden.


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
- Kind hinzufügen: an der Kasse per App-Code (siehe „Abo an der Kasse mit der
  App verknüpfen“), oder die Eltern öffnen angemeldet den persönlichen Link
  des Kindes von der Kasse und wählen „Zu meiner Familie hinzufügen“. Der Weg
  mit Kartennummer und Geburtsdatum ist seit 20.11.2026 weg (Aaron: „geht
  nicht“). Kinder mit eigener Adresse kommen per Bestätigungslink (Etappe 4b).
- Erwachsene einladen: Profil › Familie › „Per E-Mail einladen“ (siehe
  „Per E-Mail in App und Familie einladen“) oder „Stattdessen Link teilen“:
  Link `/app/familie/<schlüssel>` (HMAC, 7 Tage), die Person meldet sich mit
  ihrem eigenen Zugang an und tritt bei.
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
  Summen. Stufen nach Fahrern: 0 „Gerade ruhig“, 1–9 „Freie Bahn“, 10–24
  „Gut besucht“, ab 25 „Viel los“. Grenzen je Mandant unter Kunden App ›
  Einstellungen (`GamificationConfig.occupancyMediumFrom/HighFrom`), gelten
  auch für das Badge „Jetzt: …“ an der Drehkreuz-Karte im Dashboard.
  „Viel los“ soll selten erscheinen (rund 5 % der Betriebszeit), damit niemand
  wegbleibt (Aaron, 21.11.2026; Daten 21.08.–15.11.2026: Median 7, 90 % bis 18,
  Spitze 38 Fahrer je 60 Min). Ohne Start-Gerät bleibt die Karte weg.
- Karte „Strandbad jetzt“ (`src/lib/beach-occupancy.ts`): geschätzte Gäste vor
  Ort = erfolgreiche Eintritte der letzten 3 h an den Eingangs-Drehkreuzen
  (Bereich mit „Strandbad“ im Namen) × Faktor 3, weil die Tageskasse nicht
  übers Drehkreuz geht (Aaron, 21.11.2026: Top-Tage 3000 Gäste, 2/3
  Tageskasse). Stufen „Viel Platz“ / „Gut besucht“ ab 600 / „Viel los“ ab
  1200 (20 % / 40 % der 3000 Plätze), in der App ohne Zahl, Balken zur
  Kapazität. Erscheint nur an Tagen mit Eintritten. Einstellbar unter Kunden
  App › Einstellungen; Badge an der Drehkreuz-Karte, wenn „Strandbad“ gewählt.

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
- Die Mail (`src/lib/rider-mail-template.ts`) hat seit 20.11.2026 den Look der
  App (dunkel, Petrol, Gelb, kursive Versalien), Aaron: „im gleichen look sexy“.
- Der alte Weg mit Kartennummer und Geburtsdatum (`api/rider/login`) ist
  entfernt. Der persönliche Link von der Kasse bleibt.
- Offen: Profile ohne Ticket erscheinen nicht in der Liste Kunden App ›
  Fahrer. Ein später gekauftes Abo holt der Kunde, indem er sich erneut per
  Mail-Link anmeldet und es auswählt. (Seit Etappe 4a gilt das nur noch für
  Adressen ohne Kundenkonto, siehe unten.)

## Einladung zur App bei neuem anny-Abo (20.11.2026)

Aaron: „wenn ein neues abo gebucht wird über anny soll er eine einladungsmail
zur app bekommen“.

- Der anny-Abgleich meldet jedes neu angelegte Abo-Ticket an
  `sendAboInvites` (`src/lib/rider-invite.ts`), nach dem Zuordnen der
  Personen. Die Mail `riderInviteMail` hat den Look der Anmelde-Mail, der
  Link ist der Anmelde-Link `/app/mail/<schlüssel>`, hier 7 Tage gültig.
- Eine Mail geht nur, wenn das Abo gültig ist und höchstens 7 Tage vorher
  begonnen hat (künftiger Beginn zählt), die Adresse kein anderes Abo hat
  (Bestandskunde, Verlängerung, Reepay), unter der Adresse noch niemand in der
  App ist, die Adresse die Einladung noch nie bekommen hat (`EmailSend` mit
  Betreff „Dein Abo ist in der App“, Status SENT) und Kunden-App und
  Mailversand eingeschaltet sind. Abo-Arten wie in der App
  (`GamificationConfig.subscriptionIds`). Höchstens 25 Mails je Lauf, eine je
  Adresse (Familienkonto bekommt eine Mail, „Wer bist du?“ beim Öffnen).
- Links aus dem Hintergrund nehmen `AUTH_URL`, `NEXTAUTH_URL` oder
  `VERCEL_PROJECT_PRODUCTION_URL`; ohne alle drei geht keine Mail.
- Schalter unter Kunden App › Einstellungen, Karte „Einladung zur App“
  (Aaron: „beides im backend aktivieren und deaktivieren“):
  „Bei neuem Abo aus anny“ (`GamificationConfig.inviteNewAbos`, Standard an)
  und „An Bestandskunden“ (`inviteExistingAbos`, Standard aus, Einschalten
  mit Rückfrage und Anzahl). Bestandskunden = laufende Abos (VALID/PAUSED,
  nicht abgelaufen), Adresse nicht in der App, noch keine Einladung; Versand
  über `runInviteTick` im Cron tick-5min, 10 Mails je Lauf, 9–20 Uhr Berlin.
  Nach 3 Fehlversuchen an eine Adresse wird sie ausgelassen.
- Einzeln einladen (Aaron: „kunden einzeln individuell zur kunden app
  einladen können“): Abos › Kundenkonten › Konto öffnen, Abschnitt
  „Kunden-App“ mit Stand (wer schon in der App ist, zuletzt eingeladen am)
  und Taste „Zur App einladen“ bzw. „Erneut einladen“. `POST
  /api/customers/[id]/invite` → `inviteCustomer`, nur Admins, unabhängig von
  den beiden Schaltern; dieselbe Adresse höchstens alle 5 Minuten.

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

## Kundenkonto und Personen, Etappe 2 (20.11.2026)

- Tabelle `Customer`: eine E-Mail-Adresse je Mandant (klein geschrieben,
  eindeutig), Name des Kontoinhabers, anny-Kundennummern. `Ticket.customerId`
  zeigt bei Abos auf das Konto der Adresse am Ticket. Tagestickets bekommen
  kein Konto, sie finden ihr Profil weiter über die Adresse.
- Person = `RiderProfile` mit `customerId`, `firstName`, `lastName`,
  `birthDate`. `Ticket.riderProfileId` sagt, wer mit dem Abo fährt; NULL bei
  einem Abo mit Konto heißt „Fahrer offen“. Der anny-Sync schreibt Namen nur
  ans Ticket, nie an die Person.
- Regeln (`planPersons` in `src/lib/customer-person.ts`): bestehende
  Zuordnungen bleiben; Kids-Abo mit Geburtsdatum ab 18 (`KIDS_MAX_AGE`,
  Annahme) bleibt offen; gleiche Daten, nacheinander laufend = dieselbe
  Person; ein zweites Fahr-Abo (Ride, Ride + Gear, Kids, `aboCategory`) zur
  selben Zeit bleibt offen; Beach und Aqua darf dieselbe Person nebenher
  haben; gekündigte oder vorzeitig ungültige Abos zählen dabei nicht. Ein
  Profil ohne Daten und Abo (App per E-Mail) übernimmt die erste neue Person.
- Schreibwege (`src/lib/customers.ts`): anny-Sync (`customerFor`, Konto folgt
  einer Adressänderung über die anny-Kundennummer), `POST/PUT
  /api/tickets`, `PATCH /api/tickets/[id]/email`, Shop-Monitor. Der Cron
  `tick-5min` (Job `customers`) holt Abos mit Adresse ohne Konto nach, bis
  400 je Lauf. Ein Lauf je Konto zugleich (`pg_advisory_xact_lock`).
- Kunden-App: Die Anmeldung mit der Adresse eines Kontos landet beim
  Kontoinhaber (`holderPersonForEmail`, `pickHolder`). Neue Profile bekommen
  das Konto der Adresse, `ensureRiderProfile` legt die Person mit den Daten
  vom Abo an (nicht beim Kids-Abo mit Eltern-Daten).
- Probelauf auf einer Kopie der Bestandsdaten (20.11.2026): 153 Konten,
  160 Abos zugeordnet, 148 Personen neu. Von 197 laufenden Abos haben 140 eine
  Person, 9 stehen auf „Fahrer offen“ (6 Kids-Abos mit Eltern-Daten, 3
  Ride-Abos neben einem Kids-Abo mit denselben Daten), 48 haben keine Adresse.
- Noch nicht: Anzeige und Auswahl der Person an Kasse und im Backend,
  Kundenkonten-Seite, Familie aus dem Konto (Etappen 3 und 4).

## Fahrer an Kasse, Scanner und Backend, Etappe 3a (20.11.2026)

- Anzeige: Shop-Monitor (Liste, Scan), Scanner-Pi und Ticket-Liste im Backend
  zeigen bei Abos Name und Geburtsdatum der Person, die damit fährt
  (`riderView` in `src/lib/customer-person.ts`), nicht die Daten am Ticket
  (bei anny die des Kontoinhabers). Der Bearbeiten-Dialog im Backend ändert
  weiter die Daten am Ticket.
- „Fahrer offen“ (Abo mit Konto, ohne Person): Badge an Ticket-Karte und
  Ticket-Liste, Hinweis im Ticket-Overlay mit „Eintragen“. Neue Daten im
  Personen-Formular ordnen das Abo einer Person des Kontos mit genau diesen
  Daten zu oder legen sie an (`assignRider`). Unveränderte Daten (etwa beim
  Nachtragen der E-Mail) ordnen nichts zu.
- Karte ausgeben nur mit Fahrer: `PUT /api/checkin/public/[token]/update`
  lehnt eine neue RFID bei „Fahrer offen“ ab, bis Name und Geburtsdatum
  eingetragen sind; das Overlay zeigt stattdessen „Erst den Fahrer eintragen“.
- Name an der Kasse ändern: Hat das Abo eine Person, ändert das Formular die
  Person (`updatePersonData`). Bei anny-Abos bleiben die Daten am Ticket
  unangetastet, der Sync schreibt sie ohnehin neu.
- Abo ohne E-Mail: Badge „E-Mail fehlt“ und Hinweis im Overlay.
- Abos-Seite: Karte „Fahrer offen (n)“ mit Suche; der Dialog wählt eine
  Person des Kontos oder legt eine neue an (`PUT /api/tickets/[id]/rider`,
  Body `{ personId }` oder `{ firstName, lastName, birthDate }`).

## Kundenkonten bearbeiten und zusammenlegen, Etappe 3b (20.11.2026)

- Abos-Seite, Umschalter „Abos | Kundenkonten“ (`/subscriptions?ansicht=konten`,
  nicht für den Super-Admin). Tabelle aller Konten mit Suche (Name, Adresse,
  Personen), Badge „Fahrer offen“, laufende Abos. Daten:
  `loadCustomerAccounts` in `src/lib/customer-accounts.ts`.
- Konto-Dialog: Personen mit Alter und Abos, Abos mit Fahrer. Person
  bearbeiten (`PATCH /api/customers/persons/[id]`, gilt für alle Abos der
  Person), Fahrer ändern (`PUT /api/tickets/[id]/rider`, gleiches Formular wie
  „Fahrer offen“, `rider-form.tsx`).
- Zusammenlegen (nur Admin, `POST /api/customers/[id]/merge`, Body
  `{ fromId }`, `mergeCustomers`): Abos und Personen kommen ins geöffnete
  Konto, das andere Konto wird gelöscht. Seine Adressen bleiben als weitere
  Adressen (`Customer.aliasEmails`), anny-Kundennummern werden vereint, der
  Name bleibt der des Zielkontos. Personen mit gleichem Namen und
  Geburtsdatum werden eins, wenn eine davon keinen eigenen Zugang hat
  (Adresse, Passwort, Passkey, Push, Familie, Spitzname, App-Besuch). Danach
  ordnet `syncCustomerPersons` offene Abos neu zu. Nicht umkehrbar.
- Weitere Adressen: `customerIdForEmail` und `ensureCustomer` finden das Konto
  auch über `aliasEmails` (anny-Sync, Kasse, Cron, App-Anmeldung). Ändert
  anny die Adresse eines Kunden, wird die alte Adresse ebenfalls weitere
  Adresse.
- Vorschläge „Vielleicht doppelt“: Konten mit gleichem Inhabernamen (zwei
  Wörter oder mehr) oder gleicher anny-Kundennummer
  (`findDuplicateGroups`). Stand 20.11.2026: 2 Paare mit gleichem Namen,
  keine gemeinsame anny-Nummer.

## Kunden-App mit Familie aus dem Konto, Etappe 4a (20.11.2026)

- Anmeldung per Mail-Link mit der Adresse eines Kundenkontos (Haupt- oder
  weitere Adresse): Beim ersten Mal fragt `/app/willkommen/<schlüssel>`
  „Wer bist du?“ (`RiderWho`). Zur Wahl stehen die Personen des Kontos ohne
  eigenen Zugang und „Ich fahre selbst nicht“ (Eltern, die nur für Kinder
  buchen: neue Person ohne Abo). Vorschlag aus `pickHolder` (Name des
  Kontoinhabers, sonst Person mit Erwachsenen-Abo, bei nur Kinder-Abos
  keiner). Die gewählte Person bekommt die Adresse (`RiderProfile.email`),
  danach geht jede Anmeldung direkt zu ihr (`kontoLogin`,
  `completeOnboarding` in `src/lib/rider-onboarding.ts`).
- Familie aus dem Konto (`syncKontoFamily` in `src/lib/customers.ts`): Wer
  sich mit der Adresse angemeldet hat, wird Erwachsene einer Familie; die
  übrigen Personen des Kontos ohne eigenen Zugang kommen als verwaltete
  Mitglieder dazu. Personen mit eigenem Zugang nur per Einladung, wer schon
  in einer anderen Familie ist, bleibt dort. Läuft nach jeder Anmeldung,
  nach `syncCustomerPersons` (anny-Sync, Cron, Kasse, Zusammenlegen) und wenn
  `assignRider` eine Person anlegt. Ohne Anmeldung entsteht keine Familie.
- Personen aus dem eigenen Konto lassen sich nicht aus der Familie nehmen,
  „Familie verlassen“ fehlt dann; die App zeigt „Aus deinem Kundenkonto, von
  dir verwaltet“.
- „Neues Abo: Für wen ist es?“ (`RiderForWhom` auf der Startseite, nur im
  eigenen Profil der Person mit der Konto-Adresse): je Abo des Kontos mit
  „Fahrer offen“ ich, eine Person des Kontos oder jemand Neues mit Vorname,
  Nachname und Geburtsdatum (`POST /api/rider/[token]/rider`,
  `kontoRidersFor` in `src/lib/rider-konto.ts`). Neue Abos derselben Person
  (Verlängerung) landen ohne Frage im Profil.
- Name in der App: Vorname der Person vor dem am Abo (`loadRider`,
  `memberName`), damit Kinder nicht mit dem Namen der Eltern grüßen.
- Adressen ohne Konto (Tagesgäste, Abo noch nicht verknüpft) wie bisher mit
  Abo-Auswahl.
- Weiter in Etappe 4b (unten).

## Mails je Konto und Kinder mit eigener Adresse, Etappe 4b (20.11.2026)

- Automatische Mails (`src/lib/email-automation.ts`, Einstellungen › E-Mail ›
  Regeln): Empfänger ist die Adresse des Kundenkontos (`mailRecipient`),
  sonst die am Ticket. Abos mit Konto, aber ohne Adresse am Ticket, bekommen
  jetzt auch ihre Mail. `{{firstName}}`, `{{lastName}}` und `{{fullName}}`
  sind die der Person, die mit dem Abo fährt (`riderView`); am anny-Kids-Abo
  stand vorher der Name der Eltern. Der Regel-Dialog sagt das unter den
  Variablen.
- Ablauf-Mails („läuft ab“, „ist abgelaufen“) entfallen, wenn dieselbe Person
  schon ein Folge-Abo derselben Art hat, das länger läuft (`hasFollowUpAbo`
  in `src/lib/customer-person.ts`, Art nach `aboCategory`). Zählt im Lauf als
  übersprungen. Abos ohne Person werden nicht geprüft.
- Kind mit eigener Adresse (eigenes Kundenkonto) in die Familie holen: In der
  App unter Profil › Familie › „Per E-Mail einladen“, „Kind mit eigener Adresse“.
  Die App antwortet immer gleich; eine Mail „Familie in der App bestätigen“
  geht nur raus, wenn zur Adresse ein anderes Konto mit Personen unter 18
  (oder ohne Geburtsdatum) ohne Familie gehört, höchstens alle 10 Minuten und
  3-mal am Tag je Adresse. Der Link `/app/familie/kind/<schlüssel>` gilt 7
  Tage und braucht keine Anmeldung: wer ihn öffnet, wählt die Personen und
  bestätigt; sie kommen als verwaltete Mitglieder in die Familie
  (`src/lib/rider-family-link.ts`, `POST /api/rider/family/confirm`).
  Erwachsene treten weiter über den Einladungslink für Partner bei. Die
  Erwachsene kann solche Kinder wieder entfernen, sie gehören nicht zu ihrem
  Konto.
- Noch offen: Die Datenbankregel „kein Abo ohne Konto“ kommt erst, wenn die
  Liste „Abos ohne E-Mail“ leer ist.

## Abo an der Kasse mit der App verknüpfen (20.11.2026)

Für Abos, die nicht unter der Adresse der App liegen: Abo ohne Adresse (Import,
Kasse), alte oder andere Adresse, anny-Adresse anders als die in der App
(Aaron: „qr code scann an der kasse“).

- App, Profil › „Abo fehlt?“: zeigt auf Knopfdruck einen QR-Code, den
  App-Code (`APP` + Ablauf in Minuten + HMAC + Profil-ID, nur Ziffern und
  Großbuchstaben, 15 Minuten gültig). Er kommt per `POST
  /api/rider/[token]/kasse-code`, nicht mit der Seite, weil der Service Worker
  Seiten zwischenspeichert. Nur für Erwachsene, nicht für Kinder einer Familie.
- Shop-Monitor: App-Code und Abo-Karte scannen, Reihenfolge egal (ist ein Abo
  offen, kommt es gleich mit). `POST …/scan` erkennt den App-Code
  (`readAppCode`) vor der Ticketsuche und liefert `appLink`; der Dialog
  „Abo mit der App verknüpfen“ fragt, wer fährt: die Person der App selbst
  oder ein Kind. Solange er offen ist, gehören Scans ihm. Enter vom Scanner
  löst darin keine Taste aus. Verknüpft wird über `POST …/app-link`
  (`linkAboToApp` in `src/lib/rider-kasse-link.ts`).
- Seit 21.11.2026 (Aaron: „wo kann ich hier die app mit qr code verbinden?“):
  Im Kunden-Dialog eines Abos öffnet „Mit App verbinden“ den Dialog mit
  diesem Abo; dann fehlt nur der App-Code. Ohne Handscanner lässt er sich im
  Dialog eintippen (Leerzeichen und Kleinschreibung egal) oder mit der Kamera
  des Geräts lesen (`html5-qrcode`). Beides geht wie ein Scan an `POST …/scan`.
- „Selbst“: Ein Abo ohne Adresse bekommt die der App. Sonst kommt die
  App-Person ins Kundenkonto des Abos und ihre Adresse wird eine weitere
  Adresse des Kontos (Alias), so überlebt sie den anny-Abgleich. Eine
  bisherige Person am Abo ohne eigene Adresse und mit gleichem Vornamen wird
  mit der App-Person zusammengefasst (Abos, Name, Geburtsdatum, „Fährt seit“,
  Profilbild). Anderer Vorname: Hinweis auf „Kind“.
- „Kind“: Die Person am Abo (oder eine neue aus den Abo-Daten) kommt als
  verwaltetes Mitglied in die Familie der App-Person; ein Abo ohne Adresse
  bekommt die der App. Volljährige, Kinder einer anderen Familie und
  Kids-Abos mit den Daten der Eltern lehnt der Server mit Text ab.
- Zwei verschiedene Kundenkonten legt der Monitor nicht zusammen, er
  verweist auf Abos › Kundenkonten (nur Admins).
- Seit 21.11.2026 (Aaron: „das sollte man verwalten und auch wieder lösen
  können“): Die Abo-Kachel im Dialog zeigt, wo das Abo in der App steht
  („In der App: App von X“, „X, Kind in der Familie von Y“, „X, noch ohne
  eigenen Zugang“ oder „Noch in keiner App“), über `GET
  …/app-link?ticketId=` (`aboAppOwner`, `ownerText`). Steht es schon in einer
  anderen App oder Familie, kommt statt der Sperre ein Hinweis mit „Bisherige
  Verknüpfung lösen“; nach der Rückfrage („Lösen und verknüpfen“) geht
  `POST …/app-link` mit `replace: true`. Dann zieht nur dieses Abo um,
  Besuche, Starts und Awards hängen am Abo und kommen mit. Bleibt die
  bisherige Person ohne Abo, Adresse, Passwort und Passkey zurück, fällt sie
  weg; eine Familie mit nur noch einer Person löst sich auf (`tidyFamily`).
  Wer selbst eine Familie verwaltet, wird nicht zum Kind gemacht. Lösen ohne
  neue Verknüpfung gibt es nicht: Der Kundenkonto-Abgleich würde das Abo
  gleich wieder einer Person des Kundenkontos zuordnen.

## Per E-Mail in App und Familie einladen (20.11.2026)

Aaron: „hier will ich leute per email direkt zur app einladen“.

- App, Profil › Familie › „Per E-Mail einladen“: Adresse eingeben, „Erwachsene
  Person“ oder „Kind mit eigener Adresse“ (das Kind geht wie bisher über den
  Bestätigungslink, Etappe 4b). Für Erwachsene schickt `POST
  /api/rider/[token]/family` mit `action: "mail"` die Mail „Einladung in die
  App“ im Look der App (`inviteFamilyByMail` in
  `src/lib/rider-family-invite.ts`, `familyInviteMail`).
- Der Link ist der Anmelde-Link `/app/mail/<schlüssel>` (7 Tage) mit
  `?familie=<einladungsschlüssel>`: Er belegt die Adresse, meldet an (beim
  ersten Mal über das Einrichten) und nimmt die Person als Erwachsene in die
  Familie auf. Gehören zur Adresse schon Abos oder ein Kundenkonto, wählt sie
  zuerst wie bei der Anmeldung, wer sie ist; der Schlüssel wartet so lange im
  Cookie `rd-family-invite` und `POST /api/rider/onboarding` tritt danach bei.
- Verwaltet die eingeladene Person schon eine Familie nur mit Kindern (etwa
  aus ihrem Kundenkonto), kommen die Kinder mit (`joinFamily`). Mit weiteren
  Erwachsenen muss sie die alte Familie erst verlassen; dann zeigt die
  Einladungsseite den Grund.
- Grenzen: je Adresse höchstens alle 10 Minuten und 3-mal am Tag, je Person
  10 Einladungen in der Stunde. Ist die Adresse schon in der Familie, geht
  keine Mail raus.

## Personen ohne Abo löschen (20.11.2026)

- Abos › Kundenkonten › Person bearbeiten: „Person löschen“ für Admins
  (`DELETE /api/customers/persons/[id]`, `deletePerson` in
  `src/lib/customers.ts`). Personen ohne Ticket tragen das Abzeichen „ohne
  Abo“.
- Nur, wenn mit der Person kein Ticket fährt (auch kein abgelaufenes):
  Starts, Awards und Statistik hängen an den Tickets und bleiben so immer
  erhalten. Personen mit eigenem Zugang (Adresse, Passwort, Passkey) und
  Erwachsene einer Familie bleiben ebenfalls. Doppelte Person mit Abo: erst
  beim Abo den Fahrer ändern, dann löschen.

## Gutschein-Monitor für die Kasse (21.11.2026)

- Neuer Monitor-Typ `VOUCHER` („Gutscheine“) unter Einstellungen › Monitore.
  Seite `/gutscheine/[token]`, ohne Login, wie der Scanner immer dunkel und
  als eigene App auf den Home-Bildschirm legbar (Manifest-Art `gutscheine`).
- Ablauf: Code per Handscanner (Tastatur-Eingabe ins Scanfeld, das den Fokus
  behält) oder per Kamera (Taste rechts, Wahl je Gerät gespeichert) lesen.
  Der Monitor **prüft** erst nur (`POST /api/gutscheine/public/[token]`) und
  zeigt Leistung, Fahrer, Herkunft (Award), Gültigkeit und Code. Erst die
  Taste „Einlösen“ entwertet (`POST …/redeem`). Ein Scan zum Nachsehen
  entwertet also nichts; der Check-in-Monitor entwertet weiter direkt beim Scan.
- Einlösen läuft über `redeemBenefitVoucher` (atomar) mit `redeemedVia =
  "KASSE"`; in Kunden App › Gutscheine steht dann „Gutschein-Monitor“.
- Zutritts-Gutscheine (`GS-…`) zeigt der Monitor nur an und verweist an den
  Check-in. Abgelaufene, deaktivierte und schon eingelöste Gutscheine werden
  rot mit Datum angezeigt.
- Rechts bzw. darunter: „Heute eingelöst“ (alle Leistungs-Gutscheine des
  Berlin-Tages, egal wo eingelöst), lädt jede Minute und nach jedem Einlösen neu.
- Code: `src/lib/voucher-monitor.ts`, `src/components/vouchers/voucher-scan-monitor.tsx`.

## Awards in der Kunden-App (20.11.2026)

- Ein Award ist ein Meilenstein (`Milestone`) mit Seltenheit (`tier`: Bronze,
  Silver, Gold, Legendary). Verwaltung unter Gäste › Kunden App › Awards; dort
  ist jeder Award änderbar (Name, Ziel, Gutschein, Kurztext für die Kachel,
  Zugabe ohne Gutschein, Beschreibung, Aktionstage, Grad-Grenze, aktiv).
- **Vorlage**: Die Migration `20261120190100_awards_vorlage` legt für jedes
  Konto mit eingeschalteter Kunden App 20 Awards an (Liste in
  `AWARD_DEFAULTS`, `src/lib/awards.ts`; `Milestone.key` verhindert doppeltes
  Anlegen). Meilensteine mit Namen „TEST: …“, die noch nie vergeben wurden,
  schaltet sie dort aus (nicht gelöscht).
- **Zählarten** (`GamiMetric`), immer je Person über alle ihre Tickets:
  - Starts, Besuchstage, Wochen in Serie wie bisher.
  - `EARLY_DAYS`: Tage, an denen der erste eigene Start höchstens 60 Minuten
    nach dem ersten Abo-Start des Tages lag (`EARLY_WINDOW_MS`). Eine feste
    Öffnungszeit braucht es dafür nicht.
  - `WEEKENDS`: längste Folge von Wochenenden (Samstag oder Sonntag) mit Start.
  - `EVENT_DAYS`: Start an einem Aktionstag. Die Tage trägt das Personal am
    Award ein (`Milestone.eventDays`, Taste „Heute“). Für eigene Awards; Day
    One und Ice Breaker liefen bis 21.11.2026 so.
  - `OPENING_DAY` (seit 21.11.2026, Day One): Start am ersten Tag der Saison.
    Das ist von selbst der erste Tag des Jahres, an dem ein Abo-Ticket
    gestartet ist (`loadOpeningDays`; Tagestickets zählen dafür nicht, weil
    sie ohne Scan den Beginn des Tickets als Tag tragen). Für das Jahr, in
    dem die Zählung begonnen hat, gibt es keinen automatischen Tag: 2026
    beginnen die Daten am 09.05., also mitten in der Saison, deshalb vergibt
    das System Day One erst ab 2027 von selbst. Trägt das Personal
    am Award einen Tag ein, gilt für dessen Jahr dieser Tag (`openingDayOf`),
    zum Beispiel wenn vor dem Opening jemand zur Probe gefahren ist. Die
    Schwelle ist immer 1.
  - `COLD_DAYS` (seit 21.11.2026, Ice Breaker): Besuchstage, an denen das
    Wasser kälter war als die Grenze am Award (`Milestone.tempBelow`, Vorlage
    10 °C). Quelle ist der Klimaverlauf (`ClimateSample`) des Fühlers aus
    Gäste › Kunden App › Einstellungen › „Fühler für die Wassertemperatur“
    (`GamificationConfig.waterSensorDeviceId`; die Migration wählt den
    einzigen Fühler mit dem Namen „Wasser“ vor). Es gilt der kleinste
    Mittelwert von einer Stunde vor dem ersten bis eine Stunde nach dem
    letzten Start der Person (`WATER_WINDOW_MS`, `loadWaterTemps`). Ohne
    Fühler oder ohne Messwert in dem Fenster zählt der Tag nicht. Messwerte
    gibt es seit 05.11.2026.
  - `SEASONS`: Jahre mit mindestens einem Start. Steht an der Person ein
    früheres Jahr („Fährt seit“, `RiderProfile.ridingSince`, Abos ›
    Kundenkonten › Person bearbeiten), zählen die Jahre davor lückenlos mit,
    weil Starts erst seit 2026 gezählt werden.
- **Zeitraum**: neu ist „Gesamt“ (`ALL_TIME`, `periodKey` „all“): über alle
  Jahre, einmal vergeben. Starts und Saisons der Vorlage zählen so,
  Besuchstage und Specials je Saison (jedes Jahr neu zu holen).
- **Vergabe** (`awardMilestones`): nach jedem Start und beim Öffnen der App
  (`loadRider`, dann ohne Push, damit Abzeichen und Gutschein zusammen
  erscheinen). Wer ein Ziel schon erreicht hatte, bekommt Award und Gutschein
  also beim nächsten Start oder Öffnen. Eine Sperre je Person
  (`claimAward`, `pg_advisory_xact_lock`) verhindert, dass Scan und App
  denselben Award gleichzeitig auf zwei Tickets vergeben. Push beim Scan:
  „Award freigeschaltet: …“ (`notifyAward`).
- **Kunden-App**: Reiter Awards (`/app/<token>/awards`, „Trophy Case“) mit
  Reihen Starts am Lift, Besuchstage, Specials, Treue; gesperrte Awards blass
  mit Fortschritt. Detailseite je Award mit Reihe und Gutschein. Start-Seite
  mit Abzeichen-Leiste und „Nächster Award“ (`nextAward`: größter Anteil am
  Ziel; Awards, bei denen ein einzelner Tag entscheidet, nie
  (`awardCountable`), Treue erst zuletzt). Solche Awards zeigen statt eines
  Balkens „So holst du ihn“ (`awardHowText`): bei Day One den ersten Tag der
  laufenden Saison, bei Ice Breaker die gerade gemessene Wassertemperatur
  (`loadWaterNow`). Gutscheine als Tickets mit dem Abzeichen des Awards.
- **Abzeichen** (`award-badge.tsx`): Form nach Zählart (Starts Sechseck,
  Besuchstage Kreis, Specials Stern, Treue Kranz), Metall nach Seltenheit.
  Eigene Awards aus der Verwaltung bekommen dieselben Abzeichen.
- **Freischalt-Moment** (`rider-award-unlock.tsx`): frisch vergebene Awards
  erscheinen einmal als Vollbild mit Konfetti, höchstens sechs nacheinander.
  Gemerkt am Server (`MilestoneAward.seenAt`,
  `POST /api/rider/<token>/awards/seen`) und zusätzlich im Gerät. Mit
  „Bewegung reduzieren“ ohne Animation. Der Partner in der Familienansicht
  sieht ihn nicht.
- Gutscheine aus Awards tragen die Notiz „Award <Name>“ bzw.
  „Award <Name> (<Jahr>)“ und gelten 365 Tage; Private Session, Abo-Monat und
  50 % aufs Abo laufen nicht ab. Sunset Session und Grillplatz sind im Abo
  nicht enthalten (Aaron, 21.11.2026): die Gutscheine von Thousand Club und
  Endless Summer sind also echte Belohnungen.

## Profil der Kunden-App: eigene Daten und Profilbild (20.11.2026)

- Wunsch von Aaron: Profilseite übersichtlicher; Kunden ändern Vorname,
  Nachname, Geburtsdatum und Profilbild selbst.
- Aufbau (`/app/<token>/profil`): oben Bild, Name, Spitzname und Adresse,
  darunter die persönlichen Daten; dann Abo, Spitzname und Rangliste, Familie,
  Anmeldung (Passkey und Passwort als Zeilen), Benachrichtigungen; ganz unten
  Abmelden (Statistik löschen gibt es nicht mehr). Styles in `profil/profil.css`.
- Speichern: `PATCH /api/rider/<token>/person` (`riderApiManage`): die Person
  selbst oder Eltern für ihr Kind; der Partner sieht nur. Prüfung in
  `src/lib/rider-person.ts` (Vor- und Nachname Pflicht, Geburtsdatum ab 1900
  und nicht in der Zukunft).
- Die Daten landen an der Person (`RiderProfile.firstName/lastName/birthDate`)
  und erscheinen über `riderView` auch an Kasse, Scanner und im Backend. Die
  Rohdaten am Ticket (anny) bleiben. Damit eine Verlängerung mit dem alten
  Namen aus anny trotzdem zur Person findet, merkt sich `planPersons` die
  Daten der Abos, die die Person schon hat.
- Profilbild: `RiderProfile.photo` (Data-URL, im Browser auf 320 × 320 px als
  JPEG verkleinert, höchstens 400 000 Zeichen). Nur für die App. Das Foto zum
  Abgleich an der Kasse (`Ticket.profileImage`) ändert der Kunde nicht, damit
  niemand sein Abo mit fremdem Foto weitergeben kann.

## Temperaturen im Saisonrückblick (21.11.2026)

- Wunsch von Aaron: in den Stats der Kunden-App steht, bei welchen
  Temperaturen man im Schnitt gefahren ist, Luft und Wasser. Der
  Saisonrückblick (`/app/<token>/rueckblick`) zeigt dafür zwei Kacheln:
  „Luft im Schnitt“ und „Wasser im Schnitt“.
- **Rechenweg** (`loadRideTemps` in `src/lib/gamification-service.ts`,
  `tempStat` und `tempStatNote` in `src/lib/gamification.ts`): je Besuchstag
  das Mittel über die Zeit am Lift (erster bis letzter Start der Person),
  danach das Mittel über die Tage. Jeder Tag zählt gleich, egal wie viele
  Starts er hatte. Die Unterzeile nennt die Spanne vom kältesten zum
  wärmsten Tag, oder „gemessen an x von y Tagen“, solange nicht jeder
  Besuchstag einen Messwert hat.
- **Wasser**: der Fühler der Kunden-App (derselbe wie für Ice Breaker,
  `GamificationConfig.waterSensorDeviceId`, Werte aus `ClimateSample`).
  Messwerte gibt es seit 05.11.2026, für die Saison 2026 also nur für die
  letzten Tage. Ohne Messwert an den eigenen Tagen steht ein Strich mit
  Hinweis; ohne Fühler erscheint die Kachel nicht.
- **Luft**: draußen hängt kein Fühler (die beiden Shelly-Fühler messen die
  Umkleiden). Die Werte kommen deshalb von Open-Meteo, je Stunde für den
  Standort des Kontos, und stehen in `WeatherHour`. Der 5-Minuten-Cron
  (`runWeatherHistoryTick`, `src/lib/weather-history.ts`) holt einmal je
  Stunde die neuen Stunden für jedes Konto mit eingeschalteter Kunden-App
  und Standort. Beim ersten Lauf füllt er rückwirkend ab dem ersten
  gezählten Besuchstag, höchstens ab dem Vorjahr: die letzten zehn Tage über
  die Vorhersage-API, Älteres über das Archiv
  (`archive-api.open-meteo.com`, hängt etwa fünf Tage hinterher). Die
  Vorhersage-API reicht laut Doku 92 Tage zurück, lieferte am 21.11.2026 aber
  nur 72; dadurch fehlten zuerst der 21.08. bis 09.09.2026. Fehlen Stunden
  im Bestand (Abruf gescheitert, Stunden ohne Wert), holt der Takt die erste
  Lücke einmal je Stunde nach (`firstGap`). Ohne Standort gibt es keine
  Luftwerte und die Kachel erscheint nicht.
- **Standort des Kontos** (`Account.latitude`, `Account.longitude`): war bis
  21.11.2026 leer. Die Cloud rechnete das Wetter für Bewässerung und
  Tagesvorschau sowie Sonnenauf- und -untergang für Regeln deshalb für
  Berlin. Seit 21.11.2026 steht dort mit Aarons OK der Tuttenbrocksee
  (51,756 / 8,043, dieselben Werte wie der Rückfall im Hub,
  `hub/src/weather.ts`). Ein Eingabefeld für den Standort gibt es in der
  Verwaltung nicht.
- **Aktuelle Werte im Kopf der Startseite** (Wunsch von Aaron am
  21.11.2026, „ganz oben noch Luft und Wasser“): rechts neben dem Standort
  steht „Luft 8° Wasser 9,6°“. Luft ist die jüngste Stunde aus `WeatherHour`
  (`loadAirNow`, auf ganze Grad gerundet), Wasser der jüngste Messwert des
  Fühlers (`loadWaterNow`, eine Nachkommastelle). Beide Werte dürfen höchstens
  drei Stunden alt sein, sonst fehlt der jeweilige Wert; fehlen beide, bleibt
  der Kopf wie vorher. Die Seite ruft dafür nichts von außen ab: es sind zwei
  kleine Abfragen neben den übrigen der Startseite. Unter 328 px Inhaltsbreite
  (Geräte mit 320 px) rutschen die Werte unter den Standort.

## Ride Pass im Kundenkonto (21.11.2026)

Abos › Kundenkonten › Konto öffnen: neben jeder Person (auch Kindern) führt die Taste mit dem Pokal zum Ride Pass der Person. Er zeigt dasselbe wie die Kunden-App, nur zum Ansehen:

- Kopf: zuletzt in der App, Spitzname und ob er in Ranglisten erscheint; Kacheln Besuchstage und Starts der Saison, Starts gesamt, Saisons.
- Reiter Statistik: Saisonrückblick der laufenden und der letzten Saison mit Luft- und Wassertemperatur im Schnitt.
- Reiter Awards: vergebene Awards mit Datum, die drei, denen die Person am nächsten ist, und früher geholte.
- Reiter Challenges: laufende und in den letzten 30 Tagen beendete mit dem Stand der Person.
- Reiter Gutscheine: offen, eingelöst, abgelaufen mit Code und Herkunft.

Technik: `GET /api/customers/persons/[id]/ride-pass` → `loadRidePassForStaff` (`src/lib/ride-pass-staff.ts`, Datenform in `ride-pass-staff-types.ts` ohne Datenbank-Import für die Client-Komponente). Sie nutzt `loadRider(…, readOnly)` und `loadRiderChallenges(…, readOnly)`: anders als beim Öffnen der App wird dabei nichts vergeben, ausgewertet, keine Tagestickets übernommen und kein „zuletzt in der App“ gesetzt. Oberfläche: `src/components/subscriptions/ride-pass-panel.tsx`.

## Mahnlauf für offene Abo-Zahlungen (21.11.2026)

Aaron wollte vorerst statt Inkasso einen eigenen Mahnlauf, vollautomatisch (Entscheidung 21.11.2026). Grundlage ist „Zahlung offen“ (`src/lib/payment-open.ts`): Der anny-Abgleich pausiert Abos mit überfälliger Rechnung.

- **Ablauf** (`src/lib/dunning.ts`, Stufenlogik in `src/lib/dunning-state.ts`): Cron `/api/cron/dunning` täglich 8:20 UTC (9:20 bzw. 10:20 Berlin), Mails nur 9–20 Uhr, höchstens 30 je Lauf. Je Abo höchstens eine Stufe pro Lauf, immer nacheinander:
  1. **Zahlungserinnerung** 3 Tage nach Beginn der Pause, über anny (`POST /invoices/{id}/send-payment-reminder`); scheitert das oder fehlt die Rechnungs-id, geht eine eigene Mail.
  2. **1. Mahnung** 14 Tage nach der Erinnerung, eigene Mail, Frist 14 Tage.
  3. **Letzte Mahnung** 14 Tage nach der 1. Mahnung, Frist 7 Tage, Hinweis auf Inkasso.
  4. **Bereit für Inkasso** nach Ablauf der Frist, ohne Mail. Hier soll die spätere Übergabe (Empfehlung Debtist) ansetzen.
- Keine Mahngebühr, kein automatisches erneutes Abbuchen. Mailtexte in `src/lib/dunning-mail.ts`, Protokoll in `EmailSend`.
- **Stand** in `extras.paymentPause.dunning` (Zeitpunkte, Fristen, Fehlversuche). Der Abgleich trägt ihn mit, solange die Pause besteht; nach Zahlung fällt der Vermerk weg und der Mahnlauf endet. Nach 3 Fehlversuchen einer Stufe (z. B. keine Adresse) wird nicht mehr versucht, die Abos-Seite zeigt den Grund.
- **Schalter** „Mahnlauf“ in der Karte „Zahlung offen“ auf der Abos-Seite (nur Admins), gespeichert in `ApiConfig(ANNY).extraConfig.dunning.enabled`, Standard an. Die Karte zeigt je Abo die erreichte und die nächste Stufe.
- Offen: Ob anny den Endpunkt der Zahlungserinnerung genau so erwartet, ist ungeprüft. Der Vercel-Log `[dunning] … anny-Erinnerung fehlgeschlagen` zeigt es, dann geht automatisch die eigene Mail.

## Kunden-App: Tagesauswertung und Öffnungszeiten-Kalender (21.11.2026)

- **Tagesauswertung** („Dein Tag heute“): ganz oben auf der Startseite, sobald die Person heute einen Start hat (`RiderDayStat` von heute, Feld `today` in `RiderView`, `src/lib/rider-app.ts`). Zeigt Starts, Zeit am Lift (erster bis letzter Start; bei einem Start die Uhrzeit), Wasser (kältester Wert während der Fahrt, sonst aktueller Wert, sonst Luft), Besuchstag Nr., Saisonrekord, Hinweis für den Kälte-Award, heute freigeschaltete Awards, Fortschritt zum nächsten Award und zur laufenden Aufgaben-Challenge. Kostet eine kleine Abfrage über den eindeutigen Index (ticketId, day); alles andere ist schon geladen.
- **Öffnungszeiten-Kalender** `/app/<token>/zeiten`: Tipp auf die Öffnungszeile in „Auslastung jetzt“. Monatsraster mit Zeiten je Tag, Sondertage (Ausnahmetage) mit gelbem Punkt, darunter die offenen Tage ab heute. Lift-Profil zuerst (`loadRiderSchedules`, `src/lib/rider-opening.ts`), andere Bereiche umschaltbar. Blättern ein Monat zurück, zwölf voraus (`?monat=YYYY-MM`, `?bereich=<id>`). Logik in `src/lib/rider-calendar.ts` (+ Test). Server-gerendert ohne Client-JS.

## Feiertage in der Kunden-App (21.11.2026)

Aaron: „feiertage noch in der kunden app hinzufügen. dafür im backend auswählen welche mit was angezeigt werden können. grußwort, angebot oder gutschein möglich“.

- Verwaltung: Kunden App › Aktionen › Karte „Feiertage“. Je Feiertag Aus, Gruß, Angebot oder Gutschein, dazu Überschrift (Standardgruß, falls leer), Text, beim Gutschein Leistung und Gültigkeit, „Schon vorher zeigen“ (0–14 Tage). Gilt jedes Jahr; das Datum rechnet `src/lib/holidays.ts` (NRW plus Heiligabend, Silvester, Oster- und Pfingstsonntag).
- Daten: `RiderHoliday` (je Mandant und `key` einmal), `RiderHolidayGift` (vergebener Gutschein, eindeutig je Feiertag, Jahr und Person). Speichern über `PUT /api/gamification/holidays/<key>`.
- App: Karte oben auf der Startseite (nach „Dein Tag heute“), `src/lib/rider-holiday.ts`. Überschneiden sich zwei Feiertage, zeigt die App den nächstliegenden.
- Gutschein: Leistungs-Gutschein wie bei Awards. Jede Person mit gültigem Abo bekommt ihn einmal, beim ersten Öffnen der App im Zeitraum; ohne Abo bleibt es beim Gruß.
- Push (Aaron 21.11.2026: „ja“): Schalter „Push an Kunden senden“ im Dialog, beim ersten Einschalten an. Geht jedes Jahr einmal raus, sobald der Feiertag in der App erscheint (erster Tag von „Schon vorher zeigen“), nur 9–21 Uhr, über `runAccountAnnouncements` (`pushedYear`/`pushedAt`/`pushSent`). Empfänger wie bei Angeboten: alle Geräte mit Push-Erlaubnis; beim Gutschein heißt es deshalb „Mit Abo wartet ein Geschenk …“.

## Playlist-Abstimmung der Fahrer (21.11.2026)

Aaron: „in der kunden app soll optional aktiviert werden können, dass alle aktiven fahrer die playlist auswählen können. die mehrheit ist immer aktiv“.

- Einschalten unter Kunden App › Einstellungen › „Playlist-Abstimmung“: Zonen (z. B. Insel), 2 bis 8 Playlists oder Webradios zur Wahl (seit 21.11.2026 abends auch Webradio, Aaron: „playlist abstimmung geht auch mit streams“; gespeichert als `musicVoteOptions` bzw. `RiderMusicVote.option` = "p<id>"/"s<id>"; Reihenfolge = Reihenfolge in der App), Ruhe nach Wahl des Teams (Vorgabe 60 Min, 0 = aus). Ab Werk aus.
- Aktiv ist, wer heute am Lift gestartet ist und dessen letzter Start höchstens 2 Stunden her ist (`RiderDayStat.lastStartAt`). Je Person und Tag eine Stimme (`RiderMusicVote`), jederzeit änderbar oder zurücknehmbar. Stimmen inaktiver Fahrer zählen nicht mehr.
- Mehrheit gewinnt; bei Gleichstand bleibt die laufende, sonst die vordere in der Auswahl. Ohne Stimme bleibt, was eingestellt ist.
- Umsetzung `src/lib/music-vote.ts`, Regeln `music-vote-rules.ts`: gleich nach jeder Stimme und jede Minute im Cron `audio-schedules`. Sie wechselt nur laufende eigene Musik (nicht bei AirPlay/Bluetooth, nicht ohne Abspieler), startet nie selbst und schickt `manual: false`, das Musikfenster bleibt also unberührt. Der Wechsel setzt `AudioZone.playlistId` bzw. `streamId`/`streamUrl` (nach dem Ausschalten bleibt die zuletzt gewählte Playlist als Vorgabe der Zone).
- Personal geht vor: Start/Stopp von Hand (Dashboard, Geräte-API, emp-control) setzt `AudioZone.staffChoiceAt`; danach ruht die Abstimmung für die eingestellte Zeit. Im Audio-Verlauf stehen Wechsel als „Fahrer-Abstimmung“ (`triggerKind = VOTE`).
- Kunden-App: Karte „Musik · <Zone>“ auf der Startseite, für aktive Fahrer direkt unter „Dein Tag heute“, sonst unter der Auslastung (nur zum Ansehen).
- Kunden-App (seit 21.11.2026 abends, Aaron: „die musik auswahl muss minimiert sein und oben bei betrieb … zu öffnen sein“): eingeklappte Zeile „Musik <läuft>“ in der Karte „Auslastung jetzt“ direkt unter den Öffnungszeiten (ohne Auslastung als eigene kleine Karte). Antippen klappt die Auswahl auf.
- Runden (Aaron: „auch timer anzeigen bis wann abgestimmt werden kann für den wechsel“): `GamificationConfig.musicVoteRoundMinutes` (Vorgabe 15, Auswahl 0/5/10/15/20/30/60). Runden zählen ab Mitternacht (bei 15 also :00/:15/:30/:45); der Cron wertet einmal je Rundenbeginn aus (`musicVoteRoundAt` als Guard), gewechselt wird also nur am Rundenende. Die App zeigt den Countdown bis zum nächsten Wechsel und lädt danach den neuen Stand (`GET /api/rider/<token>/music-vote`). 0 = Wechsel sofort nach jeder Stimme wie vorher.

## Skills in der Kunden-App (Geräte schalten als Belohnung)

Seit 21.11.2026 (Aaron: „anstatt gutschein, kann man auch skills gewinnen wie geräte steuern, außenduschen, heizstrahler etc“). Ein Skill ist ein zeitlich begrenztes Recht, vor Ort selbst ein Gerät zu schalten oder die Musik zu bestimmen.

- Anlegen, sperren, Protokoll: Kunden App › Gutscheine › Karte „Skills“ und „Geschaltet“. Ab Werk gibt es keinen Skill.
- Arten: `DEVICE` (Shelly-Taster, -Schalter, -Licht oder Hue; Türen, Tore, Schlösser, Ventile nie, `isSkillDevice`) und `MUSIC` (Musik-Joker: eine Auswahl der Playlist-Abstimmung läuft `minutes` lang, die Abstimmung ruht über `AudioZone.riderChoiceUntil`).
- Vergabe: an Award, Challenge und Feiertag (Feld „Skill freischalten“ mit Nutzungen und Gültigkeit), als `RiderSkillGrant` am Ticket wie ein Gutschein; Push „Neuer Skill“.
- Grenzen (`src/lib/rider-skill-rules.ts`): Nutzungen und Ablauf, nur während der Betriebszeit am Lift, nur wer heute schon am Lift gestartet ist, Pause je Skill nach jeder Nutzung, Sperre durch das Personal.
- Schalten (`src/lib/rider-skills.ts`, `POST /api/rider/[token]/skill`): Nutzung wird unter einer Sperre je Skill gebucht, dann geschaltet. Taster laufen ihre eigene Dauer, Schalter bekommen den Shelly-Auto-Off-Timer (`autoOffSec`), Hue schaltet der Minuten-Cron (`runSkillOffTick` im Audio-Cron) wieder aus. Klappt das Schalten nicht, gibt es die Nutzung zurück; das Protokoll (`RiderSkillUse`) zeigt den Fehler.

## Geburtstag in der Kunden-App (21.11.2026)

Aaron: „geburtstagsgrüße in die kunden app, im backend geschenk hinterlegen, grüße auch als push, geburtstagsoption in audio: wenn ein geburtstagskind scant kommt die ansage einmalig an dem tag“.

- Einstellung je Mandant in `RiderBirthday` (eine Zeile), Vergaben je Person und Jahr in `RiderBirthdayGift` (Geschenk `giftAt`/`voucherId`, Push `pushedAt`/`pushSent`, Durchsage `announcedAt`). Regeln ohne DB in `src/lib/birthday.ts`, Ablauf in `src/lib/rider-birthday.ts`.
- Geburtsdatum: `RiderProfile.birthDate` (die Person pflegt es im Profil). 29. Februar feiert ohne Schalttag am 28.
- App: Karte oben auf der Startseite nur am Geburtstag („Dein 25. Geburtstag“). Geschenk wie bei Feiertagen: Gutschein für Personen mit gültigem Abo, einmal je Jahr, beim ersten Öffnen der App am Geburtstag. Ohne Abo nur der Gruß mit Hinweis.
- Verwaltung: Kunden App › Aktionen › Karte „Geburtstag“ (Aus / Gruß / Mit Geschenk, Überschrift, Text, Push-Schalter mit Vorschau). `{vorname}` in Überschrift und Text wird ersetzt, sonst hängt der Vorname hinten an.
- Push: einmal am Geburtstag 9–21 Uhr über den 5-Minuten-Cron (`runAccountAnnouncements`), nur an die Geräte des Geburtstagskinds; Kind ohne eigenes Gerät: an die Erwachsenen seiner Familie („Heute hat Mia Geburtstag“). Nie, wenn die Überschrift mit „TEST:“ beginnt.
- Durchsage: Audio › Zeitpläne › Karte „Geburtstags-Ansage“ (Zonen, Text, Vorname ja/nein, Stimme, Gong, Probe nur im Browser). Beim ersten GRANTED-Scan am Gerät mit `countsAsStart` (Start-Drehkreuz) am Geburtstag rendert `announceBirthdayOnScan` den Text über xAI (gleicher Text aus dem Cache) und legt ANNOUNCE-Jobs mit `triggerKind = "BIRTHDAY"` an; läuft per `after()` hinter der Scan-Antwort. Einmal am Tag; schlägt die Sprachausgabe fehl, versucht es der nächste Scan erneut.
- Datenschutz: nur Vorname, nie Nachname, im Verlauf „Geburtstag Mia“. Die Person kann die Durchsage auf ihrer Geburtstagskarte abschalten (`RiderProfile.birthdayAnnounce`, PATCH `/api/rider/<token>/birthday`). Alles ab Werk aus.
