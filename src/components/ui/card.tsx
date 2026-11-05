import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Karte: die Grundfläche des Dashboards, eine Glasfläche (`glass-card`) über
 * dem Farbgrund – Radius 24 px, Lichtkante oben, weicher Schatten. Innen
 * 16 px Abstand oben/unten, 18 px seitlich (docs/design-regeln.md, Abschnitt 5).
 * Am Einsatzort keine eigenen Rahmen-, Schatten- oder Hintergrundfarben.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "glass-card text-card-foreground flex flex-col gap-4 py-4 sm:py-[18px]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-4 sm:px-[18px] has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-4 [.border-b]:border-border",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-sm leading-tight font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-[13px] leading-snug", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 sm:px-[18px]", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-4 sm:px-[18px] [.border-t]:pt-4 [.border-t]:border-border", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
