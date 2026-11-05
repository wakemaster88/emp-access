"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { IconChip } from "@/components/ui/icon-chip";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
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

  const filterButtons: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "Alle", count: items.length },
    { id: "open", label: "Offen", count: openCount },
    { id: "pickedUp", label: "Erledigt", count: items.length - openCount },
  ];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 px-4 sm:px-[18px]">
        <Segmented
          aria-label="Filter"
          value={filter}
          onValueChange={setFilter}
          className="self-start sm:self-auto"
          options={filterButtons.map((f) => ({ value: f.id, label: f.label, count: f.count }))}
        />
        {!readonly && (
          <Button
            onClick={() => setAddOpen(true)}
            type="button"
            className="h-11 sm:h-9 sm:ml-auto"
          >
            <Plus className="h-4 w-4" />
            Eintrag anlegen
          </Button>
        )}
      </div>

      <div className="border-t border-border">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Bild</TableHead>
              {/* Ohne Taste ist auf dem Handy die Beschreibung die letzte sichtbare Spalte. */}
              <TableHead className={cn(readonly && "max-sm:pr-4")}>Beschreibung</TableHead>
              <TableHead className="hidden sm:table-cell w-[120px]">Datum</TableHead>
              <TableHead className="hidden md:table-cell w-[200px]">Kontakt</TableHead>
              <TableHead className="hidden sm:table-cell sm:w-[120px] text-right">Status</TableHead>
              {!readonly && <TableHead className="sm:w-[130px] text-right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableEmpty
                colSpan={readonly ? 5 : 6}
                icon={PackageSearch}
                title={filter === "all" ? "Noch keine Einträge erfasst" : "Keine Einträge in dieser Ansicht"}
                compact={false}
              />
            )}
            {filtered.map((item) => {
              const contact = contactLabel(item);
              const isLostReport = item.kind === "LOST_REPORT";
              const statusBadge = item.pickedUp ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" />
                  Erledigt
                </Badge>
              ) : (
                <Badge variant="warning">
                  <Clock className="h-3 w-3" />
                  Offen
                </Badge>
              );
              return (
                <TableRow
                  key={item.id}
                  className={cn(!readonly && "cursor-pointer")}
                  onClick={() => !readonly && setSelected(item)}
                >
                  {/* Erledigt: Text bleibt lesbar, den Zustand sagt das Badge „Erledigt“;
                      gedimmt werden nur Bild und Symbol-Chip (docs/design-regeln.md, Abschnitt 17). */}
                  <TableCell>
                    {item.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */
                      <img
                        src={item.image}
                        alt={item.description}
                        className={cn("h-12 w-12 rounded-lg object-cover border border-border", item.pickedUp && "opacity-60")}
                      />
                    ) : (
                      // Platzhalter ohne Bild: Symbol-Chip wie in Listenzeilen.
                      <IconChip icon={isLostReport ? User : ImageOff} size="lg" className={cn("size-12", item.pickedUp && "opacity-60")} />
                    )}
                  </TableCell>
                  {/* Beschreibung bricht vollständig um, sonst wird die Tabelle so breit wie der längste Text. */}
                  <TableCell className={cn("whitespace-normal", readonly && "max-sm:pr-4")}>
                    <div className="flex items-start gap-2 min-w-0 sm:min-w-48">
                      {/* Art ist ein Typ, kein Zustand: neutral, Gelb bleibt dem Status „Offen“.
                          Handy: die Art steht in der Zeile darunter, damit die Beschreibung die volle Breite hat. */}
                      <Badge variant="neutral" className="shrink-0 max-sm:hidden">
                        {isLostReport ? "Verlust" : "Fund"}
                      </Badge>
                      <p className="font-medium text-foreground">{item.description}</p>
                    </div>
                    {/* Handy: Datum und Status unter der Beschreibung statt eigener Spalten. */}
                    <div className="sm:hidden mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="neutral">{isLostReport ? "Verlust" : "Fund"}</Badge>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(item.foundDate)}</span>
                      {statusBadge}
                    </div>
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
                  <TableCell className="hidden sm:table-cell text-right">
                    {statusBadge}
                  </TableCell>
                  {!readonly && (
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={togglingId === item.id}
                        onClick={(e) => { e.stopPropagation(); togglePickedUp(item); }}
                        className="gap-1.5 max-sm:size-11"
                      >
                        {/* Handy: nur Symbol (44 px), die Beschriftung bleibt für Screenreader. */}
                        {item.pickedUp ? (
                          <>
                            <Undo2 className="h-3.5 w-3.5" />
                            <span className="max-sm:sr-only">Zurücksetzen</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span className="max-sm:sr-only">{isLostReport ? "Erledigt" : "Abgeholt"}</span>
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
