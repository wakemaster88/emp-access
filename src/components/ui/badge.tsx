import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Weiche Akzent-Tönung: hell `text-primary` auf `primary/12` (4,7:1 auf
 * Glaskarte, 4,8:1 im Dialog), dunkel Vordergrund auf `primary/25` (11,5:1).
 * Gemeinsam für Badge `accent` und gedrückte `ToggleChip`s, damit die
 * gemessenen Werte (docs/design-regeln.md, Abschnitt 10) für beide gelten.
 */
const accentTintClass = "bg-primary/12 text-primary dark:bg-primary/25 dark:text-foreground"

/**
 * Pille mit Status-Varianten (Radius 999 px, docs/design-regeln.md). `success`,
 * `warning`, `danger`, `info` und `neutral` sind weiche Tönungen (Fläche 12 bis
 * 16 %, Text in Vollfarbe) und lösen Hand-Kombinationen wie
 * `bg-emerald-100 text-emerald-700 …` ab. `outline` und `secondary` sind Glas.
 * `mono` ist für Codes, Tokens und IP-Adressen gedacht.
 *
 * - `accent`: weiche Akzent-Tönung für Zähler und Auswahl („3 gewählt“),
 *   statt `bg-primary/10`-Überschreibungen am Einsatzort.
 * - `light`, `music`, `heat`, `water`, `live`: Zustandsvokabular aus
 *   Abschnitt 3 (amber, violet, orange, sky, emerald). Hell Text 700/800 auf
 *   Fläche 500/12, dunkel Text 300 auf 400/15 – Text mindestens 4,5:1 auf
 *   Glaskarte und Popover.
 * - `media`: über Kamerabildern und Videos (dunkle Glaspille, in beiden
 *   Modi gleich).
 *
 * `success` und `danger` hellen ihren Text im Dunkeln auf (70 % Farbe, 30 %
 * Weiß): der Farbschein hinter dem Glas drückt die Vollfarbe sonst unter 4,5:1.
 *
 * Deckende Varianten (`default`, `destructive`) nutzen `primary-fill` bzw.
 * `destructive-fill`, damit weiße Schrift auch im Dunkeln 4,5:1 erreicht.
 * Getönte Varianten als Link (`asChild`) unterstreichen beim Darüberfahren,
 * statt die Tönung zu verdichten – sonst fiele der Text unter 4,5:1.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-semibold leading-4 w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary-fill text-primary-foreground [a&]:hover:bg-primary-fill/90",
        secondary:
          "bg-glass-tile text-foreground ring-1 ring-inset ring-border dark:ring-glass-border [a&]:hover:bg-glass-strong",
        destructive:
          "bg-destructive-fill text-white [a&]:hover:bg-destructive-fill/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border-border text-foreground dark:border-glass-border [a&]:hover:bg-glass-tile",
        ghost: "[a&]:hover:bg-glass-tile",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        success: "bg-success/12 text-success dark:bg-success/16 dark:text-[color:color-mix(in_oklch,var(--success)_70%,white)] underline-offset-2 [a&]:hover:underline",
        warning: "bg-warning/14 text-warning dark:bg-warning/16 underline-offset-2 [a&]:hover:underline",
        danger: "bg-destructive/12 text-destructive dark:bg-destructive/16 dark:text-[color:color-mix(in_oklch,var(--destructive)_70%,white)] underline-offset-2 [a&]:hover:underline",
        info: "bg-info/12 text-info dark:bg-info/16 underline-offset-2 [a&]:hover:underline",
        neutral: "bg-foreground/[0.06] text-muted-foreground dark:bg-white/[0.08] [a&]:hover:bg-foreground/10",
        mono: "rounded-md border-border bg-glass-tile dark:border-glass-border font-mono text-[11px] font-medium tracking-tight text-foreground/80",
        accent: `${accentTintClass} underline-offset-2 [a&]:hover:underline`,
        light: "bg-amber-500/12 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300 underline-offset-2 [a&]:hover:underline",
        music: "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300 underline-offset-2 [a&]:hover:underline",
        heat: "bg-orange-500/12 text-orange-800 dark:bg-orange-400/15 dark:text-orange-300 underline-offset-2 [a&]:hover:underline",
        water: "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300 underline-offset-2 [a&]:hover:underline",
        live: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300 underline-offset-2 [a&]:hover:underline",
        media: "bg-black/60 text-white backdrop-blur-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, accentTintClass }
