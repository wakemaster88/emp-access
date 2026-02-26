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
}

interface AreaData {
  id: number | null;
  name: string;
  personLimit: number | null;
  allowReentry: boolean;
  openingHours: string | null;
  tickets: TicketEntry[];
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
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(date);
  }, [date, fetchData]);

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
      if (res.ok) {
        const ticket = await res.json();
        setSelectedTicket(ticket);
      }
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
    <div className="space-y-6">
      {/* Date picker bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="w-44 h-9 text-sm font-medium pl-9"
            />
            <CalendarDays className="h-4 w-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {!isToday(date) && (
          <Button variant="ghost" size="sm" onClick={() => setDate(toLocaleDateStr(new Date()))}>
            Heute
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {(loading || ticketLoading) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <Badge variant="secondary" className="gap-1.5 text-sm py-1 px-3">
            <Users className="h-3.5 w-3.5" />
            {totalTickets} Tickets
          </Badge>
          {data && (
            <Badge variant="secondary" className="gap-1.5 text-sm py-1 px-3">
              <ScanLine className="h-3.5 w-3.5" />
              {data.scansToday} Scans
            </Badge>
          )}
        </div>
      </div>

      {/* Date display */}
      <p className="text-lg font-semibold text-slate-800 dark:text-slate-200">
        {fmtDisplayDate(date)}
        {isToday(date) && (
          <span className="ml-2 text-sm font-normal text-slate-400">heute</span>
        )}
      </p>

      {/* Areas grid */}
      {!loading && allAreas.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <MapPin className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Keine Bereiche mit Tickets für dieses Datum</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {allAreas.map((area) => (
          <Card
            key={area.id ?? "unassigned"}
            className={cn(
              "border-slate-200 dark:border-slate-800 overflow-hidden",
              area.id === null && "border-dashed"
            )}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-500" />
                  {area.name}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {area.personLimit && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs font-mono",
                        area._count.tickets > area.personLimit
                          ? "border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400"
                          : "border-slate-300 text-slate-500"
                      )}
                    >
                      {area._count.tickets}/{area.personLimit}
                    </Badge>
                  )}
                  <Badge
                    className={cn(
                      "text-xs tabular-nums",
                      area._count.tickets > 0
                        ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800"
                    )}
                  >
                    {area._count.tickets}
                  </Badge>
                </div>
              </div>
              {area.openingHours && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Clock className="h-3 w-3 text-slate-400" />
                  <span className="text-xs text-slate-500">{area.openingHours}</span>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              {area.tickets.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">Keine Tickets</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[320px] overflow-y-auto -mx-1 px-1">
                  {area.tickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center gap-2.5 py-2 cursor-pointer rounded-md px-1 -mx-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      onClick={() => openTicket(ticket.id)}
                    >
                      {ticket.profileImage ? (
                        <img
                          src={ticket.profileImage}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-slate-400">
                            {(ticket.firstName?.[0] || ticket.name[0] || "?").toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                          {personName(ticket)}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {ticket.ticketTypeName && (
                            <span className="text-xs text-slate-400 truncate">{ticket.ticketTypeName}</span>
                          )}
                          {ticket.slotStart && ticket.slotEnd && (
                            <span className="text-xs text-indigo-500 font-mono">
                              {ticket.slotStart}–{ticket.slotEnd}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {ticket.source === "ANNY" && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-violet-300 text-violet-500">
                            anny
                          </Badge>
                        )}
                        <div
                          className={cn(
                            "h-2 w-2 rounded-full",
                            ticket.status === "VALID"
                              ? "bg-emerald-500"
                              : ticket.status === "REDEEMED"
                                ? "bg-sky-500"
                                : "bg-slate-300"
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
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
