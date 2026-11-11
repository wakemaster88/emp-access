# Design-Regeln EMP Access

Stand: 5. November 2026. Abgeleitet aus dem Räume-Konzept (Canvas „Raumübersicht Konzept“) und
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
`--glass-border`, `--glass-tile-border`, `--glass-highlight`, `--glass-shadow`, `--glass-blur`,
`--glass-pill` sowie die Radien `rounded-card` (24 px), `rounded-tile` (18 px), `rounded-control` (14 px).

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

**Akzent und Füllung.** `primary` ist der Akzent für Text, Symbole, Ringe und Tönungen
(`text-primary`, `ring-primary/40`, `bg-primary/12`). Deckende Flächen mit Schrift oder Symbol
darauf nehmen `primary-fill` bzw. `destructive-fill`: Primärtaste, Badge `default`/`destructive`,
angehaktes Kästchen, aktiver `IconChip`, Avatar-Punkt. Weiß darauf erreicht hell 5,6:1 bzw.
5,7:1, dunkel 4,9:1 bzw. 5,0:1 (vorher im Dunkeln 4,1:1 und 4,0:1). Hover `bg-primary-fill/90`.
Glow und Schatten dürfen `var(--primary)` behalten.

**Zustandsfarben hell.** `success`, `warning`, `destructive` und `info` sind im Hellen so dunkel,
dass Badge-Text auf seiner Tönung (12 bis 14 %) auf Glaskarte und Popover mindestens 4,5:1
erreicht (gemessen 4,6 bis 4,8:1, vorher 4,1 bis 4,5:1); Weiß auf der vollen Fläche 5,5 bis 5,7:1.
Im Dunkeln bleiben die Werte.

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
- Handy: eine Spalte. Nichts scrollt seitlich – nicht die Seite, keine Tab-Leiste oder Kapsel,
  keine Tabelle (geprüft bei 390 und 360 px Breite).
  Desktop: Raster mit 2 bis 3 Spalten, Objekt-Ansicht in zwei Spalten.

## 6. Tab-Leisten und Navigation

- Eine Seite mit mehreren Objekten (Räume, Kameras, Zonen) hat oben eine Tab-Leiste:
  „Übersicht“ ganz links, ein Tab je Objekt, Sammel-Tabs („Ohne Raum“) ganz rechts.
- Ein Tab zeigt höchstens einen Punkt (Zustand) und eine Zahl (Störungen). Mehr nicht.
- Innerhalb eines Objekts: höchstens vier Reiter (Steuern, Zeit, Überwachung, Technik).
  Reiter ohne Inhalt werden nicht gezeigt.
- Passt eine Tab-Leiste oder Kapsel (`Tabs`, `Segmented`, `SegmentedLinks`) nicht in eine Zeile,
  bricht sie um: eine Zeile mehr, die Einträge füllen jede Zeile, die Kapsel wird ein
  abgerundetes Rechteck (22 px). Nie seitlich wischen oder scrollen. Auf dem Handy stehen die
  Einträge enger (10 px Innenabstand). Der aktive Eintrag behält die Schriftstärke und hebt sich
  nur durch die helle Pille ab – fetter wäre er breiter, und die Leiste spränge beim Wechseln.

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

Beide Modi sind gleichwertig. Glas-Tokens haben je einen Wert in `:root, .light` und `.dark`.
Zustandsfarben hell: Text im 700er-Ton (auf einer Tönung Bernstein und Orange 800), Flächen,
Punkte und Symbole 100er bis 600er. Dunkel: Text im 300er-Ton, Flächen im 400er-Ton mit 15 bis
25 % Deckung. Kontrast Text zu Fläche mindestens 4,5:1, Nebentext 3:1.

