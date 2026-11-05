"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import type { LockOption } from "@/components/schliessanlage/types";
import { cn } from "@/lib/utils";

/** Mehrfachauswahl von Schloessern mit Suche – Basis der n:m-Zuordnung. */
export function LockPicker({
  options,
  value,
  onChange,
}: {
  options: LockOption[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

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
            placeholder="Raum, Tür oder Schließung suchen…"
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

      <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            compact
            title={options.length === 0 ? "Noch keine Schlösser angelegt." : "Keine Treffer."}
            className="py-4"
          />
        ) : (
          filtered.map((o) => {
            const selected = value.includes(o.id);
            return (
              // Ganze Zeile ist Beschriftung des Kästchens und damit die Tippfläche; das Kästchen
              // selbst nimmt keine Zeiger an (kein doppeltes Umschalten, keine überlappende Tippfläche).
              <label
                key={o.id}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors max-sm:min-h-11",
                  selected
                    ? "bg-primary/10"
                    : "hover:bg-glass-tile",
                )}
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => toggle(o.id)}
                  className="pointer-events-none"
                />
                {/* Umbrechen statt kürzen: Tür- und Schließungsnummer stehen am Ende und unterscheiden sonst gleich beginnende Zeilen. */}
                <span className="min-w-0 break-words text-xs text-foreground">{o.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
