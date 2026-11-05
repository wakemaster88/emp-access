"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Kästchen für Mehrfachauswahl (docs/design-regeln.md, Abschnitt 16):
 * Glasfeld wie die Eingaben, angehakt in Akzentfarbe. Für Ja/Nein-Optionen,
 * die sofort wirken, ist `Switch` gedacht; das Kästchen wählt Einträge aus
 * („diese drei zuweisen“) oder bestätigt etwas in einem Formular.
 * `checked="indeterminate"` zeigt einen Strich (Teilauswahl).
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative size-[18px] shrink-0 rounded-[6px] border border-foreground/35 bg-field dark:border-white/30 shadow-[inset_0_1px_0_oklch(1_0_0/5%)] outline-none transition-[background-color,border-color,box-shadow]",
        "after:absolute after:-inset-3 after:content-['']",
        "hover:border-foreground/55 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50",
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
