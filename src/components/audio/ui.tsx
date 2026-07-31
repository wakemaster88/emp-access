"use client";

import { cn } from "@/lib/utils";

/**
 * Auswahlknopf für Zonen, Filter und Arten.
 *
 * Lag fünfmal in fast gleicher Form im Modul verstreut – jede Anpassung wurde
 * dadurch an mindestens einer Stelle vergessen. Am Telefon ist der Knopf
 * fingergerecht hoch und wird erst am Zeigergerät kompakt: Zonen-Chips
 * entscheiden, wo eine Durchsage landet, ein Fehlgriff beschallt den falschen
 * Bereich.
 */
export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors sm:min-h-8 sm:px-3 sm:text-xs",
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
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
  "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:text-sm dark:border-slate-700";
