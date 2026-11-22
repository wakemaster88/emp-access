"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { setAppBadge } from "@/lib/app-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SegmentBar } from "@/components/ui/segment-bar";
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
  Ticket,
  RefreshCw,
  Activity,
  BarChart3,
  Radar,
  CalendarCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EditTicketDialog, type TicketData } from "@/components/tickets/edit-ticket-dialog";
import { SectionHeading } from "@/components/ui/section-heading";
import { OpsCard, type DashboardOps } from "@/components/dashboard/ops-strip";
import { LiveSection, type DashboardLive, fmtHm } from "@/components/dashboard/live-section";
import { TrackingSection } from "@/components/dashboard/tracking-section";
import { AreaStats } from "@/components/dashboard/area-stats";

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
  /** Erlaubter Scan an diesem Tag. */
  checkedIn: boolean;
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

interface DashboardData {
  date: string;
  kpis: {
    /** Tagesbuchungen (Bereiche und ohne Bereich), ohne Abos und Services. */
    booked: number;
    bookedCheckedIn: number;
    subscriptionsVisited: number;
    subscriptionsActive: number;
    newTickets: number;
    newTicketsAnny: number;
  };
  newTickets: NewTicket[];
  areas: AreaData[];
  unassigned: AreaData;
  /** Abos mit erlaubtem Scan an diesem Tag. */
  subscriptions: TicketEntry[];
  /** Services, die an diesem Tag benutzt oder angelegt wurden. */
  services: TicketEntry[];
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

type DayState = "past" | "today" | "future";

function dayStateOf(dateStr: string): DayState {
  const today = toLocaleDateStr(new Date());
  return dateStr === today ? "today" : dateStr < today ? "past" : "future";
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
    <button
      type="button"
      className="flex w-full items-center gap-2 py-1.5 sm:py-1 text-left rounded-[10px] px-1 -mx-1 outline-none hover:bg-glass-tile focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
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
        <Camera className="h-3 w-3 text-warning shrink-0" aria-label="Foto fehlt" />
      )}
      {ticket.needsRfid && (
        <ScanLine className="h-3 w-3 text-warning shrink-0" aria-label="Chip fehlt" />
      )}
      {/* Grün = an diesem Tag schon durchs Drehkreuz, grau = noch nicht da. */}
      <StatusDot size="xs" tone={ticket.checkedIn ? "success" : "neutral"} label={ticket.checkedIn ? "eingecheckt" : "noch nicht da"} />
    </button>
  );
}

