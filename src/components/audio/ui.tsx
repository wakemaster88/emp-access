"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Kopfzeile eines Tabs: Erklärung links, Anlegen-Taste oben rechts – auf dem
 * Handy wie am Desktop (docs/design-regeln.md, Abschnitt 13 „Kopf der Karte“).
 *
 * Früher stand die Taste am Telefon als eigene Zeile in voller Breite unter
 * dem Text. Jetzt bleibt sie rechts oben und wird nicht gequetscht
 * (`shrink-0`); auf dem Handy zeigt sie nur Symbol plus ein Wort
 * (`actionShort`), ab `sm` den vollen Text. Der Name der Taste ist immer der
 * volle Text, 44 px hoch bleibt sie für den Daumen.
 */
export function SectionHeader({
  text,
  actionLabel,
  actionShort,
  onAction,
}: {
  text: string;
  actionLabel: string;
  /** Kurzform auf dem Handy, ein Wort aus `actionLabel` (z. B. „Zone“ für „Neue Zone“). */
  actionShort: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 sm:items-center">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{text}</p>
      <Button onClick={onAction} aria-label={actionLabel} className="shrink-0 gap-1.5 max-sm:h-11">
        <Plus className="h-4 w-4" />
        <span className="sm:hidden">{actionShort}</span>
        <span className="max-sm:hidden">{actionLabel}</span>
      </Button>
    </div>
  );
}

/**
 * Auswahlknopf für Zonen, Filter und Arten.
 *
 * Lag fünfmal in fast gleicher Form im Modul verstreut – jede Anpassung wurde
 * dadurch an mindestens einer Stelle vergessen. Am Telefon ist der Knopf
 * fingergerecht hoch und wird erst am Zeigergerät kompakt: Zonen-Chips
 * entscheiden, wo eine Durchsage landet, ein Fehlgriff beschallt den falschen
 * Bereich.
 *
 * Für Mehrfachauswahl (Zonen, Wochentage) gibt es `ToggleChip` aus
 * ui/toggle-chip.tsx; dieser Knopf bleibt für Einfachauswahl.
 */
export function Chip({
  active,
  onClick,
  children,
  className,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "press inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-8 sm:px-3 sm:text-xs",
        // Aus: Glas-Kapsel wie Badge `secondary` – im Hellen mit dunkler Haarlinie (auf weißen
        // Glaskarten sichtbar), im Dialog tönt sich das Glas von selbst (Abschnitt 18).
        // An: deckend in `primary-fill`, damit die Schrift auch im Dunkeln 4,5:1 erreicht (Abschnitt 3);
        // der Rand in derselben Farbe, sonst läge im Dunkeln ein hellerer Ring um die Fläche.
        active
          ? "border-primary-fill bg-primary-fill text-primary-foreground"
          : "border-border bg-glass-tile text-muted-foreground shadow-[inset_0_1px_0_var(--glass-highlight)] hover:bg-glass-strong hover:text-foreground dark:border-glass-border",
        className
      )}
    >
      {children}
    </button>
  );
}

/**
 * Stand für die Fülllinie eines `.touch-slider`.
 *
 * Der selbst gezeichnete Regler kennt seinen Wert im Stylesheet nicht; ohne
 * diese Variable bliebe die Schiene einfarbig und man müsste für jede Zone die
 * Prozentzahl lesen statt einmal hinzusehen.
 */
export function sliderFill(value: number): React.CSSProperties {
  return { "--slider-fill": `${value}%` } as React.CSSProperties;
}

/**
 * Textfeld für Ansagetexte.
 *
 * `text-base` bis `md:` ist kein Geschmack, sondern Pflicht: unter 16 px zoomt
 * Safari beim Antippen die ganze Seite heran, und danach bedient man den Rest
 * der Oberfläche verschoben weiter. Der Input-Baustein macht es genauso.
 */
export const TEXTAREA_CLASS =
  "glass-field w-full px-3 py-2 text-base outline-none transition-[color,box-shadow,border-color,background-color] placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:border-ring focus-visible:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/30 md:text-sm";
