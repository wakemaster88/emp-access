# Design-Regeln EMP Access

Stand: 4. November 2026. Abgeleitet aus dem Räume-Konzept (Canvas „Raumübersicht Konzept“) und
Aarons Vorgabe „cleaner, Richtung iOS 26/27 Liquid Glass“. Diese Datei ist die eine Quelle für
alle Seiten; neue Abschnitte kommen hier hinein, nicht in eine zweite Datei.

## 1. Grundsätze

1. **Jede Information genau einmal.** Ein Wert steht an einer Stelle und wird dort gepflegt.
   Andere Stellen verlinken oder verdichten („3 Lichter an“), sie wiederholen nicht.
2. **Zustand als Farbe, nicht als Text.** Eine Kachel leuchtet, wenn etwas an ist; Grau heißt aus,
   Rot heißt Störung. Text erklärt nur, was die Farbe nicht sagt („heizt auf 21 °C“).
3. **Drei Ebenen.** Lagebild (alles auf einen Blick, filterbar) → Objekt in voller Breite
   (ein Raum, ein Gerät, eine Kamera) → Dialog für Einstellungen. Keine vierte Ebene.
4. **Erst sehen, dann tippen.** Der häufigste Griff ist eine Geste (Licht an, Musik aus, Tor auf).
   Alles Seltene liegt einen Tipp tiefer.
5. **Ruhe bei Normalbetrieb.** Ist nichts los, ist die Seite leise: keine leeren Rahmen,
   keine Hinweise, die nichts fordern. Auffälliges fällt auf, weil der Rest still ist.

## 2. Flächen: Liquid Glass

- **Grund** (`page-ambient`): dunkler oder heller Grund mit vier weichen Farbflecken
  (Indigo, Himmelblau, Violett, Smaragd). Er scheint durch das Glas und gibt Tiefe.
- **Karte** (`glass-card`): durchscheinende Fläche, Weichzeichner 28 px, Sättigung 170 %,
  Rand 1 px, Lichtkante oben (inset 0 1px 0), weicher Schatten nach unten. Radius 24 px.
- **Kachel** (`glass-tile`): Fläche in einer Karte, etwas heller als die Karte. Radius 18 px.
  Aktive Kacheln bekommen einen Farbverlauf im Farbton des Zustands und einen Glow.
- **Leiste** (`glass-strip`): Tab-Leisten und Segmentwahlen sind eine schwebende Kapsel
  (Radius 999 px). Der aktive Eintrag ist eine helle Glas-Pille (`glass-pill-active`),
  keine Unterstreichung.
- **Bedienelemente**: Tasten und Eingaben Radius 14 px, Pillen und Chips 999 px.
- Kein Element liegt flach und deckend auf dem Grund. Volle Deckung nur für Dialoge und
  Primärtasten.

Tokens in `src/app/globals.css`: `--glass-bg`, `--glass-bg-strong`, `--glass-tile`,
`--glass-border`, `--glass-highlight`, `--glass-shadow`, `--glass-blur`, `--glass-pill`
sowie die Radien `rounded-card` (24 px), `rounded-tile` (18 px), `rounded-control` (14 px).

## 3. Farbe

Semantische Tokens aus `globals.css` (`primary`, `success`, `warning`, `info`, `destructive`,
`muted`) bleiben die Basis. Für Zustände gilt ein festes Vokabular:

| Zustand | Farbton | Tailwind-Ton | Beispiel |
|---|---|---|---|
| Licht an | Bernstein | `amber` | Lampe, Lichtgruppe |
| Musik läuft | Violett | `violet` | Beschallungszone |
| Heizt | Orange | `orange` | Heizung, Temperaturring |
| Lüftet, Wasser | Himmelblau | `sky` | Lüftung, Bewässerung, Kamera-Erkennung |
| Live, geöffnet, mäht | Smaragd | `emerald` | Betrieb offen, Mäher aktiv |
| Jemand da | Violett hell | `violet` | Anwesenheit |
| Störung, offline | Rot | `destructive` | Gerät antwortet nicht |
| Hinweis, wartet | Gelb | `warning` | Pause, Ausnahme, Batterie |
| Aus, ruhig | Grau | `muted` | alles andere |

