"use client";

import { useState } from "react";
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
import { fmtDate, fmtDateTime } from "@/lib/utils";

interface Area {
  id: number;
  name: string;
}

interface TicketsTableProps {
  tickets: TicketData[];
  areas: Area[];
  readonly?: boolean;
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

  const dateRange = (ticket.startDate || ticket.endDate)
    ? `${ticket.startDate ? fmtDate(ticket.startDate) : "∞"} – ${ticket.endDate ? fmtDate(ticket.endDate) : "∞"}`
    : null;

  if (vt === "TIME_SLOT") {
    return (
      <div className="space-y-0.5">
        {dateRange && <p>{dateRange}</p>}
        {ticket.slotStart && ticket.slotEnd ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400">
            {ticket.slotStart}–{ticket.slotEnd} Uhr
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400">
            Zeitslot
          </Badge>
        )}
      </div>
    );
  }

  if (vt === "DURATION") {
    return (
      <div className="space-y-0.5">
        {dateRange && <p>{dateRange}</p>}
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400">
          {ticket.validityDurationMinutes
            ? `${formatDuration(ticket.validityDurationMinutes)} ab Scan`
            : "Dauer ab Scan"}
        </Badge>
        {ticket.firstScanAt && (
          <p className="text-xs text-slate-400">Start: {fmtDateTime(ticket.firstScanAt)}</p>
        )}
      </div>
    );
  }

  return <span>{dateRange ?? "–"}</span>;
}

export function TicketsTable({ tickets, areas, readonly }: TicketsTableProps) {
  const [selected, setSelected] = useState<TicketData | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Bereich</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Gültigkeit</TableHead>
            <TableHead className="text-right">Scans</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-slate-500 py-12">
                Keine Tickets vorhanden
              </TableCell>
            </TableRow>
          )}
          {tickets.map((ticket) => (
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
                <div className="flex items-center gap-2.5">
                  {ticket.profileImage ? (
                    <img src={ticket.profileImage} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : null}
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                    </p>
                    {ticket.ticketTypeName && (
                      <p className="text-xs text-slate-400">{ticket.ticketTypeName}</p>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-xs font-mono text-slate-500">
                {ticket.source === "ANNY" ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400 font-normal">
                    anny #{(ticket.qrCode || ticket.uuid || "").split(",")[0]}
                  </Badge>
                ) : (
                  ticket.barcode || ticket.qrCode || ticket.rfidCode || "–"
                )}
              </TableCell>
              <TableCell className="text-sm">
                {(ticket as TicketData & { accessArea?: { name: string } | null }).accessArea?.name || "–"}
              </TableCell>
              <TableCell>{statusBadge(ticket.status)}</TableCell>
              <TableCell className="text-sm text-slate-500">
                <ValidityInfo ticket={ticket} />
              </TableCell>
              <TableCell className="text-right font-medium">{ticket._count.scans}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {!readonly && (
        <EditTicketDialog
          ticket={selected}
          areas={areas}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
