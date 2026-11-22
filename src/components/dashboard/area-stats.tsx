"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Ban,
  BarChart3,
  CableCar,
  CalendarDays,
  Loader2,
  LogIn,
  ScanLine,
  Ticket as TicketIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SegmentBar } from "@/components/ui/segment-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusDot } from "@/components/ui/status-dot";
import { areaSeries } from "@/components/dashboard/area-colors";
import { AREA_METRIC_LABEL, type AreaMetric } from "@/lib/dashboard-areas";
import { cn } from "@/lib/utils";

const AREA_STORAGE_KEY = "dashboard:turnstileAreaId";
/** Ohne gespeicherte Wahl: die Seilbahn (jede Fahrt einzeln, aussagekräftigster Zählpunkt). */
const PREFERRED_AREA_NAME = /seilbahn a/i;

interface AreaJson {
  id: number;
  name: string;
  personLimit: number | null;
  metric: AreaMetric;
  totals: {
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
  average: { rides: number; guests: number; days: number } | null;
  hourly: { hour: string; granted: number; denied: number; total: number }[];
  week: { date: string; dayName: string; rides: number; denied: number; guests: number }[];
  ticketTypes: { name: string; rides: number; guests: number }[];
  denyReasons: { reason: string; count: number }[];
  devices: {
    id: number;
    name: string;
    direction: "IN" | "OUT" | "BOTH";
    online: boolean;
    granted: number;
    denied: number;
    total: number;
    lastScanAt: string | null;
  }[];
}

interface AreasJson {
  date: string;
  areas: AreaJson[];
}

const METRIC_ICON: Record<AreaMetric, LucideIcon> = {
  rides: CableCar,
  entries: LogIn,
  passes: ArrowLeftRight,
};

const DIRECTION_LABEL = { IN: "Eingang", OUT: "Ausgang", BOTH: "Ein/Aus" } as const;

// Diagramme nur aus Tokens (docs/design-regeln.md, Abschnitt 15).
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  boxShadow: "0 12px 32px -14px oklch(0 0 0 / 45%)",
  fontSize: "12px",
  color: "var(--popover-foreground)",
  padding: "6px 10px",
};
const CHART_GRID = "var(--border)";
const CHART_AXIS = "var(--muted-foreground)";
const CHART_CURSOR = { fill: "var(--primary)", fillOpacity: 0.06 };
/** Nicht gewählte Bereiche treten zurück, bleiben aber lesbar. */
const DIMMED = 0.3;

function fmtNum(n: number): string {
  return n.toLocaleString("de-DE");
}

function fmtDec(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

function storedAreaId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(AREA_STORAGE_KEY);
    return stored && Number.isInteger(Number(stored)) ? Number(stored) : null;
  } catch {
    return null;
  }
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
  if (rows.length === 0) return <EmptyState compact title={emptyText} />;
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">{row.label}</span>
            {row.sub && <span className="shrink-0 tabular-nums text-muted-foreground">{row.sub}</span>}
            <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-foreground/80">{fmtNum(row.value)}</span>
          </div>
          <SegmentBar max={max} segments={[{ label: row.label, value: row.value, className: barClass }]} />
        </div>
      ))}
    </div>
  );
}

/** Stunden mit Betrieb (erster bis letzter Scan aller Bereiche), mindestens 9 bis 18 Uhr. */
function hourRange(areas: AreaJson[]): [number, number] {
  let first = 24;
  let last = -1;
  for (const a of areas) {
    a.hourly.forEach((b, h) => {
      if (b.total > 0) {
        first = Math.min(first, h);
        last = Math.max(last, h);
      }
    });
  }
  if (last < 0) return [9, 18];
  return [Math.min(first, 9), Math.max(last, 18)];
}

