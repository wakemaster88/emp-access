"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SubscriptionDialog, type SubscriptionData } from "./subscription-dialog";
import { Plus } from "lucide-react";

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
    setSelected({ id: sub.id, name: sub.name, annyNames: sub.annyNames });
    setSelectedAreas(sub.areas.map((a) => a.id));
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
            Abo anlegen
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
          {subscriptions.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-slate-500 py-12">
                Noch keine Abos angelegt
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
                className={readonly ? "hover:bg-slate-50 dark:hover:bg-slate-900/50" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"}
                onClick={() => !readonly && openEdit(sub)}
              >
                <TableCell className="text-slate-400 text-sm">{i + 1}</TableCell>
                <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                  {sub.name}
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
                  {sub.areas.length === 0 ? (
                    <span className="text-slate-400 text-sm">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {sub.areas.map((a) => (
                        <Badge key={a.id} variant="outline" className="text-[10px] px-1.5 py-0">{a.name}</Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">{sub._count.tickets}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

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
