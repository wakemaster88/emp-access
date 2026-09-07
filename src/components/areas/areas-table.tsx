"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
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

export function AreasTable({ areas, readonly, annyResources, annyServices, annyMappings }: AreasTableProps) {
  const [selected, setSelected] = useState<AreaData | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const allAreaData: AreaData[] = areas.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    allowReentry: a.allowReentry,
    personLimit: a.personLimit,
    scanLockSeconds: a.scanLockSeconds,
    showOnDashboard: a.showOnDashboard,
    openingHours: a.openingHours,
  }));

  const maxDeviceBadges = 3;

  function DeviceBadges({ devices }: { devices: DeviceRef[] }) {
    if (devices.length === 0) return <span className="text-muted-foreground/70 text-sm">–</span>;
    const show = devices.slice(0, maxDeviceBadges);
    const rest = devices.length - maxDeviceBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((d) => (
          <span
            key={d.id}
            className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80"
          >
            {d.name}
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

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4">
          <Button
            onClick={() => setAddOpen(true)}
            className="bg-primary hover:bg-primary/90 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Resource anlegen
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
                  <MapPin className="h-4 w-4 text-muted-foreground/70" />
                  Name
                </span>
              </TableHead>
              <TableHead className="hidden lg:table-cell text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <FolderTree className="h-4 w-4 text-muted-foreground/70" />
                  In Resource
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <LogIn className="h-4 w-4 text-muted-foreground/70" />
                  Geräte Einlass
                </span>
              </TableHead>
              <TableHead className="hidden md:table-cell text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <LogOut className="h-4 w-4 text-muted-foreground/70" />
                  Geräte Auslass
                </span>
              </TableHead>
              <TableHead className="hidden sm:table-cell text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-muted-foreground/70" />
                  Wiedereinlass
                </span>
              </TableHead>
              <TableHead className="hidden sm:table-cell text-muted-foreground font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground/70" />
                  Limit
                </span>
              </TableHead>
              <TableHead className="text-right text-muted-foreground font-medium">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-4 w-4 text-muted-foreground/70" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {areas.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <MapPin className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-muted-foreground">Noch keine Resourcen angelegt</p>
                    <p className="text-sm">Lege eine Resource an, um Ein- und Auslass zu verwalten.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {areas.map((area, i) => (
              <TableRow
                key={area.id}
                className={`border-border transition-colors ${
                  readonly ? "hover:bg-muted/40" : "cursor-pointer hover:bg-primary/10 "
                }`}
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
                <TableCell>
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <MapPin className="h-4 w-4 text-primary shrink-0" />
                      {area.name}
                    </span>
                    {area.parent?.name && (
                      <p className="lg:hidden text-xs text-muted-foreground/70 ml-6 mt-0.5">in {area.parent.name}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
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
                  <Badge
                    className={
                      area.allowReentry
                        ? "bg-success/12 text-success font-normal"
                        : "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground font-normal"
                    }
                  >
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
        area={null}
        allAreas={allAreaData}
        annyResources={annyResources}
        annyServices={annyServices}
        annyMappings={annyMappings}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

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