function DayChart({ areas, colorIndex, selectedId }: { areas: AreaJson[]; colorIndex: Map<number, number>; selectedId: number }) {
  const [from, to] = hourRange(areas);
  const rows = Array.from({ length: to - from + 1 }, (_, i) => {
    const h = from + i;
    const row: Record<string, number | string> = { hour: String(h) };
    for (const a of areas) row[`a${a.id}`] = a.hourly[h]?.granted ?? 0;
    return row;
  });
  const total = areas.reduce((s, a) => s + a.totals.rides, 0);
  const selected = areas.find((a) => a.id === selectedId);
  const metricOf = new Map(areas.map((a) => [`a${a.id}`, AREA_METRIC_LABEL[a.metric]]));
  // Oberster Teil eines Stapels mit runder Kante: der letzte Bereich mit Wert.
  const topKey = rows.map((r) => {
    for (let i = areas.length - 1; i >= 0; i--) if (Number(r[`a${areas[i].id}`]) > 0) return `a${areas[i].id}`;
    return null;
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          Tagesverlauf
        </CardTitle>
        <CardAction className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {areas.map((a) => (
            <span key={a.id} className={cn("flex items-center gap-1", a.id === selectedId && "font-medium text-foreground")}>
              <span className={cn("size-2 rounded-full", areaSeries(colorIndex.get(a.id) ?? -1).bg)} aria-hidden />
              {a.name}
            </span>
          ))}
        </CardAction>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState compact title="Keine Eintritte oder Fahrten an diesem Tag." />
        ) : (
          <>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={CHART_CURSOR}
                    labelFormatter={(h) => `${h}–${Number(h) + 1} Uhr`}
                    formatter={(value, key) => [`${fmtNum(Number(value))} ${metricOf.get(String(key)) ?? ""}`, areas.find((a) => `a${a.id}` === key)?.name ?? key]}
                  />
                  {areas.map((a) => {
                    const key = `a${a.id}`;
                    const fill = areaSeries(colorIndex.get(a.id) ?? -1).fill;
                    return (
                      <Bar
                        key={key}
                        dataKey={key}
                        name={a.name}
                        stackId="day"
                        fill={fill}
                        fillOpacity={a.id === selectedId ? 1 : DIMMED}
                        stroke="var(--card)"
                        strokeWidth={1}
                        isAnimationActive={false}
                      >
                        {rows.map((_, i) => (
                          <Cell key={i} radius={topKey[i] === key ? ([3, 3, 0, 0] as unknown as number) : 0} />
                        ))}
                      </Bar>
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {selected?.totals.peakHour && (
              <p className="mt-1 text-center text-[11px] text-muted-foreground">
                {selected.name}: am meisten los um{" "}
                <span className="font-semibold text-foreground">{Number(selected.totals.peakHour.hour.slice(0, 2))} Uhr</span>{" "}
                mit {fmtNum(selected.totals.peakHour.count)} Scans
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WeekChart({ area, fill, date }: { area: AreaJson; fill: string; date: string }) {
  const max = area.week.reduce((m, d) => Math.max(m, d.rides), 0);
  const label = AREA_METRIC_LABEL[area.metric];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">7 Tage · {area.name}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {max === 0 ? (
          <EmptyState compact title="Keine Werte in den letzten 7 Tagen." />
        ) : (
          <>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={area.week} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="dayName" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={CHART_CURSOR}
                    labelFormatter={(_, payload) => {
                      const d = payload?.[0]?.payload as AreaJson["week"][number] | undefined;
                      return d ? new Date(`${d.date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) : "";
                    }}
                    formatter={(value, _name, item) => {
                      const d = item?.payload as AreaJson["week"][number] | undefined;
                      return [`${fmtNum(Number(value))} ${label}${d ? ` · ${fmtNum(d.guests)} Gäste` : ""}`, area.name];
                    }}
                  />
                  {area.average && (
                    <ReferenceLine
                      y={area.average.rides}
                      stroke={CHART_AXIS}
                      strokeDasharray="4 3"
                    />
                  )}
                  <Bar dataKey="rides" name={label} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {area.week.map((d) => (
                      <Cell key={d.date} fill={fill} fillOpacity={d.date === date ? 1 : 0.4} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              {label} je Tag
              {area.average && (
                <>
                  {" "}· gestrichelt: Ø <span className="font-medium text-foreground tabular-nums">{fmtNum(area.average.rides)}</span> der{" "}
                  {area.average.days} Tage davor
                </>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DevicesCard({ area }: { area: AreaJson }) {
  const max = area.devices.reduce((m, d) => Math.max(m, d.total), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-1.5">
          <ScanLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">Leser · {area.name}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {area.devices.map((d) => {
          const rate = d.total > 0 ? Math.round((d.granted / d.total) * 100) : null;
          const last = fmtTime(d.lastScanAt);
          const onlineLabel = d.online ? "Online" : "Kein Heartbeat";
          return (
            <div key={d.id} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span title={onlineLabel} className="inline-flex shrink-0">
                  <StatusDot size="xs" tone={d.online ? "success" : "neutral"} label={onlineLabel} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">{d.name}</span>
                <span className="shrink-0 text-muted-foreground">{DIRECTION_LABEL[d.direction]}</span>
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-foreground/80">{fmtNum(d.granted)}</span>
              </div>
              <SegmentBar
                max={max}
                segments={[
                  { label: "Erlaubt", value: d.granted, className: "bg-success" },
                  { label: "Abgelehnt", value: d.denied, className: "bg-destructive" },
                ]}
              />
              <p className="text-[11px] text-muted-foreground">
                {rate != null ? (
                  <>
                    {rate} % erfolgreich{last && <> · zuletzt {last}</>}
                  </>
                ) : (
                  "Keine Scans an diesem Tag"
                )}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DeniedCard({ area }: { area: AreaJson }) {
  const t = area.totals;
  const notGranted = t.denied + t.protected;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-1.5">
          <Ban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">Ablehnungen · {area.name}</span>
        </CardTitle>
        <CardAction>
          <Badge variant={t.denied > 0 ? "danger" : "neutral"} className="tabular-nums">
            {fmtNum(notGranted)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {t.scans === 0 ? (
          <EmptyState compact title="Keine Scans an diesem Tag." />
        ) : (
          <>
            <div className="space-y-1.5">
              <SegmentBar
                size="md"
                segments={[
                  { label: "Erlaubt", value: t.rides, className: "bg-success" },
                  { label: "Abgelehnt", value: t.denied, className: "bg-destructive" },
                  { label: "Geschützt", value: t.protected, className: "bg-warning" },
                ]}
              />
              <p className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{t.grantRate} %</span> der {fmtNum(t.scans)} Scans
                erfolgreich
              </p>
            </div>
            <BarList
              rows={area.denyReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))}
              emptyText="Keine Ablehnung an diesem Tag."
              barClass="bg-destructive"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Auswertung des gewählten Tages je Drehkreuz-Bereich: oben je Bereich eine
 * Kennzahl (zugleich Auswahl für die Karten darunter), dann Tagesverlauf
 * aller Bereiche, sieben Tage, Ticket-Typen, Leser und Ablehnungen des
 * gewählten Bereichs.
 */
export function AreaStats({ date }: { date: string }) {
  const [data, setData] = useState<AreasJson | null>(null);
  const [failed, setFailed] = useState(false);
  const [areaId, setAreaId] = useState<number | null>(storedAreaId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/dashboard/areas?date=${date}`);
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setData(await res.json());
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [date]);

  // Farbe je Bereich nach seiner festen Position in der Antwort.
  const colorIndex = useMemo(() => new Map((data?.areas ?? []).map((a, i) => [a.id, i])), [data]);
  const active = useMemo(
    () => (data?.areas ?? []).filter((a) => a.totals.scans > 0 || a.week.some((d) => d.rides > 0 || d.denied > 0)),
    [data],
  );

  function select(id: number) {
    try {
      window.localStorage.setItem(AREA_STORAGE_KEY, String(id));
    } catch {
      /* privater Modus */
    }
    setAreaId(id);
  }

  if (!data) {
    return failed ? (
      <Notice tone="warning" compact title="Auswertung nicht erreichbar">
        Die Seite versucht es jede Minute erneut.
      </Notice>
    ) : (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lädt …
        </CardContent>
      </Card>
    );
  }

  if (active.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ScanLine}
          title="Keine Drehkreuz-Scans in den letzten 7 Tagen"
          description="Sobald an einem Drehkreuz gescannt wird, erscheinen hier Eintritte und Fahrten je Bereich."
        />
      </Card>
    );
  }

  const selected =
    active.find((a) => a.id === areaId) ?? active.find((a) => PREFERRED_AREA_NAME.test(a.name)) ?? active[0];
  const fill = areaSeries(colorIndex.get(selected.id) ?? -1);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "grid grid-cols-2 gap-3 sm:gap-4",
          active.length >= 4 ? "lg:grid-cols-4" : active.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
        {active.map((a, i) => {
          const t = a.totals;
          const label = AREA_METRIC_LABEL[a.metric];
          const delta =
            a.average && a.average.rides > 0 ? Math.round(((t.rides - a.average.rides) / a.average.rides) * 100) : null;
          const guests = t.guests > 0 ? `${fmtNum(t.guests)} ${t.guests === 1 ? "Gast" : "Gäste"}` : "noch kein Gast";
          return (
            <StatCard
              key={a.id}
              label={a.name}
              icon={METRIC_ICON[a.metric]}
              tone="primary"
              value={fmtNum(t.rides)}
              suffix={label}
              trend={delta != null && a.average ? { value: delta, label: `zum Ø ${fmtNum(a.average.rides)}` } : undefined}
              hint={a.metric === "rides" && t.guests > 0 ? `${guests} · Ø ${fmtDec(t.ridesPerGuest)} je Gast` : guests}
              hintWithTrend
              onClick={() => select(a.id)}
              active={a.id === selected.id}
              // Einzelne Kachel in der letzten Zeile auf dem Handy über die volle Breite.
              className={active.length % 2 === 1 && i === active.length - 1 ? "max-lg:col-span-2" : undefined}
            >
              <span className={cn("block h-1 w-8 rounded-full", areaSeries(colorIndex.get(a.id) ?? -1).bg)} aria-hidden />
            </StatCard>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DayChart areas={active} colorIndex={colorIndex} selectedId={selected.id} />
        <WeekChart area={selected} fill={fill.fill} date={data.date} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-1.5">
              <TicketIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">Ticket-Typen · {selected.name}</span>
            </CardTitle>
            {selected.totals.soldTickets > 0 && (
              <CardAction>
                <Badge variant="secondary" className="tabular-nums" title={`An diesem Tag für ${selected.name} angelegte Tickets`}>
                  {fmtNum(selected.totals.soldTickets)} neu
                </Badge>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <BarList
              rows={selected.ticketTypes.map((t) => ({
                key: t.name,
                label: t.name,
                value: t.rides,
                sub: `${fmtNum(t.guests)} ${t.guests === 1 ? "Gast" : "Gäste"}`,
              }))}
              emptyText="Keine Scans an diesem Tag."
              barClass={fill.bg}
            />
          </CardContent>
        </Card>
        <DevicesCard area={selected} />
        <DeniedCard area={selected} />
      </div>
    </div>
  );
}
