"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { setAppBadge } from "@/lib/app-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  ScanLine,
  Loader2,
  MapPin,
  Clock,
  CreditCard,
  CheckCircle2,
  XCircle,
  Wifi,
  TrendingUp,
  Ticket,
  RefreshCw,
  Activity,
  PieChart as PieChartIcon,
  BarChart3,
  Smartphone,
} from "lucide-react";
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
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { EditTicketDialog, type TicketData } from "@/components/tickets/edit-ticket-dialog";
import { OpsStrip, type DashboardOps } from "@/components/dashboard/ops-strip";
import { TurnstileCard } from "@/components/dashboard/turnstile-card";

interface TicketEntry {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  validityType: string;
  slotStart: string | null;
  slotEnd: string | null;
  profileImage: string | null;
  source: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  hasRfid: boolean;
  needsRfid: boolean;
  needsPhoto: boolean;
  groupName: string | null;
}

interface ResourceBlock {
  resourceName: string;
  slots: { startTime: string; endTime: string }[];
  tickets: TicketEntry[];
}

interface AreaData {
  id: number | null;
  name: string;
  personLimit: number | null;
  allowReentry: boolean;
  openingHours: string | null;
  resources: ResourceBlock[];
  otherTickets: TicketEntry[];
  occupancyRelevant?: boolean;
  _count: { tickets: number };
}

interface RecentScan {
  id: number;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  scanTime: string;
  deviceName: string | null;
  ticketName: string;
  ticketTypeName: string | null;
  profileImage: string | null;
}

interface NewTicket {
  id: number;
  name: string;
  typeName: string | null;
  source: string | null;
  profileImage: string | null;
  createdAt: string;
}

interface AnnySyncStatus {
  lastSync: string | null;
  created?: number;
  updated?: number;
  errors?: number;
  errorDetails?: string[];
  total?: number;
}

interface HourlyBucket {
  hour: string;
  granted: number;
  denied: number;
  total: number;
}

interface WeekTrendDay {
  date: string;
  dayName: string;
  scans: number;
  granted: number;
  denied: number;
  tickets: number;
}

interface TopDevice {
  id: number;
  name: string;
  granted: number;
  denied: number;
  total: number;
}

interface DashboardData {
  date: string;
  scansToday: number;
  checkedInCount: number;
  newTicketsCount: number;
  activeDevices: number;
  recentScans: RecentScan[];
  newTickets: NewTicket[];
  areas: AreaData[];
  unassigned: AreaData;
  subscriptions: TicketEntry[];
  services: TicketEntry[];
  scanResults: { granted: number; denied: number; protected: number };
  grantRate: number;
  peakHour: { hour: string; count: number } | null;
  hourly: HourlyBucket[];
  weekTrend: WeekTrendDay[];
  topDevices: TopDevice[];
  annySyncStatus?: AnnySyncStatus | null;
}

interface AreaOption {
  id: number;
  name: string;
}

function toLocaleDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function isToday(dateStr: string): boolean {
  return dateStr === toLocaleDateStr(new Date());
}

function personName(t: TicketEntry): string {
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
}

function TicketRow({ ticket, onClick, inSlot, hideType, hideTime }: { ticket: TicketEntry; onClick: () => void; inSlot?: boolean; hideType?: boolean; hideTime?: boolean }) {
  const time = !inSlot && !hideTime
    ? (ticket.bookingStart
        ? `${ticket.bookingStart}${ticket.bookingEnd ? `–${ticket.bookingEnd}` : ""}`
        : ticket.slotStart && ticket.slotEnd
          ? `${ticket.slotStart}–${ticket.slotEnd}`
          : null)
    : null;

  return (
    <div
      className="flex items-center gap-2 py-1.5 sm:py-1 cursor-pointer rounded-[10px] px-1 -mx-1 hover:bg-glass-tile transition-colors"
      onClick={onClick}
    >
      {ticket.profileImage ? (
        <img src={ticket.profileImage} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-muted-foreground">
            {(ticket.firstName?.[0] || ticket.name[0] || "?").toUpperCase()}
          </span>
        </div>
      )}
      <span className="text-xs font-medium text-foreground/90 truncate flex-1 min-w-0">
        {personName(ticket)}
      </span>
      {!inSlot && !hideType && ticket.ticketTypeName && (
        <span className="text-[11px] text-muted-foreground truncate max-w-[90px] hidden sm:inline">{ticket.ticketTypeName}</span>
      )}
      {time && (
        <span className="text-[11px] text-primary tabular-nums shrink-0">{time}</span>
      )}
      {ticket.needsPhoto && (
        <Camera className="h-3 w-3 text-warning shrink-0" />
      )}
      {ticket.needsRfid && (
        <ScanLine className="h-3 w-3 text-warning shrink-0" />
      )}
      <StatusDot
        size="xs"
        tone={
          ticket.status === "VALID"
            ? "success"
            : ticket.status === "REDEEMED"
              ? "info"
              : "neutral"
        }
      />
    </div>
  );
}

