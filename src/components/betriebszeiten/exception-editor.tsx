"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExceptionSpec } from "@/components/betriebszeiten/types";

/** Heute als "YYYY-MM-TT" – Vorbelegung für einen neuen Ausnahmetag. */
function todayYmd(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/**
 * Ausnahmetage: Feiertage, Betriebsferien, Sonderoeffnungen. Ein Ausnahmetag
 * schlaegt die Saison – genau dafuer ist er da.
 */
export function ExceptionEditor({
  exceptions,
  disabled,
  onChange,
}: {
  exceptions: ExceptionSpec[];
  disabled?: boolean;
  onChange: (next: ExceptionSpec[]) => void;
}) {
  const update = (index: number, patch: Partial<ExceptionSpec>) => {
    onChange(exceptions.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const duplicates = new Set(
    exceptions
      .map((e) => e.date)
      .filter((date, i, all) => all.indexOf(date) !== i),
  );

  return (
    <div className="space-y-2">
      {exceptions.length === 0 && (
        <p className="text-xs text-neutral-500">
          Noch keine Ausnahmen. Ohne Ausnahmetag gilt immer der Wochenplan der Saison.
        </p>
      )}

      {exceptions.map((exception, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-700"
        >
          <div className="space-y-1">
            <Label className="text-xs">Datum</Label>
            <Input
              type="date"
              value={exception.date}
              disabled={disabled}
              className="h-8 w-36 text-xs"
              onChange={(e) => update(index, { date: e.target.value })}
            />
          </div>

          <label className="flex h-8 items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={exception.closed}
              disabled={disabled}
              className="h-3.5 w-3.5"
              onChange={(e) =>
                update(index, {
                  closed: e.target.checked,
                  opensAt: e.target.checked ? null : exception.opensAt ?? "10:00",
                  closesAt: e.target.checked ? null : exception.closesAt ?? "18:00",
                })
              }
            />
            geschlossen
          </label>

          {!exception.closed && (
            <div className="flex items-center gap-1.5">
              <Input
                type="time"
                value={exception.opensAt ?? "10:00"}
                disabled={disabled}
                className="h-8 w-[6.5rem] text-xs"
                onChange={(e) => update(index, { opensAt: e.target.value })}
              />
              <span className="text-xs text-neutral-400">bis</span>
              <Input
                type="time"
                value={exception.closesAt ?? "18:00"}
                disabled={disabled}
                className="h-8 w-[6.5rem] text-xs"
                onChange={(e) => update(index, { closesAt: e.target.value })}
              />
            </div>
          )}

          <div className="min-w-32 flex-1 space-y-1">
            <Label className="text-xs">Notiz</Label>
            <Input
              value={exception.note ?? ""}
              disabled={disabled}
              placeholder="z.B. Feiertag, Seefest"
              className="h-8 text-xs"
              onChange={(e) => update(index, { note: e.target.value })}
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-8 w-8 p-0 text-neutral-400 hover:text-red-600"
            onClick={() => onChange(exceptions.filter((_, i) => i !== index))}
            title="Ausnahme entfernen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {duplicates.has(exception.date) && (
            <p className="w-full text-[11px] text-amber-600">
              Dieses Datum kommt mehrfach vor – gespeichert wird nur der erste Eintrag.
            </p>
          )}
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-8 text-xs"
        onClick={() =>
          onChange([
            ...exceptions,
            { date: todayYmd(), closed: true, opensAt: null, closesAt: null, note: "" },
          ])
        }
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Ausnahmetag
      </Button>
    </div>
  );
}
