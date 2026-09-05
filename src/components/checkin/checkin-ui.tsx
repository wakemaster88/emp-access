"use client";

/**
 * Kleine Bausteine des Check-in-Kiosks: Abschnitte, Uhr, Tageswahl, Eingaben.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, Printer, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackageSearch } from "lucide-react";
import { exportCourseDayPdf } from "./checkin-print";
import type { CheckinTicket, GuestInfoSummary } from "./checkin-types";
import { aggregateRentalAddOns, formatSetup, isRentalAddOn, sortSummaryValues, toDateStr } from "./checkin-utils";

export function Section({ title, icon: Icon, count, color, children }: { title: string; icon: React.ComponentType<{ className?: string }>; count: number; color: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
    indigo: "text-indigo-400",
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", colors[color])} />
        <h2 className={cn("text-sm font-bold uppercase tracking-wider", colors[color])}>{title}</h2>
        <span className="text-xs font-mono font-bold text-slate-500 border border-slate-700 rounded-lg px-2 py-0.5 ml-auto">{count}</span>
      </div>
      {children}
    </div>
  );
}


/** Verleihmaterial-Bedarf des Tages. Steht ganz oben im Shop-Monitor, damit
 *  das Personal Neoprenanzuege, Boards und Helme vorbereiten kann, ohne jede
 *  Ticketkarte einzeln durchzugehen. */
