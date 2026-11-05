"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
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

/**
 * Primärhandlung „Service anlegen“ mit eigenem Dialog – steht im Kartenkopf
 * (`CardAction`, docs/design-regeln.md, Abschnitt 13). Auf dem Handy nur Symbol
 * und „Service“; der volle Name bleibt als `aria-label`.
 */
export function CreateServiceButton({ areas, annyServices, annyResources }: Omit<ServicesTableProps, "services" | "readonly">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-sm:h-11" aria-label="Service anlegen">
        <Plus className="h-4 w-4" />
        <span>Service<span className="max-sm:sr-only"> anlegen</span></span>
      </Button>
      <ServiceDialog
        service={null}
        initialServiceAreas={[]}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function ServicesTable({ services, areas, annyServices, annyResources, readonly }: ServicesTableProps) {
  const [selected, setSelected] = useState<ServiceData | null>(null);
  const [initialServiceAreas, setInitialServiceAreas] = useState<InitialServiceAreaInput[]>([]);

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
          <Badge key={n} variant="secondary" className="font-normal">
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
            // Hauptressource ist eine Rolle, kein Zustand: Akzentfarbe statt Warnfarbe (docs/design-regeln.md, Abschnitt 3).
            <Badge
              key={sa.area.id}
              variant={isMain ? "accent" : "secondary"}
              className={isMain ? undefined : "font-medium"}
              title={isMain ? "Hauptressource" : undefined}
            >
              {isMain
                ? <Star className="h-3 w-3 shrink-0 fill-current" />
                : <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />}
              {sa.area.name}
            </Badge>
          );
        })}
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
      {/* „Service anlegen“ steht im Kartenkopf (CreateServiceButton). */}
      {/* Bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand der Karte ein (`Table edge`).
          Auf dem Handy ist „#“ ausgeblendet, daher bekommt „Name“ dort den Randabstand. */}
      <div className="-mx-4 sm:-mx-[18px]">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell w-10">#</TableHead>
              <TableHead className="pl-4 sm:pl-2">
                <span className="inline-flex items-center gap-1.5">
                  <Box className="h-4 w-4 text-muted-foreground/70" />
                  Name
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell min-w-[160px]">
                <span className="inline-flex items-center gap-1.5">
                  <Link2 className="h-4 w-4 text-muted-foreground/70" />
                  anny Verknüpfungen
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell min-w-[140px]">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-muted-foreground/70" />
                  Resourcen
                </span>
              </TableHead>
              <TableHead className="hidden sm:table-cell w-[120px]">
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-muted-foreground/70" />
                  Wiedereinlass
                </span>
              </TableHead>
              <TableHead className="w-[90px] text-right max-sm:w-auto">
                {/* Handy: ohne Symbol und feste Breite ist die Spalte 22 px schmaler, und in der Namensspalte
                    stehen zwei Ressourcen nebeneinander statt untereinander (360 px). */}
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-4 w-4 text-muted-foreground/70 max-sm:hidden" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length === 0 && (
              <TableEmpty
                colSpan={6}
                icon={Box}
                title="Noch keine Services angelegt"
                description="Lege einen Service an, um Buchungen aus anny.co zu verknüpfen."
                compact={false}
              />
            )}
            {services.map((svc, i) => {
              const annyNames: string[] = svc.annyNames ? (() => {
                try { return JSON.parse(svc.annyNames); } catch { return []; }
              })() : [];

              return (
                <TableRow
                  key={svc.id}
                  className={`max-sm:h-11 ${readonly ? "" : "cursor-pointer"}`}
                  onClick={() => !readonly && openEdit(svc)}
                >
                  <TableCell className="hidden sm:table-cell text-muted-foreground/70 text-sm tabular-nums">{i + 1}</TableCell>
                  {/* Handy: lange Namen brechen um, statt die Tabelle zu verbreitern (vorher 358 px in 326 px). */}
                  <TableCell className="pl-4 sm:pl-2 max-sm:whitespace-normal max-sm:text-pretty">
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
                      <Badge variant="success" className="font-normal">Ja</Badge>
                    ) : (
                      <Badge variant="neutral" className="font-normal">Nein</Badge>
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
