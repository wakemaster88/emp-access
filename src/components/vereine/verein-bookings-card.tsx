"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Download, Loader2, Receipt, Undo2, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { billingTotals, formatCents } from "@/lib/verein-portal-rules";

export interface BookingRowData {
  id: number;
  vereinName: string;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  priceCents: number;
  status: "BOOKED" | "CANCELED";
  bookedBy: string | null;
  note: string | null;
  canceledBy: string | null;
  billedAt: string | null;
  invoiceRef: string | null;
  past: boolean;
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Abrechnung der Vereinsbuchungen eines Monats: Summen, Auswahl,
 * „als abgerechnet markieren“ (mit Rechnungsnummer), CSV und Storno.
 */
export function VereinBookingsCard({
  month,
  vereinId,
  vereine,
  rows,
}: {
  month: string;
  vereinId: number | null;
  vereine: { id: number; name: string }[];
  rows: BookingRowData[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [billOpen, setBillOpen] = useState(false);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingRowData | null>(null);

  const totals = useMemo(() => billingTotals(rows), [rows]);
  const canceledCount = rows.filter((r) => r.status === "CANCELED").length;
  const selectable = rows.filter((r) => r.status === "BOOKED");
  const selectedRows = selectable.filter((r) => selected.has(r.id));
  const selectedOpen = selectedRows.filter((r) => !r.billedAt);
  const selectedBilled = selectedRows.filter((r) => r.billedAt);
  const allSelected = selectable.length > 0 && selectedRows.length === selectable.length;

  function hrefFor(m: string, v: number | null) {
    const p = new URLSearchParams({ monat: m });
    if (v) p.set("verein", String(v));
    return `/vereine/buchungen?${p.toString()}`;
  }

  function navigate(m: string, v: number | null) {
    setSelected(new Set());
    router.push(hrefFor(m, v));
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function setBilled(ids: number[], billed: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vereine/buchungen", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, billed, invoiceRef: billed ? invoiceRef.trim() || null : null }),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen.");
      setSelected(new Set());
      setBillOpen(false);
      setInvoiceRef("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const csvParams = new URLSearchParams({ month, format: "csv" });
  if (vereinId) csvParams.set("vereinId", String(vereinId));

  return (
    <Card flush>
      <CardHeader>
        <CardTitle>{monthLabel(month)} ({rows.length})</CardTitle>
        <CardDescription>Slots, die Vereine im Portal gebucht haben. Stornierte werden nicht berechnet.</CardDescription>
        <CardAction>
          <Button variant="outline" asChild className="max-sm:h-11">
            <a href={`/api/vereine/buchungen?${csvParams.toString()}`} aria-label="CSV exportieren">
              <Download />
              <span>CSV<span className="max-sm:sr-only"> exportieren</span></span>
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Voriger Monat" onClick={() => navigate(shiftMonth(month, -1), vereinId)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-0 flex-1 text-center text-sm font-medium tabular-nums sm:w-32 sm:flex-none">{monthLabel(month)}</span>
            <Button variant="ghost" size="icon" aria-label="Nächster Monat" onClick={() => navigate(shiftMonth(month, 1), vereinId)}>
              <ChevronRight />
            </Button>
          </div>
          <NativeSelect
            aria-label="Verein"
            containerClassName="w-full sm:w-56"
            value={vereinId ? String(vereinId) : ""}
            onChange={(e) => navigate(month, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Alle Vereine</option>
            {vereine.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </NativeSelect>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatCard variant="tile" size="sm" icon={Receipt} tone="warning" label="Offen" value={formatCents(totals.openCents)} hint={`${totals.openCount} Slots`} />
          <StatCard variant="tile" size="sm" icon={CheckCircle2} tone="success" label="Abgerechnet" value={formatCents(totals.billedCents)} hint={`${totals.billedCount} Slots`} />
          <StatCard variant="tile" size="sm" icon={XCircle} tone="neutral" label="Storniert" value={canceledCount} hint="nicht berechnet" />
        </div>

        {selectedRows.length > 0 && (
          <div className="glass-tile flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="text-sm">
              <span className="font-medium tabular-nums">{selectedRows.length}</span> ausgewählt ·{" "}
              <span className="tabular-nums">{formatCents(selectedRows.reduce((s, r) => s + r.priceCents, 0))}</span>
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {selectedBilled.length > 0 && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setBilled(selectedBilled.map((r) => r.id), false)}>
                  <Undo2 /> Zurücknehmen
                </Button>
              )}
              {selectedOpen.length > 0 && (
                <Button size="sm" disabled={busy} onClick={() => { setError(null); setBillOpen(true); }}>
                  <Receipt /> Als abgerechnet markieren
                </Button>
              )}
            </div>
          </div>
        )}
        {error && !billOpen && <Notice tone="danger" title={error} compact />}
      </CardContent>

      <div className="border-t border-border">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Alle auswählen"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onCheckedChange={(v) => setSelected(v ? new Set(selectable.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Slot</TableHead>
              <TableHead className="max-sm:hidden">Verein</TableHead>
              <TableHead className="text-right">Preis</TableHead>
              <TableHead className="text-right max-sm:pr-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableEmpty colSpan={5} icon={CalendarCheck} title="In diesem Monat hat noch kein Verein gebucht." />
            )}
            {rows.map((r) => {
              const canceled = r.status === "CANCELED";
              return (
                <TableRow key={r.id} className="max-sm:h-11">
                  <TableCell>
                    {!canceled && (
                      <Checkbox aria-label={`Buchung ${fmtDay(r.date)} ${r.slotStart} auswählen`} checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                    )}
                  </TableCell>
                  <TableCell className="max-w-0 w-full">
                    <p className="truncate font-medium">
                      {fmtDay(r.date)} <span className="tabular-nums">{r.slotStart}–{r.slotEnd}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="sm:hidden">{r.vereinName} · </span>
                      {r.serviceName}{r.bookedBy ? ` · ${r.bookedBy}` : ""}{r.note ? ` · ${r.note}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="max-sm:hidden">{r.vereinName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={canceled ? "text-muted-foreground line-through" : undefined}>{formatCents(r.priceCents)}</span>
                  </TableCell>
                  <TableCell className="text-right max-sm:pr-4">
                    <div className="flex items-center justify-end gap-1">
                      {canceled ? (
                        <Badge variant="neutral" title={r.canceledBy === "ADMIN" ? "vom Backoffice storniert" : "vom Verein storniert"}>Storniert</Badge>
                      ) : r.billedAt ? (
                        <Badge variant="success" title={`abgerechnet am ${fmtDate(r.billedAt)}${r.invoiceRef ? ` · ${r.invoiceRef}` : ""}`}>
                          {r.invoiceRef ?? "Abgerechnet"}
                        </Badge>
                      ) : (
                        <>
                          <Badge variant={r.past ? "warning" : "info"}>{r.past ? "Offen" : "Gebucht"}</Badge>
                          <Button variant="ghost" size="icon-sm" aria-label="Buchung stornieren" onClick={() => setCancelTarget(r)}>
                            <XCircle className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={billOpen} onOpenChange={(o) => { if (!busy) setBillOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedOpen.length} Slots als abgerechnet markieren?</DialogTitle>
            <DialogDescription>Summe {formatCents(selectedOpen.reduce((s, r) => s + r.priceCents, 0))}. Abgerechnete Buchungen kann der Verein nicht mehr stornieren.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="vb-invoice">Rechnungsnummer (optional)</Label>
            <Input id="vb-invoice" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="z. B. R-2026-117" maxLength={120} className="max-sm:h-11" />
          </div>
          {error && <Notice tone="danger" title={error} compact />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillOpen(false)} disabled={busy}>Abbrechen</Button>
            <Button onClick={() => setBilled(selectedOpen.map((r) => r.id), true)} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Abgerechnet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Buchung stornieren?"
        description={cancelTarget ? `${cancelTarget.vereinName}: ${cancelTarget.serviceName} am ${fmtDay(cancelTarget.date)} um ${cancelTarget.slotStart}. Der Slot wird in ANNY wieder frei, die Buchung wird nicht berechnet.` : undefined}
        confirmLabel="Stornieren"
        cancelLabel="Behalten"
        onConfirm={async () => {
          if (!cancelTarget) return;
          const res = await fetch(`/api/vereine/buchungen/${cancelTarget.id}`, { method: "DELETE" });
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(payload.error ?? "Stornieren fehlgeschlagen.");
          setCancelTarget(null);
          router.refresh();
        }}
      />
    </Card>
  );
}
