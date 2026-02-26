"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAY_KEYS, DAY_LABELS, WeekSchedule, DayKey, emptySchedule,
} from "@/lib/schedule";

interface WeekScheduleEditorProps {
  value: WeekSchedule;
  onChange: (v: WeekSchedule) => void;
  className?: string;
}

export function WeekScheduleEditor({ value, onChange, className }: WeekScheduleEditorProps) {
  function updateDay(day: DayKey, field: "enabled" | "on" | "off", v: boolean | string) {
    onChange({ ...value, [day]: { ...value[day], [field]: v } });
  }

  return (
    <div className={cn("rounded-xl border border-yellow-200 dark:border-yellow-900/30 bg-yellow-50 dark:bg-yellow-950/20 overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-yellow-200 dark:border-yellow-900/30">
        <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Automatische Zeitsteuerung</p>
      </div>

      <div className="p-3 space-y-1.5">
        {/* Header */}
        <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-1 mb-1">
          <div />
          <p className="text-xs font-medium text-slate-500 text-center">Tag</p>
          <p className="text-xs font-medium text-slate-500 text-center">Einschalten</p>
          <p className="text-xs font-medium text-slate-500 text-center">Ausschalten</p>
        </div>

        {DAY_KEYS.map((day) => {
          const entry = value[day];
          return (
            <div
              key={day}
              className={cn(
                "grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 items-center rounded-lg px-1 py-1.5 transition-colors",
                entry.enabled
                  ? "bg-yellow-100/60 dark:bg-yellow-900/20"
                  : "opacity-60"
              )}
            >
              {/* Toggle */}
              <button
                type="button"
                onClick={() => updateDay(day, "enabled", !entry.enabled)}
                className={cn(
                  "w-8 h-4.5 rounded-full transition-colors relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-yellow-400",
                  entry.enabled
                    ? "bg-yellow-500 dark:bg-yellow-400"
                    : "bg-slate-200 dark:bg-slate-700"
                )}
                aria-label={`${DAY_LABELS[day]} ${entry.enabled ? "deaktivieren" : "aktivieren"}`}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                    entry.enabled ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>

              {/* Day label */}
              <span className={cn(
                "text-sm font-semibold text-center",
                entry.enabled ? "text-yellow-800 dark:text-yellow-300" : "text-slate-400"
              )}>
                {DAY_LABELS[day]}
              </span>

              {/* On time */}
              <input
                type="time"
                value={entry.on}
                onChange={(e) => updateDay(day, "on", e.target.value)}
                disabled={!entry.enabled}
                className={cn(
                  "w-full rounded-lg border px-2 py-1 text-sm text-center font-mono transition-colors outline-none",
                  entry.enabled
                    ? "border-yellow-300 dark:border-yellow-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-yellow-400"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                )}
              />

              {/* Off time */}
              <input
                type="time"
                value={entry.off}
                onChange={(e) => updateDay(day, "off", e.target.value)}
                disabled={!entry.enabled}
                className={cn(
                  "w-full rounded-lg border px-2 py-1 text-sm text-center font-mono transition-colors outline-none",
                  entry.enabled
                    ? "border-yellow-300 dark:border-yellow-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-yellow-400"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                )}
              />
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3">
        <p className="text-xs text-yellow-700 dark:text-yellow-500">
          Tage ohne Aktivierung werden manuell gesteuert
        </p>
      </div>
    </div>
  );
}

/** Read-only schedule display for the device detail page */
export function WeekScheduleDisplay({ schedule }: { schedule: WeekSchedule }) {
  const activeDays = DAY_KEYS.filter((d) => schedule[d].enabled);

  return (
    <div className="rounded-xl border border-yellow-200 dark:border-yellow-900/30 bg-yellow-50/60 dark:bg-yellow-950/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-yellow-200 dark:border-yellow-900/30">
        <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Zeitsteuerung</p>
        <span className="ml-auto text-xs text-yellow-600 dark:text-yellow-500">
          {activeDays.length === 0 ? "Keine Tage aktiv" : `${activeDays.length} Tag${activeDays.length !== 1 ? "e" : ""} aktiv`}
        </span>
      </div>

      <div className="p-3 space-y-1">
        {/* Header */}
        <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-1 mb-1">
          <div />
          <p className="text-xs font-medium text-slate-500 text-center">Tag</p>
          <p className="text-xs font-medium text-slate-500 text-center">Ein</p>
          <p className="text-xs font-medium text-slate-500 text-center">Aus</p>
        </div>
        {DAY_KEYS.map((day) => {
          const entry = schedule[day];
          return (
            <div
              key={day}
              className={cn(
                "grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 items-center rounded-lg px-1 py-1 text-sm",
                entry.enabled ? "" : "opacity-40"
              )}
            >
              <div className={cn(
                "h-2 w-2 rounded-full mx-auto",
                entry.enabled ? "bg-yellow-500" : "bg-slate-300 dark:bg-slate-600"
              )} />
              <span className={cn("text-center font-semibold", entry.enabled ? "text-yellow-800 dark:text-yellow-300" : "text-slate-400")}>
                {DAY_LABELS[day]}
              </span>
              <span className={cn("text-center font-mono", entry.enabled ? "text-slate-700 dark:text-slate-300" : "text-slate-400")}>
                {entry.enabled && entry.on ? entry.on : "–"}
              </span>
              <span className={cn("text-center font-mono", entry.enabled ? "text-slate-700 dark:text-slate-300" : "text-slate-400")}>
                {entry.enabled && entry.off ? entry.off : "–"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { emptySchedule };
