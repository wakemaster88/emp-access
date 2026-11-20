"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { formatEuro, formatQty, parseEuroToCents, parseGermanNumber } from "@/lib/warenwirtschaft";
import { CORRECTION_REASON_MIN, FIELD_LABEL, LINE_FIELDS, type LineField } from "@/lib/stocktake-log";

export interface CorrectionLine {
  id: number;
  name: string;
  unit: string | null;
  counted: number | null;
  broken: number | null;
  purchasePriceCents: number | null;
}

function show(field: LineField, v: number | null) {
  return field === "purchasePriceCents" ? formatEuro(v) : formatQty(v);
}

function toInput(field: LineField, v: number | null): string {
  if (v == null) return "";
  return field === "purchasePriceCents" ? (v / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 }) : String(v).replace(".", ",");
}

/**
 * Korrektur einer festgeschriebenen Inventur: ein Feld einer Zeile mit
 * Begründung ändern. Alter und neuer Wert, Person und Zeit stehen danach im
 * Protokoll und im PDF.
 */
export function StocktakeCorrectionDialog({ stocktakeId, line, onClose }: { stocktakeId: number; line: CorrectionLine | null; onClose: () => void }) {
  const router = useRouter();
  const [field, setField] = useState<LineField>("counted");
  const [value, setValue] = useState(() => (line ? toInput("counted", line.counted) : ""));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pick(f: LineField) {
    setField(f);
    setValue(line ? toInput(f, line[f]) : "");
  }

  async function save() {
    if (!line) return;
    const parsed = field === "purchasePriceCents" ? parseEuroToCents(value) : parseGermanNumber(value);
    if (parsed === undefined) {
      setError(field === "purchasePriceCents" ? "Bitte einen Betrag eingeben, z. B. 1,29." : "Bitte eine Zahl eingeben, z. B. 12 oder 0,5.");
      return;
    }
    if (reason.trim().length < CORRECTION_REASON_MIN) {
      setError("Bitte kurz begründen, warum korrigiert wird.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/warenwirtschaft/stocktakes/${stocktakeId}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id, field, value: parsed, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Korrektur hat nicht geklappt");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Korrektur hat nicht geklappt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={line != null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Korrektur</DialogTitle>
          <DialogDescription>
            {line?.name}
            {line?.unit ? ` · ${line.unit}` : ""}. Die Inventur ist festgeschrieben; die Änderung steht mit Begründung im Protokoll. Der aktuelle Bestand bleibt unverändert.
          </DialogDescription>
        </DialogHeader>
        {line && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="corr-field">Feld</Label>
                <NativeSelect id="corr-field" value={field} onChange={(e) => pick(e.target.value as LineField)} className="h-11 sm:h-9">
                  {LINE_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="corr-value">Neuer Wert</Label>
                <Input id="corr-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 tabular-nums sm:h-9" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Bisher: {show(field, line[field])}</p>
            <div className="space-y-1.5">
              <Label htmlFor="corr-reason">Begründung *</Label>
              <Textarea id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="z. B. Zahlendreher, Rechnung 4711 nachgereicht" className="resize-none" />
            </div>
            {error && <Notice tone="danger" compact role="alert" title={error} />}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="h-11 sm:h-9">Abbrechen</Button>
              <Button type="button" onClick={save} disabled={busy} className="h-11 gap-1.5 sm:h-9">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Korrigieren
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
