import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Pille mit Status-Varianten (Radius 999 px, docs/design-regeln.md). `success`,
 * `warning`, `danger`, `info` und `neutral` sind weiche Tönungen (Fläche 12 bis
 * 16 %, Text in Vollfarbe) und lösen Hand-Kombinationen wie
 * `bg-emerald-100 text-emerald-700 …` ab. `outline` und `secondary` sind Glas.
 * `mono` ist für Codes, Tokens und IP-Adressen gedacht.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-semibold leading-4 w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-glass-tile text-foreground ring-1 ring-inset ring-border dark:ring-glass-border [a&]:hover:bg-glass-strong",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border text-foreground dark:border-glass-border [a&]:hover:bg-glass-tile",
        ghost: "[a&]:hover:bg-glass-tile",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        success: "bg-success/12 text-success dark:bg-success/16 [a&]:hover:bg-success/20",
        warning: "bg-warning/14 text-warning dark:bg-warning/16 [a&]:hover:bg-warning/22",
        danger: "bg-destructive/12 text-destructive dark:bg-destructive/16 [a&]:hover:bg-destructive/20",
        info: "bg-info/12 text-info dark:bg-info/16 [a&]:hover:bg-info/20",
        neutral: "bg-foreground/[0.06] text-muted-foreground dark:bg-white/[0.08] [a&]:hover:bg-foreground/10",
        mono: "rounded-md border-border bg-glass-tile dark:border-glass-border font-mono text-[11px] font-medium tracking-tight text-foreground/80",
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

export { Badge, badgeVariants }
