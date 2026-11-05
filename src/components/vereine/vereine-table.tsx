"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
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

/**
 * Die Tabelle läuft bis an den Kartenrand; erste und letzte Spalte bekommen
 * den Innenabstand der Karte (16 px, ab sm 18 px), damit Text und Karte fluchten.
 */
const TABLE_EDGE =
  "[&>*>tr>*:first-child]:pl-4 sm:[&>*>tr>*:first-child]:pl-[18px] [&>*>tr>*:last-child]:pr-4 sm:[&>*>tr>*:last-child]:pr-[18px]";

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
    if (!tickets?.length) return <span className="text-muted-foreground/70 text-sm">–</span>;
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
              <TicketIcon className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              <span className="truncate text-foreground">{t.name}</span>
              {t.areaNames.length > 0 && (
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5 shrink-0 tabular-nums">
                  <MapPin className="h-2.5 w-2.5" />
                  {t.areaNames.length}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 ml-auto">
                {validity}
              </span>
            </div>
          );
        })}
        {rest > 0 && (
          <span className="text-[11px] text-muted-foreground pl-4">+{rest} weitere</span>
        )}
      </div>
    );
  }

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4 px-4 sm:px-[18px]">
          <Button
            onClick={() => { setSelected(null); setSelectedAccessTicketIds([]); setSelectedMembers([]); setAddOpen(true); }}
            type="button"
            className="h-11 sm:h-9"
          >
            <Plus className="h-4 w-4" />
            Verein anlegen
          </Button>
        </div>
      )}

      <div className="border-t border-border">
        <Table className={TABLE_EDGE}>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell w-10">#</TableHead>
              {/* Auf dem Handy ist „#“ ausgeblendet, daher bekommt „Verein“ den Randabstand. */}
              <TableHead className="max-sm:pl-4">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Verein
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell w-[280px]">
                <span className="inline-flex items-center gap-1.5">
                  <TicketIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Zutritts-Tickets
                </span>
              </TableHead>
              <TableHead className="w-[110px] text-right">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Mitglieder
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vereine.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="whitespace-normal">
                  <EmptyState
                    icon={Users}
                    title="Noch keine Vereine angelegt"
                    description="Lege einen Verein an, um Mitgliedern Bulk-Zutritt über Tickets (z. B. „Bahnmiete“) zu geben."
                  />
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
                <TableRow key={v.id} className="group">
                  {/* Randabstand kommt aus TABLE_EDGE; die Spalten darin fluchten mit dem Tabellenkopf.
                      max-w-0: die Zelle wächst nicht mit dem Inhalt, damit truncate greift statt die Tabelle zu verbreitern. */}
                  <TableCell colSpan={4} className="p-0 max-w-0">
                    <div className="flex items-center w-full">
                      <div className="hidden sm:flex w-[22px] shrink-0 items-center py-3 text-muted-foreground/70 text-sm tabular-nums">
                        {i + 1}
                      </div>
                      <div
                        className={cn("flex-1 flex items-center gap-0 min-w-0 py-3 pr-3 sm:pl-2", !readonly && "cursor-pointer")}
                        onClick={() => !readonly && openEdit(v)}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-medium text-foreground min-w-0">
                            <Users className="h-4 w-4 text-primary shrink-0" />
                            <span className="truncate" title={v.name}>{v.name}</span>
                          </span>
                          {v.description && (
                            <p className="ml-6 text-xs text-muted-foreground truncate" title={v.description}>{v.description}</p>
                          )}
                          <div className="md:hidden mt-1 ml-6">
                            <AccessTicketBadges tickets={v.accessTickets} />
                          </div>
                        </div>
                      </div>
                      <div className="hidden md:block w-[280px] shrink-0 py-2 px-2 min-w-0">
                        <AccessTicketBadges tickets={v.accessTickets} />
                      </div>
                      <div className="w-[110px] shrink-0 text-right">
                        {members.length > 0 ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpand(v.id); }}
                            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium tabular-nums text-primary hover:underline sm:min-h-0"
                          >
                            {members.length}
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

                    {isExpanded && members.length > 0 && (
                      <div className="glass-tile mb-3 p-2 sm:p-3">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-2 pt-1 pb-3">
                          <div className="flex gap-2">
                            <Badge variant="success">
                              <CheckCircle2 className="h-3 w-3" />
                              {validCount} gültig
                            </Badge>
                            {/* Rot nur, wenn wirklich ein Mitglied inaktiv ist. */}
                            <Badge variant={expiredCount > 0 ? "danger" : "neutral"}>
                              <XCircle className="h-3 w-3" />
                              {expiredCount} inaktiv
                            </Badge>
                          </div>
                          {members.length > 5 && (
                            <div className="relative sm:ml-auto">
                              <Search className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                              <Input
                                type="text"
                                placeholder="Suchen..."
                                value={searchMap[v.id] ?? ""}
                                onChange={(e) => setSearchMap((prev) => ({ ...prev, [v.id]: e.target.value }))}
                                className="w-full pl-8 sm:w-48"
                              />
                            </div>
                          )}
                        </div>

                        <Table>
                          {/* Trennlinie am Kopf selbst: die äußere Tabelle nimmt jeder letzten Zeile den Rand. */}
                          <TableHeader className="border-b border-border">
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead className="hidden sm:table-cell">Typ</TableHead>
                              <TableHead className="hidden lg:table-cell">RFID / Barcode</TableHead>
                              <TableHead className="text-right">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedMembers.map((m) => {
                              const va = memberValidity(m);
                              return (
                                <TableRow key={m.id} className="max-sm:h-11">
                                  <TableCell>
                                    <span className="font-medium text-foreground/90">
                                      {m.firstName ?? ""} {m.lastName ?? ""}
                                    </span>
                                    {!m.firstName && !m.lastName && (
                                      <span className="text-muted-foreground">{m.name}</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground hidden sm:table-cell">
                                    {m.ticketTypeName ?? "–"}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground hidden lg:table-cell">
                                    <div className="flex items-center gap-2">
                                      {m.rfidCode && (
                                        <Badge variant="mono">
                                          <Fingerprint className="h-3 w-3" />
                                          {m.rfidCode}
                                        </Badge>
                                      )}
                                      {m.barcode && (
                                        <Badge variant="mono">
                                          <ScanLine className="h-3 w-3" />
                                          {m.barcode}
                                        </Badge>
                                      )}
                                      {!m.rfidCode && !m.barcode && "–"}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {va === "valid" ? (
                                      <Badge variant="success">Gültig</Badge>
                                    ) : va === "paused" ? (
                                      <Badge variant="warning">Pausiert</Badge>
                                    ) : va === "canceled" ? (
                                      <Badge variant="danger">Gekündigt</Badge>
                                    ) : va === "expired" ? (
                                      <Badge variant="danger">Abgelaufen</Badge>
                                    ) : (
                                      <Badge variant="neutral">Ungültig</Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                            {sortedMembers.length === 0 && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={4}>
                                  <EmptyState compact icon={Search} title="Keine Treffer" />
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
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
