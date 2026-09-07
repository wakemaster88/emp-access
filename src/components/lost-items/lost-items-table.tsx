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
  Plus, PackageSearch, CheckCircle2, Clock, Phone, ImageOff, Undo2, User,
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

function contactLabel(item: LostItemData): string | null {
  if (item.kind === "LOST_REPORT") {
    const parts = [item.reporterName, item.callbackPhone].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return item.contact;
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
    { id: "pickedUp", label: `Erledigt (${items.length - openCount})` },
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
                  ? "bg-primary border-primary text-white"
                  : "border-border text-muted-foreground hover:bg-muted/50"
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
            className="bg-primary hover:bg-primary/90 gap-2 shadow-sm sm:ml-auto"
          >
            <Plus className="h-4 w-4" />
            Eintrag anlegen
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent bg-muted/40">
              <TableHead className="w-16 text-muted-foreground font-medium">Bild</TableHead>
              <TableHead className="text-muted-foreground font-medium">Beschreibung</TableHead>
              <TableHead className="hidden sm:table-cell w-[120px] text-muted-foreground font-medium">Datum</TableHead>
              <TableHead className="hidden md:table-cell w-[200px] text-muted-foreground font-medium">Kontakt</TableHead>
              <TableHead className="w-[120px] text-right text-muted-foreground font-medium">Status</TableHead>
              {!readonly && <TableHead className="w-[130px] text-right text-muted-foreground font-medium" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent border-border">
                <TableCell colSpan={readonly ? 5 : 6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <PackageSearch className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-muted-foreground">
                      {filter === "all" ? "Noch keine Einträge erfasst" : "Keine Einträge in dieser Ansicht"}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filtered.map((item) => {
              const contact = contactLabel(item);
              const isLostReport = item.kind === "LOST_REPORT";
              return (
                <TableRow
                  key={item.id}
                  className={cn(
                    "border-border transition-colors",
                    !readonly && "cursor-pointer hover:bg-primary/10 ",
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
                        className="h-12 w-12 rounded-lg object-cover border border-border"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                        {isLostReport ? (
                          <User className="h-5 w-5 text-muted-foreground/70" />
                        ) : (
                          <ImageOff className="h-5 w-5 text-muted-foreground/70" />
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2 min-w-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px] px-1.5 py-0",
                          isLostReport
                            ? "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300"
                            : "border-warning/30 text-warning "
                        )}
                      >
                        {isLostReport ? "Verlust" : "Fund"}
                      </Badge>
                      <p className="font-medium text-foreground line-clamp-2">{item.description}</p>
                    </div>
                    <p className="sm:hidden text-[11px] text-muted-foreground/70 mt-0.5">{formatDate(item.foundDate)}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground tabular-nums">
                    {formatDate(item.foundDate)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {contact ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                        <span className="truncate max-w-[170px]">{contact}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.pickedUp ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Erledigt
                      </Badge>
                    ) : (
                      <Badge className="bg-warning/10 text-warning gap-1">
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
                            {isLostReport ? "Erledigt" : "Abgeholt"}
                          </>
                        )}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <LostItemDialog item={null} open={addOpen} onClose={() => setAddOpen(false)} />
      <LostItemDialog item={selected} open={!!selected} onClose={() => setSelected(null)} />
    </>
  );
}