export function RentalOverviewPanel({ tickets }: { tickets: CheckinTicket[] }) {
  const totals = useMemo(() => aggregateRentalAddOns(tickets), [tickets]);
  if (totals.length === 0) return null;
  const bookings = new Set(
    tickets.filter((t) => Array.isArray(t.addOns) && t.addOns.some((a) => isRentalAddOn(a.name)))
      .map((t) => t.annyOrderId ?? `ticket:${t.id}`),
  ).size;
  return (
    <div className="rounded-2xl border border-fuchsia-500/25 bg-fuchsia-950/20 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <PackageSearch className="h-4 w-4 text-fuchsia-400 shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-300">Verleihmaterial heute</span>
        <span className="text-[11px] text-slate-500">
          {bookings} {bookings === 1 ? "Buchung" : "Buchungen"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {totals.map((t) => (
          <span
            key={t.name}
            className="text-sm bg-fuchsia-500/15 text-fuchsia-100 border border-fuchsia-500/35 px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap"
          >
            {t.name} <span className="text-fuchsia-300">×{t.quantity}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Aggregierte Equipment-Übersicht einer Kurs-Gruppe: kombinierte Board-
 *  Setups ("Wakeboard · Anfänger · Gr. 38 ×2"), Neopren-Größen der Leiher
 *  und restliche Infos – damit das Personal das Material fuer den Tag
 *  vorbereiten kann, ohne jede Karte einzeln durchzugehen. Inklusive
 *  PDF-Export als A4-Kursblatt. */
export function GuestInfoSummaryPanel({
  summary,
  groupName,
  dateStr,
  accountName,
}: {
  summary: GuestInfoSummary;
  groupName: string;
  dateStr: string;
  accountName: string;
}) {
  const [exporting, setExporting] = useState(false);
  const hasContent = summary.setups.length > 0 || summary.neopren.size > 0 || summary.labels.size > 0;
  if (!hasContent) return null;
  return (
    <div className="mb-2 rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <ClipboardList className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">Tagesübersicht</span>
        <span className="text-[10px] text-slate-500">
          {summary.answered}/{summary.total} beantwortet
        </span>
        <button
          type="button"
          disabled={exporting}
          onClick={async (e) => {
            e.stopPropagation();
            setExporting(true);
            try {
              void exportCourseDayPdf(groupName, dateStr, accountName, summary);
            } finally {
              setExporting(false);
            }
          }}
          className="ml-auto flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
          PDF
        </button>
      </div>
      <div className="space-y-1">
        {summary.setups.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] text-slate-400 mr-1">Material:</span>
            {summary.setups.map((s) => (
              <span
                key={`${s.sport}|${s.level}|${s.shoe}`}
                className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md font-medium whitespace-nowrap"
              >
                {formatSetup(s)} <span className="text-cyan-400/80">×{s.count}</span>
              </span>
            ))}
          </div>
        )}
        {summary.neopren.size > 0 && (
          <div className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] text-slate-400 mr-1">Neopren:</span>
            {sortSummaryValues(summary.neopren).map(([size, count]) => (
              <span key={size} className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md font-medium whitespace-nowrap">
                {size} <span className="text-cyan-400/80">×{count}</span>
              </span>
            ))}
          </div>
        )}
        {[...summary.labels.entries()].map(([label, values]) => (
          <div key={label} className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] text-slate-400 mr-1">{label}:</span>
            {sortSummaryValues(values).map(([value, count]) => (
              <span key={value} className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md font-medium whitespace-nowrap">
                {value} <span className="text-cyan-400/80">×{count}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}


export function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-slate-500 shrink-0" />
      <span className="text-xs text-slate-500 w-16">{label}</span>
      <span className="text-sm text-slate-200 font-mono truncate">{value}</span>
    </div>
  );
}

/* ──── Add Ticket Overlay ──── */

export function RfidInput({ value, onChange, onSubmit, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (code: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    bufferRef.current = val;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const code = bufferRef.current.trim();
      if (code.length >= 4) {
        onSubmit(code);
      }
      bufferRef.current = "";
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      bufferRef.current = "";
      const code = value.trim();
      if (code) onSubmit(code);
    }
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      placeholder="RFID scannen oder eingeben"
      className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      autoFocus
    />
  );
}

export function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-sm font-mono font-bold text-slate-300 tabular-nums bg-slate-800 px-3 py-2 rounded-xl">{time}</span>;
}

export function DaySelector({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(date);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const todayStrGlobal = toDateStr(new Date());

  const days = useMemo(() => {
    const result: { date: string; label: string; isToday: boolean }[] = [];
    const center = new Date(date + "T12:00:00");
    for (let i = -3; i <= 3; i++) {
      const d = new Date(center);
      d.setDate(d.getDate() + i);
      const ds = toDateStr(d);
      result.push({
        date: ds,
        label: d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
        isToday: ds === todayStrGlobal,
      });
    }
    return result;
  }, [date, todayStrGlobal]);

  const calDays = useMemo(() => {
    const { year, month } = calMonth;
    const first = new Date(year, month, 1);
    const startDay = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows: (Date | null)[][] = [];
    let row: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) row.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      row.push(new Date(year, month, d));
      if (row.length === 7) { rows.push(row); row = []; }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }
    return rows;
  }, [calMonth]);

  const selectedDate = new Date(date);
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <>
      <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-800 overflow-x-auto">
        <button onClick={() => { const d = new Date(date); d.setDate(d.getDate() - 1); onChange(toDateStr(d)); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 shrink-0">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex gap-1.5 flex-1 justify-center">
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => onChange(d.date)}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-semibold transition-all min-w-[4.5rem] active:scale-95",
                d.date === date
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : d.isToday
                  ? "bg-slate-800 text-indigo-400 ring-1 ring-indigo-500/30"
                  : "bg-slate-800/50 text-slate-400 hover:bg-slate-800"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setCalMonth({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() }); setCalOpen(true); }}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 shrink-0"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <button onClick={() => { const d = new Date(date); d.setDate(d.getDate() + 1); onChange(toDateStr(d)); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 shrink-0">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {calOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setCalOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] w-full sm:w-[340px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCalMonth((p) => { const m = p.month - 1; return m < 0 ? { year: p.year - 1, month: 11 } : { ...p, month: m }; })} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm font-bold text-white capitalize">{monthLabel}</span>
              <button onClick={() => setCalMonth((p) => { const m = p.month + 1; return m > 11 ? { year: p.year + 1, month: 0 } : { ...p, month: m }; })} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((wd) => (
                <div key={wd} className="text-center text-[11px] font-bold text-slate-500 py-1">{wd}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calDays.flat().map((d, i) => {
                if (!d) return <div key={`e${i}`} />;
                const ds = toDateStr(d);
                const isSelected = ds === date;
                const isToday = ds === todayStrGlobal;
                return (
                  <button
                    key={ds}
                    onClick={() => { onChange(ds); setCalOpen(false); }}
                    className={cn(
                      "w-10 h-10 rounded-xl text-sm font-semibold transition-all active:scale-90",
                      isSelected
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                        : isToday
                        ? "bg-slate-800 text-indigo-400 ring-1 ring-indigo-500/30"
                        : "text-slate-300 hover:bg-slate-800"
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-between">
              <button
                onClick={() => { onChange(todayStrGlobal); setCalOpen(false); }}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 px-3 py-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                Heute
              </button>
              <button
                onClick={() => setCalOpen(false)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-300 px-3 py-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function StatPill({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
    indigo: "text-indigo-400",
  };
  return (
    <div className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-3 py-1.5">
      <Icon className={cn("h-4 w-4", colors[color ?? "indigo"] ?? "text-slate-400")} />
      <span className="text-xs text-slate-400">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", colors[color ?? "indigo"] ?? "text-white")}>{value}</span>
    </div>
  );
}

