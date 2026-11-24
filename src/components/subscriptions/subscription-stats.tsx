"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
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

// Das Diagramm selbst (recharts) wird nachgeladen; der Platzhalter füllt
// dieselbe feste Höhe wie das Diagramm, damit nichts springt.
const SubscriptionTimelineChart = dynamic(
  () => import("./subscription-timeline-chart").then((m) => m.SubscriptionTimelineChart),
  {
    ssr: false,
    loading: () => <div className="glass-tile h-full animate-pulse" />,
  },
);

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
            <SubscriptionTimelineChart data={data} tickInterval={tickInterval} />
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