Ein Zustand hat genau eine Farbe, eine Farbe genau eine Bedeutung. Keine Farbe als Dekoration.

## 4. Typografie

- Schrift Inter, Zahlen immer `tabular-nums`.
- Größen: Seitentitel 20 px / 600, Kartentitel 14 px / 600, Fließtext 13 px, Nebentext
  11 px `muted-foreground`, Gruppenbeschriftung 11 px / 600 Versalien, Laufweite 0.08 em
  (`text-label`).
- Ein Gedanke je Zeile. Nebentext ist ein Satz oder eine Angabe mit Mittelpunkt
  („an · 180 W“), keine Aufzählung in einer Zeile.
- Keine Emojis. Symbole kommen aus Lucide, 14 bis 20 px, Strichstärke 2 bis 2,2.

## 5. Abstände und Raster

- Außenabstand Seite 16 px (Handy) / 24 px, Kartenabstand 16 bis 20 px, Innenabstand Karte
  16 bis 18 px, Kachelabstand 8 px.
- Kacheln sind mindestens 44 px hoch und breit (Touch). Tasten 34 bis 44 px.
- Handy: eine Spalte, Tab-Leisten wischbar, kein horizontales Scrollen der Seite.
  Desktop: Raster mit 2 bis 3 Spalten, Objekt-Ansicht in zwei Spalten.

## 6. Tab-Leisten und Navigation

- Eine Seite mit mehreren Objekten (Räume, Kameras, Zonen) hat oben eine Tab-Leiste:
  „Übersicht“ ganz links, ein Tab je Objekt, Sammel-Tabs („Ohne Raum“) ganz rechts.
- Ein Tab zeigt höchstens einen Punkt (Zustand) und eine Zahl (Störungen). Mehr nicht.
- Innerhalb eines Objekts: höchstens vier Reiter (Steuern, Zeit, Überwachung, Technik).
  Reiter ohne Inhalt werden nicht gezeigt.

## 7. Kacheln und Zeilen

- **Kippkachel** für alles, was an oder aus ist (Relais, Lampe): antippen schaltet, Farbe zeigt.
- **Zeile mit Tasten** für alles mit mehreren Befehlen (Tor: Auf, Stopp, Zu) und für Taster
  (Impuls mit Fortschrittsring).
- **Gruppenkachel** für gleichartige Geräte („Beleuchtung Herren · 0 von 4 an“) mit Pfeil
  zum Aufklappen.
- Während ein Befehl läuft: „schaltet …“ und Ladekreis, höchstens 10 s, dann zurück.
- Offline: Kachel bleibt stehen, Deckkraft 60 %, Nebentext „offline seit …“, Taste gesperrt.

## 8. Diagramme und Zahlen

- Kennzahlen als Kachel (`StatCard`) mit Zahl (24 px / 700), Bezug („von 11“) und dünnem Balken.
  Eine Kennzahl ist zugleich ein Filter, wenn sie eine Liste darunter betrifft.
- Verlauf als Linie (Temperatur orange, Feuchte sky), Zeiträume als Band (Heizen orange 14 %,
  Lüften sky 12 %), Sollbereich als grünes Band. Jetzt-Marke als gestrichelte Linie.
- Wochen als Spanne (min bis max) mit Mittelpunkt, heutiger Tag hervorgehoben.

## 9. Bewegung

- Übergänge 200 bis 300 ms, `cubic-bezier(0.2, 0.7, 0.2, 1)`.
- Antippen skaliert auf 97 %, Schweben hebt um 2 px. Kein Pulsieren außer beim Live-Punkt.
- `prefers-reduced-motion`: keine Animation, nur Farbwechsel.

## 10. Hell und Dunkel

Beide Modi sind gleichwertig. Glas-Tokens haben je einen Wert in `:root` und `.dark`.
Zustandsfarben nutzen für Hell die 100er- bis 600er-Töne, für Dunkel die 400er-Töne auf
Flächen mit 15 bis 25 % Deckung. Kontrast Text zu Fläche mindestens 4,5:1, Nebentext 3:1.

## 11. Sprache

