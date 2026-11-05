import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { inputFocusClass, inputInvalidClass } from "@/components/ui/input"

/**
 * Natives Auswahlfeld im Glas-Look (docs/design-regeln.md, Abschnitt 16):
 * sieht aus wie `Input` (36 px hoch, Radius 14 px, `glass-field`), Pfeil
 * rechts. Für lange oder gruppierte Listen (`optgroup`), leere Werte
 * („— keiner —“) und Server-Formulare ohne Client-Zustand; das Handy zeigt
 * seine eigene Auswahlliste. Für kurze Listen mit eigener Darstellung `Select`.
 *
 * `children` sind `option`/`optgroup`. `className` geht an das `<select>`,
 * `containerClassName` an den Rahmen (Breite, Rasterspalte). Standard ist
 * volle Breite. In Dialogen und Sheets auf dem Handy 44 px hoch (globals.css).
 * Das Feld braucht einen Namen: `Label` mit `htmlFor`/`id` oder `aria-label`.
 */
function NativeSelect({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { containerClassName?: string }) {
  return (
    <div data-slot="native-select" className={cn("relative w-full min-w-0", containerClassName)}>
      <select
        className={cn(
          "peer glass-field h-9 w-full min-w-0 appearance-none py-1 pr-9 pl-3 text-base text-foreground transition-[color,box-shadow,border-color,background-color] outline-none hover:border-foreground/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          inputFocusClass,
          inputInvalidClass,
          // Die aufgeklappte Liste deckend auf der Popover-Fläche (sonst Glas auf Systemgrau).
          "[&_optgroup]:bg-popover [&_option]:bg-popover [&_option]:text-popover-foreground",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {/* z-10: sonst malt die Glasfläche des Feldes über den Pfeil. */}
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 z-10 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </div>
  )
}

export { NativeSelect }
