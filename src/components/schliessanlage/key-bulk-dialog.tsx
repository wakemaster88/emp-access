"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockPicker } from "@/components/schliessanlage/lock-picker";
import { ErrorLine, apiRequest } from "@/components/schliessanlage/shared";
import type { LockOption } from "@/components/schliessanlage/types";
import { KEY_LEVEL_LABELS, buildKeyNumberSeries } from "@/lib/keying";

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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-1.5 text-base">
            <Layers className="h-4 w-4 text-indigo-500" />
            Schlüsselserie anlegen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="b-prefix" className="text-xs">
                Präfix <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="b-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="z. B. Z12"
                autoFocus
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-start" className="text-xs">
                Ab Nr.
              </Label>
              <Input
                id="b-start"
                type="number"
                min={0}
                max={9999}
                value={startIndex}
                onChange={(e) => setStartIndex(Math.max(0, Number(e.target.value) || 0))}
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-count" className="text-xs">
                Anzahl
              </Label>
              <Input
                id="b-count"
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                className="h-9 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="b-sep" className="text-xs">
                Trennzeichen
              </Label>
              <Input
                id="b-sep"
                value={separator}
                onChange={(e) => setSeparator(e.target.value.slice(0, 3))}
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-pad" className="text-xs">
                Stellen
              </Label>
              <Input
                id="b-pad"
                type="number"
                min={1}
                max={6}
                value={padding}
                onChange={(e) => setPadding(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-level" className="text-xs">
                Schlüsselart
              </Label>
              <select
                id="b-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
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
            <p className="rounded bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800/50">
              {preview.join(", ")}
              {count > preview.length ? ` … (${count} Stück)` : ""}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="b-label" className="text-xs">
              Gemeinsame Bezeichnung
            </Label>
            <Input
              id="b-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="z. B. Umkleide Damen"
              className="h-9"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Schließt folgende Schlösser</Label>
            <LockPicker options={lockOptions} value={lockIds} onChange={setLockIds} />
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
            disabled={saving || !prefix.trim()}
            className="h-8 min-w-32 bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              `${count} Schlüssel anlegen`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
