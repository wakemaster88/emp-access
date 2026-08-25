"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Loader2,
  RotateCw,
  ScanLine,
  Ticket as TicketIcon,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const AREA_STORAGE_KEY = "dashboard:turnstileAreaId";

interface AreaOption {
  id: number;
  name: string;
  deviceCount: number;
}

interface TurnstileDevice {
  id: number;
  name: string;
  direction: "IN" | "OUT" | "BOTH";
  isActive: boolean;
  online: boolean;
  rides: number;
  denied: number;
  total: number;
  lastScanAt: string | null;
}

interface HourBucket {
  hour: string;
  granted: number;
  denied: number;
  total: number;
}

interface TrendDay {
  date: string;
  dayName: string;
  rides: number;
  denied: number;
  guests: number;
}

export interface TurnstileData {
  date: string;
  areas: AreaOption[];
  area: { id: number; name: string; personLimit: number | null } | null;
  totals?: {
    scans: number;
    rides: number;
    denied: number;
    protected: number;
    guests: number;
    ridesWithoutTicket: number;
    grantRate: number;
    ridesPerGuest: number;
    soldTickets: number;
    firstScanAt: string | null;
    lastScanAt: string | null;
    peakHour: { hour: string; count: number } | null;
  };
  average?: { rides: number; guests: number; days: number } | null;
  previousDay?: { rides: number; guests: number } | null;
  devices?: TurnstileDevice[];
  hourly?: HourBucket[];
  ticketTypes?: { name: string; rides: number; guests: number }[];
  denyReasons?: { reason: string; count: number }[];
  weekTrend?: TrendDay[];
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#e2e8f0",
  padding: "6px 10px",
};

const DIRECTION_LABEL: Record<TurnstileDevice["direction"], string> = {
  IN: "Eingang",
  OUT: "Ausgang",
  BOTH: "Ein/Aus",
};

