"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { cn } from "@/lib/utils";

interface AvailabilitySlot {
  startTime: string;
  endTime: string;
}

interface Booking {
  name: string;
  typeName: string | null;
  start: string;
  end: string;
}

interface Resource {
  id: number;
  name: string;
  capacity: number | null;
  availability: AvailabilitySlot[];
  bookingCount: number;
  bookings: Booking[];
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
const HEADER_HEIGHT = 56;
const COL_HEADER_HEIGHT = 44;
const TIME_GUTTER = 52;

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
      <div className="h-screen bg-white flex items-center justify-center">
        <p className="text-slate-400 text-lg">Monitor nicht gefunden oder inaktiv.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
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
  const gridHeight = `calc(100vh - ${HEADER_HEIGHT + COL_HEADER_HEIGHT}px)`;

  return (
    <div className="h-screen bg-white text-slate-900 flex flex-col overflow-hidden select-none">
      {/* Header */}
      <header
        className="shrink-0 bg-white border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">Ressourcen-Monitor</h1>
          <p className="text-xs sm:text-sm text-slate-400 truncate">{formatDateDE(data.date)}</p>
        </div>
        <div className="text-right shrink-0 pl-3">
          <p className="text-xl sm:text-2xl font-mono font-bold tabular-nums text-emerald-600">{nowTime}</p>
          <p className="text-[10px] sm:text-xs text-slate-400">{resources.length} Ressource{resources.length !== 1 ? "n" : ""}</p>
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
            className="shrink-0 flex border-b border-slate-200 bg-slate-50"
            style={{ height: COL_HEADER_HEIGHT }}
          >
            <div className="shrink-0" style={{ width: TIME_GUTTER }} />
            {resources.map((r) => (
              <div
                key={r.id}
                className="flex-1 min-w-0 px-1 flex flex-col items-center justify-center border-l border-slate-200"
              >
                <p className="text-xs sm:text-sm font-semibold truncate max-w-full">{r.name}</p>
                <p className="text-[10px] sm:text-xs text-slate-400 tabular-nums">
                  {r.bookingCount}{r.capacity != null ? `/${r.capacity}` : ""}
                </p>
              </div>
            ))}
          </div>

          {/* Grid area — fills remaining viewport */}
          <div
            ref={gridRef}
            className="relative flex overflow-hidden"
            style={{ height: gridHeight }}
          >
            {/* Time gutter */}
            <div
              className="shrink-0 relative bg-white z-10"
              style={{ width: TIME_GUTTER, height: "100%" }}
            >
              {hours.map((h) => {
                const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                return (
                  <div
                    key={h}
                    className="absolute right-0 left-0 flex justify-end pr-1.5 sm:pr-2"
                    style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
                  >
                    <span className="text-[10px] sm:text-xs text-slate-400 font-mono leading-none">
                      {String(h).padStart(2, "0")}:00
                    </span>
                  </div>
                );
              })}

              {/* Now label in gutter */}
              {showNowLine && (
                <div
                  className="absolute left-0 right-0 flex justify-end pr-1.5 sm:pr-2 z-30"
                  style={{ top: `${nowPct}%`, transform: "translateY(-50%)" }}
                >
                  <span className="text-[10px] font-mono font-bold text-red-500 bg-white px-0.5 rounded leading-none">
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
                style={{ height: "100%" }}
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
                      className="absolute left-0 right-0 border-t border-slate-50"
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
                      className="absolute left-0.5 right-0.5 sm:left-1 sm:right-1 rounded-sm bg-emerald-50 border border-emerald-200/60"
                      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                      title={`Verfügbar: ${slot.startTime} – ${slot.endTime}`}
                    />
                  );
                })}

                {/* Booking blocks */}
                {resource.bookings.map((booking, i) => {
                  const startMin = timeToMinutes(booking.start);
                  const endMin = booking.end ? timeToMinutes(booking.end) : null;
                  if (startMin == null) return null;
                  const topPct = minutesToPercent(clampMinutes(startMin));
                  const effectiveEndMin = endMin != null ? endMin : startMin + 60;
                  const bottomPct = minutesToPercent(clampMinutes(effectiveEndMin));
                  const heightPct = Math.max(bottomPct - topPct, 1.5);
                  return (
                    <div
                      key={`booking-${i}`}
                      className={cn(
                        "absolute left-1 right-1 sm:left-1.5 sm:right-1.5 rounded px-1 sm:px-1.5 py-px overflow-hidden",
                        "bg-indigo-500 text-white text-[9px] sm:text-[10px] leading-tight shadow-sm",
                      )}
                      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                      title={`${booking.name}${booking.typeName ? ` (${booking.typeName})` : ""} · ${booking.start}${booking.end ? ` – ${booking.end}` : ""}`}
                    >
                      <p className="font-medium truncate">{booking.name}</p>
                      {heightPct > 3 && booking.typeName && (
                        <p className="truncate opacity-75">{booking.typeName}</p>
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