- Deutsch, Sätze mit Verb, Du-Form in Hinweisen. Zahlen mit Einheit und schmalem Abstand
  („21,5 °C“, „180 W“), Zeiten „14:32“, relative Zeiten „vor 3 Min“.
- Fehler sagen, was passiert ist und was zu tun ist: „Kasse nicht erreichbar · Technik prüfen“.
- Leere Zustände sind ein Satz, keine Grafik: „Alle Geräte sind zugeordnet.“

## 12. Barrierefreiheit

- Jede Taste hat einen Namen (`aria-label`, wenn nur ein Symbol).
- Tab-Leisten sind `role="tablist"` mit `aria-selected`; Kippkacheln `aria-pressed`.
- Fokus sichtbar (`ring`), Tastaturreihenfolge folgt der Leserichtung.
- Farbe trägt nie allein: zusätzlich Text, Symbol oder Form.

---

Die folgenden Abschnitte gelten für alle übrigen Seiten (Cloud, öffentliche Flächen, Hub) und
beschreiben, wie die Grundsätze oben im Code umgesetzt werden.

## 13. Seitenaufbau

- **Hülle**: Der Rahmen (`DashboardShellInner`) trägt den Farbgrund (`page-ambient`). Seiten setzen
  keinen eigenen Hintergrund (`bg-background`, `bg-slate-…`), sonst verschwindet das Glas.
- **Kopfbalken** (`Header`): eine Glasleiste (`glass-bar`), klebt oben. Links Seitentitel
  (20 px / 600, auf dem Handy 18 px), daneben höchstens ein Zustand (`badge`, z. B. Live-Punkt)
  und der Mandant als Kapsel. Rechts die Aktionen der Seite (`children`), Uhrzeit, Farbschema.
  Höchstens eine Primärtaste im Kopf; alles Weitere als `outline` oder `ghost`.
- **Inhalt**: `page-content` (16 px Rand auf dem Handy, 24 px ab `sm`), darin Abschnitte mit
  16 bis 20 px Abstand (`space-y-4 sm:space-y-5` oder `gap-4 sm:gap-5`).
- **Abschnittsüberschrift** zwischen Karten: `SectionHeading` (11 px Versalien, `text-label`),
  nicht `h2` mit eigener Größe.
- **Seitenleiste**: Glasfläche, folgt Hell/Dunkel. Aktiver Eintrag als getönte Pille in
  Akzentfarbe (kein Balken am Rand). Auf dem Handy als Sheet von links.
- **Tab-Leiste unten (Handy)**: schwebende Kapsel (`glass-dock`) mit Abstand zur Home-Leiste,
  aktiver Eintrag als helle Pille. Der Inhalt hat unten genug Luft (`pb` in der Hülle).

## 14. Bausteine

Jede Seite baut aus diesen Teilen. Ein Muster, das hier fehlt, kommt als Baustein in
`src/components/ui/` hinzu, nicht als Einzellösung in einer Seite.

| Baustein | Datei | Wofür |
|---|---|---|
| `Card` (+ Header, Title, Description, Content, Footer, Action) | `ui/card.tsx` | Jede Fläche auf dem Grund. Glas, Radius 24 px, innen 16/18 px. |
| `glass-tile` (Klasse) | `globals.css` | Fläche in einer Karte: Zeile, Kachel, Gruppe. Radius 18 px. |
| `StatCard` | `ui/stat-card.tsx` | Kennzahl: Symbol-Chip, Zahl 24 px / 700, Bezug (`suffix`), Balken (`progress`), als Filter mit `onClick`/`active`. |
| `Notice` | `ui/notice.tsx` | Hinweis, Warnung, Störung, Erfolg als getönte Kachel mit Chip, Titel, Erklärung, Handlung. |
| `IconChip` | `ui/icon-chip.tsx` | Symbol im Glas-Quadrat vor Zeilen; `active` füllt in der Zustandsfarbe. |
| `Tabs` | `ui/tabs.tsx` | Umschalten zwischen Inhaltsbereichen. Kapsel mit heller Pille. |
| `Segmented` | `ui/segmented.tsx` | Filter, Zeitraum, Ansicht (ohne eigenen Inhaltsbereich). Gleiche Optik wie Tabs. |
| `Button` | `ui/button.tsx` | `default` Primär (eine je Bereich), `secondary` Glas, `outline` Glas mit Rand, `ghost`, `destructive`, `link`. |
| `Badge` | `ui/badge.tsx` | Pille für Zustand und Anzahl: `success`, `warning`, `danger`, `info`, `neutral`, `secondary`, `outline`, `mono`. |
| `Input`, `Textarea`, `Select`, `Switch`, `Label` | `ui/…` | Formulare. Felder sind `glass-field` (getönt, Radius 14 px). Schalter an = grün. |
| `Dialog`, `AlertDialog`, `Sheet` | `ui/…` | Ebene über der Seite: deckend, Radius 24 px, auf dem Handy von unten. |
| `DropdownMenu`, `Select`-Liste, `Tooltip` | `ui/…` | Schwebende Ebenen aus dichtem Glas (`glass-surface`). |
| `Table` | `ui/table.tsx` | Tabellen in einer Karte, Haarlinien, Kopf 11 px Versalien. |
| `EmptyState` | `ui/empty-state.tsx` | Leerer Zustand: ein Satz, kleines Symbol, nächster Schritt. |
| `StatusDot` | `ui/status-dot.tsx` | Zustandspunkt; `pulse` nur für „lebt gerade“. |
| `SectionHeading` | `ui/section-heading.tsx` | Überschrift eines Abschnitts. |

