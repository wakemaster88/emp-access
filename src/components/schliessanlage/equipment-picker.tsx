"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EquipmentItem {
  id: number;
  label: string;
  /** Zweite Zeile: Typ/Kategorie bzw. Modell. */
  meta: string | null;
  /** Gesetzt, wenn das Gerät aktuell in einem anderen Raum hängt. */
  takenBy: string | null;
}

/**
 * Mehrfachauswahl von Geraeten oder Kameras. Ein Geraet haengt nur in einem
 * Raum – bereits woanders zugeordnete Eintraege bleiben waehlbar, werden aber
 * mit ihrem aktuellen Raum markiert, damit das Umhaengen bewusst passiert.
 */
export function EquipmentPicker({
  items,
  value,
  onChange,
  placeholder,
  emptyText,
}: {
  items: EquipmentItem[];
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const [showTaken, setShowTaken] = useState(false);
  // Reihenfolge beim Oeffnen: Gewaehltes oben, dann Freies, dann Eintraege aus
  // anderen Raeumen. Fest beim Oeffnen, damit nichts unter dem Finger springt.
  const [initial] = useState(() => new Set(value));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (i: EquipmentItem) => (initial.has(i.id) ? 0 : i.takenBy ? 2 : 1);
    const sorted = [...items].sort((a, b) => rank(a) - rank(b));
    if (q) {
      return sorted.filter(
        (i) => i.label.toLowerCase().includes(q) || (i.meta ?? "").toLowerCase().includes(q),
      );
    }
    return showTaken ? sorted : sorted.filter((i) => !i.takenBy || value.includes(i.id) || initial.has(i.id));
  }, [items, query, showTaken, initial, value]);
  const hiddenTaken = query.trim()
    ? 0
    : items.filter((i) => i.takenBy && !value.includes(i.id) && !initial.has(i.id)).length;

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border p-1.5 dark:border-border">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded border border-border bg-white py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring dark:border-border dark:bg-muted"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground/70">{value.length} gewählt</span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 text-[11px] text-muted-foreground/70 hover:text-destructive"
          >
            Leeren
          </button>
        )}
      </div>

      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted-foreground/70">
            {items.length === 0 ? emptyText : "Keine Treffer."}
          </p>
        ) : (
          filtered.map((item) => {
            const selected = value.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-primary/8"
                    : "hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    selected ? "border-primary bg-primary" : "border-input",
                  )}
                >
                  {selected && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xs text-foreground/80">
                    {item.label}
                  </span>
                  <span className="block break-words text-[10px] text-muted-foreground/70">
                    {item.meta}
                    {item.takenBy && (
                      <span className={selected ? "text-warning" : "text-warning/80"}>
                        {item.meta ? " · " : ""}
                        {selected ? `wird aus ${item.takenBy} hierher verschoben` : `in ${item.takenBy}`}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })
        )}
        {hiddenTaken > 0 && !showTaken && (
          <button
            type="button"
            onClick={() => setShowTaken(true)}
            className="w-full rounded px-2 py-1.5 text-left text-[11px] text-primary hover:bg-muted/50"
          >
            + {hiddenTaken} aus anderen Räumen zeigen
          </button>
        )}
      </div>
    </div>
  );
}
