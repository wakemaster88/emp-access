"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
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
    <div className="space-y-1.5 rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Raum, Tür oder Schließung suchen…"
            className="w-full rounded border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{value.length} gewählt</span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 text-[11px] text-slate-400 hover:text-rose-500"
          >
            Leeren
          </button>
        )}
      </div>

      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-slate-400">
            {options.length === 0 ? "Noch keine Schlösser angelegt." : "Keine Treffer."}
          </p>
        ) : (
          filtered.map((o) => {
            const selected = value.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-indigo-50 dark:bg-indigo-950/20"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    selected
                      ? "border-indigo-500 bg-indigo-500"
                      : "border-slate-300 dark:border-slate-600",
                  )}
                >
                  {selected && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="truncate text-xs text-slate-700 dark:text-slate-300">{o.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
