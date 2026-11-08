"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Hourglass, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { formatCents, parseEuroToCents } from "@/lib/verein-portal-rules";

export interface RequestRowData {
  id: number;
  vereinName: string;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  priceCents: number;
  bookedBy: string | null;
  note: string | null;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Offene Wunschzeit-Anfragen der Vereine: freigeben (blockt den Slot in ANNY,
 * legt Zugang und Buchung an) oder mit Begründung ablehnen.
 */
export function VereinRequestsCard({ rows }: { rows: RequestRowData[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<{ row: RequestRowData; mode: "approve" | "reject" } | null>(null);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  function open(row: RequestRowData, mode: "approve" | "reject") {
    setTarget({ row, mode });
    setPrice(centsToInput(row.priceCents));
    setReason("");
    setError(null);
  }

  const priceCents = parseEuroToCents(price);

  async function decide() {
    if (!target) return;
    if (target.mode === "approve" && priceCents == null) {
      setError("Preis bitte als Eurobetrag angeben.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = target.mode === "approve"
        ? { action: "approve", priceCents }
        : { action: "reject", reason: reason.trim() || null };
      const res = await fetch(`/api/vereine/buchungen/${target.row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Speichern fehlgeschlagen.");
      setTarget(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const t = target?.row;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anfragen ({rows.length})</CardTitle>
        <CardDescription>Wunschzeiten, die Vereine außerhalb der freien Slots angefragt haben.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="glass-tile flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.vereinName} · {fmtDay(r.date)} <span className="tabular-nums">{r.slotStart}–{r.slotEnd}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.serviceName}{r.bookedBy ? ` · ${r.bookedBy}` : ""}{r.note ? ` · „${r.note}“` : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button variant="outline" size="sm" className="max-sm:h-11 max-sm:flex-1" onClick={() => open(r, "reject")}>
                  <X /> Ablehnen
                </Button>
                <Button size="sm" className="max-sm:h-11 max-sm:flex-1" onClick={() => open(r, "approve")}>
                  <Check /> Freigeben
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={!!target} onOpenChange={(o) => { if (!busy && !o) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.mode === "approve" ? "Anfrage freigeben?" : "Anfrage ablehnen?"}</DialogTitle>
            <DialogDescription>
              {t ? `${t.vereinName}: ${t.serviceName} am ${fmtDay(t.date)}, ${t.slotStart}–${t.slotEnd}.` : null}
              {target?.mode === "approve"
                ? " Die Zeit wird in ANNY geblockt, der Verein bekommt Zugang und die Buchung wird abgerechnet."
                : " Der Verein sieht die Ablehnung mit Begründung im Portal."}
            </DialogDescription>
          </DialogHeader>
          {target?.mode === "approve" ? (
            <div className="space-y-1.5">
              <Label htmlFor="vr-price">Preis</Label>
              <Input id="vr-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="max-sm:h-11" />
              {priceCents != null && <p className="text-xs text-muted-foreground">Wird mit {formatCents(priceCents)} abgerechnet.</p>}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="vr-reason">Begründung (optional)</Label>
              <Input id="vr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="z. B. Lift in Wartung" className="max-sm:h-11" />
            </div>
          )}
          {error && <Notice tone="danger" title={error} compact />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Abbrechen</Button>
            <Button variant={target?.mode === "reject" ? "destructive" : "default"} onClick={decide} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {target?.mode === "approve" ? "Freigeben" : "Ablehnen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
