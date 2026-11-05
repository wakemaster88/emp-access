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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
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

// Tooltip und Achsen über Design-Tokens, damit Hell und Dunkel gleich gut lesbar sind.
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "14px",
  fontSize: "12px",
  color: "var(--popover-foreground)",
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

function TimelineChart({ data, windowDays }: { data: Stats["timeline"]; windowDays: number }) {
  const totalActive = data[data.length - 1]?.active ?? 0;
  const totalNew = data.reduce((s, d) => s + d.newCount, 0);
  const totalExpired = data.reduce((s, d) => s + d.expiredCount, 0);

  // Bei 365 Datenpunkten ist die X-Achse zu eng – nur ~6 Ticks anzeigen.
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary shrink-0" />
          Abo-Verlauf
        </CardTitle>
        <CardDescription>
          Bestand der letzten {windowDays} Tage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Bestand
            <span className="text-foreground/80 font-semibold ml-0.5 tabular-nums">
              {totalActive}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-success" />
            Neu
            <span className="text-foreground/80 font-semibold ml-0.5 tabular-nums">
              {totalNew}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-warning" />
            Auslauf
            <span className="text-foreground/80 font-semibold ml-0.5 tabular-nums">
              {totalExpired}
            </span>
          </span>
        </div>
        {data.length === 0 ? (
          <EmptyState compact icon={Activity} title="Keine Daten im Zeitraum." />
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="aboActiveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="aboNewGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0.02} />
                  </linearGradient>
                  {/* Auslauf ist ein Hinweis, keine Störung: Warnfarbe wie „Auslaufend (30T)“. */}
                  <linearGradient id="aboExpiredGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  interval={tickInterval}
                  tickFormatter={(value: string) => fmtMonth(value)}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
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
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#aboActiveGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="newCount"
                  stroke="var(--success)"
                  strokeWidth={1.5}
                  fill="url(#aboNewGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="expiredCount"
                  stroke="var(--warning)"
                  strokeWidth={1.5}
                  fill="url(#aboExpiredGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TopAbosCard({ rows }: { rows: SubscriptionTopRow[] }) {
  const max = useMemo(() => rows.reduce((m, r) => Math.max(m, r.active), 0), [rows]);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary shrink-0" />
          Top-Abos
        </CardTitle>
        <CardDescription>Aktiver Bestand</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState compact icon={CreditCard} title="Keine aktiven Abos." />
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const pct = max > 0 ? Math.round((r.active / max) * 100) : 0;
              return (
                <li key={r.subscriptionId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground/80 truncate">{r.name}</span>
                    <span className="tabular-nums text-muted-foreground">{r.active}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-foreground/[0.08] dark:bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SubscriptionStats({ stats }: { stats: Stats }) {
  const growthIcon = stats.growthAbs >= 0 ? TrendingUp : TrendingDown;
  const growthTone: StatTone = stats.growthAbs > 0 ? "success" : stats.growthAbs < 0 ? "danger" : "neutral";
  const growthHint = stats.growthPercent != null
    ? `${stats.growthAbs >= 0 ? "+" : ""}${stats.growthAbs} (${stats.growthPercent >= 0 ? "+" : ""}${stats.growthPercent}%) vs. vor ${stats.windowDays} Tagen`
    : `vor ${stats.windowDays} Tagen: ${stats.activePast}`;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={CreditCard}
          label="Aktiv jetzt"
          value={stats.activeNow}
          hint={`Insgesamt ${stats.totalAbos} Abos`}
          tone="primary"
        />
        <StatCard
          icon={growthIcon}
          label={`Wachstum (${stats.windowDays}T)`}
          value={`${stats.growthAbs >= 0 ? "+" : ""}${stats.growthAbs}`}
          hint={growthHint}
          tone={growthTone}
          accentValue
        />
        <StatCard
          icon={CalendarPlus}
          label="Neu (30T)"
          value={stats.newLast30}
          hint={`Auslauf 30T: ${stats.expiredLast30}`}
          tone="success"
        />
        <StatCard
          icon={CalendarX}
          label="Auslaufend (30T)"
          value={stats.expiringNext30}
          hint="Enden in den nächsten 30 Tagen"
          tone="warning"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <div className="lg:col-span-2">
          <TimelineChart data={stats.timeline} windowDays={stats.windowDays} />
        </div>
        <TopAbosCard rows={stats.top} />
      </div>
    </div>
  );
}