// Diagramme nur aus Tokens (docs/design-regeln.md, Abschnitt 15): Kurzinfo
// deckend wie ein Menü, Gitter in --border, Achsentext gedämpft.
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
const CHART_CURSOR = { fill: "var(--primary)", fillOpacity: 0.08 };

function HourlyChart({ data, peakHour }: { data: HourlyBucket[]; peakHour: { hour: string; count: number } | null }) {
  const total = data.reduce((s, b) => s + b.total, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          Scan-Verlauf (Tag)
        </CardTitle>
        <CardAction className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-success" /> Erlaubt
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-destructive" /> Abgelehnt
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState compact title="Keine Scans an diesem Tag." />
        ) : (
          <>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 9, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={false}
                    interval={2}
                  />
                  <YAxis tick={{ fontSize: 9, fill: CHART_AXIS }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR} />
                  <Bar dataKey="granted" name="Erlaubt" stackId="a" fill="var(--success)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="var(--destructive)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {peakHour && (
              <p className="text-[11px] text-muted-foreground mt-1 text-center">
                Spitze um <span className="font-semibold text-foreground">{peakHour.hour}</span> mit {peakHour.count} Scans
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ScanResultDonut({ results }: { results: { granted: number; denied: number; protected: number } }) {
  const total = results.granted + results.denied + results.protected;
  const data = [
    { name: "Erlaubt", value: results.granted, color: "var(--success)" },
    { name: "Abgelehnt", value: results.denied, color: "var(--destructive)" },
    { name: "Geschützt", value: results.protected, color: "var(--warning)" },
  ].filter((d) => d.value > 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <PieChartIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          Scan-Ergebnisse
        </CardTitle>
        <CardAction>
          <Badge variant="secondary" className="tabular-nums">{total}</Badge>
        </CardAction>
      </CardHeader>
      {/* Ring und Legende nach der Kartenbreite (@container): schmal (Drittelspalte bei 1024 px)
          untereinander, mittel (360 px, 1280 px) mit kleinerem Ring nebeneinander, breit wie bisher.
          So bleibt der Legende immer Platz für „Abgelehnt“ statt „Abg…“. */}
      <CardContent className="@container">
        {total === 0 ? (
          <EmptyState compact title="Noch keine Scans an diesem Tag." />
        ) : (
          <div className="flex flex-col items-center gap-3 @min-[17rem]:flex-row">
            <div className="size-40 @min-[17rem]:size-30 @min-[19.5rem]:size-40 shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* Radien in Prozent, damit der Ring mit der Fläche mitwächst (bei 160 px wie zuvor 45/70 px). */}
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="56%" outerRadius="88%" paddingAngle={2} stroke="none">
                    {data.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-foreground tabular-nums leading-none">{total}</span>
                <span className="text-[11px] text-muted-foreground mt-0.5">Scans</span>
              </div>
            </div>
            <div className="w-full flex-1 space-y-1.5 min-w-0">
              {data.map((d) => {
                const pct = Math.round((d.value / total) * 100);
                return (
                  <div key={d.name} className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-[11px] text-muted-foreground truncate flex-1">{d.name}</span>
                    <span className="text-[11px] font-semibold text-foreground/80 tabular-nums">{d.value}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeekTrendChart({ data, selectedDate }: { data: WeekTrendDay[]; selectedDate: string }) {
  const totalScans = data.reduce((s, d) => s + d.scans, 0);
  const totalTickets = data.reduce((s, d) => s + d.tickets, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        {/* Titel bricht nicht am Bindestrich („7-Tage-“ / „Trend“); wird es bei 360 px eng,
            rückt die Legende rechts in zwei Zeilen. */}
        <CardTitle className="flex items-center gap-1.5 whitespace-nowrap">
          <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          7-Tage-Trend
        </CardTitle>
        <CardAction className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-chart-1" /> Scans
            <span className="text-foreground/80 font-semibold ml-0.5 tabular-nums">{totalScans}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-chart-2" /> Neue Tickets
            <span className="text-foreground/80 font-semibold ml-0.5 tabular-nums">{totalTickets}</span>
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        {totalScans === 0 && totalTickets === 0 ? (
          <EmptyState compact title="Keine Aktivität in den letzten 7 Tagen." />
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="scansGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="ticketsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="dayName"
                  tickFormatter={(value: string, index: number) => {
                    const isSelected = data[index]?.date === selectedDate;
                    return isSelected ? `▸${value}` : value;
                  }}
                  tick={{ fontSize: 10, fill: CHART_AXIS }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis tick={{ fontSize: 9, fill: CHART_AXIS }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="scans" name="Scans" stroke="var(--chart-1)" strokeWidth={2} fill="url(#scansGradient)" />
                <Area type="monotone" dataKey="tickets" name="Neue Tickets" stroke="var(--chart-2)" strokeWidth={2} fill="url(#ticketsGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TopDevicesCard({ devices }: { devices: TopDevice[] }) {
  const max = devices.reduce((m, d) => Math.max(m, d.total), 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          Top-Geräte heute
        </CardTitle>
        <CardAction>
          <Badge variant="secondary" className="tabular-nums">{devices.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {devices.length === 0 ? (
          <EmptyState compact title="Noch keine Scans an diesem Tag." />
        ) : (
          devices.map((d) => {
            const grantedPct = max > 0 ? (d.granted / max) * 100 : 0;
            const deniedPct = max > 0 ? (d.denied / max) * 100 : 0;
            const rate = d.total > 0 ? Math.round((d.granted / d.total) * 100) : 0;
            return (
              <div key={d.id} className="space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium text-foreground/80 truncate flex-1 min-w-0">{d.name}</span>
                  <span className="text-muted-foreground tabular-nums">{d.total}</span>
                  <span className={cn(
                    "tabular-nums w-10 text-right font-semibold",
                    rate >= 90 ? "text-success" : rate >= 70 ? "text-warning" : "text-destructive",
                  )}>{rate}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                  <div className="bg-success h-full" style={{ width: `${grantedPct}%` }} />
                  <div className="bg-destructive h-full" style={{ width: `${deniedPct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// Gruppenfarben aus der Diagramm-Reihe (keine Zustandsfarben als Dekor).
const MEMBERSHIP_PALETTE = [
  { bar: "bg-chart-5", dot: "bg-chart-5" },
  { bar: "bg-chart-1", dot: "bg-chart-1" },
  { bar: "bg-chart-4", dot: "bg-chart-4" },
  { bar: "bg-chart-2", dot: "bg-chart-2" },
  { bar: "bg-chart-3", dot: "bg-chart-3" },
  { bar: "bg-chart-5/50", dot: "bg-chart-5/50" },
  { bar: "bg-chart-1/50", dot: "bg-chart-1/50" },
  { bar: "bg-chart-4/50", dot: "bg-chart-4/50" },
] as const;

function MembershipsCard({
  title,
  icon,
  tickets,
  openTicket,
  fallbackGroupName,
}: {
  title: string;
  icon: React.ReactNode;
  tickets: TicketEntry[];
  openTicket: (id: number) => void;
  fallbackGroupName: string;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const grouped = (() => {
    const map = new Map<string, TicketEntry[]>();
    for (const t of tickets) {
      const key = t.groupName || t.ticketTypeName?.replace(/\s*\(\d+\s*Termine?\)/, "") || fallbackGroupName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  })();

  const total = tickets.length;
  const colored = grouped.map(([name, group], i) => ({
    name,
    group,
    color: MEMBERSHIP_PALETTE[i % MEMBERSHIP_PALETTE.length],
    pct: total > 0 ? (group.length / total) * 100 : 0,
  }));

  function toggle(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {icon}
          {title}
        </CardTitle>
        <CardAction>
          <Badge variant="secondary" className="tabular-nums">{total}</Badge>
        </CardAction>
      </CardHeader>

      {colored.length > 1 && (
        <CardContent>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
            {colored.map((c) => (
              <div
                key={c.name}
                className={cn("h-full transition-all", c.color.bar)}
                style={{ width: `${c.pct}%` }}
                title={`${c.name}: ${c.group.length}`}
              />
            ))}
          </div>
        </CardContent>
      )}

      <div className="max-h-[360px] overflow-y-auto scrollbar-thin min-h-[60px]">
        {colored.length === 0 ? (
          <EmptyState compact title="Keine aktiven Einträge am gewählten Tag." />
        ) : (
          <div className="px-2 sm:px-2.5 space-y-0.5">
            {colored.map(({ name, group, color, pct }) => {
              const isOpen = openGroups.has(name);
              return (
                <div key={name}>
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    className="w-full flex items-center gap-2 px-2 py-2.5 sm:py-1.5 rounded-[10px] hover:bg-glass-tile transition-colors"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", color.dot)} aria-hidden />
                    <span className="text-xs font-medium text-foreground/80 truncate flex-1 min-w-0 text-left">
                      {name}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                      {Math.round(pct)}%
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-foreground/80 shrink-0 min-w-[1.5rem] text-right">
                      {group.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 text-muted-foreground shrink-0 transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {isOpen && (
                    <div className="pl-4 pr-1.5 pb-1">
                      {group.map((ticket) => (
                        <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} hideTime />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function AreaCard({ area, openTicket }: { area: AreaData; openTicket: (id: number) => void }) {
  const hasResources = area.resources.length > 0;
  const hasOther = area.otherTickets.length > 0;
  const count = area._count.tickets;
  const limit = area.personLimit;
  const overLimit = limit != null && count > limit;
  const utilPct = limit != null && limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : null;
  const utilTone = utilPct == null
    ? null
    : utilPct >= 100
      ? "rose"
      : utilPct >= 80
        ? "amber"
        : "indigo";

  return (
    <Card
      className={cn(
        "gap-3",
        // Über dem Limit bzw. ab 80 % Auslastung: Karte in der Zustandsfarbe getönt.
        overLimit
          ? "border-destructive/40 bg-gradient-to-b from-destructive/10 to-transparent"
          : utilTone === "amber" && "border-warning/45 bg-gradient-to-b from-warning/10 to-transparent",
        area.id === null && "border-dashed",
      )}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 min-w-0">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{area.name}</span>
        </CardTitle>
        <CardAction className="flex items-center gap-1.5">
          {area.openingHours && (
            <span className="text-[11px] text-muted-foreground tabular-nums hidden sm:inline">
              {area.openingHours}
            </span>
          )}
          {limit != null ? (
            <Badge
              variant={
                overLimit
                  ? "danger"
                  : utilTone === "amber"
                    ? "warning"
                    : count > 0
                      ? "secondary"
                      : "neutral"
              }
              className="tabular-nums"
            >
              {count}/{limit}
            </Badge>
          ) : (
            <Badge variant={count > 0 ? "secondary" : "neutral"} className="tabular-nums">
              {count}
            </Badge>
          )}
        </CardAction>
      </CardHeader>

      {utilPct != null && count > 0 && (
        <CardContent>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                overLimit
                  ? "bg-destructive"
                  : utilTone === "amber"
                    ? "bg-warning"
                    : "bg-primary",
              )}
              style={{ width: `${utilPct}%` }}
            />
          </div>
        </CardContent>
      )}

      {(hasResources || hasOther) && (
        <CardContent className="max-h-[320px] overflow-y-auto scrollbar-thin">
          {area.resources.map((res, ri) => (
            <div key={res.resourceName} className={cn(ri > 0 && "mt-2")}>
              {/* Viele Zeitfenster rutschen in eine zweite Zeile statt die Zeile zu sprengen. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1 border-b border-border/60">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-label truncate">
                  {res.resourceName}
                </span>
                {res.slots.length > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
                    {res.slots.map((s) => `${s.startTime}–${s.endTime}`).join(" · ")}
                  </span>
                )}
              </div>
              {res.tickets.length > 0 && (
                <div className="pl-0.5">
                  {res.tickets.map((ticket) => (
                    <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} inSlot={res.slots.length > 0} />
                  ))}
                </div>
              )}
            </div>
          ))}

          {hasOther && (
            <div className={cn(hasResources && "mt-2")}>
              {hasResources && (
                <div className="py-1 border-b border-border/60">
                  <span className="text-label">Sonstige</span>
                </div>
              )}
              {area.otherTickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function QuietAreasCard({ areas }: { areas: AreaData[] }) {
  if (areas.length === 0) return null;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          Ruhige Bereiche
        </CardTitle>
        <CardAction>
          <Badge variant="secondary" className="tabular-nums">
            {areas.length}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {areas.map((area, i) => (
          <div
            key={area.id ?? `unassigned-${i}`}
            className="glass-tile flex items-center gap-2 px-3 py-2 min-w-0 min-h-11"
          >
            <MapPin className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            {/* Öffnungszeiten unter dem Namen: neben ihm ließen lange Zeiten
                vom Namen nur „Sau…“ übrig. */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground truncate">{area.name}</p>
              {area.openingHours && (
                <p className="text-[11px] text-muted-foreground tabular-nums truncate">{area.openingHours}</p>
              )}
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
              {area.personLimit != null ? `0/${area.personLimit}` : "0"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DashboardClient() {
  const [date, setDate] = useState(toLocaleDateStr(new Date()));
  const [data, setData] = useState<DashboardData | null>(null);
  const [ops, setOps] = useState<DashboardOps | null>(null);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [subs, setSubs] = useState<{ id: number; name: string }[]>([]);
  const [svcs, setSvcs] = useState<{ id: number; name: string }[]>([]);
  const [vereine, setVereine] = useState<{ id: number; name: string }[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketData | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [syncErrorsOpen, setSyncErrorsOpen] = useState(false);
  const hasLoaded = useRef(false);

  const fetchData = useCallback(async (d: string, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet && !hasLoaded.current) setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?date=${d}`);
      if (res.ok) {
        setData(await res.json());
        hasLoaded.current = true;
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(date); }, [date, fetchData]);

  useEffect(() => {
    let cancelled = false;
    async function loadOps() {
      try {
        const res = await fetch("/api/dashboard/ops");
        if (!cancelled && res.ok) {
          const json = await res.json();
          setOps(json);
          // Offene Warnungen als Zaehler auf dem App-Icon (installierte PWA).
          setAppBadge(Number(json?.alerts?.open) || 0);
        }
      } catch { /* ignore */ }
    }
    loadOps();
    const t = setInterval(loadOps, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!isToday(date)) return;
    const t = setInterval(() => { fetchData(date, { quiet: true }); }, 60_000);
    return () => clearInterval(t);
  }, [date, fetchData]);

  function ensureTicketOptions() {
    if (areas.length > 0 || subs.length > 0 || svcs.length > 0 || vereine.length > 0) return;
    fetch("/api/areas")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setAreas(d); })
      .catch(() => {});
    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setSubs(d); })
      .catch(() => {});
    fetch("/api/services")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setSvcs(d); })
      .catch(() => {});
    fetch("/api/vereine")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setVereine(d); })
      .catch(() => {});
  }

  async function openTicket(ticketId: number) {
    ensureTicketOptions();
    setTicketLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (res.ok) setSelectedTicket(await res.json());
    } catch { /* ignore */ }
    setTicketLoading(false);
  }

  function shiftDate(days: number) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    setDate(toLocaleDateStr(d));
  }

  const allAreas: AreaData[] = data
    ? [...data.areas, ...(data.unassigned._count.tickets > 0 ? [data.unassigned] : [])]
    : [];

  const totalTickets = allAreas.reduce((sum, a) => sum + a._count.tickets, 0);

  const weekDays = (() => {
    const current = new Date(date + "T12:00:00");
    const dayOfWeek = current.getDay();
    const monday = new Date(current);
    monday.setDate(current.getDate() - ((dayOfWeek + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        date: toLocaleDateStr(d),
        dayName: d.toLocaleDateString("de-DE", { weekday: "short" }),
        dayNum: d.getDate(),
        isToday: toLocaleDateStr(d) === toLocaleDateStr(new Date()),
        isSelected: toLocaleDateStr(d) === date,
      };
    });
  })();

  function fmtSyncAgo(iso: string | null): string {
    if (!iso) return "Nie";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Gerade eben";
    if (mins < 60) return `vor ${mins} Min.`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `vor ${hrs} Std.`;
    const days = Math.floor(hrs / 24);
    return `vor ${days} Tag${days > 1 ? "en" : ""}`;
  }

  function fmtScanTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ""; }
  }

  function fmtCreatedAt(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Date navigation */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Vorherige Woche" onClick={() => shiftDate(-7)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* Der gewählte Tag steht in der Segmentwahl darunter; Primärfarbe bleibt Handlungen vorbehalten. */}
            <Button
              variant="outline"
              aria-pressed={isToday(date)}
              onClick={() => setDate(toLocaleDateStr(new Date()))}
            >
              Heute
            </Button>
            <Button variant="outline" size="icon" aria-label="Nächste Woche" onClick={() => shiftDate(7)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-sm font-semibold text-foreground/80">
            {fmtDisplayDate(date)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {(loading || ticketLoading) && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Lädt …
              </span>
            )}
          </div>
        </div>

        {/* Wochentage als Segmentwahl; zweizeilig, daher 44 px hoch */}
        <Segmented
          value={date}
          onValueChange={setDate}
          aria-label="Tag"
          stretch
          className="[&>button]:h-11 [&>button]:px-1"
          options={weekDays.map((wd) => ({
            value: wd.date,
            label: (
              <span
                className={cn(
                  "flex flex-col items-center gap-0.5 leading-none",
                  wd.isToday && !wd.isSelected && "text-primary",
                )}
              >
                <span className="text-[10px] font-medium uppercase">{wd.dayName}</span>
                <span className="text-[15px] font-bold tabular-nums">{wd.dayNum}</span>
              </span>
            ),
          }))}
        />
      </div>

      <OpsStrip ops={ops} />
      {data && (() => {
        const noShowCount = Math.max(0, totalTickets - data.checkedInCount);
        const checkInRate = totalTickets > 0 ? Math.round((data.checkedInCount / totalTickets) * 100) : 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tickets"
              icon={Ticket}
              tone="primary"
              value={totalTickets}
              hint={
                totalTickets > 0
                  ? noShowCount > 0
                    ? <><span className="font-medium text-destructive">{noShowCount}</span> No-Show</>
                    : "Alle eingecheckt"
                  : undefined
              }
            />
            <StatCard
              label="Scans"
              icon={ScanLine}
              tone="info"
              value={data.scansToday}
              hint={
                data.scansToday > 0
                  ? <><span className="font-medium text-success">{data.grantRate}%</span> Erfolgsrate</>
                  : "Keine Scans"
              }
            />
            <StatCard
              label="Eingecheckt"
              icon={CheckCircle2}
              tone="success"
              value={data.checkedInCount}
              hint={
                totalTickets > 0
                  ? `${checkInRate}% der Tickets`
                  : data.peakHour
                    ? `Spitze ${data.peakHour.hour}`
                    : "—"
              }
              progress={totalTickets > 0 ? data.checkedInCount / totalTickets : undefined}
            />
            <StatCard
              label="Geräte"
              icon={Wifi}
              tone="neutral"
              value={data.activeDevices}
              hint={data.peakHour ? `Spitze ${data.peakHour.hour} (${data.peakHour.count})` : "online"}
            />
          </div>
        );
      })()}

      {/* Drehkreuz-Auswertung (Fahrten/Gäste je Bereich, Standard: Seilbahn A) */}
      <TurnstileCard date={date} />

      {/* ANNY Sync Status */}
      {data?.annySyncStatus && (() => {
        const s = data.annySyncStatus!;
        const syncAge = s.lastSync ? Date.now() - new Date(s.lastSync).getTime() : Infinity;
        const isStale = syncAge > 2 * 60 * 60_000;
        const hasErrors = (s.errors ?? 0) > 0;
        const details = s.errorDetails ?? [];
        return (
          <Notice
            tone={hasErrors ? "danger" : isStale ? "warning" : "success"}
            icon={RefreshCw}
            role="status"
            compact
            title={
              <>
                ANNY Sync
                <span className="font-normal text-muted-foreground ml-2">
                  {fmtSyncAgo(s.lastSync)}
                  {s.lastSync && (
                    <span className="hidden sm:inline"> ({new Date(s.lastSync).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr)</span>
                  )}
                </span>
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {s.total != null && (
                <span className="mr-0.5">{s.total} Buchungen</span>
              )}
              {(s.created ?? 0) > 0 && (
                <Badge variant="success">
                  +{s.created} neu
                </Badge>
              )}
              {(s.updated ?? 0) > 0 && (
                <Badge variant="info">
                  {s.updated} aktualisiert
                </Badge>
              )}
              {hasErrors && (
                <Badge variant="danger">
                  {s.errors} Fehler
                </Badge>
              )}
              {!s.lastSync && (
                <Badge variant="warning">
                  Kein Sync
                </Badge>
              )}
              {/* Fehlerliste per Taste aufklappen (Tastatur und Screenreader erreichen sie).
                  Steht in der Zeile der Fehlerzahl statt im action-Platz der Notice: dort
                  sitzt sie mittig und springt beim Aufklappen nach unten. */}
              {hasErrors && details.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-my-2 h-9"
                  aria-expanded={syncErrorsOpen}
                  onClick={() => setSyncErrorsOpen((v) => !v)}
                >
                  Details
                  <ChevronDown className={cn("transition-transform", syncErrorsOpen && "rotate-180")} />
                </Button>
              )}
            </div>
            {syncErrorsOpen && details.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-destructive/30 pt-2">
                {details.map((d, i) => (
                  <p key={i} className="text-xs text-destructive font-mono break-words">{d}</p>
                ))}
              </div>
            )}
          </Notice>
        );
      })()}

      {/* Area cards: aktive zuerst, ruhige Bereiche kompakt darunter */}
      {data && allAreas.length === 0 && (
        <Card>
          <EmptyState
            icon={MapPin}
            title="Keine Resourcen für dieses Datum"
            description="Anderes Datum oben wählen."
          />
        </Card>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lädt …
        </div>
      )}

      {data && allAreas.length > 0 && (() => {
        const activeAreas = allAreas.filter((a) => a._count.tickets > 0);
        const quietAreas = allAreas.filter((a) => a._count.tickets === 0 && a.occupancyRelevant !== false);
        if (activeAreas.length === 0 && quietAreas.length === 0) return null;
        return (
          <div className="space-y-4">
            {activeAreas.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeAreas.map((area) => (
                  <AreaCard key={area.id ?? "unassigned"} area={area} openTicket={openTicket} />
                ))}
              </div>
            )}
            <QuietAreasCard areas={quietAreas} />
          </div>
        );
      })()}

      {/* Charts: Stundenverlauf + Scan-Ergebnisse */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <HourlyChart data={data.hourly} peakHour={data.peakHour} />
          </div>
          <ScanResultDonut results={data.scanResults} />
        </div>
      )}

      {/* 7-Tage-Trend + Top-Geräte */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <WeekTrendChart data={data.weekTrend} selectedDate={data.date} />
          </div>
          <TopDevicesCard devices={data.topDevices} />
        </div>
      )}

      {/* Abos & Services: separate Bereiche, unabhängig von Tages-Areas */}
      {data && (data.subscriptions.length > 0 || data.services.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.subscriptions.length > 0 && (
            <MembershipsCard
              title="Abos"
              icon={<CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              tickets={data.subscriptions}
              openTicket={openTicket}
              fallbackGroupName="Abo"
            />
          )}
          {data.services.length > 0 && (
            <MembershipsCard
              title="Services"
              icon={<Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              tickets={data.services}
              openTicket={openTicket}
              fallbackGroupName="Service"
            />
          )}
        </div>
      )}

      {/* Live feeds: Recent scans + New bookings (immer sichtbar; Inhalt für gewähltes Datum) */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                Letzte Scans
              </CardTitle>
              <CardAction>
                <Badge variant="secondary" className="tabular-nums">
                  {data.scansToday}
                </Badge>
              </CardAction>
            </CardHeader>
            <div className="px-2 sm:px-2.5 divide-y divide-border/60 max-h-[360px] min-h-[160px] overflow-y-auto scrollbar-thin">
              {data.recentScans.length === 0 ? (
                <EmptyState
                  compact
                  icon={ScanLine}
                  title="Keine Scans an diesem Tag"
                  description="Anderes Datum oben wählen oder die vollständige Historie öffnen."
                />
              ) : (
                data.recentScans.map((scan) => (
                  <div key={scan.id} className="flex items-center gap-2.5 px-2 py-2 hover:bg-glass-tile transition-colors">
                    {scan.profileImage ? (
                      <img src={scan.profileImage} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <IconChip
                        icon={scan.result === "GRANTED" ? CheckCircle2 : XCircle}
                        tone={scan.result === "GRANTED" ? "success" : "danger"}
                        size="sm"
                        className="rounded-full"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground/90 truncate">{scan.ticketName}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {scan.ticketTypeName && <>{scan.ticketTypeName} · </>}
                        {scan.deviceName || "Unbekannt"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] tabular-nums text-muted-foreground">{fmtScanTime(scan.scanTime)}</span>
                      <StatusDot
                        size="xs"
                        className="flex ml-auto mt-0.5"
                        tone={scan.result === "GRANTED" ? "success" : scan.result === "DENIED" ? "danger" : "warning"}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                Neueste Tickets
              </CardTitle>
              <CardAction>
                <Badge variant="secondary" className="tabular-nums">
                  {data.newTicketsCount}
                </Badge>
              </CardAction>
            </CardHeader>
            <div className="px-2 sm:px-2.5 divide-y divide-border/60 max-h-[360px] min-h-[160px] overflow-y-auto scrollbar-thin">
              {data.newTickets.length === 0 ? (
                <EmptyState
                  compact
                  icon={Ticket}
                  title="Keine neuen Tickets an diesem Tag"
                  description="Hier erscheinen Tickets, sobald sie für diesen Tag angelegt wurden."
                />
              ) : (
                data.newTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-center gap-2.5 px-2 py-2 cursor-pointer hover:bg-glass-tile transition-colors"
                    onClick={() => openTicket(ticket.id)}
                  >
                    {ticket.profileImage ? (
                      <img src={ticket.profileImage} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      // Neutral wie die Personenzeilen der Bereichskarten: Akzent-Initiale auf
                      // Akzent-Tönung erreicht im Dunkeln nur 3,7:1.
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {(ticket.name[0] || "?").toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground/90 truncate">{ticket.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {ticket.typeName || "Ticket"}
                        {ticket.source && <> · {ticket.source === "ANNY" ? "anny.co" : ticket.source === "EMP_CONTROL" ? "Mitarbeiter" : ticket.source}</>}
                      </p>
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{fmtCreatedAt(ticket.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <EditTicketDialog
        ticket={selectedTicket}
        areas={areas}
        subscriptions={subs}
        services={svcs}
        vereine={vereine}
        autoFocusCode
        onClose={() => {
          setSelectedTicket(null);
          fetchData(date);
        }}
      />
    </div>
  );
}
