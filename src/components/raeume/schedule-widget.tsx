"use client";

/**
 * Betriebszeit eines Raums als Widget: Zustand (geoeffnet bis … / oeffnet um …),
 * Tagesleiste mit Oeffnungszeit, Heizfenster (Vorlauf/Nachlauf des Klimas) und
 * Jetzt-Markierung, darunter die Woche.
 */

import { CalendarClock, Flame } from "lucide-react";
import type { RoomClimateView, RoomSchedule } from "@/components/raeume/types";
import { describeDay, openingForDay, operatingSpanState, type ScheduleSpec } from "@/lib/operating-hours";
import { addDaysToYmd, parseHhmm, tzMinutesOfDay, tzYmd, weekdayBitOfYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface Bar {
  from: number;
  to: number;
}

function fmtTime(d: Date, tz: string): string {
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}

/** "16:00", "morgen 12:00" oder "Do 12:00". */
export function fmtWhen(d: Date, now: Date, tz: string): string {
  const today = tzYmd(now, tz);
  const ymd = tzYmd(d, tz);
  if (ymd === today) return fmtTime(d, tz);
  if (ymd === addDaysToYmd(today, 1)) return `morgen ${fmtTime(d, tz)}`;
  return `${DAY_SHORT[weekdayBitOfYmd(ymd)]} ${fmtTime(d, tz)}`;
}

const fmtMin = (m: number) => {
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Oeffnungsspannen eines Tages als Minuten (Ende ueber Mitternacht → 1440). */
function dayBars(spec: ScheduleSpec, ymd: string): Bar[] {
  const out: Bar[] = [];
  for (const w of openingForDay(spec, ymd).windows) {
    const from = parseHhmm(w.opensAt);
    const to = parseHhmm(w.closesAt);
    if (from == null || to == null) continue;
    out.push({ from, to: w.overnight || to <= from ? 1440 : to });
  }
  return out;
}

export function ScheduleWidget({
  schedule,
  climate,
  timezone,
  nowMs,
  hideStatus = false,
}: {
  schedule: RoomSchedule;
  climate: RoomClimateView | null;
  timezone: string;
  nowMs: number;
  /** Zustand (geoeffnet/geschlossen) steht schon im Kopf der Raumkarte. */
  hideStatus?: boolean;
}) {
  const now = new Date(nowMs);
  const spec: ScheduleSpec = { name: schedule.name, seasons: schedule.seasons, exceptions: schedule.exceptions };
  const today = tzYmd(now, timezone);
  const open = dayBars(spec, today);
  const state = operatingSpanState(spec, now, timezone);

  // Heizfenster nur, wenn das Klima dieser Betriebszeit folgt.
  const heatFollows =
    !!climate?.isActive && (climate.operatingScheduleId == null || climate.operatingScheduleId === schedule.id);
  const pre = heatFollows ? climate!.preheatMinutes : 0;
  const post = heatFollows ? climate!.afterrunMinutes : 0;
  const heat: Bar[] = heatFollows
    ? open.map((b) => ({ from: Math.max(0, b.from - pre), to: Math.min(1440, b.to + post) }))
    : [];
  const heatState = heatFollows
    ? operatingSpanState(spec, now, timezone, { openMinutes: -pre, closeMinutes: post })
    : null;

  // Sichtbarer Ausschnitt: 6–24 Uhr, erweitert, wenn Fenster frueher beginnen.
  const all = [...open, ...heat];
  const lo = Math.min(360, ...all.map((b) => Math.floor(b.from / 60) * 60));
  const hi = Math.max(1320, ...all.map((b) => Math.ceil(b.to / 60) * 60));
  const pct = (m: number) => `${((Math.min(hi, Math.max(lo, m)) - lo) / (hi - lo)) * 100}%`;
  const width = (b: Bar) => `${((Math.min(hi, b.to) - Math.max(lo, b.from)) / (hi - lo)) * 100}%`;
  const nowMin = tzMinutesOfDay(now, timezone);
  const ticks: number[] = [];
  for (let m = lo; m <= hi; m += hi - lo > 1080 ? 360 : 180) ticks.push(m);

  const monday = addDaysToYmd(today, -weekdayBitOfYmd(today));
  const week = Array.from({ length: 7 }, (_, i) => {
    const ymd = addDaysToYmd(monday, i);
    return { ymd, label: DAY_SHORT[i], day: openingForDay(spec, ymd) };
  });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border p-3.5",
        state.inside
          ? "border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 dark:border-emerald-500/20 dark:from-emerald-500/10 dark:via-card dark:to-card"
          : "border-border bg-gradient-to-br from-slate-50 to-white dark:from-muted/30 dark:to-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {hideStatus ? (
          <p className="min-w-0 truncate pt-1 text-xs font-medium text-muted-foreground">{schedule.name}</p>
        ) : (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "relative flex h-2.5 w-2.5 shrink-0 rounded-full",
                state.inside ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
              )}
            >
              {state.inside && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />}
            </span>
            <span className="text-lg font-semibold tracking-tight">{state.inside ? "Geöffnet" : "Geschlossen"}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {state.until
              ? state.inside
                ? `schließt ${fmtWhen(state.until, now, timezone)}`
                : `öffnet ${fmtWhen(state.until, now, timezone)}`
              : "keine Öffnung in Sicht"}
            {" · "}
            {schedule.name}
          </p>
        </div>
        )}
        {heatState && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums",
              heatState.inside
                ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm shadow-orange-500/30"
                : "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
            )}
            title={`Heizfenster: ${pre} Min. vor Öffnung bis ${post} Min. nach Schluss`}
          >
            <Flame className="h-3 w-3" />
            {heatState.inside
              ? `${climate!.targetC.toLocaleString("de-DE")} °C bis ${heatState.until ? fmtWhen(heatState.until, now, timezone) : "–"}`
              : heatState.until
                ? `Heizen ab ${fmtWhen(heatState.until, now, timezone)}`
                : "Heizen aus"}
          </div>
        )}
      </div>

      {/* Tagesleiste */}
      <div className="relative mt-4 h-9">
        <div className="absolute inset-x-0 top-3 h-3 rounded-full bg-slate-200/70 dark:bg-muted" />
        {heat.map((b, i) => (
          <div
            key={`h${i}`}
            className="absolute top-1.5 h-6 rounded-full bg-gradient-to-r from-orange-300/50 via-orange-400/40 to-rose-300/50 ring-1 ring-orange-300/60 dark:from-orange-500/25 dark:to-rose-500/25"
            style={{ left: pct(b.from), width: width(b) }}
          />
        ))}
        {open.map((b, i) => (
          <div
            key={`o${i}`}
            className="absolute top-3 h-3 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 shadow-sm shadow-emerald-500/40"
            style={{ left: pct(b.from), width: width(b) }}
          />
        ))}
        {nowMin >= lo && nowMin <= hi && (
          <div className="absolute top-0 h-9 -translate-x-1/2" style={{ left: pct(nowMin) }}>
            <div className="mx-auto h-full w-0.5 rounded-full bg-foreground/80" />
            <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-white dark:ring-card" />
          </div>
        )}
      </div>
      <div className="relative h-4 text-[10px] tabular-nums text-muted-foreground">
        {ticks.map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: pct(m) }}>
            {m === 1440 ? "24" : Math.floor(m / 60)}
          </span>
        ))}
      </div>

      {(open.length > 0 || heat.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {open.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" />
              Betrieb {open.map((b) => `${fmtMin(b.from)}–${fmtMin(b.to)}`).join(", ")}
            </span>
          )}
          {heat.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-orange-300/80 ring-1 ring-orange-400/60" />
              Heizung {heat.map((b) => `${fmtMin(b.from)}–${fmtMin(b.to)}`).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Woche */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {week.map((d) => {
          const isToday = d.ymd === today;
          const closed = d.day.closed || d.day.windows.length === 0;
          return (
            <div
              key={d.ymd}
              title={`${d.label}: ${describeDay(d.day)}${d.day.label ? ` (${d.day.label})` : ""}`}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-lg px-0.5 py-1.5 text-center",
                isToday
                  ? "bg-foreground text-background shadow-sm"
                  : closed
                    ? "text-muted-foreground/60"
                    : "bg-white/70 text-foreground dark:bg-muted/40",
              )}
            >
              <span className="text-[10px] font-semibold">{d.label}</span>
              {closed ? (
                <span className="text-[9px] leading-tight">zu</span>
              ) : (
                <span className="text-[9px] leading-tight tabular-nums">
                  {d.day.windows[0].opensAt.replace(/:00$/, "")}–{d.day.windows[d.day.windows.length - 1].closesAt.replace(/:00$/, "")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Platzhalter fuer Raeume ohne Betriebszeit. */
export function ScheduleEmpty({ onEdit }: { onEdit?: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      disabled={!onEdit}
      className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border p-3 text-left text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted">
        <CalendarClock className="h-4 w-4" />
      </span>
      <span>
        <span className="block font-medium text-foreground">Keine Betriebszeit</span>
        Heizung und Regeln laufen rund um die Uhr. {onEdit ? "Antippen, um eine Betriebszeit zu wählen." : ""}
      </span>
    </button>
  );
}
