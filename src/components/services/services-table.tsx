"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ServiceDialog, type ServiceData, type InitialServiceAreaInput } from "./service-dialog";
import { Box, Link2, MapPin, Plus, Repeat, Star, Ticket } from "lucide-react";

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
      allowManualCheckin: svc.allowManualCheckin !== false,
      requiresPhoto: svc.requiresPhoto ?? false,
      requiresRfid: svc.requiresRfid ?? false,
      mainAccessAreaId: svc.mainAccessAreaId ?? null,
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
    if (names.length === 0) return <span className="text-muted-foreground/70 text-sm">–</span>;
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
          <span className="inline-flex items-center rounded-md bg-border dark:bg-accent px-2 py-0.5 text-xs text-muted-foreground">
            +{rest}
          </span>
        )}
      </div>
    );
  }

  function ResourceBadges({ areas, mainAreaId }: { areas: { area: AreaRef }[]; mainAreaId?: number | null }) {
    if (!areas?.length) return <span className="text-muted-foreground/70 text-sm">–</span>;
    // Hauptressource zuerst rendern, damit die "Wertigkeits"-Reihenfolge
    // visuell mit der Backend-Logik uebereinstimmt.
    const sorted = mainAreaId != null
      ? [...areas].sort((a, b) => (a.area.id === mainAreaId ? -1 : b.area.id === mainAreaId ? 1 : 0))
      : areas;
    const show = sorted.slice(0, maxBadges);
    const rest = sorted.length - maxBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((sa) => {
          const isMain = sa.area.id === mainAreaId;
          return (
            <span
              key={sa.area.id}
              className={
                isMain
                  ? "inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning ring-1 ring-amber-200 "
                  : "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80"
              }
              title={isMain ? "Hauptressource" : undefined}
            >
              {isMain
                ? <Star className="h-3 w-3 text-warning shrink-0" />
                : <MapPin className="h-3 w-3 text-muted-foreground/70 shrink-0" />}
              {sa.area.name}
            </span>
          );
        })}
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
            onClick={() => { setSelected(null); setInitialServiceAreas([]); setAddOpen(true); }}
            className="bg-primary hover:bg-primary/90 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Service anlegen
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
                  <Box className="h-4 w-4 text-muted-foreground/70" />
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
              <TableHead className="hidden sm:table-cell w-[120px] text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-muted-foreground/70" />
                  Wiedereinlass
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
            {services.length === 0 && (
              <TableRow className="hover:bg-transparent border-border">
                <TableCell colSpan={6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Box className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-muted-foreground">Noch keine Services angelegt</p>
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
                  className={`border-border transition-colors ${
                    readonly ? "hover:bg-muted/40" : "cursor-pointer hover:bg-primary/10 "
                  }`}
                  onClick={() => !readonly && openEdit(svc)}
                >
                  <TableCell className="hidden sm:table-cell text-muted-foreground/70 text-sm tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-2 font-medium text-foreground">
                        <Box className="h-4 w-4 text-primary shrink-0" />
                        {svc.name}
                      </span>
                      <div className="md:hidden mt-0.5 ml-6">
                        <ResourceBadges areas={svc.serviceAreas ?? []} mainAreaId={svc.mainAccessAreaId} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell py-2">
                    <AnnyBadges names={annyNames} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell py-2">
                    <ResourceBadges areas={svc.serviceAreas ?? []} mainAreaId={svc.mainAccessAreaId} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {svc.allowReentry ? (
                      <Badge variant="success" className="text-xs font-normal">Ja</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground text-xs font-normal">Nein</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {svc._count.tickets > 0 ? (
                      <Link
                        href={`/tickets?source=all`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-end gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        {svc._count.tickets}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground/70">0</span>
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
