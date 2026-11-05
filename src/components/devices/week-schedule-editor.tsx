"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import { Switch } from "@/components/ui/switch";
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
    // Gruppe im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18).
    <div className={cn("glass-tile overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Automatische Zeitsteuerung</p>
      </div>

      <div className="p-3 space-y-1.5">
        {/* Header */}
        <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-1 mb-1">
          <div />
          <p className="text-xs font-medium text-muted-foreground text-center">Tag</p>
          <p className="text-xs font-medium text-muted-foreground text-center">Einschalten</p>
          <p className="text-xs font-medium text-muted-foreground text-center">Ausschalten</p>
        </div>

        {DAY_KEYS.map((day) => {
          const entry = value[day];
          return (
            <div
              key={day}
              className={cn(
                "grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 items-center rounded-lg px-1 py-1.5 transition-colors",
                entry.enabled
                  ? "bg-primary/10"
                  : "opacity-60"
              )}
            >
              {/* Toggle: Schalter-Baustein statt eigenem Knopf; Standardgröße (24 × 40) füllt die 40-px-Spalte und ist gut zu treffen. */}
              <Switch
                checked={entry.enabled}
                onCheckedChange={() => updateDay(day, "enabled", !entry.enabled)}
                aria-label={`${DAY_LABELS[day]} ${entry.enabled ? "deaktivieren" : "aktivieren"}`}
              />

              {/* Day label */}
              <span className={cn(
                "text-sm font-semibold text-center",
                entry.enabled ? "text-foreground" : "text-muted-foreground"
              )}>
                {DAY_LABELS[day]}
              </span>

              {/* On time */}
              {/* Eigenes Zeitfeld wie ein Eingabefeld: glass-field, 16 px Schrift auf dem Handy (Abschnitt 16). */}
              <input
                type="time"
                value={entry.on}
                onChange={(e) => updateDay(day, "on", e.target.value)}
                disabled={!entry.enabled}
                className={cn(
                  "glass-field w-full h-9 px-2 text-base md:text-sm text-center font-mono transition-[color,box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 max-sm:h-11",
                  entry.enabled
                    ? "text-foreground/90"
                    : "text-muted-foreground cursor-not-allowed"
                )}
              />

              {/* Off time */}
              <input
                type="time"
                value={entry.off}
                onChange={(e) => updateDay(day, "off", e.target.value)}
                disabled={!entry.enabled}
                className={cn(
                  "glass-field w-full h-9 px-2 text-base md:text-sm text-center font-mono transition-[color,box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 max-sm:h-11",
                  entry.enabled
                    ? "text-foreground/90"
                    : "text-muted-foreground cursor-not-allowed"
                )}
              />
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3">
        <p className="text-xs text-muted-foreground">
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
    // Kachel in der Karte (glass-tile) statt Gelb aus der Palette.
    <div className="glass-tile overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Zeitsteuerung</p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {activeDays.length === 0 ? "Keine Tage aktiv" : `${activeDays.length} Tag${activeDays.length !== 1 ? "e" : ""} aktiv`}
        </span>
      </div>

      <div className="p-3 space-y-1">
        {/* Header */}
        <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-1 mb-1">
          <div />
          <p className="text-xs font-medium text-muted-foreground text-center">Tag</p>
          <p className="text-xs font-medium text-muted-foreground text-center">Ein</p>
          <p className="text-xs font-medium text-muted-foreground text-center">Aus</p>
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
              <StatusDot tone={entry.enabled ? "primary" : "neutral"} className="mx-auto" />
              <span className={cn("text-center font-semibold", entry.enabled ? "text-foreground" : "text-muted-foreground")}>
                {DAY_LABELS[day]}
              </span>
              <span className={cn("text-center font-mono", entry.enabled ? "text-foreground/80" : "text-muted-foreground")}>
                {entry.enabled && entry.on ? entry.on : "–"}
              </span>
              <span className={cn("text-center font-mono", entry.enabled ? "text-foreground/80" : "text-muted-foreground")}>
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
