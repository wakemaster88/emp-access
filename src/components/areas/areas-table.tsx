"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AreaDialog, type AreaData } from "./area-dialog";
import {
  FolderTree,
  Infinity,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  Repeat,
  Ticket,
  Users,
} from "lucide-react";

interface DeviceRef {
  id: number;
  name: string;
}

interface AreaRow extends AreaData {
  parent: (AreaData & { showOnDashboard?: boolean; openingHours?: string | null }) | null;
  devicesIn: DeviceRef[];
  devicesOut: DeviceRef[];
  _count: { tickets: number; children: number };
}

interface AreasTableProps {
  areas: AreaRow[];
  readonly?: boolean;
  annyResources?: string[];
  annyServices?: string[];
  annyMappings?: Record<string, number>;
}

/** Alle Ressourcen als Dialog-Daten (Auswahl „In Resource“ im Dialog). */
function toAllAreaData(areas: AreaRow[]): AreaData[] {
  return areas.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    allowReentry: a.allowReentry,
    personLimit: a.personLimit,
    scanLockSeconds: a.scanLockSeconds,
    showOnDashboard: a.showOnDashboard,
    openingHours: a.openingHours,
  }));
}

/**
 * Primärhandlung „Resource anlegen“ mit eigenem Dialog – steht im Kartenkopf
 * (`CardAction`, docs/design-regeln.md, Abschnitt 13). Auf dem Handy nur Symbol
 * und „Resource“; der volle Name bleibt als `aria-label`.
 */
export function CreateAreaButton({ areas, annyResources, annyServices, annyMappings }: Omit<AreasTableProps, "readonly">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-sm:h-11" aria-label="Resource anlegen">
        <Plus className="h-4 w-4" />
        <span>Resource<span className="max-sm:sr-only"> anlegen</span></span>
      </Button>
      <AreaDialog
        area={null}
        allAreas={toAllAreaData(areas)}
        annyResources={annyResources}
        annyServices={annyServices}
        annyMappings={annyMappings}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function AreasTable({ areas, readonly, annyResources, annyServices, annyMappings }: AreasTableProps) {
  const [selected, setSelected] = useState<AreaData | null>(null);

  const allAreaData = toAllAreaData(areas);

  const maxDeviceBadges = 3;

  function DeviceBadges({ devices }: { devices: DeviceRef[] }) {
    if (devices.length === 0) return <span className="text-muted-foreground/70 text-sm">–</span>;
    const show = devices.slice(0, maxDeviceBadges);
    const rest = devices.length - maxDeviceBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((d) => (
          <Badge key={d.id} variant="secondary" className="font-medium">
            {d.name}
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
      {/* „Resource anlegen“ steht im Kartenkopf (CreateAreaButton). */}
      {/* Bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand der Karte ein (`Table edge`).
          Auf dem Handy ist „#“ ausgeblendet, daher bekommt „Name“ dort den Randabstand. */}
      <div className="-mx-4 sm:-mx-[18px]">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell w-10">#</TableHead>
              <TableHead className="pl-4 sm:pl-2">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-muted-foreground/70" />
                  Name
                </span>
              </TableHead>
              {/* Eigene Spalte erst ab 2xl: bei 1280 px (mit Seitenleiste) war die Tabelle sonst 55 px zu breit
                  und „Tickets“ lag abgeschnitten im seitlichen Scroller; bis dahin steht „in …“ unter dem Namen. */}
              <TableHead className="hidden 2xl:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <FolderTree className="h-4 w-4 text-muted-foreground/70" />
                  In Resource
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <LogIn className="h-4 w-4 text-muted-foreground/70" />
                  Geräte Einlass
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <LogOut className="h-4 w-4 text-muted-foreground/70" />
                  Geräte Auslass
                </span>
              </TableHead>
              <TableHead className="hidden sm:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-muted-foreground/70" />
                  Wiedereinlass
                </span>
              </TableHead>
              <TableHead className="hidden sm:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground/70" />
                  Limit
                </span>
              </TableHead>
              <TableHead className="text-right">
                {/* Handy: Kopf ohne Symbol wie bei Services (dort braucht die Namensspalte den Platz). */}
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-4 w-4 text-muted-foreground/70 max-sm:hidden" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {areas.length === 0 && (
              <TableEmpty
                colSpan={8}
                icon={MapPin}
                title="Noch keine Resourcen angelegt"
                description="Lege eine Resource an, um Ein- und Auslass zu verwalten."
                compact={false}
              />
            )}
            {areas.map((area, i) => (
              <TableRow
                key={area.id}
                className={`max-sm:h-11 ${readonly ? "" : "cursor-pointer"}`}
                onClick={() => !readonly && setSelected({
                  id: area.id,
                  name: area.name,
                  parentId: area.parentId,
                  allowReentry: area.allowReentry,
                  personLimit: area.personLimit,
                  scanLockSeconds: area.scanLockSeconds,
                  showOnDashboard: area.showOnDashboard,
                  openingHours: area.openingHours,
                })}
              >
                <TableCell className="hidden sm:table-cell text-muted-foreground/70 text-sm tabular-nums">{i + 1}</TableCell>
                {/* Handy: lange Namen brechen um, statt die Tabelle zu verbreitern. */}
                <TableCell className="pl-4 sm:pl-2 max-sm:whitespace-normal max-sm:text-pretty">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <MapPin className="h-4 w-4 text-primary shrink-0" />
                      {area.name}
                    </span>
                    {area.parent?.name && (
                      <p className="2xl:hidden text-xs text-muted-foreground/70 ml-6 mt-0.5">in {area.parent.name}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden 2xl:table-cell text-sm text-muted-foreground">
                  {area.parent?.name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <FolderTree className="h-3.5 w-3.5 text-muted-foreground/70" />
                      {area.parent.name}
                    </span>
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell py-2">
                  <DeviceBadges devices={area.devicesIn} />
                </TableCell>
                <TableCell className="hidden md:table-cell py-2">
                  <DeviceBadges devices={area.devicesOut} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={area.allowReentry ? "success" : "neutral"} className="font-normal">
                    {area.allowReentry ? "Ja" : "Nein"}
                  </Badge>
                  {!!area.scanLockSeconds && area.scanLockSeconds > 0 && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      Sperre {area.scanLockSeconds < 60
                        ? `${area.scanLockSeconds} Sek.`
                        : `${Math.round(area.scanLockSeconds / 60)} Min.`}
                    </p>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell font-medium text-foreground/80">
                  {area.personLimit ? (
                    area.personLimit.toLocaleString("de-DE")
                  ) : (
                    <span className="inline-flex text-muted-foreground/70">
                      <Infinity className="h-4 w-4" />
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {area._count.tickets > 0 ? (
                    <Link
                      href={`/tickets?area=${area.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center justify-end gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      {area._count.tickets}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted-foreground/70">0</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AreaDialog
        area={selected}
        allAreas={allAreaData}
        annyResources={annyResources}
        annyServices={annyServices}
        annyMappings={annyMappings}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
