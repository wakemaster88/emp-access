"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  BarChart3,
  CalendarDays,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatCard } from "@/components/ui/stat-card";
import { StatusDot } from "@/components/ui/status-dot";
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

// Diagramm nur aus Tokens (docs/design-regeln.md, Abschnitt 15).
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
    return <EmptyState compact title={emptyText} />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-foreground/80 truncate flex-1 min-w-0">{row.label}</span>
            {row.sub && <span className="text-muted-foreground tabular-nums shrink-0">{row.sub}</span>}
            <span className="font-semibold text-foreground/80 tabular-nums shrink-0">
              {fmtNum(row.value)}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full", barClass)} style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
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
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lädt …
        </CardContent>
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
  const perGuest =
    totals.guests > 0
      ? `Ø ${totals.ridesPerGuest.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Fahrten/Gast`
      : null;
  // Abweichung zum Durchschnitt als Trendzeile (grün/rot mit Vorzeichen).
  // Bei den Fahrten trägt sie den Vergleich selbst (der Hinweis wäre derselbe);
  // bei den Gästen steht der Hinweis (Fahrten je Gast) per hintWithTrend darunter.
  const ridesTrend =
    ridesDelta != null && average
      ? { value: ridesDelta, label: `zum Ø ${fmtNum(average.rides)} an ${average.days} Vergleichstagen` }
      : undefined;
  const guestsTrend =
    guestsDelta != null && average
      ? { value: guestsDelta, label: `zum Ø ${fmtNum(average.guests)}` }
      : undefined;

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHeading
          title={`Drehkreuz ${area.name}`}
          icon={RotateCw}
          aside={<Badge variant="secondary">echte Fahrten</Badge>}
          className="min-w-0"
        />
        {/* Handy: die Auswahl steht unter der Überschrift in voller Breite; feste Breite erst ab sm. */}
        <div className="ml-auto shrink-0 max-sm:w-full">
          <Select value={String(area.id)} onValueChange={selectArea}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.areas.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Fahrten"
          value={fmtNum(totals.rides)}
          icon={CheckCircle2}
          tone="success"
          trend={ridesTrend}
          hint={
            average
              ? `Ø ${fmtNum(average.rides)} an ${average.days} Vergleichstagen`
              : openFrom && openUntil
                ? `Betrieb ${openFrom}–${openUntil} Uhr`
                : "Drehkreuz-Durchgänge"
          }
        />
        <StatCard
          label="Gäste"
          value={fmtNum(totals.guests)}
          icon={Users}
          tone="primary"
          trend={guestsTrend}
          hint={perGuest ?? "eindeutige Tickets am Drehkreuz"}
          hintWithTrend
        />
        <StatCard
          label="Tickets"
          value={fmtNum(totals.soldTickets)}
          icon={TicketIcon}
          tone="primary"
          hint={
            totals.ridesWithoutTicket > 0
              ? `heute angelegt · +${fmtNum(totals.ridesWithoutTicket)} ohne Ticket`
              : "heute für diesen Bereich angelegt"
          }
        />
        <StatCard
          label="Scans"
          value={fmtNum(totals.scans)}
          icon={ScanLine}
          tone="info"
          hint={
            totals.scans > 0
              ? totals.denied > 0
                ? <><span className="font-medium text-success">{totals.grantRate}%</span> Erfolg · {fmtNum(totals.denied)} abgelehnt</>
                : <><span className="font-medium text-success">{totals.grantRate}%</span> Erfolg, keine Ablehnung</>
              : "Keine Scans"
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              Fahrten im Tagesverlauf
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totals.scans === 0 ? (
              <EmptyState compact title="Keine Scans an diesem Tag." />
            ) : (
              <>
                <div className="h-[190px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourly} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                      <XAxis dataKey="hour" tick={{ fontSize: 9, fill: CHART_AXIS }} tickLine={false} axisLine={false} interval={2} />
                      <YAxis tick={{ fontSize: 9, fill: CHART_AXIS }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--primary)", fillOpacity: 0.08 }} />
                      <Bar dataKey="granted" name="Fahrten" stackId="a" fill="var(--success)" />
                      <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="var(--destructive)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {totals.peakHour && (
                  <p className="text-[11px] text-muted-foreground mt-1 text-center">
                    Spitze um <span className="font-semibold text-foreground">{totals.peakHour.hour}</span> mit {fmtNum(totals.peakHour.count)} Scans
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <TicketIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              Ticket-Typen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={ticketTypes.map((t) => ({
                key: t.name,
                label: t.name,
                value: t.rides,
                sub: `${fmtNum(t.guests)} ${t.guests === 1 ? "Gast" : "Gäste"}`,
              }))}
              emptyText="Keine Fahrten an diesem Tag."
              barClass="bg-primary"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              Leser
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {devices.map((d) => {
              const rate = d.total > 0 ? Math.round((d.rides / d.total) * 100) : 0;
              const last = fmtTime(d.lastScanAt);
              const onlineLabel = d.online ? "Online" : "Kein Heartbeat";
              return (
                <div key={d.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span title={onlineLabel} className="inline-flex shrink-0">
                      <StatusDot size="xs" tone={d.online ? "success" : "neutral"} label={onlineLabel} />
                    </span>
                    <span className="font-medium text-foreground/80 truncate flex-1 min-w-0">{d.name}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">{DIRECTION_LABEL[d.direction]}</span>
                    <span className="font-semibold text-foreground/80 tabular-nums shrink-0">{fmtNum(d.rides)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                    <div className="bg-primary h-full" style={{ width: `${totals.rides > 0 ? (d.rides / totals.rides) * 100 : 0}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {d.total > 0 ? <>{rate}% erfolgreich{last && <> · letzter Scan {last}</>}</> : "Keine Scans an diesem Tag"}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              Ablehnungsgründe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={denyReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))}
              emptyText="Keine Ablehnungen an diesem Tag."
              barClass="bg-destructive"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              7 Tage
            </CardTitle>
          </CardHeader>
          <CardContent>
            {maxTrendRides === 0 ? (
              <EmptyState compact title="Keine Fahrten in den letzten 7 Tagen." />
            ) : (
              <div className="space-y-1.5">
                {weekTrend.map((d) => (
                  <div key={d.date} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[11px] w-7 shrink-0 uppercase",
                        d.date === data.date ? "font-bold text-foreground/80" : "text-muted-foreground",
                      )}
                    >
                      {d.dayName}
                    </span>
                    <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", d.date === data.date ? "bg-primary" : "bg-primary/40")}
                        style={{ width: `${(d.rides / maxTrendRides) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-right shrink-0">
                      {fmtNum(d.rides)}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-7 text-right shrink-0 hidden sm:inline">
                      {fmtNum(d.guests)}
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground pt-1">
                  Fahrten<span className="hidden sm:inline"> · Gäste</span> je Tag
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
