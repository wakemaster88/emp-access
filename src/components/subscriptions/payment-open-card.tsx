"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDay, formatMoney, paymentOpenTotal, type PaymentOpenRow } from "@/lib/payment-open";

function ymdDay(ymd: string): string {
  return formatDay(`${ymd}T12:00:00Z`) ?? ymd;
}

/** Mahnstufe einer Zeile: erreicht (mit Datum) und was als Nächstes kommt. */
function DunningCell({ d, enabled }: { d: PaymentOpenRow["dunning"]; enabled: boolean }) {
  return (
    <div className="space-y-0.5">
      {d.stage ? (
        <Badge variant={d.stage === "collection" ? "danger" : d.stage === "final" ? "warning" : "neutral"}>{d.label}</Badge>
      ) : (
        <span className="text-muted-foreground">Noch keine</span>
      )}
      {d.stage && d.stage !== "collection" && d.at && (
        <div className="text-xs text-muted-foreground tabular-nums">am {formatDay(d.at)}</div>
      )}
      {d.error ? (
        <div className="text-xs text-destructive">{d.stuck ? "Gestoppt: " : ""}{d.error}</div>
      ) : (
        d.next && enabled && (
          <div className="text-xs text-muted-foreground tabular-nums">{d.next.label} ab {ymdDay(d.next.on)}</div>
        )
      )}
    </div>
  );
}

/**
 * Abos, die der anny-Abgleich wegen einer überfälligen Abo-Rechnung pausiert
 * hat. Älteste Schuld zuerst; bezahlt wird in anny, danach endet die Pause.
 * Der Mahnlauf (lib/dunning) läuft jeden Morgen und zeigt hier seine Stufe.
 */
export function PaymentOpenCard({
  rows,
  dunningEnabled,
  readonly = false,
}: {
  rows: PaymentOpenRow[];
  dunningEnabled: boolean;
  readonly?: boolean;
}) {
  const total = paymentOpenTotal(rows);
  const [enabled, setEnabled] = useState(dunningEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    setEnabled(next);
    try {
      const res = await fetch("/api/subscriptions/dunning", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Speichern fehlgeschlagen");
    } catch (e) {
      setEnabled(!next);
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card flush>
      <CardHeader>
        <CardTitle>Zahlung offen ({rows.length}){total ? ` · ${total}` : ""}</CardTitle>
        <CardDescription>
          Diese Abos sind pausiert, weil eine Rechnung in anny überfällig ist. Nach der Zahlung hebt der Abgleich die Pause selbst auf.
          {" "}
          {enabled
            ? "Der Mahnlauf schickt jeden Morgen automatisch Erinnerung (über anny), 1. Mahnung und letzte Mahnung, je 14 Tage auseinander."
            : "Der Mahnlauf ist ausgeschaltet, es gehen keine Erinnerungen oder Mahnungen raus."}
          {error && <span className="block text-destructive">{error}</span>}
        </CardDescription>
        {!readonly && (
          <CardAction>
            <label className="flex items-center gap-2 text-sm">
              <span className="max-sm:hidden">Mahnlauf</span>
              <Switch checked={enabled} disabled={saving} onCheckedChange={toggle} aria-label="Mahnlauf automatisch" />
            </label>
          </CardAction>
        )}
      </CardHeader>
      <Table edge>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead className="max-sm:hidden">Abo</TableHead>
            <TableHead className="text-right max-sm:hidden">Fällig seit</TableHead>
            <TableHead className="max-md:hidden">Mahnstufe</TableHead>
            <TableHead className="text-right">Offen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-sm:whitespace-normal">
                <div className="font-medium">{r.person}</div>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground tabular-nums">
                  <span className="sm:hidden">{r.aboName ?? "Abo"} · seit {formatDay(r.dueDate) ?? "?"}</span>
                  {r.invoiceNumber && <span>{r.invoiceNumber}</span>}
                  {r.openCount != null && r.openCount > 1 && <Badge variant="neutral">{r.openCount} Rechnungen</Badge>}
                  {r.dunning.label && (
                    <Badge className="md:hidden" variant={r.dunning.stage === "collection" ? "danger" : r.dunning.stage === "final" ? "warning" : "neutral"}>
                      {r.dunning.label}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-sm:hidden">{r.aboName ?? "–"}</TableCell>
              <TableCell className="text-right tabular-nums max-sm:hidden">
                {formatDay(r.dueDate) ?? "–"}
                {r.daysOverdue != null && (
                  <div className="text-xs text-muted-foreground">{r.daysOverdue} {r.daysOverdue === 1 ? "Tag" : "Tage"}</div>
                )}
              </TableCell>
              <TableCell className="max-md:hidden">
                <DunningCell d={r.dunning} enabled={enabled} />
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold text-destructive">
                {formatMoney(r.amount, r.currency) ?? "–"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
