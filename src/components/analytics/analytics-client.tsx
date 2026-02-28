"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ScanLine,
  ShieldCheck,
  ShieldX,
  Ticket,
  Users,
  BarChart3,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";

type Mode = "day" | "week" | "month" | "year" | "custom";

interface Summary {
  totalScans: number;
  grantedScans: number;
  deniedScans: number;
  grantRate: number;
  uniqueTicketsScanned: number;
  totalTickets: number;
  validTickets: number;
  redeemedTickets: number;
  annyTickets: number;
}

interface TimelineBucket {
  label: string;
  granted: number;
  denied: number;
  total: number;
}

interface NameCount {
  name: string;
  count?: number;
  scans?: number;
  granted?: number;
  denied?: number;
  total?: number;
}

interface HourCount {
  hour: string;
  count: number;
}

interface AnalyticsData {
  mode: string;
  rangeStart: string;
  rangeEnd: string;
  summary: Summary;
  timeline: TimelineBucket[];
  byArea: NameCount[];
  byDevice: NameCount[];
  byType: NameCount[];
  peakHours: HourCount[];
}

function toLocaleDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtRange(start: string, end: string, mode: string): string {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };
  const shortOpts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };

  switch (mode) {
    case "day":
      return s.toLocaleDateString("de-DE", { weekday: "long", ...opts });
    case "week":
      return `${s.toLocaleDateString("de-DE", shortOpts)} – ${e.toLocaleDateString("de-DE", shortOpts)} ${e.getFullYear()}`;
    case "month":
      return s.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    case "year":
      return `${s.getFullYear()}`;
    default:
      return `${s.toLocaleDateString("de-DE", shortOpts)} – ${e.toLocaleDateString("de-DE", shortOpts)} ${e.getFullYear()}`;
  }
}

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8", "#4f46e5", "#7c3aed", "#5b21b6"];
const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <Card className="border-slate-200 dark:border-slate-800 py-0">
      <CardContent className="p-3 sm:p-4 flex items-center gap-3">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
          <p className="text-[11px] text-slate-500 truncate">{label}</p>
          {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function AnalyticsClient() {
  const [mode, setMode] = useState<Mode>("week");
  const [date, setDate] = useState(toLocaleDateStr(new Date()));
  const [customFrom, setCustomFrom] = useState(toLocaleDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocaleDateStr(new Date()));
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ mode, date });
      if (mode === "custom") {
        params.set("from", customFrom);
        params.set("to", customTo);
      }
      const res = await fetch(`/api/analytics?${params}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [mode, date, customFrom, customTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function navigate(dir: -1 | 1) {
    const d = new Date(date + "T12:00:00");
    switch (mode) {
      case "day": d.setDate(d.getDate() + dir); break;
      case "week": d.setDate(d.getDate() + dir * 7); break;
      case "month": d.setMonth(d.getMonth() + dir); break;
      case "year": d.setFullYear(d.getFullYear() + dir); break;
    }
    setDate(toLocaleDateStr(d));
  }

  function goToday() {
    setDate(toLocaleDateStr(new Date()));
  }

  const modes: { id: Mode; label: string }[] = [
    { id: "day", label: "Tag" },
    { id: "week", label: "Woche" },
    { id: "month", label: "Monat" },
    { id: "year", label: "Jahr" },
    { id: "custom", label: "Individuell" },
  ];

  const s = data?.summary;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === m.id
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode !== "custom" ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={goToday}>
              Heute
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {data && (
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 ml-1">
                {fmtRange(data.rangeStart, data.rangeEnd, data.mode)}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="h-8 text-xs w-36"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-slate-400">–</span>
            <Input
              type="date"
              className="h-8 text-xs w-36"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}

        {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
      </div>

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={ScanLine} label="Scans gesamt" value={s.totalScans} color="bg-indigo-500" />
          <StatCard
            icon={ShieldCheck}
            label="Erlaubt"
            value={s.grantedScans}
            sub={`${s.grantRate}% Erfolgsrate`}
            color="bg-emerald-500"
          />
          <StatCard icon={ShieldX} label="Abgelehnt" value={s.deniedScans} color="bg-rose-500" />
          <StatCard
            icon={Ticket}
            label="Aktive Tickets"
            value={s.totalTickets}
            sub={`${s.annyTickets} via ANNY`}
            color="bg-violet-500"
          />
        </div>
      )}

      {/* Main chart: Scans timeline */}
      {data && data.timeline.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-3 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Scan-Verlauf</h3>
              <div className="flex items-center gap-3 ml-auto">
                <span className="flex items-center gap-1 text-[10px] text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Erlaubt
                </span>
                <span className="flex items-center gap-1 text-[10px] text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-rose-400" /> Abgelehnt
                </span>
              </div>
            </div>
            <div className="h-[220px] sm:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#e2e8f0",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="granted"
                    name="Erlaubt"
                    stackId="1"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.3}
                  />
                  <Area
                    type="monotone"
                    dataKey="denied"
                    name="Abgelehnt"
                    stackId="1"
                    stroke="#f87171"
                    fill="#f87171"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom row: By Type + By Device + Peak Hours */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Tickets by type */}
          {data.byType.length > 0 && (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-3 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-violet-500" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tickets nach Typ</h3>
                </div>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.byType}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={2}
                      >
                        {data.byType.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1e293b",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "#e2e8f0",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-2">
                  {data.byType.slice(0, 6).map((t, i) => (
                    <div key={t.name} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate flex-1">{t.name}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{t.count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scans by device */}
          {data.byDevice.length > 0 && (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-3 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <ScanLine className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Scans nach Gerät</h3>
                </div>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.byDevice}
                      layout="vertical"
                      margin={{ top: 0, right: 5, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        width={90}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1e293b",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "#e2e8f0",
                        }}
                      />
                      <Bar dataKey="granted" name="Erlaubt" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="#f87171" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Peak hours */}
          {s && s.totalScans > 0 && (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-3 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Stoßzeiten</h3>
                </div>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.peakHours.filter((h) => {
                        const hr = parseInt(h.hour);
                        return hr >= 6 && hr <= 22;
                      })}
                      margin={{ top: 0, right: 5, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 9, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        interval={1}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1e293b",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "#e2e8f0",
                        }}
                      />
                      <Bar dataKey="count" name="Scans" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Area utilization */}
      {data && data.byArea.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-3 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Auslastung nach Bereich</h3>
            </div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byArea} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#e2e8f0",
                    }}
                  />
                  <Bar dataKey="scans" name="Scans" fill="#6366f1" radius={[4, 4, 0, 0]}>
                    {data.byArea.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data && s && s.totalScans === 0 && s.totalTickets === 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Keine Daten für diesen Zeitraum</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
