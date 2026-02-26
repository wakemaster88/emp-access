"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
  ScanLine,
  Loader2,
  MapPin,
  Clock,
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

function TicketRow({ ticket, onClick }: { ticket: TicketEntry; onClick: () => void }) {
  const time = ticket.bookingStart
    ? `${ticket.bookingStart}${ticket.bookingEnd ? `–${ticket.bookingEnd}` : ""}`
    : ticket.slotStart && ticket.slotEnd
      ? `${ticket.slotStart}–${ticket.slotEnd}`
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
      {ticket.ticketTypeName && (
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

export function DashboardClient() {
  const [date, setDate] = useState(toLocaleDateStr(new Date()));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<AreaOption[]>([]);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-0.5">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="relative">
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="w-40 h-8 text-xs font-medium pl-8"
            />
            <CalendarDays className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {!isToday(date) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setDate(toLocaleDateStr(new Date()))}>
            Heute
          </Button>
        )}

        <span className="text-sm font-medium text-slate-600 dark:text-slate-400 hidden sm:inline">
          {fmtDisplayDate(date)}
          {isToday(date) && <span className="ml-1 text-slate-400 font-normal">· heute</span>}
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

      {!loading && allAreas.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">Keine Resourcen für dieses Datum</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {allAreas.map((area) => {
          const hasResources = area.resources.length > 0;
          const hasOther = area.otherTickets.length > 0;
          const isEmpty = !hasResources && !hasOther;

          return (
            <Card
              key={area.id ?? "unassigned"}
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
                            <TicketRow key={ticket.id} ticket={ticket} onClick={() => openTicket(ticket.id)} />
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
                </CardContent>
              )}

              {isEmpty && (
                <CardContent className="pt-0 pb-2.5 px-3.5">
                  <p className="text-[11px] text-slate-300 dark:text-slate-600">Keine Tickets</p>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <EditTicketDialog
        ticket={selectedTicket}
        areas={areas}
        onClose={() => {
          setSelectedTicket(null);
          fetchData(date);
        }}
      />
    </div>
  );
}
