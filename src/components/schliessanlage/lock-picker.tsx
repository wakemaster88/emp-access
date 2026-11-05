"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import type { LockOption } from "@/components/schliessanlage/types";

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
    // Suche und Zähler über der Auswahlliste; die Liste ist eine Checklist (Kachel mit Haarlinien,
    // in Ebenen automatisch getönt, die ganze Zeile schaltet das Kästchen).
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Raum, Tür oder Schließung suchen…"
          containerClassName="flex-1"
          className="max-sm:h-11"
        />
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

      <Checklist aria-label="Schließt folgende Schlösser" maxHeight="14rem">
        {filtered.length === 0 ? (
          <EmptyState
            size="sm"
            title={options.length === 0 ? "Noch keine Schlösser angelegt." : "Keine Treffer."}
          />
        ) : (
          filtered.map((o) => (
            // Umbrechen statt kürzen: Tür- und Schließungsnummer stehen am Ende und unterscheiden sonst gleich beginnende Zeilen.
            <ChecklistItem
              key={o.id}
              checked={value.includes(o.id)}
              onCheckedChange={() => toggle(o.id)}
              title={o.label}
            />
          ))
        )}
      </Checklist>
    </div>
  );
}
