"use client"

import * as React from "react"
import Link from "next/link"
import { SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { segmentedCountClass } from "@/components/ui/segmented-styles"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/**
 * Filterleiste (docs/design-regeln.md, Abschnitt 13): ab `sm` stehen die
 * Filter in einer umbrechenden Zeile. Auf dem Handy liegen sie hinter der
 * Taste „Filter“ (mit der Zahl aktiver Filter) in einem Sheet von unten, dort
 * untereinander in voller Breite (Auswahlfelder und Tasten 44 px).
 *
 * Für drei und mehr Filter. Ein oder zwei Filter stehen auf dem Handy direkt
 * in zwei Spalten (`grid grid-cols-2 gap-2 sm:flex`), Suchfelder immer
 * sichtbar außerhalb der Leiste.
 *
 * Die Kinder werden für Desktop und Sheet getrennt gerendert: Filter ohne
 * feste `id` bauen (Radix-Auswahl vergibt eigene). `activeCount` zählt die
 * Filter, die vom Standard abweichen; mit `resetHref` oder `onReset` gibt es
 * im Sheet „Zurücksetzen“.
 */
function FilterBar({
  children,
  activeCount = 0,
  resetHref,
  onReset,
  title = "Filter",
  description,
  className,
  triggerClassName,
}: {
  children: React.ReactNode
  activeCount?: number
  resetHref?: string
  onReset?: () => void
  title?: string
  description?: React.ReactNode
  /** Klassen der Zeile ab `sm`. */
  className?: string
  /** Klassen der Taste „Filter“ auf dem Handy (z. B. Breite). */
  triggerClassName?: string
}) {
  const canReset = activeCount > 0 && (resetHref !== undefined || onReset !== undefined)
  return (
    <>
      <div data-slot="filter-bar" className={cn("hidden flex-wrap items-center gap-2 sm:flex", className)}>
        {children}
      </div>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            data-slot="filter-bar-trigger"
            className={cn("sm:hidden", triggerClassName)}
            aria-label={activeCount > 0 ? `${title}, ${activeCount} aktiv` : title}
          >
            <SlidersHorizontal />
            {title}
            {activeCount > 0 && (
              <span aria-hidden className={segmentedCountClass(true)}>
                {activeCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 sm:hidden">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description ? (
              <SheetDescription>{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Änderungen gelten sofort.</SheetDescription>
            )}
          </SheetHeader>
          <div
            data-slot="filter-bar-sheet"
            className={cn(
              "flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-2",
              // Eigene Zeilen der Filter lösen sich auf: alles untereinander, volle Breite, 44 px.
              "[&_[data-slot=filter-group]]:flex-col [&_[data-slot=filter-group]]:items-stretch",
              "[&_[data-slot=select-trigger]]:h-11 [&_[data-slot=select-trigger]]:w-full",
              "[&_[data-slot=button]]:h-11 [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start",
            )}
          >
            {children}
          </div>
          <SheetFooter className="flex-row gap-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {canReset &&
              (resetHref !== undefined ? (
                <Button asChild variant="ghost" className="h-11 flex-1">
                  <Link href={resetHref} onClick={onReset}>
                    Zurücksetzen
                  </Link>
                </Button>
              ) : (
                <Button variant="ghost" className="h-11 flex-1" onClick={onReset}>
                  Zurücksetzen
                </Button>
              ))}
            <SheetClose asChild>
              <Button className="h-11 flex-1">Fertig</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * Gruppe innerhalb einer `FilterBar` (z. B. eine Komponente mit mehreren
 * Auswahlfeldern): ab `sm` in einer Zeile, im Sheet untereinander.
 */
function FilterGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="filter-group" className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
}

export { FilterBar, FilterGroup }