Hilfsklassen aus `globals.css`: `glass-card`, `glass-tile`, `glass-strip`, `glass-pill-active`,
`glass-bar` (klebende Leisten), `glass-surface` (Menüs, Popover), `glass-dock` (Tab-Leiste
unten), `glass-field` (eigene Eingaben), `press` (Antippen 97 %), `page-ambient`, `text-label`.
Als Tailwind-Farben stehen `bg-glass`, `bg-glass-strong`, `bg-glass-tile`, `border-glass-border`
und `bg-field` bereit.

## 15. Farben im Code

- **Erlaubt**: semantische Tokens (`primary`, `success`, `warning`, `info`, `destructive`,
  `muted`, `foreground`, `border`, `glass-…`) und die Zustandstöne aus Abschnitt 3 (`amber`,
  `violet`, `orange`, `sky`, `emerald`) – nur für genau diese Zustände.
- **Nicht erlaubt**: Grautöne aus der Palette (`slate`, `gray`, `zinc`, `neutral`, `stone`),
  andere Paletten-Farben als Dekoration (`indigo`, `blue`, `rose`, `pink`, `teal`, `cyan` …),
  Hex-Werte in TSX, `bg-white`/`bg-black` als Fläche. Ausnahme: Text auf deckender Farbe
  (`text-white` auf `bg-primary`), Video- und Kamerabilder (schwarzer Grund), Druckansichten.
- Zustandsfarbe hell/dunkel: Text `text-amber-600 dark:text-amber-300` (Kontrast!), Fläche
  `bg-amber-500/15`, aktive Kachel `bg-gradient-to-br from-amber-400/25 to-amber-400/5` mit Rand
  `border-amber-400/45`.
- Diagramme (Recharts): `var(--chart-1)` … `var(--chart-5)` bzw. die Zustandsfarben, Gitter in
  `var(--border)`, Achsentext `var(--muted-foreground)`.

## 16. Formulare

- Beschriftung über dem Feld (`Label`, 13 bis 14 px), Hilfetext darunter in `muted-foreground`.
- Felder 36 px hoch (`h-9`), in Dialogen auf dem Handy 44 px (`h-11`). Mindestens 16 px Schrift
  (iOS zoomt sonst).
- Eigene `<input>`, `<select>`, `<textarea>` bekommen `glass-field` statt eigener Rahmen.
- Fehler stehen am Feld (`aria-invalid`, roter Rand) oder als `Notice tone="danger" compact`
  über den Tasten, nie als Browser-Alert.
- Tasten unten rechts: Primärhandlung rechts, „Abbrechen“ als `ghost` oder `outline` links davon.
  Auf dem Handy volle Breite, Primärtaste oben.

## 17. Listen und Tabellen

- Kurze Listen (bis etwa 12 Einträge, gemischter Inhalt): Zeilen als `glass-tile` oder als
  Zeilen mit Haarlinie in einer Karte, links `IconChip`, rechts Zustand und Handlung.
