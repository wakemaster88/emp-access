"use client";

import { CalendarX, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
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
        <EmptyState
          compact
          icon={CalendarX}
          title="Noch keine Ausnahmen."
          description="Ohne Ausnahmetag gilt immer der Wochenplan der Saison."
        />
      )}

      {exceptions.map((exception, index) => (
        // Gruppe im Dialog als Glas-Kachel; in der Ebene getönt (docs/design-regeln.md, Abschnitt 18).
        <div
          key={index}
          className="glass-tile flex flex-wrap items-end gap-2 p-3"
        >
          <div className="space-y-1">
            <Label>Datum</Label>
            <Input
              type="date"
              value={exception.date}
              disabled={disabled}
              className="w-36 max-sm:h-11"
              onChange={(e) => update(index, { date: e.target.value })}
            />
          </div>

          {/* Kästchen aus dem Baustein (Glasfeld, angehakt in Akzentfarbe); die ganze Zeile ist Tippfläche (docs/design-regeln.md, Abschnitt 14). */}
          <label className="flex h-9 items-center gap-2 text-xs max-sm:h-11">
            <Checkbox
              checked={exception.closed}
              disabled={disabled}
              onCheckedChange={(checked) =>
                update(index, {
                  closed: checked === true,
                  opensAt: checked === true ? null : exception.opensAt ?? "10:00",
                  closesAt: checked === true ? null : exception.closesAt ?? "18:00",
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
                className="w-[6.5rem] max-sm:h-11"
                onChange={(e) => update(index, { opensAt: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">bis</span>
              <Input
                type="time"
                value={exception.closesAt ?? "18:00"}
                disabled={disabled}
                className="w-[6.5rem] max-sm:h-11"
                onChange={(e) => update(index, { closesAt: e.target.value })}
              />
            </div>
          )}

          <div className="min-w-32 flex-1 space-y-1">
            <Label>Notiz</Label>
            <Input
              value={exception.note ?? ""}
              disabled={disabled}
              placeholder="z.B. Feiertag, Seefest"
              className="max-sm:h-11"
              onChange={(e) => update(index, { note: e.target.value })}
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="text-muted-foreground hover:text-destructive max-sm:size-11"
            onClick={() => onChange(exceptions.filter((_, i) => i !== index))}
            title="Ausnahme entfernen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {duplicates.has(exception.date) && (
            <p className="w-full text-[11px] text-warning">
              Dieses Datum kommt mehrfach vor – gespeichert wird nur der erste Eintrag.
            </p>
          )}
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-8 text-xs max-sm:h-11"
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
