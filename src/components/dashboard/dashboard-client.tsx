"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
      className="flex items-center gap-2 py-1 cursor-pointer rounded px-1 -mx-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      onClick={onClick}
    >
      {ticket.profileImage ? (
        <img src={ticket.profileImage} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-6 w-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-slate-400">
            {(ticket.firstName?.[0] || ticket.name[0] || "?").toUpperCase()}
          </span>
        </div>
      )}
      <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate flex-1 min-w-0">
        {personName(ticket)}
      </span>
      {!inSlot && !hideType && ticket.ticketTypeName && (
        <span className="text-[10px] text-slate-400 truncate max-w-[90px] hidden sm:inline">{ticket.ticketTypeName}</span>
      )}
      {time && (
        <span className="text-[10px] text-indigo-500 font-mono shrink-0">{time}</span>
      )}
      {ticket.needsPhoto && (
        <Camera className="h-3 w-3 text-amber-500 shrink-0" />
      )}
      {ticket.needsRfid && (
        <ScanLine className="h-3 w-3 text-amber-500 shrink-0" />
      )}
      <div
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          ticket.status === "VALID"
            ? "bg-emerald-500"
            : ticket.status === "REDEEMED"
              ? "bg-sky-500"
              : "bg-slate-300"
        )}
      />
    </div>
  );
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#e2e8f0",
  padding: "6px 10px",
};