`--glass-tile-border` ist der Rand von Glas auf Glas: `glass-tile`, `Button` `outline` und
`secondary`, `ToggleChip` in Ruhe – hell eine dunkle Haarlinie (7 %), dunkel die helle
Lichtkante, in Dialogen der Ebenen-Rand. Badges (`secondary`, `outline`, `mono`) nehmen
`border-border dark:border-glass-border` bzw. den passenden Ring. `IconChip`, die Symbole in
`StatCard` und `EmptyState` und `Notice neutral` haben auf Karten noch den weißen Rand
(`glass-border`), der im Hellen verschwindet; in Dialogen greift dort der Ebenen-Rand.

Gemessen (WCAG; Glaskarte hell = 58 % Weiß über dem Grund, Popover deckend; Werte Karte/Popover):

| Paar | Hell | Dunkel |
|---|---|---|
| Weiß auf `primary-fill` / `destructive-fill` | 5,6 / 5,7 | 4,9 / 5,0 |
| Badge `success`, `warning`, `danger`, `info` (Text auf eigener Tönung) | 4,6–4,8 | 5,0–7,5 |
| Badge `accent`, `ToggleChip` gedrückt (hell `text-primary` auf `primary/12`, dunkel Vordergrund auf `primary/25`) | 4,7 / 4,8 | 11,5 |
| Rand des gedrückten `ToggleChip` (`ring-primary`) gegen die Fläche (Ruhe-Haarlinie 1,1) | 5,6 / 5,8 | 4,2 |
| Rahmen der aktiven `StatCard` in `light` … `live` (hell 600/700, dunkel 400) gegen Karte und Grund | 3,4–5,5 | 6,3–10,4 |
| Badge `light`, `music`, `heat`, `water`, `live` (hell 700/800 auf 500/12, dunkel 300 auf 400/15) | 4,7–6,5 | 7,6–9,1 |
| Zahl im aktiven `Segmented`-Segment | 4,6 | 6,7 (vorher 2,0) |

Direkt über dem Indigo-Fleck des Grunds liegt der helle Badge-Kontrast 0,4 bis 0,6 tiefer
(Zustands-Badges dort etwa 4,2:1).

Eine Fläche mit eigenem Schema (Wandmonitor mit eigener Hell/Dunkel-Taste, Kiosk, Ressourcen-Monitor)
setzt `dark scheme-dark` bzw. `light scheme-light` an ihre Wurzel: Der nächste Vorfahr mit `light`
oder `dark` bestimmt alle Tokens darunter, `dark:`-Varianten greifen in einem `light`-Bereich nicht,
`scheme-*` zeichnet Eingabefelder und Bildlaufleisten passend. Dialoge, Menüs und Tooltips liegen
außerhalb dieser Wurzel im `<body>` und bekommen dieselbe Klasse. Eine solche Taste ändert nie das
Schema des Dashboards (kein `setTheme`). Nicht weiter verschachteln (kein `dark` in `light` in `dark`).

## 11. Sprache

- Deutsch, Sätze mit Verb, Du-Form in Hinweisen. Zahlen mit Einheit und schmalem Abstand
  („21,5 °C“, „180 W“), Zeiten „14:32“, relative Zeiten „vor 3 Min“.
- Fehler sagen, was passiert ist und was zu tun ist: „Kasse nicht erreichbar · Technik prüfen“.
- Leere Zustände sind ein Satz, keine Grafik: „Alle Geräte sind zugeordnet.“

## 12. Barrierefreiheit

- Jede Taste hat einen Namen (`aria-label`, wenn nur ein Symbol).
- Tab-Leisten sind `role="tablist"` mit `aria-selected`; Kippkacheln `aria-pressed`.
- Fokus sichtbar (`ring`), Tastaturreihenfolge folgt der Leserichtung. Dialoge und Sheets
  fokussieren beim Öffnen das erste Bedienelement, nie das Schließen-X.
