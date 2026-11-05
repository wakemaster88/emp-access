"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
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

  function AnnyBadges({ names, className }: { names: string[]; className?: string }) {
    if (names.length === 0) return <span className="text-muted-foreground/70 text-sm">–</span>;
    const show = names.slice(0, maxBadges);
    const rest = names.length - maxBadges;
    return (
      <div className={cn("flex flex-wrap gap-1", className)}>
        {show.map((n) => (
          // Verknüpfung ist eine Bezeichnung, kein Info-Zustand: Glas wie die Resourcen.
          <Badge key={n} variant="secondary" className="font-medium text-foreground/80">
            <Link2 className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            {n}
          </Badge>
        ))}
        {rest > 0 && (
          <Badge variant="neutral" className="tabular-nums">
            +{rest}
          </Badge>
        )}
      </div>
    );
  }

  function ResourceBadges({ areas: areaList, className }: { areas: AreaRef[]; className?: string }) {
    if (!areaList?.length) return <span className="text-muted-foreground/70 text-sm">–</span>;
    const show = areaList.slice(0, maxBadges);
    const rest = areaList.length - maxBadges;
    return (
      <div className={cn("flex flex-wrap gap-1", className)}>
        {show.map((a) => (
          <Badge key={a.id} variant="secondary" className="font-medium text-foreground/80">
            <MapPin className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            {a.name}
          </Badge>
        ))}
        {rest > 0 && (
          <Badge variant="neutral" className="tabular-nums">
            +{rest}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Kopf der Karte (docs/design-regeln.md, Abschnitt 13): Titel mit Anzahl links, „Abo anlegen“
          oben rechts statt als eigene Zeile. Steht hier und nicht in der Seite, weil der Anlegen-Dialog
          zum Zustand dieser Tabelle gehört. */}
      <CardHeader>
        <CardTitle>Alle Abos ({subscriptions.length})</CardTitle>
        <CardDescription>
          Abos verknüpfen <Link href="/tickets" className="text-primary hover:underline">Tickets</Link> mit <Link href="/areas" className="text-primary hover:underline">Resourcen</Link> und definieren Standard-Gültigkeiten.
        </CardDescription>
        {!readonly && (
          <CardAction>
            <Button
              onClick={() => { setSelected(null); setSelectedAreas([]); setAddOpen(true); }}
              className="h-11 sm:h-9"
            >
              <Plus className="h-4 w-4" />
              {/* Auf dem Handy „+ anlegen“, damit Titel und Beschreibung daneben Platz haben;
                  „Abo“ bleibt für Screenreader im Namen. */}
              <span>
                <span className="max-sm:sr-only">Abo </span>anlegen
              </span>
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <div className="border-t border-border">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell w-10">#</TableHead>
              {/* Auf dem Handy ist „#“ ausgeblendet, daher bekommt „Name“ den Randabstand. */}
              <TableHead className="max-sm:pl-4">
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Name
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell min-w-[160px]">
                <span className="inline-flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground/70" />
                  anny Verknüpfungen
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell min-w-[140px]">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Resourcen
                </span>
              </TableHead>
              <TableHead className="w-[90px] text-right">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.length === 0 && (
              <TableEmpty
                colSpan={5}
                compact={false}
                icon={CreditCard}
                title="Noch keine Abos angelegt"
                description="Lege ein Abo an, um Abonnements aus anny.co zu verknüpfen."
              />
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

              const showTickets = isExpanded && tickets.length > 0;

              return (
                <Fragment key={sub.id}>
                  {/* Echte Zellen je Spalte, damit Zeilen und Tabellenkopf fluchten. Ausgeklappt hängt die
                      Ticketliste als eigene Zeile ohne Trennlinie direkt darunter. */}
                  <TableRow className={cn(showTickets && "border-b-0")}>
                    <TableCell className="hidden sm:table-cell py-3 text-sm tabular-nums text-muted-foreground/70">
                      {i + 1}
                    </TableCell>
                    {/* w-full + max-w-0: die Namensspalte nimmt den Rest und kürzt lange Namen, statt die Tabelle zu verbreitern.
                        Auf dem Handy ist „#“ ausgeblendet, daher bekommt der Name den Randabstand. */}
                    <TableCell
                      className={cn("w-full max-w-0 py-3 max-sm:pl-4", !readonly && "cursor-pointer")}
                      onClick={() => !readonly && openEdit(sub)}
                    >
                      <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                        <CreditCard className="h-4 w-4 text-primary shrink-0" />
                        <span className="truncate" title={sub.name}>{sub.name}</span>
                      </span>
                      <div className="md:hidden mt-0.5 ml-6">
                        <ResourceBadges areas={sub.areas} />
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <AnnyBadges names={annyNames} className="flex-nowrap" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <ResourceBadges areas={sub.areas} className="flex-nowrap" />
                    </TableCell>
                    <TableCell className="text-right">
                      {tickets.length > 0 ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(sub.id); }}
                          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium tabular-nums text-primary hover:underline sm:min-h-0"
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
                    </TableCell>
                  </TableRow>

                  {/* Expanded ticket list */}
                  {showTickets && (
                    <TableRow className="hover:bg-transparent">
                      {/* max-w-0: die Ticketliste scrollt in ihrer Kachel, statt die Tabelle zu verbreitern. */}
                      <TableCell colSpan={5} className="max-w-0 p-0 pb-3">
                        <div className="glass-tile p-2 sm:p-3">
                          {/* Summary + search */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-2 pt-1 pb-3">
                            <div className="flex gap-2">
                              <Badge variant="success">
                                <CheckCircle2 className="h-3 w-3" />
                                {validCount} gültig
                              </Badge>
                              {/* Rot nur, wenn wirklich etwas abgelaufen ist. */}
                              <Badge variant={expiredCount > 0 ? "danger" : "neutral"}>
                                <XCircle className="h-3 w-3" />
                                {expiredCount} abgelaufen
                              </Badge>
                            </div>
                            {tickets.length > 5 && (
                              <SearchInput
                                placeholder="Suchen..."
                                value={searchMap[sub.id] ?? ""}
                                onChange={(e) => setSearchMap(prev => ({ ...prev, [sub.id]: e.target.value }))}
                                containerClassName="sm:ml-auto sm:w-48"
                              />
                            )}
                          </div>

                          {/* Ticket list */}
                          <Table>
                            {/* Trennlinie am Kopf selbst: die äußere Tabelle nimmt jeder letzten Zeile den Rand. */}
                            <TableHeader className="border-b border-border">
                              <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead className="hidden sm:table-cell">Typ</TableHead>
                                <TableHead className="hidden md:table-cell">Gültig</TableHead>
                                <TableHead className="hidden lg:table-cell">RFID / Barcode</TableHead>
                                <TableHead className="text-right">Status</TableHead>
                                {!readonly && <TableHead className="w-10" />}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sortedTickets.map((t) => {
                                const v = ticketValidity(t);
                                const isLoading = ticketLoadingId === t.id;
                                return (
                                  <TableRow
                                    key={t.id}
                                    className={cn("group max-sm:h-11", !readonly && "cursor-pointer")}
                                    onClick={() => openTicketEdit(t.id)}
                                  >
                                    {/* Handy: lange Namen brechen um, statt die Ticketliste seitlich scrollen zu lassen. */}
                                    <TableCell className="max-sm:whitespace-normal">
                                      <span className="font-medium text-foreground/90">
                                        {t.firstName ?? ""} {t.lastName ?? ""}
                                      </span>
                                      {!t.firstName && !t.lastName && (
                                        <span className="text-muted-foreground">{t.name}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                                      {t.ticketTypeName ?? "–"}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground hidden md:table-cell tabular-nums">
                                      <span className="inline-flex items-center gap-1">
                                        <Clock className="h-3 w-3 text-muted-foreground/70" />
                                        {formatDate(t.startDate)} – {formatDate(t.endDate)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground hidden lg:table-cell">
                                      <div className="flex items-center gap-2">
                                        {t.rfidCode && (
                                          <Badge variant="mono">
                                            <Fingerprint className="h-3 w-3" />
                                            {t.rfidCode}
                                          </Badge>
                                        )}
                                        {t.barcode && (
                                          <Badge variant="mono">
                                            <ScanLine className="h-3 w-3" />
                                            {t.barcode}
                                          </Badge>
                                        )}
                                        {!t.rfidCode && !t.barcode && "–"}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {v === "valid" ? (
                                        <Badge variant="success">
                                          Gültig
                                        </Badge>
                                      ) : v === "paused" ? (
                                        <Badge variant="warning">
                                          Pausiert
                                        </Badge>
                                      ) : v === "canceled" ? (
                                        <Badge variant="danger">
                                          Gekündigt
                                        </Badge>
                                      ) : v === "expired" ? (
                                        <Badge variant="danger">
                                          Abgelaufen
                                        </Badge>
                                      ) : (
                                        <Badge variant="neutral">
                                          Ungültig
                                        </Badge>
                                      )}
                                    </TableCell>
                                    {!readonly && (
                                      <TableCell className="text-right">
                                        {isLoading ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary inline-block" />
                                        ) : (
                                          <Pencil className="h-3.5 w-3.5 text-muted-foreground/70 group-hover:text-primary inline-block" />
                                        )}
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                              {sortedTickets.length === 0 && (
                                <TableEmpty colSpan={readonly ? 5 : 6} icon={Search} title="Keine Treffer" />
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
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
