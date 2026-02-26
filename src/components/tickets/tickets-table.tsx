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

function ValidityInfo({ ticket }: { ticket: TicketData }) {
  const ext = ticket as TicketData & {
    validityType?: string;
    slotStart?: string | null;
    slotEnd?: string | null;
    validityDurationMinutes?: number | null;
    firstScanAt?: string | null;
  };
  const vt = ext.validityType ?? "DATE_RANGE";

  const dateRange = (ticket.startDate || ticket.endDate)
    ? `${ticket.startDate ? fmtDate(ticket.startDate) : "∞"} – ${ticket.endDate ? fmtDate(ticket.endDate) : "∞"}`
    : null;

  if (vt === "TIME_SLOT" && ext.slotStart && ext.slotEnd) {
    return (
      <div className="space-y-0.5">
        {dateRange && <p>{dateRange}</p>}
        <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
          {ext.slotStart}–{ext.slotEnd} Uhr
        </p>
      </div>
    );
  }

  if (vt === "DURATION" && ext.validityDurationMinutes) {
    const hrs = Math.floor(ext.validityDurationMinutes / 60);
    const mins = ext.validityDurationMinutes % 60;
    const label = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}min` : ""}` : `${mins}min`;
    return (
      <div className="space-y-0.5">
        {dateRange && <p>{dateRange}</p>}
        <p className="text-xs font-medium text-violet-600 dark:text-violet-400">
          {label} ab 1. Scan
        </p>
        {ext.firstScanAt && (
          <p className="text-xs text-slate-400">Start: {fmtDateTime(ext.firstScanAt)}</p>
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
            <TableHead>Person</TableHead>
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
              <TableCell colSpan={7} className="text-center text-slate-500 py-12">
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
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{ticket.name}</p>
                  {ticket.ticketTypeName && (
                    <p className="text-xs text-slate-400">{ticket.ticketTypeName}</p>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-500">
                {ticket.firstName || ticket.lastName
                  ? `${ticket.firstName ?? ""} ${ticket.lastName ?? ""}`.trim()
                  : "–"}
              </TableCell>
              <TableCell className="text-xs font-mono text-slate-500">
                {ticket.barcode || ticket.qrCode || ticket.rfidCode || "–"}
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
