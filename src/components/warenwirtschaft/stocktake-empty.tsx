"use client";

import { TableEmpty } from "@/components/ui/table";
import { CalendarCheck, ClipboardList } from "lucide-react";

/**
 * Leere Liste der Inventuren. Eigene Client-Komponente, weil `TableEmpty`
 * eine Client-Komponente ist und ein Symbol (Funktion) nicht aus einer
 * Server-Komponente übergeben werden darf.
 */
export function StocktakeEmpty({ cutoff, colSpan }: { cutoff: boolean; colSpan: number }) {
  return (
    <TableEmpty
      colSpan={colSpan}
      icon={cutoff ? CalendarCheck : ClipboardList}
      title={cutoff ? "Noch keine Stichtagsinventur" : "Noch keine Zählung"}
      compact={false}
    />
  );
}
