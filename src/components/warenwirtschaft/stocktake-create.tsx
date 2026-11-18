"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import { defaultCutoffDate } from "@/lib/warenwirtschaft";
import { Loader2, Plus } from "lucide-react";

type Kind = "ROLLING" | "CUTOFF";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * „Neue Zählung“ bzw. „Neue Stichtagsinventur“ im Kartenkopf. Die laufende
 * Inventur darf sich auf Kategorien beschränken; die Stichtagsinventur
 * umfasst immer alle aktiven Artikel.
 */
export function CreateStocktakeButton({ kind, categories, basePath }: { kind: Kind; categories: string[]; basePath: string }) {
  const router = useRouter();
  const cutoff = kind === "CUTOFF";
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(cutoff ? defaultCutoffDate() : today());
    setTitle("");
    setPicked([]);
    setError("");
  }, [open, cutoff]);

  async function create() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/warenwirtschaft/stocktakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, date, title: title.trim() || undefined, categories: cutoff ? undefined : picked }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.id) {
        router.push(`${basePath}/${data.id}`);
        return;
      }
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Anlegen fehlgeschlagen");
      router.push(`${basePath}/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Anlegen fehlgeschlagen");
      setSaving(false);
    }
  }

  const label = cutoff ? "Stichtagsinventur" : "Zählung";
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="max-sm:h-11" aria-label={`Neue ${label}`}>
        <Plus className="h-4 w-4" />
        <span>{cutoff ? <>Stichtag<span className="max-sm:sr-only"> anlegen</span></> : <>Zählung<span className="max-sm:sr-only"> starten</span></>}</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cutoff ? "Stichtagsinventur anlegen" : "Zählung starten"}</DialogTitle>
            <DialogDescription>
              {cutoff
                ? "Alle aktiven Artikel werden zum Stichtag gezählt und bewertet. Nach dem Festschreiben ist die Liste nicht mehr änderbar."
                : "Zähle jederzeit einzelne Kategorien oder alles. Beim Abschluss wird der gezählte Bestand übernommen."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="st-date">{cutoff ? "Stichtag" : "Zähltag"}</Label>
              <Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 sm:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-title">Bezeichnung</Label>
              <Input id="st-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={cutoff ? "z. B. Inventur Gastro 2026" : "z. B. Kühlhaus"} className="h-11 sm:h-9" />
            </div>
            {!cutoff && categories.length > 0 && (
              <div className="space-y-1.5">
                <Label id="st-cats">Kategorien (leer = alle)</Label>
                <ToggleChipGroup aria-labelledby="st-cats">
                  {categories.map((c) => (
                    <ToggleChip
                      key={c}
                      pressed={picked.includes(c)}
                      onPressedChange={(p) => setPicked((prev) => (p ? [...prev, c] : prev.filter((x) => x !== c)))}
                    >
                      {c}
                    </ToggleChip>
                  ))}
                </ToggleChipGroup>
              </div>
            )}
            {error && <Notice tone="danger" compact title={error} />}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving} className="h-11 sm:h-9">Abbrechen</Button>
              <Button type="button" onClick={create} disabled={saving || !date} className="h-11 gap-1.5 sm:h-9">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Anlegen
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