- Farbe trägt nie allein: zusätzlich Text, Symbol oder Form.
- Tippflächen: Auf Touch-Geräten (`pointer: coarse`) haben Tasten, Schalter und `ToggleChip` eine
  unsichtbare Fläche von mindestens 44 × 44 px (`::after` in `globals.css`); sichtbar ändert sich
  nichts. Einträge in Kapseln (Tabs, `Segmented`, `SegmentedLinks`) wachsen nur um den
  Innenabstand der Kapsel (4 px), weil sie dicht stehen (2 px nebeneinander, umbrochen 4 px
  untereinander): 42 px bei 34 px hohen Einträgen, 36 px bei `size="sm"`. `TabsList variant="line"` (ohne Kapsel) bekommt
  keine Fläche. Mit Maus mindestens 24 px – der kleine `Switch` (18 px) hat dafür eine eigene
  Fläche. Eigene `after:`-Klassen am Einsatzort gehen vor. Folgt eine Taste direkt auf eine andere,
  auf einen Link oder ein Feld, beginnt ihre Fläche an der eigenen Kante; folgt ihr ein Link oder
  ein Feld, endet sie dort. So nimmt sie Nachbarn keine Tipps ab. Tasten in eigenen Hüllen oder
  untereinander (auch in umbrochenen Zeilen) brauchen weiter Abstand (bei 32 px hohen Tasten 8 px)
  oder `size="icon"` (36 px). Zeilen mit Schalter untereinander bleiben bei Touch 44 px hoch
  (`min-h-11 sm:pointer-fine:min-h-0` statt `sm:min-h-0`), sonst überlappen ihre Flächen.

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
- **Kopf der Karte** (Liste oder Bereich mit Handlungen): links `CardTitle` mit Anzahl
  („Aktive Tickets (70)“) und höchstens einem Badge, darunter `CardDescription` (höchstens zwei
  Zeilen). Die Primärhandlung („… anlegen“, „Hinzufügen“) steht in `CardAction` oben rechts –
  nicht als eigene Zeile, nicht links unter dem Text. Ab `sm` steht sie neben Titel und
  Beschreibung, auf dem Handy nur neben dem Titel; die Beschreibung läuft dort darunter über die
  volle Breite (das macht `CardHeader` selbst). Ohne Beschreibung stehen Titel und Taste auf jeder
  Breite mittig in einer Zeile, auch das ohne eigene Klassen. Auf dem Handy zeigt die Taste Symbol und ein Wort,
  am liebsten das Hauptwort; der Rest bleibt für Screenreader:
  `<Plus /><span>Ticket<span className="max-sm:sr-only"> erstellen</span></span>` („+ Ticket“).
  Weitere Handlungen (Verlauf, Import, Neu laden) als `outline` in einer Zeile unter dem Kopf, auf
  dem Handy höchstens eine Zeile.
- **Filter unter dem Kopf**: Suche immer sichtbar (`SearchInput`, auf dem Handy volle Breite).
  Bereich oder Zustand mit wenigen Werten als `Segmented`/`SegmentedLinks`. Ein oder zwei
  Auswahlfelder stehen auf dem Handy nebeneinander in zwei gleich breiten Spalten
  (`grid grid-cols-2 gap-2 sm:flex sm:flex-wrap`, Auswahl `w-full sm:w-44`). Ab drei
  Auswahlfeldern oder Schaltern: `FilterBar` – ab `sm` eine umbrechende Zeile, auf dem Handy die
  Taste „Filter“ mit der Zahl aktiver Filter und ein Sheet von unten. Feste Breiten wie
  `w-[180px]` gelten erst ab `sm`.
- **Abschnittsüberschrift** zwischen Karten: `SectionHeading` (11 px Versalien, `text-label`),
  nicht `h2` mit eigener Größe.
