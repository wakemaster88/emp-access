"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditTicketDialog, type TicketData } from "./edit-ticket-dialog";
import { fmtDateShort, fmtDateTimeShort, isDateOnly } from "@/lib/utils";

interface Area {
  id: number;
  name: string;
}

interface Sub {
  id: number;
  name: string;
}

interface Svc {
  id: number;
  name: string;
}

interface TicketsTableProps {
  tickets: TicketData[];
  areas: Area[];
  subscriptions?: Sub[];
  services?: Svc[];
  readonly?: boolean;
  /** Bei Code-Suche: wenn genau ein Ticket gefunden, Bearbeiten-Dialog automatisch öffnen */
  searchCode?: string;
}

function sourceBadge(source: string | null | undefined) {
  const label = !source
    ? "Eigenes"
    : (() => {
        const s = source.toUpperCase();
        if (s === "ANNY") return "anny";
        if (s === "WAKESYS") return "wakesys";
        if (s === "BINARYTEC") return "binarytec";
        if (s === "EMP_CONTROL") return "emp-control";
        if (s === "SHELLY") return "shelly";
        return source;
      })();
  if (!source) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400 font-normal">
        {label}
      </Badge>
    );
  }
  const s = source.toUpperCase();
  if (s === "ANNY") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400 font-normal">
        {label}
      </Badge>
    );
  }
  if (s === "WAKESYS" || s === "EMP_CONTROL" || s === "BINARYTEC" || s === "SHELLY") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400 font-normal">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
      {label}
    </Badge>
  );
}

/** Zeigt Code nur an, wenn es ein echter Scan-Code ist (kein anny-Buchungs-JSON). */
function displayCode(ticket: TicketData): string {
  const raw = ticket.barcode || ticket.qrCode || ticket.rfidCode;
  if (!raw) return "–";
  const t = raw.trim();
  if (t.startsWith("[") || t.startsWith("{")) return "–";
  if (t.length > 80) return `${t.slice(0, 40)}…`;
  return t;
}

function statusBadge(status: string) {
  switch (status) {
    case "VALID":
      return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Gültig</Badge>;
    case "REDEEMED":
      return <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">Eingelöst</Badge>;
    case "INVALID":
      return <Badge variant="destructive">Ungültig</Badge>;
    case "PROTECTED":
      return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Geschützt</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDuration(minutes: number) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}min` : ""}` : `${mins}min`;
}

function ValidityInfo({ ticket }: { ticket: TicketData }) {
  const vt = ticket.validityType ?? "DATE_RANGE";
  const hasRange = ticket.startDate || ticket.endDate;

  const dateRangeStr = hasRange
    ? (() => {
        const start = ticket.startDate ? new Date(ticket.startDate) : null;
        const end = ticket.endDate ? new Date(ticket.endDate) : null;
        const startOnlyDate = start && isDateOnly(start);
        const endOnlyDate = end && isDateOnly(end);
        if (startOnlyDate && endOnlyDate) {
          return `${ticket.startDate ? fmtDateShort(ticket.startDate) : "∞"} – ${ticket.endDate ? fmtDateShort(ticket.endDate) : "∞"}`;
        }
        return `${ticket.startDate ? fmtDateTimeShort(ticket.startDate) : "∞"} – ${ticket.endDate ? fmtDateTimeShort(ticket.endDate) : "∞"}`;
      })()
    : null;

  if (vt === "TIME_SLOT") {
    const slot = ticket.slotStart && ticket.slotEnd ? `${ticket.slotStart}–${ticket.slotEnd}` : "Zeitslot";
    return (
      <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
        {dateRangeStr && <span>{dateRangeStr}</span>}
        {dateRangeStr && " · "}
        <span className="text-indigo-600 dark:text-indigo-400">{slot} Uhr</span>
      </span>
    );
  }

  if (vt === "DURATION") {
    const dur = ticket.validityDurationMinutes ? `${formatDuration(ticket.validityDurationMinutes)} ab Scan` : "Dauer ab Scan";
    return (
      <span className="text-xs text-slate-600 dark:text-slate-400">
        {dateRangeStr && <span className="whitespace-nowrap">{dateRangeStr}</span>}
        {dateRangeStr && " · "}
        <span className="text-violet-600 dark:text-violet-400">{dur}</span>
        {ticket.firstScanAt && (
          <span className="block text-[10px] text-slate-400 mt-0.5">Start: {fmtDateTimeShort(ticket.firstScanAt)}</span>
        )}
      </span>
    );
  }

  return (
    <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
      {dateRangeStr ?? "–"}
    </span>
  );
}

