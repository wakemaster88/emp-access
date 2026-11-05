"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";

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
    // Suche und Zähler über der Auswahlliste; die Liste ist eine Checklist (Kachel mit Haarlinien,
    // in Ebenen automatisch getönt, gewählte Zeilen in Akzent-Tönung, die ganze Zeile schaltet).
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
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

      {/* Name der Gruppe für Screenreader: der Suchhinweis des Pickers (die sichtbare Beschriftung steht beim Aufrufer). */}
      <Checklist aria-label={placeholder} maxHeight="16rem">
        {filtered.length === 0 ? (
          <EmptyState size="sm" title={items.length === 0 ? emptyText : "Keine Treffer."} />
        ) : (
          filtered.map((item) => {
            const selected = value.includes(item.id);
            return (
              <ChecklistItem
                key={item.id}
                checked={selected}
                onCheckedChange={() => toggle(item.id)}
                title={item.label}
                description={
                  item.meta || item.takenBy ? (
                    <>
                      {item.meta}
                      {item.takenBy && (
                        // Nicht gewählt: Hinweis in Nebentextfarbe (Kontrast); Warnfarbe nur für das Verschieben.
                        <span className={selected ? "text-warning" : undefined}>
                          {item.meta ? " · " : ""}
                          {selected ? `wird aus ${item.takenBy} hierher verschoben` : `in ${item.takenBy}`}
                        </span>
                      )}
                    </>
                  ) : null
                }
              />
            );
          })
        )}
        {/* Letzte Zeile der Liste, Innenabstand wie die Einträge. */}
        {hiddenTaken > 0 && !showTaken && (
          <button
            type="button"
            onClick={() => setShowTaken(true)}
            className="w-full px-3 py-2 text-left text-[11px] text-primary transition-colors hover:bg-glass-tile max-sm:min-h-11"
          >
            + {hiddenTaken} aus anderen Räumen zeigen
          </button>
        )}
      </Checklist>
    </div>
  );
}
