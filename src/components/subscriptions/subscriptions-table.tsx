"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SubscriptionDialog, type SubscriptionData } from "./subscription-dialog";
import { EditTicketDialog, type TicketData } from "@/components/tickets/edit-ticket-dialog";
import {
  CreditCard, Link2, MapPin, Plus, Ticket, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, Search, Fingerprint, ScanLine, Pencil, Loader2,
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

function ticketValidity(t: TicketRow): "valid" | "expired" | "invalid" | "paused" | "canceled" {
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
  const [selectedTicket, setSelectedTicket] = useState<TicketData | null>(null);
  const [ticketLoadingId, setTicketLoadingId] = useState<number | null>(null);

  const subscriptionOptions = subscriptions.map((s) => ({
    id: s.id,
    name: s.name,
    areaIds: s.areas.map((a) => a.id),
    requiresRfid: s.requiresRfid ?? false,
  }));

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

  async function openTicketEdit(ticketId: number) {
    if (readonly) return;
    setTicketLoadingId(ticketId);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSelectedTicket(data);
    } finally {
      setTicketLoadingId(null);
    }
  }

  const maxBadges = 4;

  function AnnyBadges({ names }: { names: string[] }) {
    if (names.length === 0) return <span className="text-muted-foreground/70 text-sm">–</span>;
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
          <span className="inline-flex items-center rounded-md bg-border dark:bg-accent px-2 py-0.5 text-xs text-muted-foreground">
            +{rest}
          </span>
        )}
      </div>
    );
  }

  function ResourceBadges({ areas: areaList }: { areas: AreaRef[] }) {
    if (!areaList?.length) return <span className="text-muted-foreground/70 text-sm">–</span>;
    const show = areaList.slice(0, maxBadges);
    const rest = areaList.length - maxBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
            <MapPin className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            {a.name}
          </span>
        ))}
        {rest > 0 && (
          <span className="inline-flex items-center rounded-md bg-border dark:bg-accent px-2 py-0.5 text-xs text-muted-foreground">
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
            className="bg-primary hover:bg-primary/90 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Abo anlegen
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent bg-muted/40">
              <TableHead className="hidden sm:table-cell w-10 text-muted-foreground font-medium">#</TableHead>
              <TableHead className="text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-muted-foreground/70" />
                  Name
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell min-w-[160px] text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Link2 className="h-4 w-4 text-muted-foreground/70" />
                  anny Verknüpfungen
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell min-w-[140px] text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-muted-foreground/70" />
                  Resourcen
                </span>
              </TableHead>
              <TableHead className="w-[90px] text-right text-muted-foreground font-medium">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-4 w-4 text-muted-foreground/70" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.length === 0 && (
              <TableRow className="hover:bg-transparent border-border">
                <TableCell colSpan={5} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <CreditCard className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-muted-foreground">Noch keine Abos angelegt</p>
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
                    "border-border transition-colors group",
                    readonly ? "hover:bg-muted/40" : "hover:bg-primary/10 ",
                  )}
                >
                  <TableCell colSpan={5} className="p-0">
                    {/* Main subscription row */}
                    <div className="flex items-center w-full">
                      <div className="hidden sm:flex w-10 shrink-0 items-center justify-center px-3 py-3 text-muted-foreground/70 text-sm tabular-nums">
                        {i + 1}
                      </div>
                      <div
                        className={cn("flex-1 flex items-center gap-0 min-w-0 py-3 px-3 sm:px-0", !readonly && "cursor-pointer")}
                        onClick={() => !readonly && openEdit(sub)}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="inline-flex items-center gap-2 font-medium text-foreground">
                            <CreditCard className="h-4 w-4 text-primary shrink-0" />
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
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                          >
                            {tickets.length}
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />
                            }
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground/70">0</span>
                        )}
                      </div>
                    </div>

                    {/* Expanded ticket list */}
                    {isExpanded && tickets.length > 0 && (
                      <div className="border-t border-border/60 bg-muted/50 dark:bg-card/30 px-3 sm:px-6 py-4">
                        {/* Summary + search */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                          <div className="flex gap-2 text-xs">
                            <Badge variant="success" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {validCount} gültig
                            </Badge>
                            <Badge className="bg-destructive/10 text-destructive gap-1">
                              <XCircle className="h-3 w-3" />
                              {expiredCount} abgelaufen
                            </Badge>
                          </div>
                          {tickets.length > 5 && (
                            <div className="relative sm:ml-auto">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                              <input
                                type="text"
                                placeholder="Suchen..."
                                value={searchMap[sub.id] ?? ""}
                                onChange={(e) => setSearchMap(prev => ({ ...prev, [sub.id]: e.target.value }))}
                                className="pl-8 pr-3 py-1.5 text-xs bg-card border border-border rounded-lg w-full sm:w-48 focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          )}
                        </div>

                        {/* Ticket list */}
                        <div className="rounded-lg border border-border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/80 dark:bg-muted/50 text-xs text-muted-foreground">
                                <th className="text-left px-3 py-2 font-medium">Name</th>
                                <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Typ</th>
                                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Gültig</th>
                                <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">RFID / Barcode</th>
                                <th className="text-right px-3 py-2 font-medium">Status</th>
                                {!readonly && <th className="w-10 px-2 py-2" />}
                              </tr>
                            </thead>
                            <tbody>
                              {sortedTickets.map((t) => {
                                const v = ticketValidity(t);
                                const isLoading = ticketLoadingId === t.id;
                                return (
                                  <tr
                                    key={t.id}
                                    className={cn(
                                      "border-t border-border/60",
                                      readonly
                                        ? "hover:bg-white dark:hover:bg-muted/40"
                                        : "hover:bg-primary/10 cursor-pointer",
                                    )}
                                    onClick={() => openTicketEdit(t.id)}
                                  >
                                    <td className="px-3 py-2">
                                      <span className="font-medium text-foreground/90">
                                        {t.firstName ?? ""} {t.lastName ?? ""}
                                      </span>
                                      {!t.firstName && !t.lastName && (
                                        <span className="text-muted-foreground">{t.name}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                                      {t.ticketTypeName ?? "–"}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1">
                                        <Clock className="h-3 w-3 text-muted-foreground/70" />
                                        {formatDate(t.startDate)} – {formatDate(t.endDate)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">
                                      <div className="flex items-center gap-2">
                                        {t.rfidCode && (
                                          <span className="inline-flex items-center gap-1 text-xs bg-muted px-1.5 py-0.5 rounded">
                                            <Fingerprint className="h-3 w-3" />
                                            {t.rfidCode}
                                          </span>
                                        )}
                                        {t.barcode && (
                                          <span className="inline-flex items-center gap-1 text-xs bg-muted px-1.5 py-0.5 rounded">
                                            <ScanLine className="h-3 w-3" />
                                            {t.barcode}
                                          </span>
                                        )}
                                        {!t.rfidCode && !t.barcode && "–"}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {v === "valid" ? (
                                        <Badge variant="success" className="text-xs">
                                          Gültig
                                        </Badge>
                                      ) : v === "paused" ? (
                                        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 text-xs">
                                          Pausiert
                                        </Badge>
                                      ) : v === "canceled" ? (
                                        <Badge variant="danger" className="text-xs">
                                          Gekündigt
                                        </Badge>
                                      ) : v === "expired" ? (
                                        <Badge className="bg-destructive/10 text-destructive text-xs">
                                          Abgelaufen
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground text-xs">
                                          Ungültig
                                        </Badge>
                                      )}
                                    </td>
                                    {!readonly && (
                                      <td className="px-2 py-2 text-right">
                                        {isLoading ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary inline-block" />
                                        ) : (
                                          <Pencil className="h-3.5 w-3.5 text-muted-foreground/70 group-hover:text-indigo-500 inline-block" />
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                              {sortedTickets.length === 0 && (
                                <tr>
                                  <td colSpan={readonly ? 5 : 6} className="px-3 py-6 text-center text-muted-foreground/70 text-xs">
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

      {!readonly && (
        <EditTicketDialog
          ticket={selectedTicket}
          areas={areas}
          subscriptions={subscriptionOptions}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </>
  );
}
