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
import { UserCheck, MapPin, CreditCard, Package } from "lucide-react";

interface Area {
  id: number;
  name: string;
}

interface Sub {
  id: number;
  name: string;
  areaIds?: number[];
}

interface Svc {
  id: number;
  name: string;
  areaIds?: number[];
  requiresPhoto?: boolean;
}

interface VereinRef {
  id: number;
  name: string;
}

interface TicketsTableProps {
  tickets: TicketData[];
  areas: Area[];
  subscriptions?: Sub[];
  services?: Svc[];
  vereine?: VereinRef[];
  readonly?: boolean;
  /** Bei Code-Suche: wenn genau ein Ticket gefunden, Bearbeiten-Dialog automatisch öffnen */
  searchCode?: string;
  /** Im "Auch inaktive"-Modus alle Tickets einzeln zeigen statt Multi-Area-
   *  Pairs zu Personen zusammenzufassen. Der Admin will dann jeden
   *  Datensatz einzeln sehen koennen. */
  showAll?: boolean;
}

function calcAge(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
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

function isExpired(ticket: { endDate?: string | Date | null }): boolean {
  if (!ticket.endDate) return false;
  return new Date(ticket.endDate) < new Date();
}

function statusBadge(status: string, ticket?: { endDate?: string | Date | null }) {
  if (ticket && (status === "VALID" || status === "REDEEMED") && isExpired(ticket)) {
    return <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">Abgelaufen</Badge>;
  }
  switch (status) {
    case "VALID":
      return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Gültig</Badge>;
    case "REDEEMED":
      return <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">Eingelöst</Badge>;
    case "INVALID":
      return <Badge variant="destructive">Ungültig</Badge>;
    case "PAUSED":
      return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Pausiert</Badge>;
    case "CANCELED":
      return <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">Gekündigt</Badge>;
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

type TicketWithArea = TicketData & {
  accessArea?: { name: string } | null;
  subscription?: { name: string } | null;
  service?: {
    name: string;
    serviceAreas?: { accessAreaId: number }[];
  } | null;
  ticketAreas?: { accessArea: { id: number; name: string } }[];
};

/** Eine Zeile in der Tabelle. Bei Single-Tickets ist `pairedMembers` leer.
 *  Bei einer Multi-Area-ANNY-Buchung enthaelt `pairedMembers` die "anderen"
 *  Tickets derselben echten Person (z.B. das Strandbad-Pendant zum
 *  Aquapark-Ticket). Areas, Scan-Counts und Codes werden dann ueber die
 *  ganze Pair-Gruppe aggregiert dargestellt. */
type DisplayRow = {
  primary: TicketWithArea;
  pairedMembers: TicketWithArea[];
};

/** Multi-Area-ANNY-Pairs zu einer Zeile pro Person reduzieren. ANNY legt
 *  pro gebuchter Resource ein Booking an - bei sa=2-Services (Aquapark
 *  Tageskarte) entstehen 2 Tickets pro echter Person. Gruppieren ueber
 *  (customerId, serviceId, startDay), aufteilen in Chunks der Groesse sa. */
function groupMultiAreaPairs(tickets: TicketWithArea[], showAll: boolean): DisplayRow[] {
  if (showAll) return tickets.map((t) => ({ primary: t, pairedMembers: [] }));

  type Draft = { members: TicketWithArea[]; serviceAreaCount: number };
  const drafts = new Map<string, Draft>();
  const passthroughIndices = new Map<TicketWithArea, number>();

  tickets.forEach((t, idx) => {
    const sa = t.service?.serviceAreas?.length ?? 0;
    const customerId = t.uuid?.startsWith("anny:") ? t.uuid.split(":")[1] : null;
    const day = t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : "";
    if (!customerId || t.serviceId == null || sa < 2 || !day) {
      passthroughIndices.set(t, idx);
      return;
    }
    const key = `${customerId}|svc=${t.serviceId}|day=${day}`;
    const existing = drafts.get(key);
    if (existing) existing.members.push(t);
    else drafts.set(key, { members: [t], serviceAreaCount: sa });
  });

  // Sortierreihenfolge der Originaltickets beibehalten (idx) damit
  // bestehende sort-Reihenfolge (date/name/...) nicht durcheinander geraet.
  const rows: { row: DisplayRow; orderIdx: number }[] = [];

  for (const [t, idx] of passthroughIndices) {
    rows.push({ row: { primary: t, pairedMembers: [] }, orderIdx: idx });
  }

  for (const draft of drafts.values()) {
    const clean = draft.members.length > 1 && draft.members.length % draft.serviceAreaCount === 0;
    if (!clean) {
      // Anomalie (z.B. fehlender Sync) - alle Member als Einzelzeilen
      // damit nichts unsichtbar wird.
      for (const m of draft.members) {
        rows.push({ row: { primary: m, pairedMembers: [] }, orderIdx: tickets.indexOf(m) });
      }
      continue;
    }
    // Stabil nach Ticket-ID sortieren, dann in Chunks der Groesse sa
    // splitten. Innerhalb jedes Chunks ist [0] der Primaer, Rest = paired.
    const sorted = [...draft.members].sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length; i += draft.serviceAreaCount) {
      const chunk = sorted.slice(i, i + draft.serviceAreaCount);
      const [primary, ...paired] = chunk;
      rows.push({
        row: { primary, pairedMembers: paired },
        orderIdx: tickets.indexOf(primary),
      });
    }
  }

  return rows
    .sort((a, b) => a.orderIdx - b.orderIdx)
    .map((r) => r.row);
}

export function TicketsTable({ tickets, areas, subscriptions = [], services = [], vereine = [], readonly, searchCode, showAll }: TicketsTableProps) {
  const [selected, setSelected] = useState<TicketData | null>(null);
  const openedForCodeRef = useRef<string | null>(null);

  const { regularGroups, employeeTickets } = useMemo(() => {
    const allTickets = tickets as TicketWithArea[];
    const empTickets = allTickets.filter((t) => t.source === "EMP_CONTROL");
    const regTickets = allTickets.filter((t) => t.source !== "EMP_CONTROL");

    const map = new Map<string, { type: "resource" | "subscription" | "service" | "none"; rows: DisplayRow[] }>();
    const groupedRows = groupMultiAreaPairs(regTickets, !!showAll);
    for (const row of groupedRows) {
      const t = row.primary;
      let groupName: string;
      let groupType: "resource" | "subscription" | "service" | "none";
      if (t.accessArea?.name) {
        groupName = t.accessArea.name;
        groupType = "resource";
      } else if (t.subscription?.name) {
        groupName = t.subscription.name;
        groupType = "subscription";
      } else if (t.service?.name) {
        groupName = t.service.name;
        groupType = "service";
      } else {
        groupName = "Ohne Zuordnung";
        groupType = "none";
      }
      const key = `${groupType}:${groupName}`;
      if (!map.has(key)) map.set(key, { type: groupType, rows: [] });
      map.get(key)!.rows.push(row);
    }
    const groups = Array.from(map.entries())
      .sort(([, a], [, b]) => {
        const order = { resource: 0, service: 1, subscription: 2, none: 3 };
        if (a.type !== b.type) return order[a.type] - order[b.type];
        return 0;
      })
      .map(([key, { type, rows }]) => ({
        groupName: key.split(":").slice(1).join(":"),
        groupType: type,
        rows,
      }));

    return { regularGroups: groups, employeeTickets: empTickets };
  }, [tickets, showAll]);

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
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Gültigkeit</TableHead>
              <TableHead className="text-right">Scans</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500 py-12">
                  {searchCode ? "Kein Ticket mit diesem Code gefunden" : "Keine Tickets vorhanden"}
                </TableCell>
              </TableRow>
            )}

            {regularGroups.map(({ groupName, groupType, rows: groupRows }) => {
              const personCount = groupRows.length;
              const ticketCount = groupRows.reduce((sum, r) => sum + 1 + r.pairedMembers.length, 0);
              const hasPairs = ticketCount > personCount;
              return (
              <React.Fragment key={`${groupType}:${groupName}`}>
                <TableRow className="bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <TableCell colSpan={7} className="py-1.5 px-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    <span className="flex items-center gap-1.5">
                      {groupType === "subscription" && <CreditCard className="h-3 w-3 text-indigo-500" />}
                      {groupType === "service" && <Package className="h-3 w-3 text-violet-500" />}
                      {groupName}
                      {groupType === "subscription" && <Badge variant="outline" className="text-[9px] px-1 py-0 border-indigo-200 text-indigo-500 dark:border-indigo-800 dark:text-indigo-400 font-normal ml-1">Abo</Badge>}
                      {groupType === "service" && <Badge variant="outline" className="text-[9px] px-1 py-0 border-violet-200 text-violet-500 dark:border-violet-800 dark:text-violet-400 font-normal ml-1">Service</Badge>}
                      <span className="font-normal text-slate-400 dark:text-slate-500">
                        ({personCount} {personCount === 1 ? "Person" : "Personen"}
                        {hasPairs ? ` / ${ticketCount} Tickets` : ""})
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
                {groupRows.map((row) => {
                  const ticket = row.primary;
                  const allMembers = [ticket, ...row.pairedMembers];
                  const isPair = row.pairedMembers.length > 0;
                  const totalScans = allMembers.reduce((sum, m) => sum + (m._count?.scans ?? 0), 0);
                  // Areas aller Resource-Tickets der Person zusammenfassen.
                  // Sortieren damit Reihenfolge konsistent ist (Aquapark vor
                  // Strandbad, alphabetisch).
                  const pairAreaNames = isPair
                    ? [...new Set(
                        allMembers
                          .map((m) => m.accessArea?.name)
                          .filter((n): n is string => !!n),
                      )].sort()
                    : [];
                  return (
                  <TableRow
                    key={isPair ? `pair:${allMembers.map((m) => m.id).join(",")}` : ticket.id}
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
                            {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className="ml-1 text-xs font-normal text-slate-400">({a})</span> : null; })()}
                          </p>
                          {(ticket.ticketTypeName || ticket.subscription?.name) && (
                            <p className="text-xs text-slate-400 truncate">
                              {ticket.ticketTypeName}
                              {ticket.ticketTypeName && ticket.subscription?.name && " · "}
                              {ticket.subscription?.name && (
                                <span className="text-indigo-500 dark:text-indigo-400">{ticket.subscription.name}</span>
                              )}
                            </p>
                          )}
                          {isPair && pairAreaNames.length > 0 && (
                            <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-0.5 truncate">
                              {pairAreaNames.join(" + ")}
                              <span className="text-slate-400 dark:text-slate-500"> · {allMembers.length} Tickets</span>
                            </p>
                          )}
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
                    <TableCell>{statusBadge(ticket.status, ticket)}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-slate-500">
                      <ValidityInfo ticket={ticket} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {totalScans > 0 ? (
                        <Link
                          href={`/scans`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {totalScans}
                        </Link>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </React.Fragment>
              );
            })}

            {employeeTickets.length > 0 && (
              <>
                <TableRow className="bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/20">
                  <TableCell colSpan={7} className="py-1.5 px-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <span className="flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5" />
                      Mitarbeiter
                      <span className="font-normal text-emerald-500 dark:text-emerald-500/70">
                        ({employeeTickets.length})
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
                {employeeTickets.map((ticket) => {
                  const empAreas = (ticket as TicketWithArea).ticketAreas?.map((ta) => ta.accessArea) ?? [];
                  return (
                    <TableRow
                      key={ticket.id}
                      className={readonly ? "" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"}
                      onClick={() => !readonly && setSelected(ticket)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {ticket.profileImage ? (
                            <img src={ticket.profileImage} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                {(ticket.firstName?.[0] || ticket.name[0] || "?").toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                              {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className="ml-1 text-xs font-normal text-slate-400">({a})</span> : null; })()}
                            </p>
                            {empAreas.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {empAreas.map((a) => (
                                  <Badge key={a.id} variant="outline" className="text-[9px] px-1 py-0 border-emerald-200 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400 font-normal gap-0.5">
                                    <MapPin className="h-2 w-2" />
                                    {a.name}
                                  </Badge>
                                ))}
                              </div>
                            )}
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
                        Mitarbeiter
                      </TableCell>
                      <TableCell>{statusBadge(ticket.status, ticket)}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-slate-500">
                        <ValidityInfo ticket={ticket} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {ticket._count.scans > 0 ? (
                          <Link href="/scans" onClick={(e) => e.stopPropagation()} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                            {ticket._count.scans}
                          </Link>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {!readonly && (
        <EditTicketDialog
          ticket={selected}
          areas={areas}
          subscriptions={subscriptions}
          services={services}
          vereine={vereine}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
