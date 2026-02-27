"use client";

import { useState } from "react";
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
    showOnDashboard: a.showOnDashboard,
    openingHours: a.openingHours,
  }));

  const maxDeviceBadges = 3;

  function DeviceBadges({ devices }: { devices: DeviceRef[] }) {
    if (devices.length === 0) return <span className="text-slate-400 text-sm">–</span>;
    const show = devices.slice(0, maxDeviceBadges);
    const rest = devices.length - maxDeviceBadges;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((d) => (
          <span
            key={d.id}
            className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            {d.name}
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
            onClick={() => setAddOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Resource anlegen
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
              <TableHead className="w-10 text-slate-500 font-medium">#</TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  Name
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <FolderTree className="h-4 w-4 text-slate-400" />
                  In Resource
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <LogIn className="h-4 w-4 text-slate-400" />
                  Geräte Einlass
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <LogOut className="h-4 w-4 text-slate-400" />
                  Geräte Auslass
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-slate-400" />
                  Wiedereinlass
                </span>
              </TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-slate-400" />
                  Personenlimit
                </span>
              </TableHead>
              <TableHead className="text-right text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <Ticket className="h-4 w-4 text-slate-400" />
                  Tickets
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {areas.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <MapPin className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-slate-600 dark:text-slate-400">Noch keine Resourcen angelegt</p>
                    <p className="text-sm">Lege eine Resource an, um Ein- und Auslass zu verwalten.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {areas.map((area, i) => (
              <TableRow
                key={area.id}
                className={`border-slate-200 dark:border-slate-700 transition-colors ${
                  readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                }`}
                onClick={() => !readonly && setSelected({
                  id: area.id,
                  name: area.name,
                  parentId: area.parentId,
                  allowReentry: area.allowReentry,
                  personLimit: area.personLimit,
                  showOnDashboard: area.showOnDashboard,
                  openingHours: area.openingHours,
                })}
              >
                <TableCell className="text-slate-400 text-sm tabular-nums">{i + 1}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                    <MapPin className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                    {area.name}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {area.parent?.name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <FolderTree className="h-3.5 w-3.5 text-slate-400" />
                      {area.parent.name}
                    </span>
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <DeviceBadges devices={area.devicesIn} />
                </TableCell>
                <TableCell className="py-2">
                  <DeviceBadges devices={area.devicesOut} />
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      area.allowReentry
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-normal"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 font-normal"
                    }
                  >
                    {area.allowReentry ? "Ja" : "Nein"}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium text-slate-700 dark:text-slate-300">
                  {area.personLimit ? (
                    area.personLimit.toLocaleString("de-DE")
                  ) : (
                    <span className="inline-flex text-slate-400">
                      <Infinity className="h-4 w-4" />
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center justify-end gap-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                    {area._count.tickets}
                  </span>
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
