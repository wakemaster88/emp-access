"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LockerDialog, type LockerData, type AboTicketRef, type RentalRow, type LockerType,
} from "./locker-dialog";
import {
  Lock, Plus, Search, MapPin, Hash, Ticket as TicketIcon, CreditCard,
  Calendar, History, Key, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LockerRow {
  id: number;
  name: string;
  number: string;
  location: string | null;
  notes: string | null;
  lockType: LockerType;
  keyCount: number;
  lockNumber: string | null;
  rentals: RentalRow[];
}

interface LockersTableProps {
  lockers: LockerRow[];
  aboTickets: AboTicketRef[];
  currentYear: number;
  readonly?: boolean;
}

function ticketDisplayName(t: AboTicketRef): string {
  const personName = [t.firstName, t.lastName].filter(Boolean).join(" ");
  return personName || t.name;
}

export function LockersTable({ lockers, aboTickets, currentYear, readonly }: LockersTableProps) {
  const [selected, setSelected] = useState<LockerData | null>(null);
  const [selectedRentals, setSelectedRentals] = useState<RentalRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "free" | "openKeys">("all");

  /// Annotiertes Set: aktuelle Vermietung (=> currentYear), Historien-Liste sowie
  /// alle Vermietungen aus vergangenen Jahren mit offenen Schlüsseln/Schlössern
  /// (`keysIssued > keysReturned`). Daraus wird die Warnung gespeist.
  const enriched = useMemo(() => {
    return lockers.map((l) => {
      const current = l.rentals.find((r) => r.year === currentYear) ?? null;
      const past = l.rentals.filter((r) => r.year !== currentYear);
      const openPast = past
        .filter((r) => r.keysIssued - r.keysReturned > 0)
        .sort((a, b) => b.year - a.year);
      const openPastCount = openPast.reduce((acc, r) => acc + (r.keysIssued - r.keysReturned), 0);
      return { ...l, current, past, openPast, openPastCount };
    });
  }, [lockers, currentYear]);

  const lockersWithOpenPast = useMemo(
    () => enriched.filter((l) => l.openPast.length > 0),
    [enriched],
  );
  const totalOpenKeys = lockersWithOpenPast.reduce((acc, l) => acc + l.openPastCount, 0);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched.filter((l) => {
      if (filter === "assigned" && !l.current) return false;
      if (filter === "free" && l.current) return false;
      if (filter === "openKeys" && l.openPast.length === 0) return false;
      if (!s) return true;
      const hay = [
        l.name,
        l.number,
        l.location ?? "",
        l.notes ?? "",
        l.lockNumber ?? "",
        ...l.rentals.flatMap((r) => [
          ticketDisplayName(r.ticket),
          r.ticket.subscription?.name ?? "",
          r.ticket.ticketTypeName ?? "",
          String(r.year),
        ]),
      ].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [enriched, search, filter]);

  const assignedCount = enriched.filter((l) => l.current).length;
  const freeCount = lockers.length - assignedCount;

  function openEdit(l: LockerRow) {
    setSelected({
      id: l.id,
      name: l.name,
      number: l.number,
      location: l.location,
      notes: l.notes,
      lockType: l.lockType,
      keyCount: l.keyCount,
      lockNumber: l.lockNumber,
    });
    setSelectedRentals(l.rentals);
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              filter === "all"
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            )}
          >
            Alle ({lockers.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("assigned")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              filter === "assigned"
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            )}
          >
            Belegt {currentYear} ({assignedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("free")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              filter === "free"
                ? "bg-slate-700 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            )}
          >
            Frei {currentYear} ({freeCount})
          </button>
          {lockersWithOpenPast.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter("openKeys")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5",
                filter === "openKeys"
                  ? "bg-amber-600 text-white"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-950/60"
              )}
              title="Schließfächer mit ausstehenden Schlüsseln aus früheren Jahren"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Offene Schlüssel ({lockersWithOpenPast.length})
            </button>
          )}
        </div>

        <div className="relative sm:ml-auto sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Nr., Standort, Mieter, Abo, Jahr…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {!readonly && (
          <Button
            onClick={() => { setSelected(null); setAddOpen(true); }}
            type="button"
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Schließfach anlegen
          </Button>
        )}
      </div>

      {lockersWithOpenPast.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {totalOpenKeys} {totalOpenKeys === 1 ? "Schlüssel" : "Schlüssel/Schlösser"} aus
                früheren Jahren noch nicht zurückgegeben
                {" "}
                <span className="font-normal text-amber-800/80 dark:text-amber-300/70">
                  ({lockersWithOpenPast.length} {lockersWithOpenPast.length === 1 ? "Schließfach" : "Schließfächer"})
                </span>
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
                {lockersWithOpenPast.slice(0, 12).map((l) => {
                  const newest = l.openPast[0];
                  return (
                    <li key={l.id} className="inline-flex items-center gap-1">
                      <span className="font-mono">#{l.number}</span>
                      <span className="text-amber-700/70 dark:text-amber-300/60">·</span>
                      <span className="font-medium">{ticketDisplayName(newest.ticket)}</span>
                      <span className="text-amber-700/70 dark:text-amber-300/60">
                        ({newest.year}, {newest.keysIssued - newest.keysReturned} offen)
                      </span>
                    </li>
                  );
                })}
                {lockersWithOpenPast.length > 12 && (
                  <li className="text-amber-700 dark:text-amber-300/70">
                    +{lockersWithOpenPast.length - 12} weitere
                  </li>
                )}
              </ul>
              {filter !== "openKeys" && (
                <button
                  type="button"
                  onClick={() => setFilter("openKeys")}
                  className="mt-2 text-[11px] font-medium text-amber-800 dark:text-amber-300 underline hover:text-amber-900 dark:hover:text-amber-200"
                >
                  Nur betroffene Schließfächer anzeigen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
              <TableHead className="hidden sm:table-cell w-[90px] text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="h-4 w-4 text-slate-400" />
                  Nr.
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-slate-400" />
                  Schließfach
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  Standort
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  Mieter {currentYear}
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell w-[140px] text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <History className="h-4 w-4 text-slate-400" />
                  Historie
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
                <TableCell colSpan={5} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Lock className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    {lockers.length === 0 ? (
                      <>
                        <p className="font-medium text-slate-600 dark:text-slate-400">Noch keine Schließfächer angelegt</p>
                        <p className="text-sm">
                          Lege ein Schließfach an und vermiete es jahresweise an Abo-Tickets.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm">Keine Treffer für die aktuellen Filter.</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filtered.map((l) => (
              <TableRow
                key={l.id}
                onClick={() => !readonly && openEdit(l)}
                className={cn(
                  "border-slate-200 dark:border-slate-700 transition-colors group",
                  readonly
                    ? "hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    : "hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 cursor-pointer",
                )}
              >
                <TableCell className="hidden sm:table-cell w-[90px] font-mono text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                  {l.number}
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                      <Lock className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                      {l.name}
                      <span
                        className="text-[10px] inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 tabular-nums"
                        title={
                          l.lockType === "KEY"
                            ? `Schlüsselschloss · ${l.keyCount} Schlüssel`
                            : `Vorhängeschloss · ${l.keyCount} Stück`
                        }
                      >
                        {l.lockType === "KEY"
                          ? <Key className="h-2.5 w-2.5" />
                          : <Lock className="h-2.5 w-2.5" />}
                        {l.keyCount}×
                      </span>
                    </span>
                    <div className="sm:hidden ml-6 mt-0.5 text-[11px] text-slate-400 font-mono">
                      Nr. {l.number}
                    </div>
                    {l.lockType === "KEY" && l.lockNumber && (
                      <p className="ml-6 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        Schloss-Nr. {l.lockNumber}
                      </p>
                    )}
                    {l.notes && (
                      <p className="ml-6 text-[11px] text-slate-400 truncate">{l.notes}</p>
                    )}
                    <div className="md:hidden ml-6 mt-1">
                      {l.location ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <MapPin className="h-3 w-3" />
                          {l.location}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-slate-600 dark:text-slate-400 text-sm">
                  {l.location ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      {l.location}
                    </span>
                  ) : (
                    <span className="text-slate-400">–</span>
                  )}
                </TableCell>
                <TableCell>
                  {l.current ? (
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                        <TicketIcon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                        {ticketDisplayName(l.current.ticket)}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {l.current.ticket.subscription && (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1 text-[10px] py-0">
                            <CreditCard className="h-2.5 w-2.5" />
                            {l.current.ticket.subscription.name}
                          </Badge>
                        )}
                        {l.current.keysIssued > 0 && (() => {
                          const open = l.current.keysIssued - l.current.keysReturned;
                          const allBack = open <= 0;
                          return (
                            <span
                              className={cn(
                                "text-[10px] inline-flex items-center gap-0.5 px-1 rounded tabular-nums",
                                allBack
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                              )}
                              title={
                                allBack
                                  ? "Alle zurück"
                                  : `${open} ${l.lockType === "PADLOCK" ? "Schloss/Schlösser" : "Schlüssel"} draußen`
                              }
                            >
                              {l.lockType === "KEY" ? <Key className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                              {l.current.keysReturned}/{l.current.keysIssued}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-slate-400 border-slate-200 dark:border-slate-700 text-xs">
                      Frei
                    </Badge>
                  )}
                  {l.openPast.length > 0 && (
                    <div
                      className="mt-1 inline-flex items-start gap-1 text-[10px] leading-tight px-1.5 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 max-w-full"
                      title={l.openPast
                        .map((r) => `${r.year}: ${ticketDisplayName(r.ticket)} – ${r.keysIssued - r.keysReturned} offen`)
                        .join("\n")}
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
                      <span className="min-w-0">
                        <span className="font-semibold">Alt-Vermietung offen:</span>{" "}
                        {l.openPast.slice(0, 2).map((r, i) => (
                          <span key={r.id}>
                            {i > 0 && ", "}
                            <span className="font-mono tabular-nums">{r.year}</span>{" "}
                            {ticketDisplayName(r.ticket)}{" "}
                            <span className="opacity-70">({r.keysIssued - r.keysReturned})</span>
                          </span>
                        ))}
                        {l.openPast.length > 2 && (
                          <span className="opacity-70"> +{l.openPast.length - 2}</span>
                        )}
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell w-[140px]">
                  {l.past.length === 0 ? (
                    <span className="text-[11px] text-slate-400">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-0.5">
                      {l.past.slice(0, 4).map((r) => {
                        const open = r.keysIssued - r.keysReturned;
                        const isOpen = open > 0;
                        return (
                          <span
                            key={r.id}
                            className={cn(
                              "font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded inline-flex items-center gap-0.5",
                              isOpen
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-800"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
                            )}
                            title={
                              isOpen
                                ? `${r.year}: ${ticketDisplayName(r.ticket)} – ${open} ${l.lockType === "PADLOCK" ? "Schloss/Schlösser" : "Schlüssel"} noch nicht zurück`
                                : `${r.year}: ${ticketDisplayName(r.ticket)}`
                            }
                          >
                            {isOpen && <AlertTriangle className="h-2.5 w-2.5" />}
                            {r.year}
                          </span>
                        );
                      })}
                      {l.past.length > 4 && (
                        <span className="text-[10px] text-slate-400 px-1">+{l.past.length - 4}</span>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LockerDialog
        locker={null}
        initialRentals={[]}
        aboTickets={aboTickets}
        currentYear={currentYear}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <LockerDialog
        locker={selected}
        initialRentals={selectedRentals}
        aboTickets={aboTickets}
        currentYear={currentYear}
        open={!!selected}
        onClose={() => { setSelected(null); setSelectedRentals([]); }}
      />
    </>
  );
}
