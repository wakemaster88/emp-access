"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { VereinDialog, type VereinData, formatTicketValidity } from "./verein-dialog";
import {
  Users, Plus, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Search, Fingerprint, ScanLine,
  Ticket as TicketIcon, MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AccessTicketRef {
  id: number;
  name: string;
  ticketTypeName: string | null;
  areaNames: string[];
  validityType: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  startDate: string | null;
  endDate: string | null;
  validityDurationMinutes: number | null;
}

interface MemberRow {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  ticketTypeName: string | null;
  rfidCode: string | null;
  barcode: string | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
}

interface VereinRow {
  id: number;
  name: string;
  description: string | null;
  accessTickets: AccessTicketRef[];
  members: MemberRow[];
  _count: { members: number };
}

interface TicketRef {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  vereinId: number | null;
  areaNames: string[];
  validityType: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  startDate: string | null;
  endDate: string | null;
  validityDurationMinutes: number | null;
}

interface VereineTableProps {
  vereine: VereinRow[];
  allTickets: TicketRef[];
  readonly?: boolean;
}

function memberValidity(t: MemberRow): "valid" | "expired" | "invalid" | "paused" | "canceled" {
  if (t.status === "PAUSED") return "paused";
  if (t.status === "CANCELED") return "canceled";
  if (t.status === "INVALID") return "invalid";
  if (t.status === "REDEEMED") return "expired";
  if (t.endDate) {
    const end = new Date(t.endDate);
    if (end < new Date()) return "expired";
  }
  return "valid";
}

export function VereineTable({ vereine, allTickets, readonly }: VereineTableProps) {
  const [selected, setSelected] = useState<VereinData | null>(null);
  const [selectedAccessTicketIds, setSelectedAccessTicketIds] = useState<number[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchMap, setSearchMap] = useState<Record<number, string>>({});

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openEdit(v: VereinRow) {
    setSelected({ id: v.id, name: v.name, description: v.description });
    setSelectedAccessTicketIds(v.accessTickets.map((t) => t.id));
    setSelectedMembers(v.members.map((m) => m.id));
  }

  const maxRows = 3;

  function AccessTicketBadges({ tickets }: { tickets: AccessTicketRef[] }) {
    if (!tickets?.length) return <span className="text-slate-400 text-sm">–</span>;
    const show = tickets.slice(0, maxRows);
    const rest = tickets.length - maxRows;
    return (
      <div className="flex flex-col gap-0.5 text-xs leading-tight">
        {show.map((t) => {
          const validity = formatTicketValidity(t);
          const tooltip = [
            t.areaNames.length > 0 ? `Areas: ${t.areaNames.join(", ")}` : null,
            `Gültigkeit: ${validity}`,
          ].filter(Boolean).join(" · ");
          return (
            <div
              key={t.id}
              className="flex items-center gap-1.5 min-w-0"
              title={tooltip}
            >
              <TicketIcon className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate text-slate-700 dark:text-slate-300">{t.name}</span>
              {t.areaNames.length > 0 && (
                <span className="text-[10px] text-slate-400 inline-flex items-center gap-0.5 shrink-0">
                  <MapPin className="h-2.5 w-2.5" />
                  {t.areaNames.length}
                </span>
              )}
              <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0 ml-auto">
                {validity}
              </span>
            </div>
          );
        })}
        {rest > 0 && (
          <span className="text-[10px] text-slate-400 pl-4">+{rest} weitere</span>
        )}
      </div>
    );
  }

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4">
          <Button
            onClick={() => { setSelected(null); setSelectedAccessTicketIds([]); setSelectedMembers([]); setAddOpen(true); }}
            type="button"
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Verein anlegen
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
              <TableHead className="hidden sm:table-cell w-10 text-slate-500 font-medium">#</TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-slate-400" />
                  Verein
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell w-[280px] text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <TicketIcon className="h-4 w-4 text-slate-400" />
                  Zutritts-Tickets
                </span>
              </TableHead>
              <TableHead className="w-[110px] text-right text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Users className="h-4 w-4 text-slate-400" />
                  Mitglieder
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vereine.length === 0 && (
              <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
                <TableCell colSpan={4} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Users className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-slate-600 dark:text-slate-400">Noch keine Vereine angelegt</p>
                    <p className="text-sm">Lege einen Verein an, um Mitgliedern Bulk-Zutritt über Tickets (z. B. „Bahnmiete“) zu geben.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {vereine.map((v, i) => {
              const isExpanded = expanded.has(v.id);
              const search = (searchMap[v.id] ?? "").toLowerCase();
              const members = v.members ?? [];
              const validCount = members.filter((m) => memberValidity(m) === "valid").length;
              const expiredCount = members.length - validCount;

              const filteredMembers = search
                ? members.filter((m) => {
                    const name = `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.name}`.toLowerCase();
                    const barcode = (m.barcode ?? "").toLowerCase();
                    const rfid = (m.rfidCode ?? "").toLowerCase();
                    return name.includes(search) || barcode.includes(search) || rfid.includes(search);
                  })
                : members;

              const sortedMembers = [...filteredMembers].sort((a, b) => {
                const va = memberValidity(a) === "valid" ? 0 : 1;
                const vb = memberValidity(b) === "valid" ? 0 : 1;
                if (va !== vb) return va - vb;
                return (a.lastName ?? a.name).localeCompare(b.lastName ?? b.name);
              });

              return (
                <TableRow
                  key={v.id}
                  className={cn(
                    "border-slate-200 dark:border-slate-700 transition-colors group",
                    readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20",
                  )}
                >
                  <TableCell colSpan={4} className="p-0">
                    <div className="flex items-center w-full">
                      <div className="hidden sm:flex w-10 shrink-0 items-center justify-center px-3 py-3 text-slate-400 text-sm tabular-nums">
                        {i + 1}
                      </div>
                      <div
                        className={cn("flex-1 flex items-center gap-0 min-w-0 py-3 px-3 sm:px-0", !readonly && "cursor-pointer")}
                        onClick={() => !readonly && openEdit(v)}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100 min-w-0">
                            <Users className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                            <span className="truncate">{v.name}</span>
                          </span>
                          {v.description && (
                            <p className="ml-6 text-[11px] text-slate-400 truncate">{v.description}</p>
                          )}
                          <div className="md:hidden mt-1 ml-6">
                            <AccessTicketBadges tickets={v.accessTickets} />
                          </div>
                        </div>
                      </div>
                      <div className="hidden md:block w-[280px] shrink-0 py-2 px-3 min-w-0">
                        <AccessTicketBadges tickets={v.accessTickets} />
                      </div>
                      <div className="w-[110px] shrink-0 text-right pr-3">
                        {members.length > 0 ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpand(v.id); }}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {members.length}
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />
                            }
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">0</span>
                        )}
                      </div>
                    </div>

                    {isExpanded && members.length > 0 && (
                      <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 px-3 sm:px-6 py-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                          <div className="flex gap-2 text-xs">
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {validCount} gültig
                            </Badge>
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 gap-1">
                              <XCircle className="h-3 w-3" />
                              {expiredCount} inaktiv
                            </Badge>
                          </div>
                          {members.length > 5 && (
                            <div className="relative sm:ml-auto">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Suchen..."
                                value={searchMap[v.id] ?? ""}
                                onChange={(e) => setSearchMap((prev) => ({ ...prev, [v.id]: e.target.value }))}
                                className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-100/80 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                <th className="text-left px-3 py-2 font-medium">Name</th>
                                <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Typ</th>
                                <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">RFID / Barcode</th>
                                <th className="text-right px-3 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedMembers.map((m) => {
                                const va = memberValidity(m);
                                return (
                                  <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800/40">
                                    <td className="px-3 py-2">
                                      <span className="font-medium text-slate-800 dark:text-slate-200">
                                        {m.firstName ?? ""} {m.lastName ?? ""}
                                      </span>
                                      {!m.firstName && !m.lastName && (
                                        <span className="text-slate-500">{m.name}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">
                                      {m.ticketTypeName ?? "–"}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 hidden lg:table-cell">
                                      <div className="flex items-center gap-2">
                                        {m.rfidCode && (
                                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                            <Fingerprint className="h-3 w-3" />
                                            {m.rfidCode}
                                          </span>
                                        )}
                                        {m.barcode && (
                                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                            <ScanLine className="h-3 w-3" />
                                            {m.barcode}
                                          </span>
                                        )}
                                        {!m.rfidCode && !m.barcode && "–"}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {va === "valid" ? (
                                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 text-xs">Gültig</Badge>
                                      ) : va === "paused" ? (
                                        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 text-xs">Pausiert</Badge>
                                      ) : va === "canceled" ? (
                                        <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 text-xs">Gekündigt</Badge>
                                      ) : va === "expired" ? (
                                        <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs">Abgelaufen</Badge>
                                      ) : (
                                        <Badge className="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 text-xs">Ungültig</Badge>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {sortedMembers.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400 text-xs">Keine Treffer</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <VereinDialog
        verein={null}
        initialAccessTicketIds={[]}
        initialMemberIds={[]}
        allTickets={allTickets}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <VereinDialog
        verein={selected}
        initialAccessTicketIds={selectedAccessTicketIds}
        initialMemberIds={selectedMembers}
        allTickets={allTickets}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