- **Seitenleiste**: Glasfläche, folgt Hell/Dunkel. Aktiver Eintrag als getönte Pille in
  Akzentfarbe (kein Balken am Rand). Auf dem Handy als Sheet von links. Oben die Suche
  „Modul suchen“ (Name, Bereich, Stichworte; Enter öffnet den ersten Treffer, Strg/Cmd+K
  springt hinein). Die Gruppe der aktuellen Seite ist immer aufgeklappt. Gruppen und
  Stichworte stehen nur in `src/components/layout/nav-config.ts`: drei bis sechs Einträge je
  Gruppe, ein neues Modul kommt in einen bestehenden Bereich, der Seitentitel heißt wie
  der Menüeintrag.
- **Tab-Leiste unten (Handy)**: schwebende Kapsel (`glass-dock`) mit Abstand zur Home-Leiste,
  aktiver Eintrag als helle Pille. Der Inhalt hat unten genug Luft (`pb` in der Hülle).

## 14. Bausteine

Jede Seite baut aus diesen Teilen. Ein Muster, das hier fehlt, kommt als Baustein in
`src/components/ui/` hinzu, nicht als Einzellösung in einer Seite.

| Baustein | Datei | Wofür |
|---|---|---|
| `Card` (+ Header, Title, Description, Content, Footer, Action) | `ui/card.tsx` | Jede Fläche auf dem Grund. Glas, Radius 24 px, innen 16/18 px. `flush`: Tabelle oder Zeilenliste bis an den unteren Rand (`flush="y"` auch oben, ohne Abstand zwischen den Zeilen). |
| `glass-tile` (Klasse) | `globals.css` | Fläche in einer Karte: Zeile, Kachel, Gruppe. Radius 18 px, Rand `--glass-tile-border`. |
| `StatCard` | `ui/stat-card.tsx` | Kennzahl: Symbol-Chip, Zahl 24 px / 700, Bezug (`suffix`), Balken (`progress`), als Filter mit `onClick`/`active`. Töne wie `IconChip` (auch `light`, `music`, `heat`, `water`, `live`); `variant="tile"` in einer Karte (kein doppelter Weichzeichner); ein Trend blendet den Hinweis aus, `hintWithTrend` zeigt beide; `valueClassName` (z. B. `font-mono`); `children` unten; mit `href`/`onClick` sitzt `className` am Link bzw. an der Taste (Rasterspalten). |
| `Notice` | `ui/notice.tsx` | Hinweis, Warnung, Störung, Erfolg als getönte Kachel mit Chip, Titel, Erklärung, Handlung. `actionAlign="start"` für aufklappbare Hinweise (die Taste springt nicht). |
| `IconChip` | `ui/icon-chip.tsx` | Symbol im Glas-Quadrat vor Zeilen; `active` füllt in der Zustandsfarbe. |
| `Tabs` | `ui/tabs.tsx` | Umschalten zwischen Inhaltsbereichen. Kapsel mit heller Pille. |
| `Segmented` | `ui/segmented.tsx` | Filter, Zeitraum, Ansicht (ohne eigenen Inhaltsbereich). Gleiche Optik wie Tabs. `title` je Option als Tooltip. |
| `SegmentedLinks` | `ui/segmented-links.tsx` | Segmentwahl für Filter in der URL: Links statt Tasten, `<nav>` mit `aria-current="page"`, läuft in Server-Komponenten. Gleiche Optik wie `Segmented`. |
| `Button` | `ui/button.tsx` | `default` Primär (eine je Bereich), `secondary` Glas, `outline` Glas mit Rand, `ghost`, `destructive`, `link`. Symbole bekommen `size-4` (bei `xs` `size-3`), außer sie tragen eine `size-*`-Klasse; `h-*`/`w-*` am Symbol werden überstimmt. |
| `Badge` | `ui/badge.tsx` | Pille für Zustand und Anzahl: `success`, `warning`, `danger`, `info`, `neutral`, `secondary`, `outline`, `mono`; `accent` (weiche Akzent-Tönung für Zähler und Auswahl), Zustandsvokabular `light`, `music`, `heat`, `water`, `live`; `media` über Kamerabildern und Videos. Als Link (`asChild`) unterstreichen getönte Badges beim Darüberfahren. |
| `Input`, `Textarea`, `Select`, `Switch`, `Checkbox`, `Label` | `ui/…` | Formulare. Felder sind `glass-field` (getönt, Radius 14 px). Schalter an = grün (Ja/Nein), Kästchen für Auswahl und Bestätigung (Abschnitt 16). |
| `NativeSelect` | `ui/native-select.tsx` | Natives Auswahlfeld im Feld-Look: lange oder gruppierte Listen, leere Werte, Server-Formulare. Breite, `flex-*` und Rasterspalte an `containerClassName` (dort sitzt der Pfeil), `className` gestaltet nur das Feld. |
| `SearchInput` | `ui/search-input.tsx` | Suchfeld mit Lupe; mit `onClear` eine Taste „Suche leeren“ (danach Fokus im Feld). Breite, `flex-*` und Rasterspalte an `containerClassName`, `className` gestaltet nur das Feld. |
| `FilterBar`, `FilterGroup` | `ui/filter-bar.tsx` | Ab drei Filtern: ab `sm` eine umbrechende Zeile, auf dem Handy Taste „Filter“ (Zahl aktiver Filter) mit Sheet von unten, dort alles untereinander in 44 px. `resetHref`/`onReset` für „Zurücksetzen“. Kinder ohne feste `id` (werden zweimal gerendert). |
| `ToggleChip`, `ToggleChipGroup` | `ui/toggle-chip.tsx` | Mehrfachauswahl als Chips (Wochentage, Filter), `aria-pressed`, gedrückt weich getönt mit Akzent-Rand und halbfetter Schrift. Genau eine Wahl: `Segmented`. |
| `Checklist`, `ChecklistItem` | `ui/checklist.tsx` | Auswahlliste in Dialogen: Kachel mit Haarlinien, die ganze Zeile schaltet das Kästchen. |
| `ConfirmDialog`, `ConfirmStep` | `ui/confirm-dialog.tsx` | Rückfrage vor Löschen und Sperren: eigene Ebene von einer Seite aus, Schritt innerhalb eines Dialogs (Abschnitt 18). |
| `Dialog`, `AlertDialog`, `Sheet` | `ui/…` | Ebene über der Seite: deckend, Radius 24 px, auf dem Handy von unten. `DialogFooter start` stellt z. B. „Löschen“ ab sm links, auf dem Handy nach unten. |
| `DropdownMenu`, `Select`-Liste, `Tooltip` | `ui/…` | Schwebende Ebenen aus dichtem Glas (`glass-surface`). |
| `Table` | `ui/table.tsx` | Tabellen in einer Karte, Haarlinien, Kopf 11 px Versalien. `edge` für Tabellen bis an den Kartenrand (mit `Card flush`), `TableEmpty` für die leere Tabelle (kompakter `EmptyState`); Kürzen in einer Zelle: Zelle `max-w-0 w-full`, Text `truncate`. |
| `EmptyState` | `ui/empty-state.tsx` | Leerer Zustand: ein Satz, kleines Symbol, nächster Schritt. `title`/`description` dürfen Hervorhebungen enthalten; `compact` für Tabellenzellen (`TableEmpty`) und kleine Karten, `size="sm"` für Kacheln und Picker. |
| `StatusDot` | `ui/status-dot.tsx` | Zustandspunkt; `pulse` nur für „lebt gerade“. Töne wie `IconChip` (auch `light`, `music`, `heat`, `water`, `live`). |
| `SectionHeading` | `ui/section-heading.tsx` | Überschrift eines Abschnitts. |

