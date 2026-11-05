"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { ErrorLine, LevelBadge, apiRequest } from "@/components/schliessanlage/shared";
import type { HandoverRow } from "@/components/schliessanlage/types";
import { cn } from "@/lib/utils";

interface Props {
  handover: HandoverRow;
  open: boolean;
  onClose: () => void;
}

export function ReturnDialog({ handover, open, onClose }: Props) {
  const router = useRouter();
  const openItems = handover.items.filter((i) => i.itemStatus === "ISSUED");
  const [selected, setSelected] = useState<number[]>(openItems.map((i) => i.id));
  const [itemStatus, setItemStatus] = useState<"RETURNED" | "LOST">("RETURNED");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(`/api/schliessanlage/handovers/${handover.id}/return`, "POST", {
      itemIds: selected,
      itemStatus,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rücknahme von {handover.holderName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Offene Schlüssel</Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  setSelected(
                    selected.length === openItems.length ? [] : openItems.map((i) => i.id),
                  )
                }
                className="text-[11px] text-muted-foreground hover:text-foreground max-sm:h-11"
              >
                {selected.length === openItems.length ? "Keine" : "Alle"}
              </Button>
            </div>
            {/* Auswahlliste als Glas-Kachel (in Ebenen automatisch getönt): gewählte Zeilen in Akzent-Tönung, Kästchen angehakt. */}
            <div className="glass-tile space-y-0.5 p-1">
              {openItems.map((item) => {
                const isSel = selected.includes(item.id);
                return (
                  // Ganze Zeile ist Beschriftung des Kästchens und damit die Tippfläche; das Kästchen
                  // selbst nimmt keine Zeiger an (kein doppeltes Umschalten).
                  <label
                    key={item.id}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors max-sm:min-h-11",
                      isSel
                        ? "bg-primary/10"
                        : "hover:bg-glass-tile",
                    )}
                  >
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => toggle(item.id)}
                      className="pointer-events-none"
                    />
                    <span className="shrink-0 font-mono text-xs text-foreground">
                      {item.keyNumber}
                    </span>
                    <LevelBadge level={item.level} />
                    {item.keyLabel && (
                      <span className="truncate text-[11px] text-muted-foreground">{item.keyLabel}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Vorgang</Label>
            <Segmented
              aria-label="Vorgang"
              value={itemStatus}
              onValueChange={setItemStatus}
              stretch
              options={[
                { value: "RETURNED", label: "Zurückgegeben" },
                { value: "LOST", label: "Als verloren melden" },
              ]}
            />
            {itemStatus === "LOST" && (
              <p className="text-[11px] text-destructive">
                Verlorene Schlüssel bleiben gesperrt und wandern nicht zurück in den Bestand.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="ret-notes">
              Notiz
            </Label>
            <Input
              id="ret-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z. B. Pfand zurückgezahlt"
              className="max-sm:h-11"
            />
          </div>

          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || selected.length === 0}
            className="min-w-28 tabular-nums max-sm:h-11"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              `${selected.length} zurücknehmen`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
