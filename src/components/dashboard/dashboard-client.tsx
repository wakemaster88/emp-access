"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  ScanLine,
  Loader2,
  MapPin,
  Clock,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EditTicketDialog, type TicketData } from "@/components/tickets/edit-ticket-dialog";

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
  aboTickets: TicketEntry[];
  _count: { tickets: number };
}

interface DashboardData {
  date: string;
  scansToday: number;
  areas: AreaData[];
  unassigned: AreaData;
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

function TicketRow({ ticket, onClick, inSlot }: { ticket: TicketEntry; onClick: () => void; inSlot?: boolean }) {
  const time = !inSlot
    ? (ticket.bookingStart
        ? `${ticket.bookingStart}${ticket.bookingEnd ? `–${ticket.bookingEnd}` : ""}`
        : ticket.slotStart && ticket.slotEnd
          ? `${ticket.slotStart}–${ticket.slotEnd}`
          : null)
    : null;

  return (
    <div
      className="flex items-center gap-2 py-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
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
      {!inSlot && ticket.ticketTypeName && (
        <span className="text-[10px] text-slate-400 truncate max-w-[90px] hidden sm:inline">{ticket.ticketTypeName}</span>
      )}
      {time && (
        <span className="text-[10px] text-indigo-500 font-mono shrink-0">{time}</span>
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

function AboSection({ tickets, openTicket }: { tickets: TicketEntry[]; openTicket: (id: number) => void }) {
  const [open, setOpen] = useState(false);

  if (tickets.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 py-1 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-t transition-colors"
      >
        <CreditCard className="h-2.5 w-2.5 text-violet-400 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Abos</span>
        <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">{tickets.length}</Badge>
        <ChevronDown className={cn("h-3 w-3 text-slate-400 ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="pl-0.5">
          {tickets.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AreaCard({ area, openTicket }: { area: AreaData; openTicket: (id: number) => void }) {
  const hasResources = area.resources.length > 0;
  const hasOther = area.otherTickets.length > 0;
  const hasAbos = area.aboTickets.length > 0;
  const isEmpty = !hasResources && !hasOther && !hasAbos;

  return (
    <Card
      className={cn(
        "border-slate-200 dark:border-slate-800 overflow-hidden",
        area.id === null && "border-dashed"
      )}
    >
      <CardHeader className="py-2.5 px-3.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-1.5 min-w-0 truncate">
            <MapPin className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            {area.name}
          </CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            {area.openingHours && (
              <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                {area.openingHours}
              </span>
            )}
            {area.personLimit != null && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 font-mono",
                  area._count.tickets > area.personLimit
                    ? "border-rose-300 text-rose-600"
                    : "border-slate-300 text-slate-500"
                )}
              >
                {area._count.tickets}/{area.personLimit}
              </Badge>
            )}
            <Badge
              className={cn(
                "text-[10px] px-1.5 py-0 tabular-nums",
                area._count.tickets > 0
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800"
              )}
            >
              {area._count.tickets}
            </Badge>
          </div>
        </div>
      </CardHeader>

      {!isEmpty && (
        <CardContent className="pt-0 pb-2 px-3.5 max-h-[320px] overflow-y-auto">
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

          <AboSection tickets={area.aboTickets} openTicket={openTicket} />
        </CardContent>
      )}

      {isEmpty && (
        <CardContent className="pt-0 pb-2.5 px-3.5">
          <p className="text-[11px] text-slate-300 dark:text-slate-600">Keine Tickets</p>
        </CardContent>
      )}
    </Card>
  );
}

export function DashboardClient() {
  const [date, setDate] = useState(toLocaleDateStr(new Date()));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [subs, setSubs] = useState<{ id: number; name: string }[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketData | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);

  const fetchData = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?date=${d}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(date); }, [date, fetchData]);

  useEffect(() => {
    fetch("/api/areas")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setAreas(d); })
      .catch(() => {});
    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setSubs(d); })
      .catch(() => {});
  }, []);

  async function openTicket(ticketId: number) {
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

  return (
    <div className="space-y-4">
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
            <Badge variant="secondary" className="gap-1 text-xs py-0.5 px-2">
              <Users className="h-3 w-3" />
              {totalTickets}
            </Badge>
            {data && (
              <Badge variant="secondary" className="gap-1 text-xs py-0.5 px-2">
                <ScanLine className="h-3 w-3" />
                {data.scansToday}
              </Badge>
            )}
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

      {!loading && allAreas.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">Keine Resourcen für dieses Datum</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {allAreas.map((area) => (
          <AreaCard key={area.id ?? "unassigned"} area={area} openTicket={openTicket} />
        ))}
      </div>

      <EditTicketDialog
        ticket={selectedTicket}
        areas={areas}
        subscriptions={subs}
        onClose={() => {
          setSelectedTicket(null);
          fetchData(date);
        }}
      />
    </div>
  );
}
