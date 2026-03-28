"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { cn } from "@/lib/utils";

interface TimeSlot {
  start: string;
  end: string;
  status: "free" | "booked";
  count: number;
  names: string[];
  capacity: number | null;
  source?: string;
  isPublic?: boolean;
}

interface Resource {
  id: number;
  name: string;
  capacity: number | null;
  totalBooked: number;
  slots: TimeSlot[];
}

interface MonitorData {
  name: string;
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
const COL_HEADER_HEIGHT = 36;
const TIME_GUTTER = 54;
const GRID_PAD = 12;

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
  const [selectedDate, setSelectedDate] = useState<string>("");
  const gridRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const todayBerlin = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const isToday = !selectedDate || selectedDate === todayBerlin;

  const fetchData = useCallback(async () => {
    try {
      const dateParam = selectedDate ? `?date=${selectedDate}` : "";
      const res = await fetch(`/api/monitor/public/${token}/resources${dateParam}`);
      if (!res.ok) { setError(true); return; }
      const json: MonitorData = await res.json();
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, [token, selectedDate]);

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
        <p className="text-gray-500 text-lg">Monitor nicht gefunden oder inaktiv.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-dvh bg-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="h-5 w-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Laden…
        </div>
      </div>
    );
  }

  const nowPct = minutesToPercent(clampMinutes(nowMinutes));
  const showNowLine = isToday && nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);
  const resources = data.resources;

  return (
    <div className="h-dvh bg-white text-gray-900 flex flex-col overflow-hidden select-none">
      {/* Header */}
      <header
        className="shrink-0 bg-gray-50 border-b border-gray-300 px-3 sm:px-5 flex items-center justify-between"
        style={{ height: HEADER_HEIGHT }}
      >
        <h1 className="text-sm sm:text-base font-bold tracking-tight truncate text-gray-900">{data.name}</h1>
        <div className="flex items-baseline gap-2 sm:gap-3 shrink-0 pl-3">
          <button
            type="button"
            onClick={() => dateInputRef.current?.showPicker()}
            className="text-[11px] sm:text-xs text-gray-500 hover:text-gray-900 truncate cursor-pointer underline decoration-dotted underline-offset-2 transition-colors"
          >
            {formatDateDE(data.date)}
          </button>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate || todayBerlin}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate("")}
              className="text-[10px] sm:text-xs text-emerald-600 hover:text-emerald-800 font-medium transition-colors"
            >
              Heute
            </button>
          )}
          <p className="text-lg sm:text-2xl font-mono font-bold tabular-nums text-emerald-600">{nowTime}</p>
        </div>
      </header>

      {resources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">Keine Ressourcen konfiguriert.</p>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div
            className="shrink-0 flex border-b border-gray-300 bg-gray-50"
            style={{ height: COL_HEADER_HEIGHT }}
          >
            <div className="shrink-0" style={{ width: TIME_GUTTER }} />
            {resources.map((r) => (
              <div
                key={r.id}
                className="flex-1 min-w-0 px-1 flex items-center justify-center border-l border-gray-300"
              >
                <p className="text-sm sm:text-base font-bold truncate max-w-full text-gray-900">{r.name}</p>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div
            ref={gridRef}
            className="flex flex-1 overflow-hidden"
            style={{ paddingTop: GRID_PAD, paddingBottom: GRID_PAD }}
          >
            <div className="relative flex w-full h-full">
              {/* Time gutter */}
              <div className="shrink-0 relative z-10" style={{ width: TIME_GUTTER }}>
                {hours.map((h) => {
                  const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                  return (
                    <div
                      key={h}
                      className="absolute right-0 left-0 flex justify-end pr-1.5 sm:pr-2"
                      style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
                    >
                      <span className="text-[10px] sm:text-xs text-gray-500 font-mono font-medium leading-none tabular-nums">
                        {String(h).padStart(2, "0")}:00
                      </span>
                    </div>
                  );
                })}

                {showNowLine && (
                  <div
                    className="absolute left-0 right-0 flex justify-end pr-1.5 sm:pr-2 z-30"
                    style={{ top: `${nowPct}%`, transform: "translateY(-50%)" }}
                  >
                    <span className="text-[10px] sm:text-xs font-mono font-bold text-red-600 bg-white px-0.5 rounded leading-none tabular-nums">
                      {nowTime}
                    </span>
                  </div>
                )}
              </div>

              {/* Resource columns */}
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex-1 min-w-0 relative border-l border-gray-300"
                >
                  {/* Hour lines */}
                  {hours.map((h) => {
                    const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                    return (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-gray-200"
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
                        className="absolute left-0 right-0 border-t border-dashed border-gray-100"
                        style={{ top: `${pct}%` }}
                      />
                    );
                  })}

                  {/* Slots: free (green), public/ÖB (blue), booked (red) */}
                  {resource.slots.map((slot, i) => {
                    const startMin = timeToMinutes(slot.start);
                    const endMin = slot.end ? timeToMinutes(slot.end) : null;
                    if (startMin == null) return null;
                    const topPct = minutesToPercent(clampMinutes(startMin));
                    const effectiveEndMin = endMin != null ? endMin : startMin + 60;
                    const bottomPct = minutesToPercent(clampMinutes(effectiveEndMin));
                    const heightPct = Math.max(bottomPct - topPct, 2);
                    const isFree = slot.status === "free";
                    const isPublic = isFree && slot.isPublic;

                    return (
                      <div
                        key={`slot-${i}`}
                        className={cn(
                          "absolute left-1 right-1 sm:left-1.5 sm:right-1.5 rounded",
                          "flex flex-col justify-center px-1.5 sm:px-2 overflow-hidden shadow-sm border",
                          isFree
                            ? isPublic
                              ? "bg-sky-50 border-sky-300 text-sky-800 z-[2]"
                              : "bg-emerald-50 border-emerald-300 text-emerald-800 z-[1]"
                            : "bg-red-50 border-red-300 text-red-900 z-[5]",
                        )}
                        style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                        title={isFree
                          ? `${slot.source ? slot.source + ": " : ""}Frei ${slot.start} – ${slot.end}`
                          : `${slot.count}x gebucht: ${slot.start} – ${slot.end}\n${slot.names.join(", ")}`}
                      >
                        {isFree ? (
                          <>
                            <p className="text-[10px] sm:text-xs font-bold leading-tight truncate">
                              {isPublic && slot.source ? slot.source : "Frei"}
                            </p>
                            {heightPct > 4 && (
                              <p className="text-[9px] sm:text-[10px] font-medium leading-tight truncate opacity-70">
                                {slot.start} – {slot.end}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-[10px] sm:text-xs font-bold leading-tight truncate">
                              {slot.count}x gebucht
                            </p>
                            {heightPct > 4 && (
                              <p className="text-[9px] sm:text-[10px] font-medium leading-tight truncate opacity-70">
                                {slot.start} – {slot.end}
                              </p>
                            )}
                            {heightPct > 7 && slot.names.length > 0 && (
                              <p className="text-[8px] sm:text-[9px] leading-tight truncate opacity-60 mt-px">
                                {slot.names.slice(0, 3).join(", ")}
                                {slot.count > 3 ? " …" : ""}
                              </p>
                            )}
                          </>
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
                      <div className="h-[2px] bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
