"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LockerDialog, type LockerData } from "./locker-dialog";
import {
  Lock, Plus, Search, MapPin, Hash, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubscriptionRef {
  id: number;
  name: string;
}

interface LockerRow {
  id: number;
  name: string;
  number: string;
  location: string | null;
  notes: string | null;
  subscriptionId: number | null;
  subscription: SubscriptionRef | null;
}

interface LockersTableProps {
  lockers: LockerRow[];
  subscriptions: SubscriptionRef[];
  readonly?: boolean;
}

export function LockersTable({ lockers, subscriptions, readonly }: LockersTableProps) {
  const [selected, setSelected] = useState<LockerData | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "free">("all");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return lockers.filter((l) => {
      if (filter === "assigned" && !l.subscriptionId) return false;
      if (filter === "free" && l.subscriptionId) return false;
      if (!s) return true;
      const hay = [
        l.name,
        l.number,
        l.location ?? "",
        l.notes ?? "",
        l.subscription?.name ?? "",
      ].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [lockers, search, filter]);

  const assignedCount = lockers.filter((l) => l.subscriptionId).length;
  const freeCount = lockers.length - assignedCount;

  function openEdit(l: LockerRow) {
    setSelected({
      id: l.id,
      name: l.name,
      number: l.number,
      location: l.location,
      notes: l.notes,
      subscriptionId: l.subscriptionId,
    });
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
            Belegt ({assignedCount})
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
            Frei ({freeCount})
          </button>
        </div>

        <div className="relative sm:ml-auto sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Name, Nummer, Standort, Abo…"
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
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  Abo
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
                <TableCell colSpan={4} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Lock className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    {lockers.length === 0 ? (
                      <>
                        <p className="font-medium text-slate-600 dark:text-slate-400">Noch keine Schließfächer angelegt</p>
                        <p className="text-sm">
                          Lege ein Schließfach an und verknüpfe es optional mit einem Abo.
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
                    </span>
                    <div className="sm:hidden ml-6 mt-0.5 text-[11px] text-slate-400 font-mono">
                      Nr. {l.number}
                    </div>
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
                  {l.subscription ? (
                    <Link
                      href="/subscriptions"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1 hover:bg-emerald-200 dark:hover:bg-emerald-950/60">
                        <CreditCard className="h-3 w-3" />
                        {l.subscription.name}
                      </Badge>
                    </Link>
                  ) : (
                    <Badge variant="outline" className="text-slate-400 border-slate-200 dark:border-slate-700 text-xs">
                      Frei
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LockerDialog
        locker={null}
        subscriptions={subscriptions}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <LockerDialog
        locker={selected}
        subscriptions={subscriptions}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
