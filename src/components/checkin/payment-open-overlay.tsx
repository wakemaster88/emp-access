"use client";

/**
 * Overlay „Zahlung offen“ an der Kasse: Abos, die der anny-Abgleich wegen einer
 * überfälligen Abo-Rechnung pausiert hat, älteste Schuld zuerst.
 * Datenlieferant ist /api/checkin/public/[token]/payment-open.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { formatDay, formatMoney, type PaymentOpenRow } from "@/lib/payment-open";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";

type Row = Omit<PaymentOpenRow, "email">;

export function PaymentOpenOverlay({ token, onClose }: { token: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/checkin/public/${token}/payment-open`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { total: string | null; rows: Row[] };
      setRows(data.rows);
      setTotal(data.total);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center", overlayScrimClass)}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(overlaySheetClass, "w-full sm:max-w-2xl max-h-[92dvh] flex flex-col pb-[env(safe-area-inset-bottom)] monitor-scrollbar overflow-hidden")}
      >
        <OverlayGrip />
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2 truncate text-foreground min-w-0">
            <Wallet className="h-5 w-5 text-primary shrink-0" />
            Zahlung offen
            {rows && (
              <span className="text-muted-foreground text-sm font-normal tabular-nums truncate">
                · {rows.length} {rows.length === 1 ? "Abo" : "Abos"}{total ? ` · ${total}` : ""}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="secondary"
              size="icon-lg"
              onClick={() => void load()}
              disabled={refreshing}
              className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
              title="Aktualisieren"
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
            <Button
              variant="secondary"
              size="icon-lg"
              onClick={onClose}
              className="size-11 rounded-full sm:size-14"
              title="Schließen"
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2">
          {error && <Notice tone="danger" compact>Liste konnte nicht geladen werden.</Notice>}
          {!rows && !error && (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          )}
          {rows && rows.length === 0 && (
            <EmptyState icon={Wallet} title="Keine offenen Zahlungen" description="Alle Abo-Rechnungen sind bezahlt." />
          )}
          {rows?.map((r) => (
            <div key={r.id} className="glass-tile p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{r.person}</p>
                <p className="text-sm text-muted-foreground truncate">{r.aboName ?? "Abo"}</p>
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  {r.dueDate ? `fällig seit ${formatDay(r.dueDate)}` : "Fälligkeit unbekannt"}
                  {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}
                  {r.openCount && r.openCount > 1 ? ` · ${r.openCount} Rechnungen` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-destructive tabular-nums">{formatMoney(r.amount, r.currency) ?? "–"}</p>
                {r.daysOverdue != null && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {r.daysOverdue} {r.daysOverdue === 1 ? "Tag" : "Tage"}
                  </p>
                )}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2">
            Bezahlt wird in anny. Danach hebt der Abgleich die Pause selbst auf.
          </p>
        </div>
      </div>
    </div>
  );
}
