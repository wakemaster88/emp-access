"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LockerDialog, rentalDisplayName,
  type LockerData, type AboTicketRef, type RentalRow, type LockerType,
} from "./locker-dialog";
import {
  Lock, Plus, Search, MapPin, Hash, Ticket as TicketIcon, CreditCard,
  Calendar, History, Key, AlertTriangle, User,
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

function rentalSearchHay(r: RentalRow): string[] {
  const parts: string[] = [String(r.year)];
  if (r.ticket) {
    parts.push(
      ticketDisplayName(r.ticket),
      r.ticket.subscription?.name ?? "",
      r.ticket.ticketTypeName ?? "",
    );
  }
  if (r.renterName) parts.push(r.renterName);
  return parts;
}

/** Anzahl Schlüssel bzw. Schlösser als kleine Pille, Art im Tooltip. */
function LockCountBadge({ locker, className }: { locker: Pick<LockerRow, "lockType" | "keyCount">; className?: string }) {
  return (
    <Badge
      variant="neutral"
      className={cn("tabular-nums", className)}
      title={
        locker.lockType === "KEY"
          ? `Schlüsselschloss · ${locker.keyCount} Schlüssel`
          : `Vorhängeschloss · ${locker.keyCount} Stück`
      }
    >
      {locker.lockType === "KEY"
        ? <Key className="h-2.5 w-2.5" />
        : <Lock className="h-2.5 w-2.5" />}
      {locker.keyCount}×
    </Badge>
  );
}

/**
 * Die Tabelle läuft bis an den Kartenrand; erste und letzte Spalte bekommen
 * den Innenabstand der Karte (16 px, ab sm 18 px), damit Text und Karte fluchten.
 */
const TABLE_EDGE =
  "[&>*>tr>*:first-child]:pl-4 sm:[&>*>tr>*:first-child]:pl-[18px] [&>*>tr>*:last-child]:pr-4 sm:[&>*>tr>*:last-child]:pr-[18px]";

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
  // Ist der letzte offene Schlüssel zurück, verschwindet „Offene Schlüssel“. Dann gilt
  // wieder „Alle“, sonst hätte die Segmentwahl keine aktive Option und wäre per Tab
  // nicht mehr erreichbar.
  const activeFilter = filter === "openKeys" && lockersWithOpenPast.length === 0 ? "all" : filter;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched.filter((l) => {
      if (activeFilter === "assigned" && !l.current) return false;
      if (activeFilter === "free" && l.current) return false;
      if (activeFilter === "openKeys" && l.openPast.length === 0) return false;
      if (!s) return true;
      const hay = [
        l.name,
        l.number,
        l.location ?? "",
        l.notes ?? "",
        l.lockNumber ?? "",
        ...l.rentals.flatMap((r) => rentalSearchHay(r)),
      ].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [enriched, search, activeFilter]);

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
      <div className="mb-4 flex flex-col gap-3 px-4 sm:px-[18px] lg:flex-row lg:items-center">
        <Segmented
          aria-label="Filter"
          value={activeFilter}
          onValueChange={setFilter}
          className="self-start lg:self-auto"
          options={[
            { value: "all", label: "Alle", count: lockers.length },
            { value: "assigned", label: `Belegt ${currentYear}`, count: assignedCount },
            { value: "free", label: `Frei ${currentYear}`, count: freeCount },
            ...(lockersWithOpenPast.length > 0
              ? [{
                  value: "openKeys" as const,
                  // Segmented kennt kein title je Option, daher sitzt der Tooltip am Label.
                  label: (
                    <span
                      className="inline-flex items-center gap-1.5"
                      title="Schließfächer mit ausstehenden Schlüsseln aus früheren Jahren"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                      Offene Schlüssel
                    </span>
                  ),
                  count: lockersWithOpenPast.length,
                }]
              : []),
          ]}
        />

        {/* Handy: Suche und Taste untereinander in voller Breite, damit der Platzhalter lesbar bleibt. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:ml-auto">
          <div className="relative sm:flex-1 lg:w-64 lg:flex-none">
            <Search className="absolute left-2.5 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input
              type="text"
              placeholder="Nr., Standort, Mieter, Abo, Jahr…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 pl-8 sm:h-9"
            />
          </div>

          {!readonly && (
            <Button
              onClick={() => { setSelected(null); setAddOpen(true); }}
              type="button"
              className="h-11 shrink-0 sm:h-9"
            >
              <Plus className="h-4 w-4" />
              Schließfach anlegen
            </Button>
          )}
        </div>
      </div>

      {lockersWithOpenPast.length > 0 && (
        <Notice
          tone="warning"
          className="mx-4 mb-4 sm:mx-[18px]"
          // Handlung im action-Platz des Bausteins: ab sm rechts neben dem Text, auf dem Handy
          // als eigene Zeile in voller Breite (vorher lief die lange Taste dort über den Rand).
          action={activeFilter !== "openKeys" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilter("openKeys")}
              className="h-11 max-sm:w-full sm:h-8"
            >
              Nur betroffene Schließfächer anzeigen
            </Button>
          ) : undefined}
          title={
            <>
              {totalOpenKeys} {totalOpenKeys === 1 ? "Schlüssel" : "Schlüssel/Schlösser"} aus
              früheren Jahren noch nicht zurückgegeben
              {" "}
              <span className="font-normal text-muted-foreground">
                ({lockersWithOpenPast.length} {lockersWithOpenPast.length === 1 ? "Schließfach" : "Schließfächer"})
              </span>
            </>
          }
        >
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {lockersWithOpenPast.slice(0, 12).map((l) => {
              const newest = l.openPast[0];
              return (
                <li key={l.id} className="inline-flex items-center gap-1">
                  <span className="font-mono text-foreground">#{l.number}</span>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="font-medium text-foreground">{rentalDisplayName(newest)}</span>
                  <span className="tabular-nums">
                    ({newest.year}, {newest.keysIssued - newest.keysReturned} offen)
                  </span>
                </li>
              );
            })}
            {lockersWithOpenPast.length > 12 && (
              <li>
                +{lockersWithOpenPast.length - 12} weitere
              </li>
            )}
          </ul>
        </Notice>
      )}

      <div className="border-t border-border">
        <Table className={TABLE_EDGE}>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell w-[90px]">
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Nr.
                </span>
              </TableHead>
              {/* Auf dem Handy ist „Nr.“ ausgeblendet, daher bekommt „Schließfach“ den Randabstand. */}
              <TableHead className="max-sm:pl-4">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Schließfach
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Standort
                </span>
              </TableHead>
              {/* Unter lg ist „Historie“ ausgeblendet, daher bekommt „Mieter“ den Randabstand. */}
              <TableHead className="max-sm:pr-4 sm:max-lg:pr-[18px]">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Mieter {currentYear}
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell w-[140px]">
                <span className="inline-flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-muted-foreground/70" />
                  Historie
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="whitespace-normal">
                  {lockers.length === 0 ? (
                    <EmptyState
                      icon={Lock}
                      title="Noch keine Schließfächer angelegt"
                      description="Lege ein Schließfach an und vermiete es jahresweise an Abo-Tickets."
                    />
                  ) : (
                    <EmptyState icon={Lock} title="Keine Treffer für die aktuellen Filter." />
                  )}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((l) => (
              <TableRow
                key={l.id}
                onClick={() => !readonly && openEdit(l)}
                className={cn("group", !readonly && "cursor-pointer")}
              >
                <TableCell className="hidden sm:table-cell w-[90px] font-mono text-sm text-foreground/80 tabular-nums">
                  {l.number}
                </TableCell>
                {/* Text bricht um, statt die Tabelle auf dem Handy zu verbreitern. */}
                <TableCell className="whitespace-normal max-sm:pl-4">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <Lock className="h-4 w-4 text-primary shrink-0" />
                      {l.name}
                      <LockCountBadge locker={l} className="hidden sm:inline-flex" />
                    </span>
                    {/* Handy: Anzahl neben der Nummer statt neben dem Namen, damit der Name in der schmalen Spalte Platz hat. */}
                    <div className="sm:hidden ml-6 mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                      <span className="whitespace-nowrap">Nr. {l.number}</span>
                      <LockCountBadge locker={l} className="font-sans" />
                    </div>
                    {l.lockType === "KEY" && l.lockNumber && (
                      <p className="ml-6 text-[11px] text-muted-foreground font-mono">
                        Schloss-Nr. {l.lockNumber}
                      </p>
                    )}
                    {l.notes && (
                      <p className="ml-6 text-[11px] text-muted-foreground break-words">{l.notes}</p>
                    )}
                    <div className="md:hidden ml-6 mt-1">
                      {l.location ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {l.location}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                  {l.location ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground/70" />
                      {l.location}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70">–</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal max-sm:pr-4 sm:max-lg:pr-[18px]">
                  {l.current ? (
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="flex items-start gap-1.5 text-sm font-medium text-foreground/90 break-words">
                        {l.current.ticket
                          ? <TicketIcon className="mt-[3px] h-3.5 w-3.5 text-primary shrink-0" />
                          : <User className="mt-[3px] h-3.5 w-3.5 text-warning shrink-0" />}
                        {rentalDisplayName(l.current)}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {l.current.ticket?.subscription && (
                          // Abo-Verknüpfung ist der Normalfall, kein Zustand: Glas statt Grün.
                          // Handy: lange Abo-Namen kürzen, statt die Tabelle zu verbreitern.
                          <Badge
                            variant="secondary"
                            className="font-medium text-foreground/80 max-sm:max-w-[10.5rem]"
                            title={l.current.ticket.subscription.name}
                          >
                            <CreditCard className="h-2.5 w-2.5 text-muted-foreground/70" />
                            <span className="truncate">{l.current.ticket.subscription.name}</span>
                          </Badge>
                        )}
                        {!l.current.ticket && l.current.renterName && (
                          <Badge variant="warning" title="Manuell hinterlegter Mieter ohne Abo-Verknüpfung">
                            <User className="h-2.5 w-2.5" />
                            Manuell
                          </Badge>
                        )}
                        {l.current.keysIssued > 0 && (() => {
                          const open = l.current.keysIssued - l.current.keysReturned;
                          const allBack = open <= 0;
                          return (
                            <Badge
                              variant={allBack ? "success" : "warning"}
                              className="tabular-nums"
                              title={
                                allBack
                                  ? "Alle zurück"
                                  : `${open} ${l.lockType === "PADLOCK" ? "Schloss/Schlösser" : "Schlüssel"} draußen`
                              }
                            >
                              {l.lockType === "KEY" ? <Key className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                              {l.current.keysReturned}/{l.current.keysIssued}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <Badge variant="neutral">
                      Frei
                    </Badge>
                  )}
                  {l.openPast.length > 0 && (
                    // Warnfarbe nur am Symbol; der Text in Vordergrundfarbe bleibt auf der Tönung lesbar.
                    <div
                      className="mt-1 inline-flex items-start gap-1 text-[11px] leading-tight px-2 py-1 rounded-lg bg-warning/14 text-foreground max-w-full"
                      title={l.openPast
                        .map((r) => `${r.year}: ${rentalDisplayName(r)} – ${r.keysIssued - r.keysReturned} offen`)
                        .join("\n")}
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-px text-warning" />
                      <span className="min-w-0">
                        <span className="font-semibold">Alt-Vermietung offen:</span>{" "}
                        {l.openPast.slice(0, 2).map((r, i) => (
                          <span key={r.id}>
                            {i > 0 && ", "}
                            <span className="font-mono tabular-nums">{r.year}</span>{" "}
                            {rentalDisplayName(r)}{" "}
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
                    <span className="text-[11px] text-muted-foreground/70">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {l.past.slice(0, 4).map((r) => {
                        const open = r.keysIssued - r.keysReturned;
                        const isOpen = open > 0;
                        return (
                          <Badge
                            key={r.id}
                            variant={isOpen ? "warning" : "neutral"}
                            className={cn(
                              "font-mono tabular-nums",
                              isOpen && "ring-1 ring-inset ring-warning/40",
                            )}
                            title={
                              isOpen
                                ? `${r.year}: ${rentalDisplayName(r)} – ${open} ${l.lockType === "PADLOCK" ? "Schloss/Schlösser" : "Schlüssel"} noch nicht zurück`
                                : `${r.year}: ${rentalDisplayName(r)}`
                            }
                          >
                            {isOpen && <AlertTriangle className="h-2.5 w-2.5" />}
                            {r.year}
                          </Badge>
                        );
                      })}
                      {l.past.length > 4 && (
                        <span className="text-[11px] text-muted-foreground px-1">+{l.past.length - 4}</span>
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
