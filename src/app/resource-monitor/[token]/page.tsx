"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { cn } from "@/lib/utils";

interface AvailabilitySlot {
  startTime: string;
  endTime: string;
}

interface BookingSlot {
  start: string;
  end: string;
  count: number;
  names: string[];
}

interface Resource {
  id: number;
  name: string;
  capacity: number | null;
  availability: AvailabilitySlot[];
  bookingCount: number;
  bookingSlots: BookingSlot[];
}

interface MonitorData {
  date: string;
  now: string;
  resources: Resource[];
}

const HOUR_START = 8;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const TOTAL_MINUTES = TOTAL_HOURS * 60;
const POLL_INTERVAL = 60_000;
const HEADER_HEIGHT = 52;
const COL_HEADER_HEIGHT = 40;
const TIME_GUTTER = 48;

function timeToMinutes(timeStr: string): number | null {
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function clampMinutes(min: number): number {
  return Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, min));
}

function minutesToPercent(minutes: number): number {
  return ((minutes - HOUR_START * 60) / TOTAL_MINUTES) * 100;
}

function getNowBerlinMinutes(): number {
  const now = new Date();
  const parts = now
    .toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function getNowBerlinTime(): string {
  return new Date().toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateDE(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function utilizationColor(count: number, capacity: number | null): string {
  if (capacity == null || capacity <= 0) return "bg-indigo-500";
  const pct = count / capacity;
  if (pct >= 1) return "bg-red-500";
  if (pct >= 0.8) return "bg-amber-500";
  return "bg-indigo-500";
}

export default function ResourceMonitorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(getNowBerlinMinutes);
  const [nowTime, setNowTime] = useState(getNowBerlinTime);
  const gridRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitor/public/${token}/resources`);
      if (!res.ok) { setError(true); return; }
      const json: MonitorData = await res.json();
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [fetchData]);

  useEffect(() => {
    const iv = setInterval(() => {
      setNowMinutes(getNowBerlinMinutes());
      setNowTime(getNowBerlinTime());
    }, 15_000);
    return () => clearInterval(iv);
  }, []);

  if (error) {
    return (
      <div className="h-dvh bg-white flex items-center justify-center">
        <p className="text-slate-400 text-lg">Monitor nicht gefunden oder inaktiv.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-dvh bg-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="h-5 w-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
          Laden…
        </div>
      </div>
    );
  }

  const nowPct = minutesToPercent(clampMinutes(nowMinutes));
  const showNowLine = nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);
  const resources = data.resources;
  const gridHeight = `calc(100dvh - ${HEADER_HEIGHT + COL_HEADER_HEIGHT}px)`;

  return (
    <div className="h-dvh bg-white text-slate-900 flex flex-col overflow-hidden select-none">
      {/* Header */}
      <header
        className="shrink-0 bg-white border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-semibold tracking-tight truncate">Ressourcen-Monitor</h1>
          <p className="text-[11px] sm:text-xs text-slate-400 truncate">{formatDateDE(data.date)}</p>
        </div>
        <div className="text-right shrink-0 pl-3">
          <p className="text-lg sm:text-2xl font-mono font-bold tabular-nums text-emerald-600">{nowTime}</p>
        </div>
      </header>

      {resources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">Keine Ressourcen konfiguriert.</p>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div
            className="shrink-0 flex border-b border-slate-200 bg-slate-50/80"
            style={{ height: COL_HEADER_HEIGHT }}
          >
            <div className="shrink-0" style={{ width: TIME_GUTTER }} />
            {resources.map((r) => {
              const pct = r.capacity != null && r.capacity > 0
                ? Math.round((r.bookingCount / r.capacity) * 100)
                : null;
              return (
                <div
                  key={r.id}
                  className="flex-1 min-w-0 px-1 flex flex-col items-center justify-center border-l border-slate-200"
                >
                  <p className="text-[11px] sm:text-sm font-semibold truncate max-w-full">{r.name}</p>
                  <p className="text-[10px] sm:text-xs tabular-nums">
                    <span className={cn(
                      "font-medium",
                      pct != null && pct >= 100 ? "text-red-600" : pct != null && pct >= 80 ? "text-amber-600" : "text-slate-500",
                    )}>
                      {r.bookingCount}
                    </span>
                    {r.capacity != null && (
                      <span className="text-slate-400">/{r.capacity}</span>
                    )}
                    {pct != null && (
                      <span className={cn(
                        "ml-0.5",
                        pct >= 100 ? "text-red-500" : pct >= 80 ? "text-amber-500" : "text-slate-400",
                      )}>
                        ({pct}%)
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div
            ref={gridRef}
            className="relative flex flex-1 overflow-hidden"
            style={{ height: gridHeight }}
          >
            {/* Time gutter */}
            <div
              className="shrink-0 relative bg-white z-10 border-r border-slate-100"
              style={{ width: TIME_GUTTER }}
            >
              {hours.map((h) => {
                const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                return (
                  <div
                    key={h}
                    className="absolute right-0 left-0 flex justify-end pr-1 sm:pr-1.5"
                    style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
                  >
                    <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono leading-none tabular-nums">
                      {String(h).padStart(2, "0")}:00
                    </span>
                  </div>
                );
              })}

              {showNowLine && (
                <div
                  className="absolute left-0 right-0 flex justify-end pr-1 sm:pr-1.5 z-30"
                  style={{ top: `${nowPct}%`, transform: "translateY(-50%)" }}
                >
                  <span className="text-[9px] sm:text-[10px] font-mono font-bold text-red-500 bg-white leading-none tabular-nums">
                    {nowTime}
                  </span>
                </div>
              )}
            </div>

            {/* Resource columns */}
            {resources.map((resource) => (
              <div
                key={resource.id}
                className="flex-1 min-w-0 relative border-l border-slate-200"
              >
                {/* Hour lines */}
                {hours.map((h) => {
                  const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                  return (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-slate-100"
                      style={{ top: `${pct}%` }}
                    />
                  );
                })}

                {/* Half-hour lines */}
                {hours.slice(0, -1).map((h) => {
                  const pct = ((h - HOUR_START + 0.5) / TOTAL_HOURS) * 100;
                  return (
                    <div
                      key={`half-${h}`}
                      className="absolute left-0 right-0 border-t border-dashed border-slate-50"
                      style={{ top: `${pct}%` }}
                    />
                  );
                })}

                {/* Availability blocks */}
                {resource.availability.map((slot, i) => {
                  const startMin = timeToMinutes(slot.startTime);
                  const endMin = timeToMinutes(slot.endTime);
                  if (startMin == null || endMin == null) return null;
                  const topPct = minutesToPercent(clampMinutes(startMin));
                  const bottomPct = minutesToPercent(clampMinutes(endMin));
                  const heightPct = bottomPct - topPct;
                  if (heightPct <= 0) return null;
                  return (
                    <div
                      key={`avail-${i}`}
                      className="absolute left-0 right-0 bg-emerald-50/70 border-y border-emerald-200/40"
                      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                      title={`Verfügbar: ${slot.startTime} – ${slot.endTime}`}
                    />
                  );
                })}

                {/* Booking slot blocks */}
                {resource.bookingSlots.map((slot, i) => {
                  const startMin = timeToMinutes(slot.start);
                  const endMin = slot.end ? timeToMinutes(slot.end) : null;
                  if (startMin == null) return null;
                  const topPct = minutesToPercent(clampMinutes(startMin));
                  const effectiveEndMin = endMin != null ? endMin : startMin + 60;
                  const bottomPct = minutesToPercent(clampMinutes(effectiveEndMin));
                  const heightPct = Math.max(bottomPct - topPct, 2);
                  const color = utilizationColor(slot.count, resource.capacity);
                  const tooltip = `${slot.start}${slot.end ? ` – ${slot.end}` : ""}: ${slot.count} Buchung${slot.count !== 1 ? "en" : ""}\n${slot.names.join(", ")}${slot.count > slot.names.length ? ` (+${slot.count - slot.names.length})` : ""}`;

                  return (
                    <div
                      key={`slot-${i}`}
                      className={cn(
                        "absolute left-1 right-1 sm:left-1.5 sm:right-1.5 rounded",
                        "flex flex-col justify-center px-1.5 sm:px-2 overflow-hidden",
                        color, "text-white shadow-sm",
                      )}
                      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                      title={tooltip}
                    >
                      <p className="text-[10px] sm:text-xs font-semibold leading-tight truncate">
                        {slot.count} Buchung{slot.count !== 1 ? "en" : ""}
                      </p>
                      {heightPct > 4 && (
                        <p className="text-[9px] sm:text-[10px] leading-tight truncate opacity-80">
                          {slot.start}{slot.end ? ` – ${slot.end}` : ""}
                        </p>
                      )}
                      {heightPct > 7 && slot.names.length > 0 && (
                        <p className="text-[8px] sm:text-[9px] leading-tight truncate opacity-60 mt-px">
                          {slot.names.slice(0, 3).join(", ")}
                          {slot.count > 3 ? " …" : ""}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Now line */}
                {showNowLine && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: `${nowPct}%` }}
                  >
                    <div className="h-[2px] bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
