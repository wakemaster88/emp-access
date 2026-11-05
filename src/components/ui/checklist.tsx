import * as React from "react"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * Auswahlliste für Picker in Dialogen (docs/design-regeln.md, Abschnitt 16):
 * eine Glas-Kachel mit Zeilen, getrennt durch Haarlinien. Jede Zeile ist ein
 * `ChecklistItem`. Mit `maxHeight` scrollt die Liste innerhalb der Kachel.
 * Braucht einen Namen (`aria-label` oder `aria-labelledby`), den der
 * Screenreader für die Gruppe ansagt. Suche, Zähler („3 gewählt“) und leere
 * Zustände stehen außerhalb bzw. als `EmptyState size="sm"` darin.
 */
function Checklist({
  className,
  maxHeight,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Höchste Höhe der Liste, z. B. `"16rem"` oder `256` (px); darüber scrollt sie. */
  maxHeight?: number | string
} & ({ "aria-label": string } | { "aria-labelledby": string })) {
  return (
    <div role="group" data-slot="checklist" className={cn("glass-tile overflow-hidden", className)} {...props}>
      <div
        data-slot="checklist-rows"
        // `relative`: In einem <form> legt Radix neben jedes Kästchen ein verstecktes,
        // absolut positioniertes Feld. Ohne eigenen Bezugsrahmen entkäme es der
        // scrollenden Liste und verlängerte den Dialog um leeren Platz.
        className={cn("relative divide-y divide-border", maxHeight !== undefined && "scrollbar-thin overflow-y-auto overscroll-contain")}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Eine auswählbare Zeile: die ganze Zeile ist das `<label>` des Kästchens und
 * damit die Tippfläche. Das Kästchen selbst nimmt keine Zeiger an – ein Klick
 * schaltet genau einmal um; es bleibt per Tab erreichbar und die Leertaste
 * schaltet. Keine Tasten oder Links in die Zeile legen (`trailing` ist nur
 * Anzeige, z. B. ein Badge).
 *
 * - `title`: die Bezeichnung; `description`: zweite Zeile, gedämpft.
 * - `meta`: kurze gedämpfte Angabe rechts (Anzahl, Ort, Zeit).
 * - Gewählte Zeilen sind leicht in Akzentfarbe getönt. Auf Touch-Geräten
 *   ist jede Zeile mindestens 44 px hoch.
 */
function ChecklistItem({
  className,
  checked,
  onCheckedChange,
  title,
  description,
  meta,
  trailing,
  disabled = false,
  ...props
}: Omit<React.ComponentProps<"label">, "title" | "children"> & {
  checked: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label
      data-slot="checklist-item"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors pointer-coarse:min-h-11",
        checked === true ? "bg-primary/10" : "hover:bg-glass-tile",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent",
        className
      )}
      {...props}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange?.(value === true)}
        // Gesperrt dimmt schon die Zeile; das Kästchen nicht doppelt abschwächen.
        className={cn("pointer-events-none", disabled && "disabled:opacity-100")}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] break-words text-foreground">{title}</span>
        {description != null && description !== false && (
          <span className="block text-xs break-words text-muted-foreground">{description}</span>
        )}
      </span>
      {meta != null && meta !== false && (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{meta}</span>
      )}
      {trailing != null && trailing !== false && (
        <span data-slot="checklist-item-trailing" className="flex shrink-0 items-center gap-1.5">
          {trailing}
        </span>
      )}
    </label>
  )
}

export { Checklist, ChecklistItem }