type TicketWithArea = TicketData & { accessArea?: { name: string } | null };

export function TicketsTable({ tickets, areas, subscriptions = [], services = [], readonly, searchCode }: TicketsTableProps) {
  const [selected, setSelected] = useState<TicketData | null>(null);
  const openedForCodeRef = useRef<string | null>(null);

  const groupedByResource = useMemo(() => {
    const map = new Map<string, TicketWithArea[]>();
    for (const t of tickets as TicketWithArea[]) {
      const name = t.accessArea?.name ?? "Keine Resource";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(t);
    }
    const none = "Keine Resource";
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === none) return 1;
        if (b === none) return -1;
        return a.localeCompare(b, "de");
      })
      .map(([resourceName, list]) => ({ resourceName, tickets: list }));
  }, [tickets]);

  useEffect(() => {
    if (!searchCode) {
      openedForCodeRef.current = null;
      return;
    }
    if (readonly || tickets.length !== 1) return;
    if (openedForCodeRef.current === searchCode) return;
    openedForCodeRef.current = searchCode;
    setSelected(tickets[0]);
  }, [searchCode, readonly, tickets]);

  return (
    <>
      <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden lg:table-cell">Code</TableHead>
              <TableHead className="hidden sm:table-cell">Quelle</TableHead>
              <TableHead className="hidden xl:table-cell">Tickettyp</TableHead>
              <TableHead className="hidden md:table-cell">Resource</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Gültigkeit</TableHead>
              <TableHead className="text-right">Scans</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500 py-12">
                  {searchCode ? "Kein Ticket mit diesem Code gefunden" : "Keine Tickets vorhanden"}
                </TableCell>
              </TableRow>
            )}
            {groupedByResource.map(({ resourceName, tickets: groupTickets }) => (
              <React.Fragment key={resourceName}>
                <TableRow className="bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <TableCell colSpan={8} className="py-1.5 px-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {resourceName}
                    <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">
                      ({groupTickets.length} {groupTickets.length === 1 ? "Ticket" : "Tickets"})
                    </span>
                  </TableCell>
                </TableRow>
                {groupTickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className={
                      readonly
                        ? "hover:bg-slate-50 dark:hover:bg-slate-900/50"
                        : "hover:bg-slate-50 dark:hover:bg-slate-900/50 cursor-pointer"
                    }
                    onClick={() => !readonly && setSelected(ticket)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5 min-w-0">
                        {ticket.profileImage ? (
                          <img src={ticket.profileImage} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                        ) : null}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                          </p>
                          <p className="text-xs text-slate-400 sm:hidden truncate">
                            {(ticket as TicketWithArea).accessArea?.name || "–"}
                            {ticket.ticketTypeName ? ` · ${ticket.ticketTypeName}` : ""}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs font-mono text-slate-500">
                      {displayCode(ticket)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {sourceBadge(ticket.source)}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-sm text-slate-500">
                      {ticket.ticketTypeName || "–"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {(ticket as TicketWithArea).accessArea ? (
                        <Link
                          href={`/areas`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {(ticket as TicketWithArea).accessArea?.name}
                        </Link>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                    <TableCell>{statusBadge(ticket.status)}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-slate-500">
                      <ValidityInfo ticket={ticket} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {ticket._count.scans > 0 ? (
                        <Link
                          href={`/scans`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {ticket._count.scans}
                        </Link>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {!readonly && (
        <EditTicketDialog
          ticket={selected}
          areas={areas}
          subscriptions={subscriptions}
          services={services}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
