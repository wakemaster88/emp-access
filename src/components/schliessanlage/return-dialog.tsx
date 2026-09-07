"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
          <DialogTitle className="inline-flex items-center gap-1.5 text-base">
            <ArrowLeftCircle className="h-4 w-4 text-info" />
            Rücknahme von {handover.holderName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Offene Schlüssel</Label>
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.length === openItems.length ? [] : openItems.map((i) => i.id),
                  )
                }
                className="text-[11px] text-muted-foreground/70 hover:text-foreground"
              >
                {selected.length === openItems.length ? "Keine" : "Alle"}
              </button>
            </div>
            <div className="space-y-0.5 rounded-md border border-border p-1 dark:border-border">
              {openItems.map((item) => {
                const isSel = selected.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                      isSel
                        ? "bg-info/10"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        isSel ? "border-info bg-info" : "border-input",
                      )}
                    >
                      {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className="font-mono text-xs text-foreground/80">
                      {item.keyNumber}
                    </span>
                    <LevelBadge level={item.level} />
                    {item.keyLabel && (
                      <span className="truncate text-[11px] text-muted-foreground/70">{item.keyLabel}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Vorgang</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setItemStatus("RETURNED")}
                className={cn(
                  "h-9 rounded-md border text-xs font-medium transition-colors",
                  itemStatus === "RETURNED"
                    ? "border-success/30 bg-success/10 text-success "
                    : "border-border text-muted-foreground dark:border-border",
                )}
              >
                Zurückgegeben
              </button>
              <button
                type="button"
                onClick={() => setItemStatus("LOST")}
                className={cn(
                  "h-9 rounded-md border text-xs font-medium transition-colors",
                  itemStatus === "LOST"
                    ? "border-destructive/30 bg-destructive/10 text-destructive "
                    : "border-border text-muted-foreground dark:border-border",
                )}
              >
                Als verloren melden
              </button>
            </div>
            {itemStatus === "LOST" && (
              <p className="text-[10px] text-destructive">
                Verlorene Schlüssel bleiben gesperrt und wandern nicht zurück in den Bestand.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="ret-notes" className="text-xs">
              Notiz
            </Label>
            <Input
              id="ret-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z. B. Pfand zurückgezahlt"
              className="h-9"
            />
          </div>

          <ErrorLine message={error} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || selected.length === 0}
            className="h-8 min-w-28 bg-info hover:bg-info/90"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              `${selected.length} zurücknehmen`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