function fmtNum(n: number): string {
  return n.toLocaleString("de-DE");
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function Kpi({
  label,
  value,
  icon,
  hint,
  delta,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number | null;
}) {
  return (
    <div className="px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{label}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-none">{value}</p>
        {delta != null && (
          <span
            className={cn(
              "flex items-center text-[10px] font-semibold tabular-nums",
              delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500",
            )}
          >
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-slate-400 mt-1 truncate">{hint}</p>}
    </div>
  );
}

/** Waagerechte Balkenliste (Ticket-Typen, Ablehnungsgründe). */
function BarList({
  rows,
  emptyText,
  barClass,
}: {
  rows: { key: string; label: string; value: number; sub?: string }[];
  emptyText: string;
  barClass: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  if (rows.length === 0) {
    return <p className="py-8 text-center text-xs text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-slate-700 dark:text-slate-300 truncate flex-1 min-w-0">{row.label}</span>
            {row.sub && <span className="text-slate-400 tabular-nums shrink-0">{row.sub}</span>}
            <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">
              {fmtNum(row.value)}
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full", barClass)} style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
      {children}
    </p>
  );
}

/** Zuletzt gewählter Bereich, damit die Auswahl den Seitenwechsel überlebt. */
function storedAreaId(): number | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(AREA_STORAGE_KEY);
  return stored && Number.isInteger(Number(stored)) ? Number(stored) : null;
}

export function TurnstileCard({ date }: { date: string }) {
  const [data, setData] = useState<TurnstileData | null>(null);
  const [areaId, setAreaId] = useState<number | null>(storedAreaId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTurnstile() {
      try {
        const params = new URLSearchParams({ date });
        if (areaId != null) params.set("areaId", String(areaId));
        const res = await fetch(`/api/dashboard/turnstile?${params}`);
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    loadTurnstile();
    const t = setInterval(loadTurnstile, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [date, areaId]);

  function selectArea(next: string) {
    window.localStorage.setItem(AREA_STORAGE_KEY, next);
    setAreaId(Number(next));
  }

  if (failed && !data) return null;

  if (!data) {
    return (
      <Card className="py-0 gap-0 overflow-hidden">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
        </div>
      </Card>
    );
  }

  if (!data.area || !data.totals) return null;

  const { area, totals, hourly = [], devices = [], ticketTypes = [], denyReasons = [], weekTrend = [] } = data;
  const average = data.average ?? null;
  const ridesDelta =
    average && average.rides > 0 ? Math.round(((totals.rides - average.rides) / average.rides) * 100) : null;
  const guestsDelta =
    average && average.guests > 0 ? Math.round(((totals.guests - average.guests) / average.guests) * 100) : null;
  const maxTrendRides = weekTrend.reduce((m, d) => Math.max(m, d.rides), 0);
  const openFrom = fmtTime(totals.firstScanAt);
  const openUntil = fmtTime(totals.lastScanAt);

  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100 min-w-0">
          <RotateCw className="h-3.5 w-3.5 text-teal-500 shrink-0" />
          <span className="truncate">Drehkreuz {area.name}</span>
        </span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums shrink-0">
          echte Fahrten
        </Badge>
        <div className="ml-auto shrink-0">
          <Select value={String(area.id)} onValueChange={selectArea}>
            <SelectTrigger size="sm" className="text-xs w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.areas.map((a) => (
                <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800">
        <Kpi
          label="Fahrten"
          value={fmtNum(totals.rides)}
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
          delta={ridesDelta}
          hint={
            average
              ? <>Ø {fmtNum(average.rides)} an {average.days} Vergleichstagen</>
              : openFrom && openUntil
                ? <>Betrieb {openFrom}–{openUntil} Uhr</>
                : "Drehkreuz-Durchgänge"
          }
        />
        <Kpi
          label="Gäste"
          value={fmtNum(totals.guests)}
          icon={<Users className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
          delta={guestsDelta}
          hint={
            totals.guests > 0
              ? <>Ø {totals.ridesPerGuest.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Fahrten/Gast</>
              : "eindeutige Tickets am Drehkreuz"
          }
        />
        <Kpi
          label="Tickets"
          value={fmtNum(totals.soldTickets)}
          icon={<TicketIcon className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
          hint={
            totals.ridesWithoutTicket > 0
              ? <>heute angelegt · +{fmtNum(totals.ridesWithoutTicket)} ohne Ticket</>
              : "heute für diesen Bereich angelegt"
          }
        />
        <Kpi
          label="Scans"
          value={fmtNum(totals.scans)}
          icon={<ScanLine className="h-3.5 w-3.5 text-sky-500 shrink-0" />}
          hint={
            totals.scans > 0
              ? totals.denied > 0
                ? <><span className="text-emerald-600 font-medium">{totals.grantRate}%</span> Erfolg · {fmtNum(totals.denied)} abgelehnt</>
                : <><span className="text-emerald-600 font-medium">{totals.grantRate}%</span> Erfolg, keine Ablehnung</>
              : "Keine Scans"
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
        <div className="lg:col-span-2 px-3 py-3">
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <BarChart3 className="h-3 w-3 text-teal-500" />
              Fahrten im Tagesverlauf
            </span>
          </SectionTitle>
          {totals.scans === 0 ? (
            <p className="py-14 text-center text-xs text-slate-400">Keine Scans an diesem Tag.</p>
          ) : (
            <>
              <div className="h-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={2} />
                    <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "rgba(20, 184, 166, 0.08)" }} />
                    <Bar dataKey="granted" name="Fahrten" stackId="a" fill="#14b8a6" />
                    <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="#f87171" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {totals.peakHour && (
                <p className="text-[10px] text-slate-500 mt-1 text-center">
                  Spitze um <span className="font-semibold text-slate-700 dark:text-slate-300">{totals.peakHour.hour}</span> mit {fmtNum(totals.peakHour.count)} Scans
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-3 py-3">
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <TicketIcon className="h-3 w-3 text-indigo-500" />
              Ticket-Typen
            </span>
          </SectionTitle>
          <BarList
            rows={ticketTypes.map((t) => ({
              key: t.name,
              label: t.name,
              value: t.rides,
              sub: `${fmtNum(t.guests)} Gäste`,
            }))}
            emptyText="Keine Fahrten an diesem Tag."
            barClass="bg-indigo-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
        <div className="px-3 py-3">
          <SectionTitle>Leser</SectionTitle>
          <div className="space-y-2">
            {devices.map((d) => {
              const rate = d.total > 0 ? Math.round((d.rides / d.total) * 100) : 0;
              const last = fmtTime(d.lastScanAt);
              return (
                <div key={d.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full shrink-0", d.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600")}
                      title={d.online ? "Online" : "Kein Heartbeat"}
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300 truncate flex-1 min-w-0">{d.name}</span>
                    <span className="text-[9px] text-slate-400 shrink-0 hidden sm:inline">{DIRECTION_LABEL[d.direction]}</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">{fmtNum(d.rides)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                    <div className="bg-teal-500 h-full" style={{ width: `${totals.rides > 0 ? (d.rides / totals.rides) * 100 : 0}%` }} />
                  </div>
                  <p className="text-[9px] text-slate-400">
                    {d.total > 0 ? <>{rate}% erfolgreich{last && <> · letzter Scan {last}</>}</> : "Keine Scans an diesem Tag"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-3 py-3">
          <SectionTitle>Ablehnungsgründe</SectionTitle>
          <BarList
            rows={denyReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))}
            emptyText="Keine Ablehnungen an diesem Tag."
            barClass="bg-rose-400"
          />
        </div>

        <div className="px-3 py-3">
          <SectionTitle>7 Tage</SectionTitle>
          {maxTrendRides === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">Keine Fahrten in den letzten 7 Tagen.</p>
          ) : (
            <div className="space-y-1.5">
              {weekTrend.map((d) => (
                <div key={d.date} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] w-7 shrink-0 uppercase",
                      d.date === data.date ? "font-bold text-slate-700 dark:text-slate-200" : "text-slate-400",
                    )}
                  >
                    {d.dayName}
                  </span>
                  <div className="h-2 flex-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", d.date === data.date ? "bg-teal-500" : "bg-teal-500/40")}
                      style={{ width: `${(d.rides / maxTrendRides) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400 w-9 text-right shrink-0">
                    {fmtNum(d.rides)}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-400 w-7 text-right shrink-0 hidden sm:inline">
                    {fmtNum(d.guests)}
                  </span>
                </div>
              ))}
              <p className="text-[9px] text-slate-400 pt-1">Fahrten · Gäste je Tag</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
