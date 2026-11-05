"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Kästchen (docs/design-regeln.md, Abschnitt 16): Glasfeld wie die Eingaben,
 * angehakt deckend in Akzentfarbe (`primary-fill`).
 *
 * Checkbox: Einträge aus einer Liste auswählen (Mehrfachauswahl), etwas
 * bestätigen („Ich habe … gelesen“), Optionen einer einmaligen Handlung
 * (Drucken, Senden). Eine Ja/Nein-Eigenschaft oder Einstellung ist dagegen
 * ein `Switch` – er wirkt sofort in Einstellungen und ist das Ja/Nein-Feld in
 * Formularen (wie iOS). Für ganze auswählbare Zeilen: `ChecklistItem`.
 * `checked="indeterminate"` zeigt einen Strich (Teilauswahl). Der Rand des leeren
 * Kästchens erreicht mindestens 3:1 (hell `foreground/50`, dunkel `white/40`).
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative size-[18px] shrink-0 rounded-[6px] border border-foreground/50 bg-field dark:border-white/40 shadow-[inset_0_1px_0_oklch(1_0_0/5%)] outline-none transition-[background-color,border-color,box-shadow]",
        "after:absolute after:-inset-3 after:content-['']",
        "hover:border-foreground/70 dark:hover:border-white/55 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        // Angehakt und Fehler auch im Dunkeln: `dark:border-white/40` oben stünde sonst im CSS
        // später und legte einen hellen Ring um die Füllung bzw. überdeckte den Fehlerrand.
        "data-[state=checked]:border-primary-fill data-[state=checked]:bg-primary-fill data-[state=checked]:text-primary-foreground dark:data-[state=checked]:border-primary-fill",
        "data-[state=indeterminate]:border-primary-fill data-[state=indeterminate]:bg-primary-fill data-[state=indeterminate]:text-primary-foreground dark:data-[state=indeterminate]:border-primary-fill",
        "aria-invalid:border-destructive dark:aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator flex items-center justify-center text-current"
      >
        {props.checked === "indeterminate" ? (
          <MinusIcon className="size-3.5" strokeWidth={3} />
        ) : (
          <CheckIcon className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