- Lange Listen und Daten mit Spalten: `Table` in einer `Card` (`py-0`, Tabelle bis an den Rand).
  Zeilenhöhe mindestens 44 px auf dem Handy. Gruppenzeilen als `text-label` auf `bg-glass-tile`.
- Breite Tabellen scrollen in ihrem Container waagerecht, nie die Seite.
- Auswahl: `bg-primary/10`, Darüberfahren: `bg-glass-tile`.

## 18. Ebenen: Dialog, Sheet, Menü

- Höchstens eine Ebene über der Seite. Ein Dialog öffnet keinen zweiten Dialog; dafür gibt es
  Schritte im selben Dialog oder eine eigene Seite.
- Dialoge sind deckend (`bg-popover`), Radius 24 px, Schließen-Taste als runde Glas-Taste.
  Auf dem Handy kommen sie als Blatt von unten mit Griff.
- Löschen und Sperren immer mit `AlertDialog` und `destructive`-Taste.
- Menüs und Auswahllisten sind dichtes Glas (`glass-surface`), Einträge 36 px, aktiv
  `bg-primary/12`.

## 19. Laden, Leere, Fehler

- Laden: kleiner Kreis (`Loader2`, `animate-spin`) mit Verb („Lädt …“), in Karten an der Stelle
  des Inhalts. Keine Vollbild-Spinner außer beim Anmelden der Sitzung.
- Leer: `EmptyState` mit einem Satz („Noch keine Gutscheine angelegt.“) und dem nächsten Schritt.
- Fehler: `Notice tone="danger"` mit Ursache und Handlung („Erneut versuchen“). Technische
  Details (Statuscode) klein in `muted-foreground` darunter.

## 20. Öffentliche Flächen (Monitor, Kiosk, Scanner, Mitarbeiter-App)

- Gleiche Tokens und Bausteine, gleicher Farbgrund (`page-ambient`). Wandmonitore und Kiosk
  laufen dunkel (`dark`), Schrift größer (Zahlen 48 bis 96 px), Touch-Ziele mindestens 56 px.
- Ergebnis eines Scans als volle Fläche in der Zustandsfarbe (grün erlaubt, rot abgelehnt),
  sonst ruhige Glasflächen.

## 21. Hub-Dashboard

- Das Hub-Dashboard (`hub/src/ui/`) hat kein Tailwind, spiegelt aber dieselben Werte in
  `dashboard.css` (`--glass-*`, Radien 24/18/14 px, Akzent Indigo, Zustandsfarben).
  Karten, Leisten und Tab-Leiste sehen aus wie in der Cloud.

## 22. Leistung

- Weichzeichner nur auf Flächen, die direkt auf dem Grund liegen (Karten, Leisten, Menüs).
  Kacheln in einer Karte (`glass-tile`) zeichnen nicht weich.
- Keine Glaskarte je Listeneintrag bei langen Listen (mehr als etwa 30): eine Karte mit Zeilen.
- „Transparenz reduzieren“ des Systems macht alle Glasflächen deckend (`prefers-reduced-transparency`).
- Eigene Glas-Utilities schreiben `-webkit-backdrop-filter` **vor** `backdrop-filter`. In der
  umgekehrten Reihenfolge behält der CSS-Compiler nur die Safari-Fassung, und Chrome, Edge
  und Android zeigen gar keinen Weichzeichner.

## 23. Prüfliste für eine Seite

1. Kopfbalken mit Titel, höchstens eine Primärtaste.
2. Alle Flächen sind `Card` oder `glass-tile`; kein eigener Hintergrund, kein `shadow-…`.
3. Keine Grautöne oder Dekorfarben aus der Palette; Zustände in ihrer festen Farbe.
4. Kennzahlen als `StatCard`, Hinweise als `Notice`, Umschalter als `Tabs` oder `Segmented`.
5. Leer-, Lade- und Fehlerzustand vorhanden und je ein Satz.
6. Handy (390 px): eine Spalte, nichts läuft waagerecht über, Tasten 44 px.
7. Hell und Dunkel geprüft, Kontrast Text mindestens 4,5:1.
