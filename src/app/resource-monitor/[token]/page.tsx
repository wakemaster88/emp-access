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

const HOUR_START = 10;
const HOUR_END = 20;
const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;
const ROW_HEIGHT_PX = 60;
const POLL_INTERVAL = 60_000;

function timeToMinutes(timeStr: string): number | null {
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToPx(minutes: number): number {
  const offset = minutes - HOUR_START * 60;
  return (offset / TOTAL_MINUTES) * (TOTAL_MINUTES / 60) * ROW_HEIGHT_PX;
}

function clampMinutes(min: number): number {
  return Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, min));
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

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

  useEffect(() => {
    if (data && scrollRef.current && !hasScrolled.current) {
      hasScrolled.current = true;
      const offset = minutesToPx(clampMinutes(nowMinutes) - 30);
      scrollRef.current.scrollTop = Math.max(0, offset);
    }
  }, [data, nowMinutes]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-lg">Monitor nicht gefunden oder inaktiv.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="h-5 w-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
          Laden…
        </div>
      </div>
    );
  }

  const totalHeight = (HOUR_END - HOUR_START) * ROW_HEIGHT_PX;
  const nowOffsetPx = minutesToPx(clampMinutes(nowMinutes));
  const showNowLine = nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const resources = data.resources;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-800 px-4 py-3 sm:px-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Ressourcen-Monitor</h1>
          <p className="text-sm text-slate-400">{formatDateDE(data.date)}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono font-bold tabular-nums text-emerald-400">{nowTime}</p>
          <p className="text-xs text-slate-500">{resources.length} Ressource{resources.length !== 1 ? "n" : ""}</p>
        </div>
      </header>

      {resources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500">Keine Ressourcen konfiguriert.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Column headers */}
          <div className="shrink-0 flex border-b border-slate-800">
            <div className="w-16 sm:w-20 shrink-0" />
            {resources.map((r) => (
              <div
                key={r.id}
                className="flex-1 min-w-[120px] px-2 py-2 text-center border-l border-slate-800"
              >
                <p className="text-sm font-medium truncate">{r.name}</p>
                <p className="text-xs text-slate-500">
                  {r.bookingCount} Buchung{r.bookingCount !== 1 ? "en" : ""}
                  {r.capacity != null && ` / ${r.capacity}`}
                </p>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div ref={scrollRef} className="flex-1 overflow-auto">
            <div className="flex" style={{ minHeight: totalHeight }}>
              {/* Time labels */}
              <div className="w-16 sm:w-20 shrink-0 relative" style={{ height: totalHeight }}>
                {hours.map((h) => {
                  const y = (h - HOUR_START) * ROW_HEIGHT_PX;
                  return (
                    <div
                      key={h}
                      className="absolute left-0 right-0 flex items-start justify-end pr-2 sm:pr-3"
                      style={{ top: y }}
                    >
                      <span className="text-xs text-slate-500 font-mono -mt-2 select-none">
                        {String(h).padStart(2, "0")}:00
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Resource columns */}
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex-1 min-w-[120px] relative border-l border-slate-800"
                  style={{ height: totalHeight }}
                >
                  {/* Hour grid lines */}
                  {hours.map((h) => {
                    const y = (h - HOUR_START) * ROW_HEIGHT_PX;
                    return (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-slate-800/60"
                        style={{ top: y }}
                      />
                    );
                  })}

                  {/* Half-hour lines */}
                  {hours.slice(0, -1).map((h) => {
                    const y = (h - HOUR_START) * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
                    return (
                      <div
                        key={`half-${h}`}
                        className="absolute left-0 right-0 border-t border-slate-800/30 border-dashed"
                        style={{ top: y }}
                      />
                    );
                  })}

                  {/* Availability blocks */}
                  {resource.availability.map((slot, i) => {
                    const startMin = timeToMinutes(slot.startTime);
                    const endMin = timeToMinutes(slot.endTime);
                    if (startMin == null || endMin == null) return null;
                    const top = minutesToPx(clampMinutes(startMin));
                    const bottom = minutesToPx(clampMinutes(endMin));
                    const height = bottom - top;
                    if (height <= 0) return null;
                    return (
                      <div
                        key={`avail-${i}`}
                        className="absolute left-1 right-1 rounded bg-emerald-900/30 border border-emerald-800/40"
                        style={{ top, height }}
                        title={`Verfügbar: ${slot.startTime} – ${slot.endTime}`}
                      />
                    );
                  })}

                  {/* Booking blocks */}
                  {resource.bookings.map((booking, i) => {
                    const startMin = timeToMinutes(booking.start);
                    const endMin = booking.end ? timeToMinutes(booking.end) : null;
                    if (startMin == null) return null;
                    const top = minutesToPx(clampMinutes(startMin));
                    const effectiveEndMin = endMin != null ? endMin : startMin + 60;
                    const bottom = minutesToPx(clampMinutes(effectiveEndMin));
                    const height = Math.max(bottom - top, 18);
                    return (
                      <div
                        key={`booking-${i}`}
                        className={cn(
                          "absolute left-2 right-2 rounded-sm px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden",
                          "bg-indigo-600/80 border border-indigo-500/60 text-white shadow-sm",
                        )}
                        style={{ top, height }}
                        title={`${booking.name}${booking.typeName ? ` (${booking.typeName})` : ""} · ${booking.start}${booking.end ? ` – ${booking.end}` : ""}`}
                      >
                        <p className="font-medium truncate">{booking.name}</p>
                        {height > 26 && booking.typeName && (
                          <p className="truncate text-indigo-200/80">{booking.typeName}</p>
                        )}
                      </div>
                    );
                  })}

                  {/* Now line per column */}
                  {showNowLine && (
                    <div
                      className="absolute left-0 right-0 z-20 pointer-events-none"
                      style={{ top: nowOffsetPx }}
                    >
                      <div className="h-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Global now line with time label (left gutter) */}
            {showNowLine && (
              <div
                className="absolute z-30 pointer-events-none flex items-center"
                style={{
                  top: `calc(${nowOffsetPx}px + var(--header-offset, 0px))`,
                  left: 0,
                  right: 0,
                }}
              >
                <span className="text-[10px] font-mono font-bold text-red-400 bg-slate-950 px-1 rounded">
                  {nowTime}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