Hilfsklassen aus `globals.css`: `glass-card`, `glass-tile`, `glass-strip`, `glass-pill-active`,
`glass-bar` (klebende Leisten), `glass-surface` (Menüs, Popover), `glass-dock` (Tab-Leiste
unten), `glass-field` (eigene Eingaben), `press` (Antippen 97 %), `page-ambient`, `text-label`.
Als Tailwind-Farben stehen `bg-glass`, `bg-glass-strong`, `bg-glass-tile`, `border-glass-border`,
`border-glass-tile-border` (auch `ring-…`), `bg-field`, `bg-primary-fill` und `bg-destructive-fill`
bereit.

## 15. Farben im Code

- **Erlaubt**: semantische Tokens (`primary`, `success`, `warning`, `info`, `destructive`,
  `muted`, `foreground`, `border`, `glass-…`) und die Zustandstöne aus Abschnitt 3 (`amber`,
  `violet`, `orange`, `sky`, `emerald`) – nur für genau diese Zustände.
- **Nicht erlaubt**: Grautöne aus der Palette (`slate`, `gray`, `zinc`, `neutral`, `stone`),
  andere Paletten-Farben als Dekoration (`indigo`, `blue`, `rose`, `pink`, `teal`, `cyan` …),
  Hex-Werte in TSX, `bg-white`/`bg-black` als Fläche. Ausnahme: Text auf deckender Farbe
  (`text-white` auf `bg-primary-fill` bzw. `bg-destructive-fill`), Video- und Kamerabilder
  (schwarzer Grund), Druckansichten.
