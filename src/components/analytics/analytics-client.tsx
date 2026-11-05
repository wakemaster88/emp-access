"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import { EaboAnalytics } from "@/components/analytics/e-abo-analytics";
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
  Text,
  type XAxisTickContentProps,
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

// Diagramme nur aus Tokens (docs/design-regeln.md, Abschnitt 15). Ab der
// sechsten Kategorie wiederholen sich die Diagrammfarben, zur Schriftfarbe hin
// gemischt (im Hellen dunkler, im Dunkeln heller). Zum Hintergrund hin gemischt
// verschwammen sie im Dunkeln fast mit der Karte.
const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "color-mix(in oklch, var(--chart-1) 60%, var(--foreground))",
  "color-mix(in oklch, var(--chart-2) 60%, var(--foreground))",
  "color-mix(in oklch, var(--chart-3) 60%, var(--foreground))",
];
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  boxShadow: "0 12px 32px -14px oklch(0 0 0 / 45%)",
  fontSize: "12px",
  color: "var(--popover-foreground)",
};
const CHART_GRID = "var(--border)";
const CHART_AXIS = "var(--muted-foreground)";
// Eine Zeile je Gerät; Recharts blendet sonst jede zweite Beschriftung aus.
const DEVICE_ROW_PX = 28;
// Recharts misst Zeilenumbrüche nur über `style` (mit Einheit), nicht über das
// fontSize-Attribut; sonst rechnet es mit 16 px und bricht nach jedem Wort um.
const WRAP_TICK = { fontSize: 10, fill: CHART_AXIS, style: { fontSize: "10px" } };

/**
 * Säulenbeschriftung, die Recharts bei Platzmangel nicht ausblendet: breite
 * Säulen brechen die Beschriftung um, schmale (Handy) stellen sie schräg, damit
 * lange Wörter wie „Haupteingang“ nicht in die Nachbarn laufen.
 */
function WrappedTick({ x, y, payload }: XAxisTickContentProps) {
  const band = (payload.offset ?? 0) * 2;
  const narrow = band > 0 && band < 80;
  return (
    <Text
      x={x}
      y={y}
      width={narrow ? undefined : band > 0 ? band - 6 : undefined}
      angle={narrow ? -35 : 0}
      textAnchor={narrow ? "end" : "middle"}
      verticalAnchor="start"
      fontSize={10}
      fill={CHART_AXIS}
      style={WRAP_TICK.style}
    >
      {String(payload.value)}
    </Text>
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
      <Tabs defaultValue="general" className="w-full space-y-4 sm:space-y-5">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="general" className="flex-1 sm:flex-none">
            Allgemein
          </TabsTrigger>
          <TabsTrigger value="eabo" className="flex-1 sm:flex-none">
            E-Abo Auswertung
          </TabsTrigger>
        </TabsList>

        <TabsContent value="eabo" className="space-y-4 sm:space-y-5 mt-0">
          <EaboAnalytics />
        </TabsContent>

        <TabsContent value="general" className="space-y-4 sm:space-y-5 mt-0">
      {/* Period selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Handy: volle Breite wie die Tab-Leiste darüber; 10 px statt 14 px Innenabstand je Segment,
            damit die fünf Zeiträume auch bei 360 px in einer Zeile stehen (sonst bricht die Kapsel um). */}
        <Segmented
          value={mode}
          onValueChange={setMode}
          aria-label="Zeitraum"
          className="w-full sm:w-fit"
          options={modes.map((m) => ({ value: m.id, label: m.label }))}
        />

        {mode !== "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Zurück" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={goToday}>
              Heute
            </Button>
            <Button variant="outline" size="icon" aria-label="Weiter" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {data && (
              <span className="text-sm font-medium text-foreground/80 ml-1">
                {fmtRange(data.rangeStart, data.rangeEnd, data.mode)}
              </span>
            )}
          </div>
        ) : (
          // Handy: beide Daten in zwei gleich breiten Spalten; feste Breite erst ab sm.
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Input
              type="date"
              className="flex-1 sm:w-40 sm:flex-initial"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="date"
              className="flex-1 sm:w-40 sm:flex-initial"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}

        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lädt …
          </span>
        )}
      </div>

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard icon={ScanLine} label="Scans gesamt" value={s.totalScans} tone="info" />
          <StatCard
            icon={ShieldCheck}
            label="Erlaubt"
            value={s.grantedScans}
            hint={`${s.grantRate}% Erfolgsrate`}
            tone="success"
          />
          <StatCard icon={ShieldX} label="Abgelehnt" value={s.deniedScans} tone="danger" />
          <StatCard
            icon={Ticket}
            label="Aktive Tickets"
            value={s.totalTickets}
            hint={`${s.annyTickets} via ANNY`}
            tone="primary"
          />
        </div>
      )}

      {/* Main chart: Scans timeline */}
      {data && data.timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <h3>Scan-Verlauf</h3>
            </CardTitle>
            <CardAction className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" /> Erlaubt
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-destructive" /> Abgelehnt
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] sm:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={12}
                  />
                  <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="granted"
                    name="Erlaubt"
                    stackId="1"
                    stroke="var(--success)"
                    fill="var(--success)"
                    fillOpacity={0.3}
                  />
                  <Area
                    type="monotone"
                    dataKey="denied"
                    name="Abgelehnt"
                    stackId="1"
                    stroke="var(--destructive)"
                    fill="var(--destructive)"
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Tickets by type */}
          {data.byType.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <h3>Tickets nach Typ</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
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
                        stroke="none"
                      >
                        {data.byType.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
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
                      <span className="text-[11px] text-muted-foreground truncate flex-1">{t.name}</span>
                      <Badge variant="secondary" className="tabular-nums">{t.count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scans by device */}
          {data.byDevice.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <ScanLine className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <h3>Scans nach Gerät</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ height: Math.max(200, data.byDevice.length * DEVICE_ROW_PX + 30) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.byDevice}
                      layout="vertical"
                      margin={{ top: 0, right: 5, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={WRAP_TICK}
                        tickLine={false}
                        axisLine={false}
                        width={110}
                        interval={0}
                      />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Bar dataKey="granted" name="Erlaubt" stackId="a" fill="var(--success)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="var(--destructive)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Peak hours */}
          {s && s.totalScans > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <h3>Stoßzeiten</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.peakHours.filter((h) => {
                        const hr = parseInt(h.hour);
                        return hr >= 6 && hr <= 22;
                      })}
                      margin={{ top: 0, right: 5, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 9, fill: CHART_AXIS }}
                        tickLine={false}
                        axisLine={false}
                        interval={1}
                      />
                      <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Bar dataKey="count" name="Scans" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <h3>Auslastung nach Bereich</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* 220 px: bei 180 px blendete Recharts die vorletzte Y-Beschriftung aus (0, 6, 12, 24). */}
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byArea} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="name"
                    tick={WrappedTick}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    height={56}
                  />
                  <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="scans" name="Scans" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data && s && s.totalScans === 0 && s.totalTickets === 0 && (
        <Card>
          <EmptyState icon={BarChart3} title="Keine Daten für diesen Zeitraum" />
        </Card>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
