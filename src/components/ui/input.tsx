import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Fokus und Fehlerzustand der Felder – gemeinsam für `Input` und
 * `NativeSelect`, damit beide gleich bleiben.
 */
const inputFocusClass =
  "focus-visible:border-ring focus-visible:bg-glass-strong focus-visible:ring-ring/30 focus-visible:ring-[3px]"
const inputInvalidClass =
  "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive"

/**
 * Eingabefeld: getönte Glas-Füllung (`glass-field`), Radius 14 px, beim Fokus
 * Rand und Ring in Akzentfarbe. Auf iOS mindestens 16 px Schrift (kein Zoom).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "glass-field file:text-foreground placeholder:text-muted-foreground selection:bg-primary-fill selection:text-primary-foreground h-9 w-full min-w-0 px-3 py-1 text-base transition-[color,box-shadow,border-color,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:border-foreground/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        inputFocusClass,
        inputInvalidClass,
        className
      )}
      {...props}
    />
  )
}

export { Input, inputFocusClass, inputInvalidClass }
