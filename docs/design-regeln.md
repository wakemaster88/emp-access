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

- Kennzahlen als Kachel mit Zahl (20 px / 700), Bezug („von 11“) und dünnem Balken.
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
