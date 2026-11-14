import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Taste im schlichten Stil (docs/design-regeln.md, Abschnitte 2 und 14):
 *
 * - `default`: Primärtaste, deckend in Akzentfarbe, flach.
 *   Eine je Bereich – die Handlung, die am häufigsten gebraucht wird.
 * - `secondary`: graue Fläche ohne Rand. Für gleichrangige Nebenhandlungen
 *   und Tasten in Kacheln.
 * - `outline`: Kartenfläche mit Haarlinie – Filter, Werkzeugleisten.
 * - `ghost`: nur Text und Symbol, Fläche erst beim Darüberfahren.
 * - `destructive`: Löschen, Sperren. Immer mit Rückfrage.
 *
 * Radius 10 px (`rounded-control`), Antippen skaliert auf 97 % (`press`).
 * Deckende Tasten nutzen `primary-fill`/`destructive-fill` (Weiß darauf
 * mindestens 4,5:1). `outline` trägt die Haarlinie `glass-tile-border` (ein
 * Token statt `dark:`-Klasse – so bleibt ein eigener Rand am Einsatzort in
 * beiden Modi).
 *
 * Symbole bekommen `size-4` (bei `xs` `size-3`), außer sie tragen selbst eine
 * `size-*`-Klasse. `h-*`/`w-*` am Symbol werden überstimmt – für andere
 * Größen also `size-3.5` statt `h-3.5 w-3.5` schreiben.
 */
const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary-fill text-primary-foreground shadow-[0_1px_2px_oklch(0_0_0/12%)] hover:bg-primary-fill/90",
        destructive:
          "bg-destructive-fill text-white shadow-[0_1px_2px_oklch(0_0_0/12%)] hover:bg-destructive-fill/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-glass-tile-border bg-glass text-foreground shadow-[var(--glass-shadow)] hover:bg-accent dark:hover:bg-glass-strong",
        secondary:
          "bg-glass-strong text-foreground hover:bg-foreground/10",
        ghost:
          "text-foreground hover:bg-glass-tile",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
