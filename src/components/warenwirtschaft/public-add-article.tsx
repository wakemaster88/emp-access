"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { parseGermanNumber } from "@/lib/warenwirtschaft";
import type { Line } from "./public-count-client";

/**
 * Artikel ergänzen beim Zählen am Handy: Bezeichnung, Einheit, Kategorie und
 * gleich die gezählte Menge. Preis und Bild pflegt das Büro später nach.
 * Wird nur gerendert, solange er offen ist, damit die Felder neu starten.
 */
export function AddArticleDialog({
  open,
  onOpenChange,
  token,
  counter,
  initialName,
  categories,
  onAdded,
  onExisting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  counter: string;
  initialName: string;
  categories: string[];
  onAdded: (line: Line) => void;
  onExisting: (lineId: number) => void;
}) {
  const options = categories.includes("Sonstiges") ? categories : [...categories, "Sonstiges"];
  const [articleName, setArticleName] = useState(initialName);
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState(options[0] ?? "Sonstiges");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const counted = parseGermanNumber(qty);
    if (counted === undefined) {
      setError("Menge bitte als Zahl eingeben, z. B. 12 oder 0,5.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/zaehlen/${token}/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: counter, article: { name: articleName, unit: unit || null, category, counted } }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && typeof body?.id === "number") {
        onExisting(body.id);
        onOpenChange(false);
        return;
      }
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Speichern fehlgeschlagen. Prüfe die Verbindung.");
        return;
      }
      onAdded(body as Line);
      onOpenChange(false);
    } catch {
      setError("Speichern fehlgeschlagen. Prüfe die Verbindung.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Artikel hinzufügen</DialogTitle>
            <DialogDescription>Für Artikel, die beim Zählen auffallen, aber noch nicht in der Liste stehen. Preis und Bild ergänzt das Büro.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="add-name">Bezeichnung</Label>
            <Input id="add-name" value={articleName} onChange={(e) => setArticleName(e.target.value)} maxLength={200} required className="h-11" placeholder="z. B. Aperol Spritz Dose" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-unit">Einheit</Label>
              <Input id="add-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} className="h-11" placeholder="z. B. FL 0,7" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-qty">Gezählt</Label>
              <Input id="add-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="h-11 text-right tabular-nums" placeholder="Menge" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-cat">Kategorie</Label>
            <NativeSelect id="add-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="h-11">
              {options.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          {error && <Notice tone="danger" compact role="alert" title={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" className="h-11" disabled={busy || !articleName.trim()}>
              Hinzufügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