function HourlyChart({ data, peakHour }: { data: HourlyBucket[]; peakHour: { hour: string; count: number } | null }) {
  const total = data.reduce((s, b) => s + b.total, 0);
  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
          <BarChart3 className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          Scan-Verlauf (Tag)
        </span>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Erlaubt
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> Abgelehnt
          </span>
        </div>
      </div>
      <div className="px-3 pt-3 pb-2">
        {total === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Keine Scans an diesem Tag.</p>
        ) : (
          <>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    interval={2}
                  />
                  <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "rgba(99, 102, 241, 0.08)" }} />
                  <Bar dataKey="granted" name="Erlaubt" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="#f87171" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {peakHour && (
              <p className="text-[10px] text-slate-500 mt-1 text-center">
                Spitze um <span className="font-semibold text-slate-700 dark:text-slate-300">{peakHour.hour}</span> mit {peakHour.count} Scans
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function ScanResultDonut({ results }: { results: { granted: number; denied: number; protected: number } }) {
  const total = results.granted + results.denied + results.protected;
  const data = [
    { name: "Erlaubt", value: results.granted, color: "#10b981" },
    { name: "Abgelehnt", value: results.denied, color: "#f87171" },
    { name: "Geschützt", value: results.protected, color: "#fbbf24" },
  ].filter((d) => d.value > 0);

  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
          <PieChartIcon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
          Scan-Ergebnisse
        </span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">{total}</Badge>
      </div>
      <div className="px-3 pt-3 pb-2">
        {total === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Noch keine Scans an diesem Tag.</p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-[160px] w-[160px] shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {data.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-none">{total}</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Scans</span>
              </div>
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
              {data.map((d) => {
                const pct = Math.round((d.value / total) * 100);
                return (
                  <div key={d.name} className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate flex-1">{d.name}</span>
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{d.value}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function WeekTrendChart({ data, selectedDate }: { data: WeekTrendDay[]; selectedDate: string }) {
  const totalScans = data.reduce((s, d) => s + d.scans, 0);
  const totalTickets = data.reduce((s, d) => s + d.tickets, 0);
  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
          <Activity className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          7-Tage-Trend
        </span>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-indigo-500" /> Scans
            <span className="text-slate-700 dark:text-slate-300 font-semibold ml-0.5 tabular-nums">{totalScans}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Neue Tickets
            <span className="text-slate-700 dark:text-slate-300 font-semibold ml-0.5 tabular-nums">{totalTickets}</span>
          </span>
        </div>
      </div>
      <div className="px-3 pt-3 pb-2">
        {totalScans === 0 && totalTickets === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Keine Aktivität in den letzten 7 Tagen.</p>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="scansGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="ticketsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="dayName"
                  tickFormatter={(value: string, index: number) => {
                    const isSelected = data[index]?.date === selectedDate;
                    return isSelected ? `▸${value}` : value;
                  }}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="scans" name="Scans" stroke="#6366f1" strokeWidth={2} fill="url(#scansGradient)" />
                <Area type="monotone" dataKey="tickets" name="Neue Tickets" stroke="#10b981" strokeWidth={2} fill="url(#ticketsGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}

function TopDevicesCard({ devices }: { devices: TopDevice[] }) {
  const max = devices.reduce((m, d) => Math.max(m, d.total), 0);
  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
          <Smartphone className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          Top-Geräte heute
        </span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">{devices.length}</Badge>
      </div>
      <div className="px-3 pt-2 pb-2 space-y-2">
        {devices.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">Noch keine Scans an diesem Tag.</p>
        ) : (
          devices.map((d) => {
            const grantedPct = max > 0 ? (d.granted / max) * 100 : 0;
            const deniedPct = max > 0 ? (d.denied / max) * 100 : 0;
            const rate = d.total > 0 ? Math.round((d.granted / d.total) * 100) : 0;
            return (
              <div key={d.id} className="space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium text-slate-700 dark:text-slate-300 truncate flex-1 min-w-0">{d.name}</span>
                  <span className="text-slate-400 tabular-nums">{d.total}</span>
                  <span className={cn(
                    "tabular-nums w-10 text-right font-semibold",
                    rate >= 90 ? "text-emerald-500" : rate >= 70 ? "text-amber-500" : "text-rose-500",
                  )}>{rate}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  <div className="bg-emerald-500 h-full" style={{ width: `${grantedPct}%` }} />
                  <div className="bg-rose-400 h-full" style={{ width: `${deniedPct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

const MEMBERSHIP_PALETTE = [
  { bar: "bg-violet-500", dot: "bg-violet-500" },
  { bar: "bg-indigo-500", dot: "bg-indigo-500" },
  { bar: "bg-sky-500", dot: "bg-sky-500" },
  { bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { bar: "bg-amber-500", dot: "bg-amber-500" },
  { bar: "bg-rose-500", dot: "bg-rose-500" },
  { bar: "bg-teal-500", dot: "bg-teal-500" },
  { bar: "bg-pink-500", dot: "bg-pink-500" },
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
    <Card className="py-0 gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
          {icon}
          {title}
        </span>
        <span className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
          {total}
        </span>
      </div>

      {colored.length > 1 && (
        <div className="px-3 pt-2.5">
          <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
            {colored.map((c) => (
              <div
                key={c.name}
                className={cn("h-full transition-all", c.color.bar)}
                style={{ width: `${c.pct}%` }}
                title={`${c.name}: ${c.group.length}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="max-h-[360px] overflow-y-auto light-scrollbar dark:monitor-scrollbar min-h-[60px]">
        {colored.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            Keine aktiven Einträge am gewählten Tag.
          </p>
        ) : (
          <div className="px-2 py-2 space-y-0.5">
            {colored.map(({ name, group, color, pct }) => {
              const isOpen = openGroups.has(name);
              return (
                <div key={name}>
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", color.dot)} aria-hidden />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0 text-left">
                      {name}
                    </span>
                    <span className="text-[10px] tabular-nums text-slate-400 shrink-0">
                      {Math.round(pct)}%
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200 shrink-0 min-w-[1.5rem] text-right">
                      {group.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 text-slate-400 shrink-0 transition-transform",
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
        "relative border-slate-200 dark:border-slate-800 overflow-hidden gap-0 py-0 shadow-sm",
        "transition-shadow hover:shadow-md",
        area.id === null && "border-dashed",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          overLimit
            ? "bg-rose-500"
            : utilTone === "amber"
              ? "bg-amber-500"
              : count > 0
                ? "bg-indigo-500"
                : "bg-slate-200 dark:bg-slate-800",
        )}
      />
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 pl-3.5">
        <span className="text-sm font-semibold flex items-center gap-1.5 min-w-0 truncate text-slate-900 dark:text-slate-100">
          <MapPin className={cn(
            "h-3.5 w-3.5 shrink-0",
            count > 0 ? "text-indigo-500" : "text-slate-400",
          )} />
          {area.name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {area.openingHours && (
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
              {area.openingHours}
            </span>
          )}
          {limit != null ? (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 font-mono tabular-nums",
                overLimit
                  ? "border-rose-300 text-rose-600 dark:border-rose-800 dark:text-rose-400"
                  : utilTone === "amber"
                    ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                    : count > 0
                      ? "border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"
                      : "border-slate-200 text-slate-400 dark:border-slate-700",
              )}
            >
              {count}/{limit}
            </Badge>
          ) : (
            <Badge
              className={cn(
                "text-[10px] px-1.5 py-0 tabular-nums",
                count > 0
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
              )}
            >
              {count}
            </Badge>
          )}
        </div>
      </div>

      {utilPct != null && count > 0 && (
        <div className="px-3.5 pt-2">
          <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                overLimit
                  ? "bg-rose-500"
                  : utilTone === "amber"
                    ? "bg-amber-500"
                    : "bg-gradient-to-r from-indigo-500 to-violet-500",
              )}
              style={{ width: `${utilPct}%` }}
            />
          </div>
        </div>
      )}

      {(hasResources || hasOther) && (
        <div className="px-3 pb-2 pt-1 pl-3.5 max-h-[320px] overflow-y-auto light-scrollbar dark:monitor-scrollbar">
          {area.resources.map((res, ri) => (
            <div key={res.resourceName} className={cn(ri > 0 && "mt-2")}>
              <div className="flex items-center gap-1.5 py-1 border-b border-slate-100 dark:border-slate-800">
                <Clock className="h-2.5 w-2.5 text-indigo-400 shrink-0" />
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 truncate">
                  {res.resourceName}
                </span>
                {res.slots.length > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-auto">
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
                <div className="py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-400">Sonstige</span>
                </div>
              )}
              {area.otherTickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function QuietAreasCard({ areas }: { areas: AreaData[] }) {
  if (areas.length === 0) return null;
  return (
    <Card className="py-0 gap-0 overflow-hidden border-dashed border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-dashed border-slate-200 dark:border-slate-800">
        <span className="text-xs font-semibold flex items-center gap-1.5 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          Ruhige Bereiche
        </span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">
          {areas.length}
        </Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-px bg-slate-100 dark:bg-slate-800">
        {areas.map((area, i) => (
          <div
            key={area.id ?? `unassigned-${i}`}
            className="flex items-center gap-2 px-3 py-2 min-w-0 bg-white dark:bg-slate-950"
          >
            <MapPin className="h-3 w-3 text-slate-300 dark:text-slate-600 shrink-0" />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate flex-1 min-w-0">
              {area.name}
            </span>
            {area.openingHours && (
              <span className="text-[10px] text-slate-400 font-mono shrink-0 hidden md:inline">
                {area.openingHours}
              </span>
            )}
            <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
              {area.personLimit != null ? `0/${area.personLimit}` : "0"}
            </span>
          </div>
        ))}
      </div>
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
        if (!cancelled && res.ok) setOps(await res.json());
      } catch { /* ignore */ }
    }
    loadOps();
    const t = setInterval(loadOps, 15_000);
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
    <div className="space-y-4">
      {/* Date navigation */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(-7)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={() => setDate(toLocaleDateStr(new Date()))}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-semibold transition-colors",
                isToday(date)
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
              )}
            >
              Heute
            </button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(7)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {fmtDisplayDate(date)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {(loading || ticketLoading) && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((wd) => (
            <button
              key={wd.date}
              type="button"
              onClick={() => setDate(wd.date)}
              className={cn(
                "flex flex-col items-center py-1.5 rounded-lg text-center transition-all",
                wd.isSelected
                  ? "bg-indigo-600 text-white shadow-sm"
                  : wd.isToday
                    ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/50"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
              )}
            >
              <span className="text-[10px] font-medium uppercase">{wd.dayName}</span>
              <span className={cn("text-base font-bold leading-tight", wd.isSelected ? "text-white" : "")}>{wd.dayNum}</span>
            </button>
          ))}
        </div>
      </div>

      <OpsStrip ops={ops} />
      {data && (() => {
        const noShowCount = Math.max(0, totalTickets - data.checkedInCount);
        const checkInRate = totalTickets > 0 ? Math.round((data.checkedInCount / totalTickets) * 100) : 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="py-3 px-4 gap-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tickets</span>
                <Ticket className="h-3.5 w-3.5 text-indigo-500" />
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{totalTickets}</p>
              {totalTickets > 0 && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {noShowCount > 0 ? <><span className="text-rose-500 font-medium">{noShowCount}</span> No-Show</> : "Alle eingecheckt"}
                </p>
              )}
            </Card>
            <Card className="py-3 px-4 gap-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Scans</span>
                <ScanLine className="h-3.5 w-3.5 text-sky-500" />
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{data.scansToday}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {data.scansToday > 0 ? (
                  <><span className="text-emerald-500 font-medium">{data.grantRate}%</span> Erfolgsrate</>
                ) : "Keine Scans"}
              </p>
            </Card>
            <Card className="py-3 px-4 gap-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Eingecheckt</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{data.checkedInCount}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {totalTickets > 0 ? (
                  <><span className="font-medium text-slate-500">{checkInRate}%</span> der Tickets</>
                ) : data.peakHour ? (
                  <>Spitze {data.peakHour.hour}</>
                ) : "—"}
              </p>
            </Card>
            <Card className="py-3 px-4 gap-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Geräte</span>
                <Wifi className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{data.activeDevices}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {data.peakHour ? <>Spitze {data.peakHour.hour} ({data.peakHour.count})</> : "online"}
              </p>
            </Card>
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
          <div className={cn(
            "rounded-xl border text-sm",
            hasErrors
              ? "border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/10"
              : isStale
                ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/10"
                : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/10",
          )}>
            <div
              className={cn("flex items-center gap-3 px-4 py-2.5", hasErrors && details.length > 0 && "cursor-pointer")}
              onClick={() => { if (hasErrors && details.length > 0) setSyncErrorsOpen((v) => !v); }}
            >
              <RefreshCw className={cn(
                "h-4 w-4 shrink-0",
                hasErrors ? "text-rose-500" : isStale ? "text-amber-500" : "text-emerald-500",
              )} />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-slate-800 dark:text-slate-200">ANNY Sync</span>
                <span className="text-slate-500 dark:text-slate-400 ml-2">
                  {fmtSyncAgo(s.lastSync)}
                  {s.lastSync && (
                    <span className="hidden sm:inline"> ({new Date(s.lastSync).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs">
                {s.total != null && (
                  <span className="text-slate-500 dark:text-slate-400">{s.total} Buchungen</span>
                )}
                {(s.created ?? 0) > 0 && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    +{s.created} neu
                  </Badge>
                )}
                {(s.updated ?? 0) > 0 && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                    {s.updated} aktualisiert
                  </Badge>
                )}
                {hasErrors && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                    {s.errors} Fehler {details.length > 0 && (syncErrorsOpen ? "▲" : "▼")}
                  </Badge>
                )}
                {!s.lastSync && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Kein Sync
                  </Badge>
                )}
              </div>
            </div>
            {syncErrorsOpen && details.length > 0 && (
              <div className="px-4 pb-3 space-y-1 border-t border-rose-200/50 dark:border-rose-900/30 pt-2">
                {details.map((d, i) => (
                  <p key={i} className="text-xs text-rose-600 dark:text-rose-400 font-mono truncate">{d}</p>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Area cards: aktive zuerst, ruhige Bereiche kompakt darunter */}
      {data && allAreas.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">Keine Resourcen für dieses Datum</p>
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
        </div>
      )}

      {data && allAreas.length > 0 && (() => {
        const activeAreas = allAreas.filter((a) => a._count.tickets > 0);
        const quietAreas = allAreas.filter((a) => a._count.tickets === 0 && a.occupancyRelevant !== false);
        if (activeAreas.length === 0 && quietAreas.length === 0) return null;
        return (
          <div className="space-y-3">
            {activeAreas.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <HourlyChart data={data.hourly} peakHour={data.peakHour} />
          </div>
          <ScanResultDonut results={data.scanResults} />
        </div>
      )}

      {/* 7-Tage-Trend + Top-Geräte */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <WeekTrendChart data={data.weekTrend} selectedDate={data.date} />
          </div>
          <TopDevicesCard devices={data.topDevices} />
        </div>
      )}

      {/* Abos & Services: separate Bereiche, unabhängig von Tages-Areas */}
      {data && (data.subscriptions.length > 0 || data.services.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.subscriptions.length > 0 && (
            <MembershipsCard
              title="Abos"
              icon={<CreditCard className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
              tickets={data.subscriptions}
              openTicket={openTicket}
              fallbackGroupName="Abo"
            />
          )}
          {data.services.length > 0 && (
            <MembershipsCard
              title="Services"
              icon={<Users className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
              tickets={data.services}
              openTicket={openTicket}
              fallbackGroupName="Service"
            />
          )}
        </div>
      )}

      {/* Live feeds: Recent scans + New bookings (immer sichtbar; Inhalt für gewähltes Datum) */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card className="py-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                <ScanLine className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                Letzte Scans
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">
                {data.scansToday}
              </Badge>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[360px] min-h-[160px] overflow-y-auto light-scrollbar dark:monitor-scrollbar">
              {data.recentScans.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-10 gap-2 text-center">
                  <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center">
                    <ScanLine className="h-5 w-5 text-slate-300 dark:text-slate-600" />
                  </div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Keine Scans an diesem Tag
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 max-w-[260px]">
                    Anderes Datum oben wählen oder die vollständige Historie öffnen.
                  </p>
                </div>
              ) : (
                data.recentScans.map((scan) => (
                  <div key={scan.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    {scan.profileImage ? (
                      <img src={scan.profileImage} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
                        scan.result === "GRANTED" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-rose-100 dark:bg-rose-900/30"
                      )}>
                        {scan.result === "GRANTED"
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          : <XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{scan.ticketName}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {scan.ticketTypeName && <>{scan.ticketTypeName} · </>}
                        {scan.deviceName || "Unbekannt"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono text-slate-400">{fmtScanTime(scan.scanTime)}</span>
                      <div className={cn(
                        "h-1.5 w-1.5 rounded-full ml-auto mt-0.5",
                        scan.result === "GRANTED" ? "bg-emerald-500" : scan.result === "DENIED" ? "bg-rose-500" : "bg-amber-500"
                      )} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="py-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                Neueste Tickets
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">
                {data.newTicketsCount}
              </Badge>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[360px] min-h-[160px] overflow-y-auto light-scrollbar dark:monitor-scrollbar">
              {data.newTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-10 gap-2 text-center">
                  <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center">
                    <Ticket className="h-5 w-5 text-slate-300 dark:text-slate-600" />
                  </div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Keine neuen Tickets an diesem Tag
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 max-w-[260px]">
                    Hier erscheinen Tickets, sobald sie für diesen Tag angelegt wurden.
                  </p>
                </div>
              ) : (
                data.newTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    onClick={() => openTicket(ticket.id)}
                  >
                    {ticket.profileImage ? (
                      <img src={ticket.profileImage} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                          {(ticket.name[0] || "?").toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{ticket.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {ticket.typeName || "Ticket"}
                        {ticket.source && <> · {ticket.source === "ANNY" ? "anny.co" : ticket.source === "EMP_CONTROL" ? "Mitarbeiter" : ticket.source}</>}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">{fmtCreatedAt(ticket.createdAt)}</span>
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
