"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ServiceDialog, type ServiceData, type InitialServiceAreaInput } from "./service-dialog";
import { Plus } from "lucide-react";

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

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4">
          <Button
            onClick={() => { setSelected(null); setInitialServiceAreas([]); setAddOpen(true); }}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            <Plus className="h-4 w-4" />
            Service anlegen
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>anny Verknüpfungen</TableHead>
            <TableHead>Resourcen</TableHead>
            <TableHead className="text-right">Tickets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-slate-500 py-12">
                Noch keine Services angelegt
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
                className={readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"}
                onClick={() => !readonly && openEdit(svc)}
              >
                <TableCell className="text-slate-400 text-sm">{i + 1}</TableCell>
                <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                  {svc.name}
                </TableCell>
                <TableCell>
                  {annyNames.length === 0 ? (
                    <span className="text-slate-400 text-sm">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {annyNames.map((n) => (
                        <Badge key={n} variant="secondary" className="text-[10px] px-1.5 py-0">{n}</Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {(svc.serviceAreas?.length ?? 0) === 0 ? (
                    <span className="text-slate-400 text-sm">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(svc.serviceAreas ?? []).map((sa) => (
                        <Badge key={sa.area.id} variant="outline" className="text-[10px] px-1.5 py-0">{sa.area.name}</Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">{svc._count.tickets}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

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
