"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SubscriptionDialog, type SubscriptionData } from "./subscription-dialog";
import {
  CreditCard, Link2, MapPin, Plus, Ticket, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, Search, Fingerprint, ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AreaRef {
  id: number;
  name: string;
}

interface TicketRow {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
  status: string;
  ticketTypeName: string | null;
  rfidCode: string | null;
  barcode: string | null;
}

interface SubRow extends SubscriptionData {
  areas: AreaRef[];
  _count: { tickets: number };
  tickets: TicketRow[];
}

interface SubscriptionsTableProps {
  subscriptions: SubRow[];
  areas: AreaRef[];
  annyServices: string[];
  annyResources: string[];
  annySubscriptions?: string[];
  readonly?: boolean;
}

function ticketValidity(t: TicketRow): "valid" | "expired" | "invalid" {
  if (t.status === "INVALID") return "invalid";
  if (t.status === "REDEEMED") return "expired";
  if (t.endDate) {
    const end = new Date(t.endDate);
    if (end < new Date()) return "expired";
  }
  return "valid";
}

function formatDate(d: string | Date | null): string {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function SubscriptionsTable({ subscriptions, areas, annyServices, annyResources, annySubscriptions = [], readonly }: SubscriptionsTableProps) {
  const [selected, setSelected] = useState<SubscriptionData | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchMap, setSearchMap] = useState<Record<number, string>>({});

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openEdit(sub: SubRow) {
    setSelected({
      id: sub.id,
      name: sub.name,
      annyNames: sub.annyNames,
      defaultValidityType: sub.defaultValidityType ?? undefined,
      defaultStartDate: sub.defaultStartDate ?? undefined,
      defaultEndDate: sub.defaultEndDate ?? undefined,
      defaultSlotStart: sub.defaultSlotStart ?? undefined,
      defaultSlotEnd: sub.defaultSlotEnd ?? undefined,
      defaultValidityDurationMinutes: sub.defaultValidityDurationMinutes ?? undefined,
      requiresPhoto: sub.requiresPhoto ?? false,
      requiresRfid: sub.requiresRfid ?? false,
    });
    setSelectedAreas(sub.areas.map((a) => a.id));
  }

  const maxBadges = 4;

  function AnnyBadges({ names }: { names: string[] }) {
    if (names.length === 0) return <span className="text-slate-400 text-sm">–</span>;
    const show = names.slice(0, maxBadges);
    const rest = names.length - maxBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-md bg-violet-50 dark:bg-violet-950/30 px-2 py-0.5 text-xs text-violet-700 dark:text-violet-300">
            {n}
          </span>
        ))}
        {rest > 0 && (
          <span className="inline-flex items-center rounded-md bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
            +{rest}
          </span>
        )}
      </div>
    );
  }

  function ResourceBadges({ areas: areaList }: { areas: AreaRef[] }) {
    if (!areaList?.length) return <span className="text-slate-400 text-sm">–</span>;
    const show = areaList.slice(0, maxBadges);
    const rest = areaList.length - maxBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
            {a.name}
          </span>
        ))}
        {rest > 0 && (
          <span className="inline-flex items-center rounded-md bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
            +{rest}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4">
          <Button
            onClick={() => { setSelected(null); setSelectedAreas([]); setAddOpen(true); }}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Abo anlegen
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
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  Name
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell min-w-[160px] text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Link2 className="h-4 w-4 text-slate-400" />
                  anny Verknüpfungen
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell min-w-[140px] text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  Resourcen
                </span>
              </TableHead>
              <TableHead className="w-[90px] text-right text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-4 w-4 text-slate-400" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.length === 0 && (
              <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
                <TableCell colSpan={5} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <CreditCard className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-slate-600 dark:text-slate-400">Noch keine Abos angelegt</p>
                    <p className="text-sm">Lege ein Abo an, um Abonnements aus anny.co zu verknüpfen.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {subscriptions.map((sub, i) => {
              const annyNames: string[] = sub.annyNames ? (() => {
                try { return JSON.parse(sub.annyNames); } catch { return []; }
              })() : [];

              const isExpanded = expanded.has(sub.id);
              const search = (searchMap[sub.id] ?? "").toLowerCase();

              const tickets = sub.tickets ?? [];
              const validCount = tickets.filter(t => ticketValidity(t) === "valid").length;
              const expiredCount = tickets.filter(t => ticketValidity(t) !== "valid").length;

              const filteredTickets = search
                ? tickets.filter(t => {
                    const name = `${t.firstName ?? ""} ${t.lastName ?? ""} ${t.name}`.toLowerCase();
                    const barcode = (t.barcode ?? "").toLowerCase();
                    const rfid = (t.rfidCode ?? "").toLowerCase();
                    return name.includes(search) || barcode.includes(search) || rfid.includes(search);
                  })
                : tickets;

              const sortedTickets = [...filteredTickets].sort((a, b) => {
                const va = ticketValidity(a) === "valid" ? 0 : 1;
                const vb = ticketValidity(b) === "valid" ? 0 : 1;
                if (va !== vb) return va - vb;
                return (a.firstName ?? a.name).localeCompare(b.firstName ?? b.name);
              });

              return (
                <TableRow
                  key={sub.id}
                  className={cn(
                    "border-slate-200 dark:border-slate-700 transition-colors group",
                    readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20",
                  )}
                >
                  <TableCell colSpan={5} className="p-0">
                    {/* Main subscription row */}
                    <div className="flex items-center w-full">
                      <div className="hidden sm:flex w-10 shrink-0 items-center justify-center px-3 py-3 text-slate-400 text-sm tabular-nums">
                        {i + 1}
                      </div>
                      <div
                        className={cn("flex-1 flex items-center gap-0 min-w-0 py-3 px-3 sm:px-0", !readonly && "cursor-pointer")}
                        onClick={() => !readonly && openEdit(sub)}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="inline-flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                            <CreditCard className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                            {sub.name}
                          </span>
                          <div className="md:hidden mt-0.5 ml-6">
                            <ResourceBadges areas={sub.areas} />
                          </div>
                        </div>
                      </div>
                      <div className="hidden lg:block min-w-[160px] py-2 px-3">
                        <AnnyBadges names={annyNames} />
                      </div>
                      <div className="hidden md:block min-w-[140px] py-2 px-3">
                        <ResourceBadges areas={sub.areas} />
                      </div>
                      <div className="w-[90px] shrink-0 text-right pr-3">
                        {tickets.length > 0 ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpand(sub.id); }}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {tickets.length}
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

                    {/* Expanded ticket list */}
                    {isExpanded && tickets.length > 0 && (
                      <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 px-3 sm:px-6 py-4">
                        {/* Summary + search */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                          <div className="flex gap-2 text-xs">
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {validCount} gültig
                            </Badge>
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 gap-1">
                              <XCircle className="h-3 w-3" />
                              {expiredCount} abgelaufen
                            </Badge>
                          </div>
                          {tickets.length > 5 && (
                            <div className="relative sm:ml-auto">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Suchen..."
                                value={searchMap[sub.id] ?? ""}
                                onChange={(e) => setSearchMap(prev => ({ ...prev, [sub.id]: e.target.value }))}
                                className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          )}
                        </div>

                        {/* Ticket list */}
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-100/80 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                <th className="text-left px-3 py-2 font-medium">Name</th>
                                <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Typ</th>
                                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Gültig</th>
                                <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">RFID / Barcode</th>
                                <th className="text-right px-3 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedTickets.map((t) => {
                                const v = ticketValidity(t);
                                return (
                                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800/40">
                                    <td className="px-3 py-2">
                                      <span className="font-medium text-slate-800 dark:text-slate-200">
                                        {t.firstName ?? ""} {t.lastName ?? ""}
                                      </span>
                                      {!t.firstName && !t.lastName && (
                                        <span className="text-slate-500">{t.name}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">
                                      {t.ticketTypeName ?? "–"}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 hidden md:table-cell whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1">
                                        <Clock className="h-3 w-3 text-slate-400" />
                                        {formatDate(t.startDate)} – {formatDate(t.endDate)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 hidden lg:table-cell">
                                      <div className="flex items-center gap-2">
                                        {t.rfidCode && (
                                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                            <Fingerprint className="h-3 w-3" />
                                            {t.rfidCode}
                                          </span>
                                        )}
                                        {t.barcode && (
                                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                            <ScanLine className="h-3 w-3" />
                                            {t.barcode}
                                          </span>
                                        )}
                                        {!t.rfidCode && !t.barcode && "–"}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {v === "valid" ? (
                                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 text-xs">
                                          Gültig
                                        </Badge>
                                      ) : v === "expired" ? (
                                        <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs">
                                          Abgelaufen
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 text-xs">
                                          Ungültig
                                        </Badge>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {sortedTickets.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400 text-xs">
                                    Keine Treffer
                                  </td>
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

      <SubscriptionDialog
        subscription={null}
        initialAreaIds={[]}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        annySubscriptions={annySubscriptions}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <SubscriptionDialog
        subscription={selected}
        initialAreaIds={selectedAreas}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        annySubscriptions={annySubscriptions}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
