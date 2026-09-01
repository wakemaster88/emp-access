"use client";

import { CopyPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { weekdayName } from "@/lib/operating-hours";
import type { PeriodSpec, SeasonSpec } from "@/components/betriebszeiten/types";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function splitMmDd(mmDd: string): { month: number; day: number } {
  const [mm, dd] = mmDd.split("-").map(Number);
  return { month: mm || 1, day: dd || 1 };
}

function joinMmDd(month: number, day: number): string {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Tage im Monat, Februar bewusst mit 29 – Saisons gelten jedes Jahr. */
function daysInMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

/** Monat und Tag ohne Jahr auswählen: eine Saison wiederholt sich jährlich. */
function MmDdPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { month, day } = splitMmDd(value);
  const selectClass =
    "h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="flex gap-1.5">
      <select
        className={selectClass}
        value={day}
        disabled={disabled}
        onChange={(e) => onChange(joinMmDd(month, Number(e.target.value)))}
        aria-label="Tag"
      >
        {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}.
          </option>
        ))}
      </select>
      <select
        className={`${selectClass} flex-1`}
        value={month}
        disabled={disabled}
        onChange={(e) => {
          const nextMonth = Number(e.target.value);
          onChange(joinMmDd(nextMonth, Math.min(day, daysInMonth(nextMonth))));
        }}
        aria-label="Monat"
      >
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Öffnungszeiten eines Wochentags. Mehrere Spannen bilden eine Pause ab. */
function DayRow({
  weekday,
  periods,
  disabled,
  onChange,
  onCopyToAll,
}: {
  weekday: number;
  periods: PeriodSpec[];
  disabled?: boolean;
  onChange: (next: PeriodSpec[]) => void;
  onCopyToAll: () => void;
}) {
  const open = periods.length > 0;

  return (
    <div className="flex flex-wrap items-start gap-2 border-b border-neutral-100 py-1.5 last:border-0 dark:border-neutral-800">
      <label className="flex w-24 shrink-0 items-center gap-1.5 pt-1.5 text-xs">
        <input
          type="checkbox"
          checked={open}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.checked ? [{ weekday, opensAt: "10:00", closesAt: "18:00" }] : [])
          }
          className="h-3.5 w-3.5"
        />
        <span className={open ? "font-medium" : "text-neutral-400"}>{weekdayName(weekday)}</span>
      </label>

      {!open ? (
        <span className="pt-1.5 text-xs text-neutral-400">geschlossen</span>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5">
          {periods.map((period, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <Input
                type="time"
                value={period.opensAt}
                disabled={disabled}
                className="h-8 w-[6.5rem] text-xs"
                onChange={(e) =>
                  onChange(
                    periods.map((p, i) => (i === index ? { ...p, opensAt: e.target.value } : p)),
                  )
                }
              />
              <span className="text-xs text-neutral-400">bis</span>
              <Input
                type="time"
                value={period.closesAt}
                disabled={disabled}
                className="h-8 w-[6.5rem] text-xs"
                onChange={(e) =>
                  onChange(
                    periods.map((p, i) => (i === index ? { ...p, closesAt: e.target.value } : p)),
                  )
                }
              />
              {period.closesAt < period.opensAt && (
                <span className="text-[11px] text-amber-600" title="Endet am Folgetag">
                  über Nacht
                </span>
              )}
              {periods.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="h-7 w-7 p-0 text-neutral-400 hover:text-red-600"
                  onClick={() => onChange(periods.filter((_, i) => i !== index))}
                  title="Zeitraum entfernen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}

          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-7 px-1.5 text-[11px] text-neutral-500"
              onClick={() => onChange([...periods, { weekday, opensAt: "17:00", closesAt: "22:00" }])}
            >
              <Plus className="mr-0.5 h-3 w-3" />
              Zeitraum
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-7 px-1.5 text-[11px] text-neutral-500"
              onClick={onCopyToAll}
              title="Diese Zeiten auf alle Wochentage übertragen"
            >
              <CopyPlus className="mr-0.5 h-3 w-3" />
              auf alle Tage
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Eine Saison: Zeitraum im Jahr plus Wochenplan. Ohne Saison ist ein Profil
 * dauerhaft geschlossen, deshalb legt der Dialog immer eine mit an.
 */
export function SeasonEditor({
  season,
  disabled,
  onChange,
  onRemove,
}: {
  season: SeasonSpec;
  disabled?: boolean;
  onChange: (next: SeasonSpec) => void;
  onRemove: () => void;
}) {
  const periodsOf = (weekday: number) => season.periods.filter((p) => p.weekday === weekday);

  const setPeriodsOf = (weekday: number, next: PeriodSpec[]) => {
    onChange({
      ...season,
      periods: [...season.periods.filter((p) => p.weekday !== weekday), ...next],
    });
  };

  const copyToAll = (weekday: number) => {
    const template = periodsOf(weekday);
    onChange({
      ...season,
      periods: WEEKDAYS.flatMap((day) => template.map((p) => ({ ...p, weekday: day }))),
    });
  };

  const wrapsYear = season.startMmDd > season.endMmDd;

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-32 flex-1 space-y-1">
          <Label className="text-xs">Saison</Label>
          <Input
            value={season.name}
            disabled={disabled}
            placeholder="z.B. Sommer"
            className="h-8 text-xs"
            onChange={(e) => onChange({ ...season, name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">von</Label>
          <MmDdPicker
            value={season.startMmDd}
            disabled={disabled}
            onChange={(startMmDd) => onChange({ ...season, startMmDd })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">bis</Label>
          <MmDdPicker
            value={season.endMmDd}
            disabled={disabled}
            onChange={(endMmDd) => onChange({ ...season, endMmDd })}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 w-8 p-0 text-neutral-400 hover:text-red-600"
          onClick={onRemove}
          title="Saison entfernen"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {wrapsYear && (
        <p className="mt-1.5 text-[11px] text-neutral-500">
          Läuft über den Jahreswechsel und gilt jedes Jahr erneut.
        </p>
      )}

      <div className="mt-2">
        {WEEKDAYS.map((weekday) => (
          <DayRow
            key={weekday}
            weekday={weekday}
            periods={periodsOf(weekday)}
            disabled={disabled}
            onChange={(next) => setPeriodsOf(weekday, next)}
            onCopyToAll={() => copyToAll(weekday)}
          />
        ))}
      </div>
    </div>
  );
}
