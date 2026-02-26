"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ServiceDialog, type ServiceData } from "./service-dialog";
import { Plus } from "lucide-react";

interface AreaRef {
  id: number;
  name: string;
}

interface SvcRow extends ServiceData {
  areas: AreaRef[];
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
  const [selectedAreas, setSelectedAreas] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  function openEdit(svc: SvcRow) {
    setSelected({ id: svc.id, name: svc.name, annyNames: svc.annyNames });
    setSelectedAreas(svc.areas.map((a) => a.id));
  }

  return (
    <>
      {!readonly && (
        <div className="flex justify-end mb-4">
          <Button
            onClick={() => { setSelected(null); setSelectedAreas([]); setAddOpen(true); }}
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
                  {svc.areas.length === 0 ? (
                    <span className="text-slate-400 text-sm">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {svc.areas.map((a) => (
                        <Badge key={a.id} variant="outline" className="text-[10px] px-1.5 py-0">{a.name}</Badge>
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
        initialAreaIds={[]}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <ServiceDialog
        service={selected}
        initialAreaIds={selectedAreas}
        areas={areas}
        annyServices={annyServices}
        annyResources={annyResources}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
