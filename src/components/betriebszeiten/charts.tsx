"use client";

import { useMemo } from "react";
import { markRuns, monthTicks, type DaySegment } from "@/lib/operating-calendar";
import { addDaysToYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";

/**
 * Kleine Grafiken der Betriebszeiten-Seite: Jahresband (ein Zeichen je Tag),
 * Monatsachse und Wochenspalten. Farben nach docs/design-regeln.md: geöffnet
 * Smaragd, Ausnahme `warning`, Abgleich gleich `success` (ruhig), anders `warning`.
 */

/** Spur hinter Bändern und Balken – wie die Zeitleiste im Kalender. */
export const TRACK = "bg-foreground/[0.06] dark:bg-white/[0.08]";

/** Geöffnet als Fläche (Zustandston Smaragd, Abschnitt 3). */
export const OPEN_FILL = "bg-emerald-500 dark:bg-emerald-400";
export const OPEN_FILL_SOFT = "bg-emerald-500/55 dark:bg-emerald-400/55";

/** "2027-03-13" -> "13.03.2027". */
export function formatDate(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
}

/** Zeitraum eines Laufs für den Tooltip. */
function runTitle(from: string, start: number, length: number, label: string): string {
  const first = addDaysToYmd(from, start);
  const last = addDaysToYmd(from, start + length - 1);
  const days = `${length} ${length === 1 ? "Tag" : "Tage"}`;
  return first === last ? `${formatDate(first)}: ${label}` : `${formatDate(first)}–${formatDate(last)} (${days}): ${label}`;
}

/**
 * Band über einen Zeitraum, ein Zeichen je Tag. Zeichen ohne Eintrag in
 * `styles` bleiben Spur; die Monate stehen in der Achse darunter.
 */
export function DayStrip({
  marks,
  from,
  styles,
  labels,
  ariaLabel,
  className,
}: {
  marks: string;
  from: string;
  styles: Record<string, string>;
  labels: Record<string, string>;
  ariaLabel: string;
  className?: string;
}) {
  const total = marks.length;
  const runs = useMemo(() => markRuns(marks), [marks]);
  if (total === 0) return null;
  const pct = (n: number) => (n / total) * 100;
  return (
    <div role="img" aria-label={ariaLabel} className={cn("relative h-2.5 overflow-hidden rounded-full", TRACK, className)}>
      {runs.map((r) =>
        styles[r.ch] ? (
          <span
            key={r.start}
            title={runTitle(from, r.start, r.length, labels[r.ch] ?? "")}
            className={cn("absolute inset-y-0", styles[r.ch])}
            // Einzelne Tage (Ausnahmen) bleiben mit mindestens 2 px sichtbar.
            style={{ left: `${pct(r.start)}%`, width: `max(2px, ${pct(r.length)}%)` }}
          />
        ) : null,
      )}
    </div>
  );
}

/**
 * Monatsnamen unter einem Band; zu schmale angeschnittene Monate ohne Namen.
 * Links steht „heute“, weil jedes Band mit dem heutigen Tag beginnt.
 */
export function MonthAxis({ from, days, compact = false }: { from: string; days: number; compact?: boolean }) {
  const ticks = useMemo(() => monthTicks(from, days), [from, days]);
  return (
    <div aria-hidden className="relative h-3.5 text-[10px] leading-none font-normal tracking-normal normal-case text-muted-foreground">
      <span className="absolute top-1 left-0 font-medium text-foreground">heute</span>
      {ticks.map((t) =>
        t.days < 14 || t.offset < 24 ? null : (
          <span key={t.offset} className="absolute top-1" style={{ left: `${(t.offset / days) * 100}%` }}>
            {compact ? (
              <>
                <span className="sm:hidden">{t.initial}</span>
                <span className="max-sm:hidden">{t.label}</span>
              </>
            ) : (
              t.label
            )}
          </span>
        ),
      )}
    </div>
  );
}

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
}

function spanLabel(windows: DaySegment[]): string {
  if (windows.length === 0) return "zu";
  if (windows.length === 1 && windows[0].start === 0 && windows[0].end === 24 * 60) return "24 h";
  return `${hourLabel(windows[0].start)}–${hourLabel(windows[windows.length - 1].end)}`;
}

export interface WeekColumn {
  windows: DaySegment[];
  /** Heute: tatsächliche Zeiten des Tags (auch Ausnahme), hervorgehoben. */
  today?: boolean;
  exception?: boolean;
}

/**
 * Woche als sieben senkrechte Spannen (docs/design-regeln.md, Abschnitt 8):
 * oben früh, unten spät, heutiger Tag hervorgehoben, Jetzt-Marke gestrichelt.
 */
export function WeekColumns({
  columns,
  range,
  nowMinutes,
  openNow,
}: {
  columns: WeekColumn[];
  range: { from: number; to: number };
  /** Minuten seit Mitternacht; nur gesetzt, wenn eine Spalte „heute“ ist. */
  nowMinutes: number | null;
  openNow: boolean;
}) {
  const span = (range.to - range.from) * 60;
  const pos = (m: number) => Math.min(100, Math.max(0, ((m - range.from * 60) / span) * 100));
  return (
    <div className="grid grid-cols-[1.25rem_repeat(7,minmax(0,1fr))] gap-x-1">
      {/* Stundenachse links: Beginn und Ende des gemeinsamen Bereichs. */}
      <div aria-hidden className="flex h-14 flex-col justify-between text-[10px] leading-none text-muted-foreground tabular-nums">
        <span>{range.from}</span>
        <span>{range.to}</span>
      </div>
      {columns.map((col, d) => (
        <div key={d} className="relative mx-auto h-14 w-3 sm:w-3.5">
          <div className={cn("absolute inset-0 rounded-full", TRACK, col.today && "ring-2 ring-primary/40")} />
          {col.windows.map((w, i) => (
            <span
              key={i}
              className={cn(
                "absolute inset-x-0 rounded-full",
                col.exception ? "bg-warning" : col.today && openNow ? OPEN_FILL : OPEN_FILL_SOFT,
              )}
              style={{ top: `${pos(w.start)}%`, height: `${Math.max(4, pos(w.end) - pos(w.start))}%` }}
            />
          ))}
          {col.today && nowMinutes != null && nowMinutes >= range.from * 60 && nowMinutes <= range.to * 60 && (
            <span
              aria-hidden
              className="absolute -inset-x-1.5 border-t border-dashed border-foreground/70"
              style={{ top: `${pos(nowMinutes)}%` }}
            />
          )}
        </div>
      ))}
      <span />
      {columns.map((col, d) => (
        <div key={d} className="mt-1 min-w-0 text-center leading-tight">
          <div className={cn("text-[10px]", col.today ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {col.today ? "heute" : WEEKDAY_SHORT[d]}
          </div>
          <div
            className={cn(
              "truncate text-[10px] tabular-nums",
              col.windows.length === 0 ? "text-muted-foreground" : "text-foreground",
              col.exception && "text-warning",
            )}
          >
            {spanLabel(col.windows)}
          </div>
        </div>
      ))}
    </div>
  );
}
