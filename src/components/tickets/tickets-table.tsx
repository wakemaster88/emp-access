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
import { fmtDate } from "@/lib/utils";

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
            <TableHead>Gültig ab</TableHead>
            <TableHead>Gültig bis</TableHead>
            <TableHead className="text-right">Scans</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-slate-500 py-12">
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
                {ticket.startDate ? fmtDate(ticket.startDate) : "–"}
              </TableCell>
              <TableCell className="text-sm text-slate-500">
                {ticket.endDate ? fmtDate(ticket.endDate) : "–"}
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
