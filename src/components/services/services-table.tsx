"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ServiceDialog, type ServiceData, type InitialServiceAreaInput } from "./service-dialog";
import { Box, Link2, MapPin, Plus, Repeat, Ticket } from "lucide-react";

interface AreaRef {
  id: number;
  name: string;
}

interface ServiceAreaRef {
  area: AreaRef;
  defaultValidityType?: string | null;
  defaultStartDate?: string | Date | null;
  defaultEndDate?: string | Date | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
}

interface SvcRow extends ServiceData {
  serviceAreas?: ServiceAreaRef[];
  _count: { tickets: number };
}

interface ServicesTableProps {
  services: SvcRow[];
  areas: AreaRef[];
  annyServices: string[];
  annyResources: string[];
  readonly?: boolean;
}

export function ServicesTable({ services, areas, annyServices, annyResources, readonly }: ServicesTableProps) {
  const [selected, setSelected] = useState<ServiceData | null>(null);
  const [initialServiceAreas, setInitialServiceAreas] = useState<InitialServiceAreaInput[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  function openEdit(svc: SvcRow) {
    setSelected({
      id: svc.id,
      name: svc.name,
      annyNames: svc.annyNames,
      defaultValidityType: svc.defaultValidityType ?? undefined,
      defaultStartDate: svc.defaultStartDate ?? undefined,
      defaultEndDate: svc.defaultEndDate ?? undefined,
      defaultSlotStart: svc.defaultSlotStart ?? undefined,
      defaultSlotEnd: svc.defaultSlotEnd ?? undefined,
      defaultValidityDurationMinutes: svc.defaultValidityDurationMinutes ?? undefined,
      allowReentry: svc.allowReentry ?? false,
    });
    setInitialServiceAreas((svc.serviceAreas ?? []).map((sa) => ({
      areaId: sa.area.id,
      areaName: sa.area.name,
      defaultValidityType: sa.defaultValidityType ?? undefined,
      defaultStartDate: sa.defaultStartDate ?? undefined,
      defaultEndDate: sa.defaultEndDate ?? undefined,
      defaultSlotStart: sa.defaultSlotStart ?? undefined,
      defaultSlotEnd: sa.defaultSlotEnd ?? undefined,
      defaultValidityDurationMinutes: sa.defaultValidityDurationMinutes ?? undefined,
    })));
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

  function ResourceBadges({ areas }: { areas: { area: AreaRef }[] }) {
    if (!areas?.length) return <span className="text-slate-400 text-sm">–</span>;
    const show = areas.slice(0, maxBadges);
    const rest = areas.length - maxBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((sa) => (
          <span
            key={sa.area.id}
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
            {sa.area.name}
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
            onClick={() => { setSelected(null); setInitialServiceAreas([]); setAddOpen(true); }}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Service anlegen
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
                  <Box className="h-4 w-4 text-slate-400" />
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
              <TableHead className="hidden sm:table-cell w-[120px] text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-slate-400" />
                  Wiedereinlass
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
            {services.length === 0 && (
              <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
                <TableCell colSpan={6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Box className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-slate-600 dark:text-slate-400">Noch keine Services angelegt</p>
                    <p className="text-sm">Lege einen Service an, um Buchungen aus anny.co zu verknüpfen.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {services.map((svc, i) => {
              const annyNames: string[] = svc.annyNames ? (() => {
                try { return JSON.parse(svc.annyNames); } catch { return []; }
              })() : [];

              return (
                <TableRow
                  key={svc.id}
                  className={`border-slate-200 dark:border-slate-700 transition-colors ${
                    readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                  }`}
                  onClick={() => !readonly && openEdit(svc)}
                >
                  <TableCell className="hidden sm:table-cell text-slate-400 text-sm tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                        <Box className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                        {svc.name}
                      </span>
                      <div className="md:hidden mt-0.5 ml-6">
                        <ResourceBadges areas={svc.serviceAreas ?? []} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell py-2">
                    <AnnyBadges names={annyNames} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell py-2">
                    <ResourceBadges areas={svc.serviceAreas ?? []} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {svc.allowReentry ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-normal">Ja</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 text-xs font-normal">Nein</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {svc._count.tickets > 0 ? (
                      <Link
                        href={`/tickets?source=all`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-end gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {svc._count.tickets}
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

      <ServiceDialog
        service={null}
        initialServiceAreas={[]}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <ServiceDialog
        service={selected}
        initialServiceAreas={initialServiceAreas}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
