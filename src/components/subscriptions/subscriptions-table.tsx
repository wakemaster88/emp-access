"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SubscriptionDialog, type SubscriptionData } from "./subscription-dialog";
import { CreditCard, Link2, MapPin, Plus, Ticket } from "lucide-react";

interface AreaRef {
  id: number;
  name: string;
}

interface SubRow extends SubscriptionData {
  areas: AreaRef[];
  _count: { tickets: number };
}

interface SubscriptionsTableProps {
  subscriptions: SubRow[];
  areas: AreaRef[];
  annyServices: string[];
  annyResources: string[];
  annySubscriptions?: string[];
  readonly?: boolean;
}

export function SubscriptionsTable({ subscriptions, areas, annyServices, annyResources, annySubscriptions = [], readonly }: SubscriptionsTableProps) {
  const [selected, setSelected] = useState<SubscriptionData | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);

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
          <span
            key={n}
            className="inline-flex items-center gap-1 rounded-md bg-violet-50 dark:bg-violet-950/30 px-2 py-0.5 text-xs text-violet-700 dark:text-violet-300"
          >
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
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300"
          >
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

              return (
                <TableRow
                  key={sub.id}
                  className={`border-slate-200 dark:border-slate-700 transition-colors ${
                    readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                  }`}
                  onClick={() => !readonly && openEdit(sub)}
                >
                  <TableCell className="hidden sm:table-cell text-slate-400 text-sm tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                        <CreditCard className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                        {sub.name}
                      </span>
                      <div className="md:hidden mt-0.5 ml-6">
                        <ResourceBadges areas={sub.areas} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell py-2">
                    <AnnyBadges names={annyNames} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell py-2">
                    <ResourceBadges areas={sub.areas} />
                  </TableCell>
                  <TableCell className="text-right">
                    {sub._count.tickets > 0 ? (
                      <Link
                        href={`/tickets?source=all`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-end gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {sub._count.tickets}
                      </Link>
                    ) : (
                      <span className="text-sm text-slate-400">0</span>
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
