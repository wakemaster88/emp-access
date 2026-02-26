"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AreaDialog, type AreaData } from "./area-dialog";
import { Plus, Infinity } from "lucide-react";

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

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4">
          <Button
            onClick={() => setAddOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            <Plus className="h-4 w-4" />
            Resource anlegen
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>In Resource</TableHead>
            <TableHead>Geräte Einlass</TableHead>
            <TableHead>Geräte Auslass</TableHead>
            <TableHead>Wiedereinlass</TableHead>
            <TableHead>Personenlimit</TableHead>
            <TableHead className="text-right">Tickets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {areas.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-slate-500 py-12">
                Noch keine Resourcen angelegt
              </TableCell>
            </TableRow>
          )}
          {areas.map((area, i) => (
            <TableRow
              key={area.id}
              className={readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"}
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
              <TableCell className="text-slate-400 text-sm">{i + 1}</TableCell>
              <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                {area.name}
              </TableCell>
              <TableCell className="text-sm text-slate-500">
                {area.parent?.name || "–"}
              </TableCell>
              <TableCell>
                {area.devicesIn.length === 0 ? (
                  <span className="text-slate-400 text-sm">–</span>
                ) : (
                  <div className="space-y-0.5">
                    {area.devicesIn.map((d) => (
                      <p key={d.id} className="text-sm text-slate-700 dark:text-slate-300">{d.name}</p>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {area.devicesOut.length === 0 ? (
                  <span className="text-slate-400 text-sm">–</span>
                ) : (
                  <div className="space-y-0.5">
                    {area.devicesOut.map((d) => (
                      <p key={d.id} className="text-sm text-slate-700 dark:text-slate-300">{d.name}</p>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge className={
                  area.allowReentry
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }>
                  {area.allowReentry ? "Ja" : "Nein"}
                </Badge>
              </TableCell>
              <TableCell className="font-medium">
                {area.personLimit
                  ? area.personLimit.toLocaleString("de-DE")
                  : <Infinity className="h-4 w-4 text-slate-400" />}
              </TableCell>
              <TableCell className="text-right text-sm">{area._count.tickets}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
