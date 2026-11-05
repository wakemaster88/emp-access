import * as React from "react"

import { cn } from "@/lib/utils"
import { accentTintClass } from "@/components/ui/badge"

/**
 * Umschalt-Chip für Mehrfachauswahl (docs/design-regeln.md, Abschnitt 16):
 * Wochentage, Filter, Kanäle. Jeder Chip schaltet für sich (`aria-pressed`);
 * eine ausschließliche Wahl (genau eins) ist `Segmented`.
 *
 * Ruhe: Glas mit Haarlinie, Text gedämpft. Gedrückt: weiche Akzent-Tönung wie
 * Badge `accent` – hell `text-primary` auf `primary/12` (4,7:1 auf Glaskarte,
 * 4,8:1 im Dialog), dunkel Vordergrund auf `primary/25` (über 11:1) – mit
 * halbfetter Schrift und vollem Rand in Akzentfarbe (gegen die Karte hell
 * 5,6:1, dunkel 4,2:1; die Ruhe-Haarlinie nur 1,1:1). So ist der Zustand nicht
 * nur am Farbton erkennbar (Abschnitt 12). Keine deckende Füllung: mehrere
 * gedrückte Chips sollen ruhig bleiben.
 * Größen 36 px (`default`) und 32 px (`sm`); auf Touch-Geräten gilt die
 * unsichtbare 44-px-Tippfläche aus globals.css.
 */
function ToggleChip({
  className,
  pressed = false,
  onPressedChange,
  size = "default",
  onClick,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-pressed"> & {
  pressed?: boolean
  onPressedChange?: (pressed: boolean) => void
  size?: "default" | "sm"
}) {
  return (
    <button
      type="button"
      data-slot="toggle-chip"
      data-size={size}
      data-state={pressed ? "on" : "off"}
      aria-pressed={pressed}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onPressedChange?.(!pressed)
      }}
      className={cn(
        "press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap ring-1 ring-inset outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-[13px]",
        pressed
          ? `${accentTintClass} font-semibold ring-primary`
          : "bg-glass-tile text-muted-foreground shadow-[inset_0_1px_0_var(--glass-highlight)] ring-glass-tile-border hover:bg-glass-strong hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * Gruppe von Umschalt-Chips: `role="group"` mit Namen (`aria-label` oder
 * `aria-labelledby` auf das sichtbare Label), umbrechend mit 8 px Abstand.
 */
function ToggleChipGroup({
  className,
  ...props
}: React.ComponentProps<"div"> & ({ "aria-label": string } | { "aria-labelledby": string })) {
  return (
    <div
      role="group"
      data-slot="toggle-chip-group"
      className={cn("flex flex-wrap gap-2", className)}
      {...props}
    />
  )
}

export { ToggleChip, ToggleChipGroup }
