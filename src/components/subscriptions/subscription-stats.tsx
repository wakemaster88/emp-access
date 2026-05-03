"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  CalendarPlus,
  CalendarX,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import type { SubscriptionStats as Stats, SubscriptionTopRow } from "@/lib/subscription-stats";
import { cn } from "@/lib/utils";

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#e2e8f0",
  padding: "6px 10px",
};

function fmtMonth(iso: string): string {
  const [, m] = iso.split("-").map(Number);
  return ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][m - 1] ?? "";
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  iconClass,
  valueClass,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  iconClass?: string;
  valueClass?: string;
}) {
  return (
    <Card className="py-3 px-4 gap-1.5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Icon className={cn("h-3.5 w-3.5", iconClass ?? "text-slate-500")} />
        <span className="font-medium">{label}</span>
      </div>
      <div className={cn("text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100", valueClass)}>
        {value}
      </div>
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

function TimelineChart({ data, windowDays }: { data: Stats["timeline"]; windowDays: number }) {
  const totalActive = data[data.length - 1]?.active ?? 0;
  const totalNew = data.reduce((s, d) => s + d.newCount, 0);
  const totalExpired = data.reduce((s, d) => s + d.expiredCount, 0);

  // Bei 365 Datenpunkten ist die X-Achse zu eng – nur ~6 Ticks anzeigen.
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-indigo-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Abo-Verlauf</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Bestand der letzten {windowDays} Tage
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            Bestand
            <span className="text-slate-700 dark:text-slate-300 font-semibold ml-0.5 tabular-nums">
              {totalActive}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Neu
            <span className="text-slate-700 dark:text-slate-300 font-semibold ml-0.5 tabular-nums">
              {totalNew}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Auslauf
            <span className="text-slate-700 dark:text-slate-300 font-semibold ml-0.5 tabular-nums">
              {totalExpired}
            </span>
          </span>
        </div>
      </div>
      <div className="px-3 pt-3 pb-3">
        {data.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Keine Daten im Zeitraum.</p>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="aboActiveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="aboNewGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="aboExpiredGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  interval={tickInterval}
                  tickFormatter={(value: string) => fmtMonth(value)}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelFormatter={(label) => (typeof label === "string" ? fmtDate(label) : "")}
                  formatter={(value, name) => {
                    const labels: Record<string, string> = {
                      active: "Bestand",
                      newCount: "Neu",
                      expiredCount: "Auslauf",
                    };
                    return [String(value ?? 0), labels[String(name)] ?? String(name)];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="active"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#aboActiveGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="newCount"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fill="url(#aboNewGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="expiredCount"
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                  fill="url(#aboExpiredGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}

function TopAbosCard({ rows }: { rows: SubscriptionTopRow[] }) {
  const max = useMemo(() => rows.reduce((m, r) => Math.max(m, r.active), 0), [rows]);
  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Top-Abos</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Aktiver Bestand</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">Keine aktiven Abos.</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const pct = max > 0 ? Math.round((r.active / max) * 100) : 0;
              return (
                <li key={r.subscriptionId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{r.name}</span>
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">{r.active}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function SubscriptionStats({ stats }: { stats: Stats }) {
  const growthIcon = stats.growthAbs >= 0 ? TrendingUp : TrendingDown;
  const growthClass = stats.growthAbs > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : stats.growthAbs < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-slate-500";
  const growthHint = stats.growthPercent != null
    ? `${stats.growthAbs >= 0 ? "+" : ""}${stats.growthAbs} (${stats.growthPercent >= 0 ? "+" : ""}${stats.growthPercent}%) vs. vor ${stats.windowDays} Tagen`
    : `vor ${stats.windowDays} Tagen: ${stats.activePast}`;

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={CreditCard}
          label="Aktiv jetzt"
          value={stats.activeNow}
          hint={`Insgesamt ${stats.totalAbos} Abos`}
          iconClass="text-indigo-500"
        />
        <StatCard
          icon={growthIcon}
          label={`Wachstum (${stats.windowDays}T)`}
          value={`${stats.growthAbs >= 0 ? "+" : ""}${stats.growthAbs}`}
          hint={growthHint}
          iconClass={growthClass}
          valueClass={growthClass}
        />
        <StatCard
          icon={CalendarPlus}
          label="Neu (30T)"
          value={stats.newLast30}
          hint={`Auslauf 30T: ${stats.expiredLast30}`}
          iconClass="text-emerald-500"
        />
        <StatCard
          icon={CalendarX}
          label="Auslaufend (30T)"
          value={stats.expiringNext30}
          hint="Enden in den nächsten 30 Tagen"
          iconClass="text-rose-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <TimelineChart data={stats.timeline} windowDays={stats.windowDays} />
        </div>
        <TopAbosCard rows={stats.top} />
      </div>
    </div>
  );
}
