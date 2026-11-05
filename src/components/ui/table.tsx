"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state"

/**
 * Randabstand für Tabellen, die bis an den Kartenrand laufen (`Card flush`):
 * erste und letzte Spalte rücken wie der Karteninhalt ein (16 px, ab sm 18 px).
 * Entspricht den lokalen `TABLE_EDGE`-Konstanten.
 */
const TABLE_EDGE_CLASS =
  "[&>*>tr>*:first-child]:pl-4 sm:[&>*>tr>*:first-child]:pl-[18px] [&>*>tr>*:last-child]:pr-4 sm:[&>*>tr>*:last-child]:pr-[18px]"

/**
 * Tabelle im Leitstand-Stil: gesperrte, kleine Kopfzeile, ruhige Zeilen mit
 * Haarlinien in Glas-Randfarbe, Zahlen bündig. Steht in einer Karte und hat
 * selbst keinen Hintergrund. Der Container scrollt horizontal, damit breite
 * Tabellen auf dem Handy nicht die Seite sprengen (senkrecht schneidet er ab,
 * damit unsichtbare Tippflächen am Rand kein Wackeln auslösen).
 *
 * - `edge`: Tabelle läuft bis an den Kartenrand (`Card flush`); erste und
 *   letzte Spalte bekommen den Randabstand der Karte.
 * - Kürzen in einer Zelle: Text in der Zelle `truncate`, die Zelle selbst
 *   `max-w-0 w-full` (sie nimmt den freien Platz, ohne die Tabelle zu
 *   verbreitern); `whitespace-nowrap` gilt für alle Zellen.
 * - Leere Tabelle: `TableEmpty` als einzige Zeile im `TableBody`.
 */
function Table({
  className,
  edge = false,
  ...props
}: React.ComponentProps<"table"> & { edge?: boolean }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto overflow-y-hidden scrollbar-thin"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", edge && TABLE_EDGE_CLASS, className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-glass-tile border-t border-border font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-glass-tile data-[state=selected]:bg-primary/10 border-b border-border/70 dark:border-white/[0.07] transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-9 px-2 text-left align-middle text-[11px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

/**
 * Leere Tabelle: eine Zeile über alle Spalten (`colSpan`), Text darf
 * umbrechen. Ohne `children` zeigt sie einen kompakten `EmptyState` aus
 * `title`, `description`, `icon` und `action`.
 */
function TableEmpty({
  colSpan,
  children,
  className,
  icon,
  title = "Keine Einträge.",
  description,
  action,
  compact = true,
  size,
}: {
  colSpan: number
  children?: React.ReactNode
  /** Klassen für die Zelle. */
  className?: string
} & Partial<Omit<EmptyStateProps, "className">>) {
  return (
    <TableRow data-slot="table-empty" className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={cn("whitespace-normal", className)}>
        {children ?? (
          <EmptyState
            icon={icon}
            title={title}
            description={description}
            action={action}
            compact={compact}
            size={size}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableEmpty,
}