- Zustandsfarbe hell/dunkel: Text `text-amber-700 dark:text-amber-300` (Kontrast!), Fläche
  `bg-amber-500/15`, aktive Kachel `bg-gradient-to-br from-amber-400/25 to-amber-400/5` mit Rand
  `border-amber-400/45`. Auf einer Tönung brauchen Bernstein und Orange im Hellen den 800er-Ton.
  500 und 600 nur für Symbole, Punkte und Flächen: als Text erreichen sie schon auf heller
  Glaskarte keine 4,5:1 (Bernstein, Orange, Smaragd, Himmelblau 600: 3,1 bis 3,9:1). Als Pille
  fertig: `Badge variant="light"` usw.
- Diagramme (Recharts): `var(--chart-1)` … `var(--chart-5)` bzw. die Zustandsfarben, Gitter in
  `var(--border)`, Achsentext `var(--muted-foreground)`.

## 16. Formulare

- Beschriftung über dem Feld (`Label`, 13 bis 14 px), Hilfetext darunter in `muted-foreground`.
- Felder 36 px hoch (`h-9`), in Dialogen auf dem Handy 44 px (`h-11`). Mindestens 16 px Schrift
  (iOS zoomt sonst).
- Native Auswahl: `NativeSelect`; Suchfelder: `SearchInput`. Andere eigene `<input>` und
  `<textarea>` bekommen `glass-field` statt eigener Rahmen.
- **Switch oder Checkbox.** Switch: eine Ja/Nein-Eigenschaft oder Einstellung – wirkt sofort in
  Einstellungen und ist das Ja/Nein-Feld in Formularen (wie iOS). Checkbox: Einträge aus einer
  Liste auswählen (Mehrfachauswahl), etwas bestätigen („Ich habe … gelesen“), Optionen einer
  einmaligen Handlung (Drucken, Senden).
- Mehrfachauswahl kurzer Optionen (Wochentage, Filter): `ToggleChip` in einer `ToggleChipGroup`;
  genau eine Wahl: `Segmented`. Auswahl aus einer längeren Liste im Dialog: `Checklist` mit
  `ChecklistItem` – die ganze Zeile ist die Tippfläche, keine Tasten in der Zeile.
- Fehler stehen am Feld (`aria-invalid`, roter Rand) oder als `Notice tone="danger" compact`
  über den Tasten, nie als Browser-Alert.
- Tasten unten rechts: Primärhandlung rechts, „Abbrechen“ als `ghost` oder `outline` links davon.
  Auf dem Handy volle Breite, Primärtaste oben. „Löschen“ in einem Bearbeiten-Dialog steht ab sm
  links (`DialogFooter start`), auf dem Handy zuunterst.

