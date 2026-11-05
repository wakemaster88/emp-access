"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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
    // Auswahlliste im Dialog: Glas-Kachel (in Ebenen automatisch getönt), gewählte Zeilen in Akzent-Tönung.
    <div className="glass-tile space-y-1.5 p-1.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="pl-8 max-sm:h-11"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{value.length} gewählt</span>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChange([])}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive max-sm:h-11"
          >
            Leeren
          </Button>
        )}
      </div>

      <div className="scrollbar-thin max-h-64 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState compact title={items.length === 0 ? emptyText : "Keine Treffer."} className="py-4" />
        ) : (
          filtered.map((item) => {
            const selected = value.includes(item.id);
            return (
              // Ganze Zeile ist Beschriftung des Kästchens und damit die Tippfläche; das Kästchen
              // selbst nimmt keine Zeiger an (kein doppeltes Umschalten, keine überlappende Tippfläche).
              <label
                key={item.id}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors max-sm:min-h-11",
                  selected
                    ? "bg-primary/10"
                    : "hover:bg-glass-tile",
                )}
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => toggle(item.id)}
                  className="pointer-events-none"
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xs text-foreground">
                    {item.label}
                  </span>
                  <span className="block break-words text-[11px] text-muted-foreground">
                    {item.meta}
                    {item.takenBy && (
                      // Nicht gewählt: Hinweis in Nebentextfarbe (Kontrast); Warnfarbe nur für das Verschieben.
                      <span className={selected ? "text-warning" : undefined}>
                        {item.meta ? " · " : ""}
                        {selected ? `wird aus ${item.takenBy} hierher verschoben` : `in ${item.takenBy}`}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })
        )}
        {hiddenTaken > 0 && !showTaken && (
          <button
            type="button"
            onClick={() => setShowTaken(true)}
            className="w-full rounded-[10px] px-2 py-1.5 text-left text-[11px] text-primary transition-colors hover:bg-glass-tile max-sm:min-h-11"
          >
            + {hiddenTaken} aus anderen Räumen zeigen
          </button>
        )}
      </div>
    </div>
  );
}
