import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Badge mit Status-Varianten. `success`, `warning`, `danger`, `info` und
 * `neutral` sind weiche Tönungen (Fläche 12 %, Text in Vollfarbe) und lösen
 * die früheren Hand-Kombinationen wie `bg-emerald-100 text-emerald-700 …` ab.
 * `mono` ist für Codes, Tokens und IP-Adressen gedacht.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        success: "bg-success/12 text-success dark:bg-success/15 [a&]:hover:bg-success/20",
        warning: "bg-warning/14 text-warning dark:bg-warning/15 [a&]:hover:bg-warning/22",
        danger: "bg-destructive/12 text-destructive dark:bg-destructive/15 [a&]:hover:bg-destructive/20",
        info: "bg-info/12 text-info dark:bg-info/15 [a&]:hover:bg-info/20",
        neutral: "bg-muted text-muted-foreground [a&]:hover:bg-muted/80",
        mono: "rounded-md border-border bg-muted/60 font-mono text-[11px] tracking-tight text-foreground/80",
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