## 17. Listen und Tabellen

- Kurze Listen (bis etwa 12 Einträge, gemischter Inhalt): Zeilen als `glass-tile` oder als
  Zeilen mit Haarlinie in einer Karte, links `IconChip`, rechts Zustand und Handlung.
- Lange Listen und Daten mit Spalten: `Table edge` in einer `Card flush` (Tabelle bis an den Rand;
  Zeilenliste ohne Kopf: `flush="y"`). Leere Tabelle: `TableEmpty` als einzige Zeile.
  Trennlinien in Karten und Tabellen sind `border-border` (im Hellen dunkle Haarlinie), nicht
  `border-glass-border` – das ist die helle Lichtkante der Glasfläche selbst.
  Zeilenhöhe mindestens 44 px auf dem Handy. Gruppenzeilen als `text-label` auf `bg-glass-tile`.
- Tabellen passen auf dem Handy (360 px) ohne seitliches Scrollen: Nebenspalten `max-sm:hidden`,
  ihr Inhalt als Nebenzeile in der ersten Spalte; lange Texte brechen um (`whitespace-normal`,
  Codes und Adressen `break-all`). Der Container scrollt nur als Notnagel, nie die Seite. Fällt
  die letzte Spalte auf dem Handy weg, bekommt die letzte sichtbare `max-sm:pr-4` – den Rand von
  `Table edge` trägt die letzte Zelle im DOM, auch wenn sie versteckt ist.
- Raster für Listen und Kacheln immer mit Spaltenangabe (`grid grid-cols-1 sm:grid-cols-2 …`):
  Ohne sie ist die Spur so breit wie der längste Inhalt, `truncate` greift nicht, und die Seite
  wird breiter als das Handy.
- Auswahl: `bg-primary/10`, Darüberfahren: `bg-glass-tile`.
- **Inaktiv** (Listen und Karten außerhalb der Raum-Kacheln): Text bleibt lesbar – keine
  Deckkraft auf Text, Nebentext mindestens 3:1. Den Zustand sagt ein neutrales Badge („Inaktiv“,
  „Pausiert“) oder der Nebentext „offline seit …“. Gedimmt (Deckkraft 60 %) werden nur Bilder
  und Medien sowie der `IconChip`.

## 18. Ebenen: Dialog, Sheet, Menü

- Höchstens eine Ebene über der Seite. Ein Dialog öffnet keinen zweiten Dialog; dafür gibt es
  Schritte im selben Dialog oder eine eigene Seite.
- Dialoge sind deckend (`bg-popover`), Radius 24 px, Schließen-Taste als runde Glas-Taste. Sie
  bekommt beim Öffnen nie den ersten Fokus (kein Fokusring auf dem X).
  Auf dem Handy kommen sie als Blatt von unten mit Griff.
- Glas in Dialog, AlertDialog und Sheet ist im Hellen leicht getönt statt weiß (`--layer-glass-…`),
  wie gruppierte Zellen in iOS-Sheets. Das passiert automatisch; Kacheln, Kapseln und Glas-Tasten
  brauchen dort keine eigenen Klassen. Felder und Tasten sind darin auf dem Handy 44 px hoch.
- Löschen und Sperren immer mit Rückfrage und `destructive`-Taste: von einer Seite oder Liste aus
  `ConfirmDialog` (Spinner während der Handlung, ein Fehler bleibt als Hinweis im Dialog stehen),
  innerhalb eines Dialogs `ConfirmStep` – roter Hinweis mit der Frage anstelle der Fußzeile, kein
  zweiter Dialog.
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
6. Handy (390 und 360 px): eine Spalte, nichts scrollt seitlich (Seite, Kapseln, Tabellen),
   Tasten 44 px, Primärhandlung oben rechts im Kartenkopf, Filter nach Abschnitt 13.
7. Hell und Dunkel geprüft, Kontrast Text mindestens 4,5:1.
