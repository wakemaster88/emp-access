"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LostItemDialog, type LostItemData } from "./lost-item-dialog";
import {
  Plus, PackageSearch, CheckCircle2, Clock, Phone, ImageOff, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LostItemsTableProps {
  items: LostItemData[];
  readonly?: boolean;
}

type Filter = "all" | "open" | "pickedUp";

function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function LostItemsTable({ items, readonly }: LostItemsTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<LostItemData | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const openCount = items.filter((i) => !i.pickedUp).length;

  const filtered = useMemo(() => {
    if (filter === "open") return items.filter((i) => !i.pickedUp);
    if (filter === "pickedUp") return items.filter((i) => i.pickedUp);
    return items;
  }, [items, filter]);

  async function togglePickedUp(item: LostItemData) {
    setTogglingId(item.id);
    try {
      await fetch(`/api/lost-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedUp: !item.pickedUp }),
      });
      router.refresh();
    } finally {
      setTogglingId(null);
    }
  }

  const filterButtons: { id: Filter; label: string }[] = [
    { id: "all", label: `Alle (${items.length})` },
    { id: "open", label: `Offen (${openCount})` },
    { id: "pickedUp", label: `Abgeholt (${items.length - openCount})` },
  ];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex gap-1.5">
          {filterButtons.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                filter === f.id
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!readonly && (
          <Button
            onClick={() => setAddOpen(true)}
            type="button"
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm sm:ml-auto"
          >
            <Plus className="h-4 w-4" />
            Fundsache anlegen
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
              <TableHead className="w-16 text-slate-600 dark:text-slate-400 font-medium">Bild</TableHead>
              <TableHead className="text-slate-600 dark:text-slate-400 font-medium">Beschreibung</TableHead>
              <TableHead className="hidden sm:table-cell w-[120px] text-slate-600 dark:text-slate-400 font-medium">Funddatum</TableHead>
              <TableHead className="hidden md:table-cell w-[180px] text-slate-600 dark:text-slate-400 font-medium">Kontakt</TableHead>
              <TableHead className="w-[120px] text-right text-slate-600 dark:text-slate-400 font-medium">Status</TableHead>
              {!readonly && <TableHead className="w-[130px] text-right text-slate-600 dark:text-slate-400 font-medium" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
                <TableCell colSpan={readonly ? 5 : 6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <PackageSearch className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-slate-600 dark:text-slate-400">
                      {filter === "all" ? "Noch keine Fundsachen erfasst" : "Keine Fundsachen in dieser Ansicht"}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filtered.map((item) => (
              <TableRow
                key={item.id}
                className={cn(
                  "border-slate-200 dark:border-slate-700 transition-colors",
                  !readonly && "cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20",
                  item.pickedUp && "opacity-60"
                )}
                onClick={() => !readonly && setSelected(item)}
              >
                <TableCell>
                  {item.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */
                    <img
                      src={item.image}
                      alt={item.description}
                      className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <ImageOff className="h-5 w-5 text-slate-400" />
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <p className="font-medium text-slate-900 dark:text-slate-100 line-clamp-2">{item.description}</p>
                  <p className="sm:hidden text-[11px] text-slate-400 mt-0.5">{formatDate(item.foundDate)}</p>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-slate-600 dark:text-slate-400 tabular-nums">
                  {formatDate(item.foundDate)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-slate-600 dark:text-slate-400">
                  {item.contact ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="truncate max-w-[150px]">{item.contact}</span>
                    </span>
                  ) : (
                    <span className="text-slate-400">–</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {item.pickedUp ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Abgeholt
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 gap-1">
                      <Clock className="h-3 w-3" />
                      Offen
                    </Badge>
                  )}
                </TableCell>
                {!readonly && (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={togglingId === item.id}
                      onClick={(e) => { e.stopPropagation(); togglePickedUp(item); }}
                      className="gap-1.5 text-xs"
                    >
                      {item.pickedUp ? (
                        <>
                          <Undo2 className="h-3.5 w-3.5" />
                          Zurücksetzen
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Abgeholt
                        </>
                      )}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LostItemDialog item={null} open={addOpen} onClose={() => setAddOpen(false)} />
      <LostItemDialog item={selected} open={!!selected} onClose={() => setSelected(null)} />
    </>
  );
}