function MembershipsCard({
  title,
  icon,
  tickets,
  openTicket,
  fallbackGroupName,
  aside,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  tickets: TicketEntry[];
  openTicket: (id: number) => void;
  fallbackGroupName: string;
  /** Bezug rechts neben der Zahl, z. B. „von 412 aktiven“. */
  aside?: string;
  emptyText: string;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const grouped = (() => {
    const map = new Map<string, TicketEntry[]>();
    for (const t of tickets) {
      const key = t.groupName || t.ticketTypeName?.replace(/\s*\(\d+\s*Termine?\)/, "") || fallbackGroupName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "de"));
  })();
  const maxGroup = grouped.reduce((m, [, g]) => Math.max(m, g.length), 0);

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
        <CardAction className="flex items-center gap-1.5">
          {aside && <span className="text-[11px] text-muted-foreground tabular-nums">{aside}</span>}
          <Badge variant="secondary" className="tabular-nums">{tickets.length}</Badge>
        </CardAction>
      </CardHeader>

      <div className="max-h-[360px] overflow-y-auto scrollbar-thin min-h-[60px]">
        {grouped.length === 0 ? (
          <EmptyState compact title={emptyText} />
        ) : (
          <div className="px-2 sm:px-2.5 space-y-0.5">
            {grouped.map(([name, group]) => {
              const isOpen = openGroups.has(name);
              return (
                <div key={name}>
                  {/* Eine Farbe für alle Gruppen: der Balken zeigt die Menge, nicht wer es ist. */}
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    aria-expanded={isOpen}
                    className="w-full space-y-1 px-2 py-2 sm:py-1.5 rounded-[10px] outline-none hover:bg-glass-tile focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground/80 truncate flex-1 min-w-0 text-left">
                        {name}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-foreground/80 shrink-0">
                        {group.length}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 text-muted-foreground shrink-0 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </span>
                    <SegmentBar segments={[{ label: name, value: group.length, className: "bg-chart-1" }]} max={maxGroup} />
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

function areaTickets(area: AreaData): TicketEntry[] {
  return [...area.resources.flatMap((r) => r.tickets), ...area.otherTickets];
}

function AreaCard({ area, openTicket, dayState }: { area: AreaData; openTicket: (id: number) => void; dayState: DayState }) {
  const hasResources = area.resources.length > 0;
  const hasOther = area.otherTickets.length > 0;
  const count = area._count.tickets;
  const checkedIn = areaTickets(area).filter((t) => t.checkedIn).length;
  const limit = area.personLimit;
  const overLimit = limit != null && count > limit;
  const nearLimit = !overLimit && limit != null && limit > 0 && count / limit >= 0.8;

  return (
    <Card
      className={cn(
        "gap-3",
        // Über dem Limit bzw. ab 80 % Auslastung: Karte in der Zustandsfarbe getönt.
        overLimit
          ? "border-destructive/40 bg-destructive/[0.05]"
          : nearLimit && "border-warning/45 bg-warning/[0.05]",
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
          <Badge
            variant={overLimit ? "danger" : nearLimit ? "warning" : count > 0 ? "secondary" : "neutral"}
            className="tabular-nums"
            title={limit != null ? `${count} gebucht, Limit ${limit}` : `${count} gebucht`}
          >
            {limit != null ? `${count}/${limit}` : count}
          </Badge>
        </CardAction>
      </CardHeader>

      {count > 0 && (
        <CardContent className="space-y-1">
          {/* Länge = Buchungen im Verhältnis zum Limit, grün = davon schon da. */}
          <SegmentBar
            segments={[
              { label: "Eingecheckt", value: checkedIn, className: "bg-success" },
              { label: "Noch nicht da", value: count - checkedIn, className: overLimit ? "bg-destructive/60" : "bg-muted-foreground/45" },
            ]}
            max={limit ?? undefined}
          />
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {dayState === "future"
              ? `${count} gebucht`
              : checkedIn === count
                ? "alle eingecheckt"
                : `${checkedIn} von ${count} eingecheckt`}
            {limit != null && ` · Limit ${limit}`}
          </p>
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
  const [live, setLive] = useState<DashboardLive | null>(null);
  const [liveNow, setLiveNow] = useState(0);
  const [liveFailed, setLiveFailed] = useState(false);
  const [dayView, setDayView] = useState<"stats" | "bookings">("stats");
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

  // Live-Lage: alle 20 s, pausiert solange der Tab im Hintergrund ist.
  useEffect(() => {
    let cancelled = false;
    async function loadLive() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/dashboard/live");
        if (cancelled) return;
        if (res.ok) {
          setLive(await res.json());
          setLiveNow(Date.now());
          setLiveFailed(false);
        } else {
          setLiveFailed(true);
        }
      } catch {
        if (!cancelled) setLiveFailed(true);
      }
    }
    loadLive();
    const t = setInterval(loadLive, 20_000);
    document.addEventListener("visibilitychange", loadLive);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", loadLive);
    };
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
    if (!iso) return "nie";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "gerade eben";
    if (mins < 60) return `vor ${mins} Min.`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `vor ${hrs} Std.`;
    const days = Math.floor(hrs / 24);
    return `vor ${days} Tag${days > 1 ? "en" : ""}`;
  }

  function fmtCreatedAt(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }

  const dayState = dayStateOf(date);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 1. Was ist gerade los: immer „jetzt“, unabhängig vom Tag der Statistik. */}
      <section className="space-y-3 sm:space-y-4" aria-label="Jetzt">
        <SectionHeading
          title="Jetzt"
          icon={Activity}
          aside={
            live ? (
              <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
                <StatusDot tone="live" pulse size="xs" />
                Stand {fmtHm(live.at)} Uhr
              </span>
            ) : undefined
          }
        />
        {live ? (
          <LiveSection
            live={live}
            now={liveNow}
            onOpenTicket={openTicket}
            side={<OpsCard ops={ops} status={live.status} />}
          />
        ) : liveFailed ? (
          <Notice tone="warning" compact title="Live-Lage nicht erreichbar">
            Die Seite versucht es alle 20 Sekunden erneut.
          </Notice>
        ) : (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Lädt …
          </div>
        )}
      </section>

      {/* 2. Tracking: Personen, Fahrzeuge, Bewegungen. */}
      {live && (
        <section className="space-y-3 sm:space-y-4" aria-label="Tracking">
          <SectionHeading title="Tracking" icon={Radar} />
          <TrackingSection live={live} now={liveNow} />
        </section>
      )}

      {/* 3. Statistik und Buchungen des gewählten Tages. */}
      <section className="space-y-4" aria-label="Statistik">
        <SectionHeading title="Statistik" icon={BarChart3} />

        {/* Tag wählen */}
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

        <Segmented
          value={dayView}
          onValueChange={setDayView}
          aria-label="Ansicht des Tages"
          options={[
            { value: "stats", label: "Auswertung" },
            { value: "bookings", label: "Buchungen", count: data ? data.kpis.booked : undefined },
          ]}
        />

        {/* Eintritte, Fahrten und Gäste je Bereich (Strandbad, Seilbahn …) statt einer Summe über alle Leser. */}
        {dayView === "stats" && <AreaStats date={date} />}

        {dayView === "bookings" && loading && !data && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Lädt …
          </div>
        )}

        {dayView === "bookings" && data && (
          <div className="space-y-4">
            {(() => {
              const k = data.kpis;
              const open = Math.max(0, k.booked - k.bookedCheckedIn);
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <StatCard
                    label="Gebucht"
                    icon={CalendarCheck}
                    tone="primary"
                    value={k.booked}
                    hint={
                      k.booked > 0
                        ? `in ${allAreas.filter((a) => a._count.tickets > 0).length} ${allAreas.filter((a) => a._count.tickets > 0).length === 1 ? "Bereich" : "Bereichen"}`
                        : "keine Tagesbuchung"
                    }
                  />
                  <StatCard
                    label="Eingecheckt"
                    icon={CheckCircle2}
                    tone="success"
                    value={k.bookedCheckedIn}
                    suffix={k.booked > 0 ? `von ${k.booked}` : undefined}
                    progress={k.booked > 0 && dayState !== "future" ? k.bookedCheckedIn / k.booked : undefined}
                    hint={
                      k.booked === 0
                        ? "—"
                        : dayState === "future"
                          ? "Tag liegt noch vor uns"
                          : open === 0
                            ? "alle eingecheckt"
                            : dayState === "today"
                              ? `${open} noch nicht da`
                              : `${open} nicht gekommen`
                    }
                  />
                  <StatCard
                    label="Abos da"
                    icon={CreditCard}
                    tone="info"
                    value={k.subscriptionsVisited}
                    hint={`von ${k.subscriptionsActive.toLocaleString("de-DE")} aktiven`}
                  />
                  <StatCard
                    label="Neu angelegt"
                    icon={Sparkles}
                    tone="neutral"
                    value={k.newTickets}
                    hint={k.newTickets > 0 ? `davon ${k.newTicketsAnny} über anny` : "kein neues Ticket"}
                  />
                </div>
              );
            })()}

            {/* anny-Abgleich: leise Zeile, solange alles läuft; Fehler und Stillstand als Hinweis. */}
            {data.annySyncStatus && (() => {
              const s = data.annySyncStatus!;
              const syncAge = s.lastSync ? Date.now() - new Date(s.lastSync).getTime() : Infinity;
              const isStale = syncAge > 2 * 60 * 60_000;
              const hasErrors = (s.errors ?? 0) > 0;
              const details = s.errorDetails ?? [];
              if (!hasErrors && !isStale) {
                return (
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" role="status">
                    <RefreshCw className="h-3 w-3 shrink-0" aria-hidden />
                    <span>anny abgeglichen {fmtSyncAgo(s.lastSync)}</span>
                    {(s.created ?? 0) > 0 && <span className="tabular-nums">· {s.created} neu</span>}
                    {(s.updated ?? 0) > 0 && <span className="tabular-nums">· {s.updated} aktualisiert</span>}
                  </p>
                );
              }
              return (
                <Notice
                  tone={hasErrors ? "danger" : "warning"}
                  icon={RefreshCw}
                  role="status"
                  compact
                  title={
                    <>
                      {hasErrors ? `anny-Abgleich mit ${s.errors} Fehler${s.errors === 1 ? "" : "n"}` : "anny-Abgleich hängt"}
                      <span className="font-normal text-muted-foreground ml-2">
                        zuletzt {fmtSyncAgo(s.lastSync)}
                      </span>
                    </>
                  }
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.total != null && <span className="mr-0.5">{s.total} Buchungen geprüft</span>}
                    {!s.lastSync && <Badge variant="warning">Noch nie gelaufen</Badge>}
                    {/* Fehlerliste per Taste aufklappen (Tastatur und Screenreader erreichen sie). */}
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

            {/* Bereiche mit Buchungen zuerst, ruhige kompakt darunter */}
            {allAreas.length === 0 && (
              <Card>
                <EmptyState
                  icon={MapPin}
                  title="Keine Resourcen für dieses Datum"
                  description="Anderes Datum oben wählen."
                />
              </Card>
            )}

            {allAreas.length > 0 && (() => {
              const activeAreas = allAreas
                .filter((a) => a._count.tickets > 0)
                .sort((x, y) => y._count.tickets - x._count.tickets);
              const quietAreas = allAreas.filter((a) => a._count.tickets === 0 && a.occupancyRelevant !== false);
              if (activeAreas.length === 0 && quietAreas.length === 0) return null;
              return (
                <div className="space-y-4">
                  {activeAreas.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {activeAreas.map((area) => (
                        <AreaCard key={area.id ?? "unassigned"} area={area} openTicket={openTicket} dayState={dayState} />
                      ))}
                    </div>
                  )}
                  <QuietAreasCard areas={quietAreas} />
                </div>
              );
            })()}

            {/* Abos (da gewesen) und Services (benutzt oder neu) des Tages */}
            {(data.kpis.subscriptionsActive > 0 || data.services.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.kpis.subscriptionsActive > 0 && (
                  <MembershipsCard
                    title="Abos da"
                    icon={<CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    tickets={data.subscriptions}
                    openTicket={openTicket}
                    fallbackGroupName="Abo"
                    aside={`von ${data.kpis.subscriptionsActive.toLocaleString("de-DE")}`}
                    emptyText={dayState === "today" ? "Heute war noch kein Abo da." : "An diesem Tag war kein Abo da."}
                  />
                )}
                {data.services.length > 0 && (
                  <MembershipsCard
                    title="Services"
                    icon={<Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    tickets={data.services}
                    openTicket={openTicket}
                    fallbackGroupName="Service"
                    aside="benutzt oder neu"
                    emptyText="Kein Service an diesem Tag."
                  />
                )}
              </div>
            )}

            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Ticket className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  Neu angelegte Tickets
                </CardTitle>
                <CardAction className="flex items-center gap-1.5">
                  {data.kpis.newTickets > data.newTickets.length && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      neueste {data.newTickets.length}
                    </span>
                  )}
                  <Badge variant="secondary" className="tabular-nums">
                    {data.kpis.newTickets}
                  </Badge>
                </CardAction>
              </CardHeader>
              <div className="px-2 sm:px-2.5 divide-y divide-border/60 max-h-[360px] min-h-[120px] overflow-y-auto scrollbar-thin">
                {data.newTickets.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Ticket}
                    title="Keine neuen Tickets an diesem Tag"
                    description="Hier erscheinen Tickets, sobald sie für diesen Tag angelegt wurden."
                  />
                ) : (
                  data.newTickets.map((ticket) => (
                    <button
                      type="button"
                      key={ticket.id}
                      className="flex w-full min-h-11 items-center gap-2.5 px-2 py-2 text-left outline-none hover:bg-glass-tile focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
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
                          {ticket.source && <> · {ticket.source === "ANNY" ? "anny" : ticket.source === "EMP_CONTROL" ? "Mitarbeiter" : ticket.source}</>}
                        </p>
                      </div>
                      <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{fmtCreatedAt(ticket.createdAt)}</span>
                    </button>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}
      </section>

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
