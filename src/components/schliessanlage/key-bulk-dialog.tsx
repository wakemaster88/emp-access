"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockPicker } from "@/components/schliessanlage/lock-picker";
import { ErrorLine, apiRequest, selectFieldClass } from "@/components/schliessanlage/shared";
import type { LockOption } from "@/components/schliessanlage/types";
import { KEY_LEVEL_LABELS, buildKeyNumberSeries } from "@/lib/keying";
import { cn } from "@/lib/utils";

interface Props {
  lockOptions: LockOption[];
  open: boolean;
  onClose: () => void;
}

/** Mehrere gleichartige Schluessel als Nummernserie anlegen. */
export function KeyBulkDialog({ lockOptions, open, onClose }: Props) {
  const router = useRouter();
  const [prefix, setPrefix] = useState("");
  const [startIndex, setStartIndex] = useState(1);
  const [count, setCount] = useState(5);
  const [separator, setSeparator] = useState("-");
  const [padding, setPadding] = useState(1);
  const [label, setLabel] = useState("");
  const [level, setLevel] = useState("SINGLE");
  const [lockIds, setLockIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    if (!prefix.trim()) return [];
    return buildKeyNumberSeries({
      prefix: prefix.trim(),
      count: Math.min(count, 4),
      startIndex,
      separator,
      padding,
    });
  }, [prefix, count, startIndex, separator, padding]);

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest("/api/schliessanlage/keys/bulk", "POST", {
      prefix: prefix.trim(),
      startIndex,
      count,
      separator,
      padding,
      label: label.trim() || null,
      level,
      lockIds,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schlüsselserie anlegen</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="b-prefix">
                Präfix <span className="text-destructive">*</span>
              </Label>
              <Input
                id="b-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="z. B. Z12"
                autoFocus
                className="font-mono max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-start">
                Ab Nr.
              </Label>
              <Input
                id="b-start"
                type="number"
                min={0}
                max={9999}
                value={startIndex}
                onChange={(e) => setStartIndex(Math.max(0, Number(e.target.value) || 0))}
                className="tabular-nums max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-count">
                Anzahl
              </Label>
              <Input
                id="b-count"
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                className="tabular-nums max-sm:h-11"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="b-sep">
                Trennzeichen
              </Label>
              <Input
                id="b-sep"
                value={separator}
                onChange={(e) => setSeparator(e.target.value.slice(0, 3))}
                className="font-mono max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-pad">
                Stellen
              </Label>
              <Input
                id="b-pad"
                type="number"
                min={1}
                max={6}
                value={padding}
                onChange={(e) => setPadding(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
                className="tabular-nums max-sm:h-11"
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label htmlFor="b-level">
                Schlüsselart
              </Label>
              <select
                id="b-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className={cn(selectFieldClass, "w-full max-sm:h-11")}
              >
                {Object.entries(KEY_LEVEL_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {preview.length > 0 && (
            // Vorschau der Nummern als Glas-Kachel (in Ebenen automatisch getönt).
            <p className="glass-tile px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {preview.join(", ")}
              {count > preview.length ? ` … (${count} Stück)` : ""}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="b-label">
              Gemeinsame Bezeichnung
            </Label>
            <Input
              id="b-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="z. B. Umkleide Damen"
              className="max-sm:h-11"
            />
          </div>

          <div className="space-y-1">
            <Label>Schließt folgende Schlösser</Label>
            <LockPicker options={lockOptions} value={lockIds} onChange={setLockIds} />
          </div>

          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || !prefix.trim()}
            className="min-w-32 tabular-nums max-sm:h-11"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              `${count} Schlüssel anlegen`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
