"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftCircle,
  CheckCircle2,
  FileDown,
  Plus,
  QrCode,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HandoverDialog } from "@/components/schliessanlage/handover-dialog";
import { ReturnDialog } from "@/components/schliessanlage/return-dialog";
import {
  EmptyHint,
  ErrorLine,
  HandoverStatusBadge,
  apiRequest,
  fmtDate,
  fmtDateTime,
} from "@/components/schliessanlage/shared";
import { SignatureDialog } from "@/components/schliessanlage/signature-dialog";
import type {
  EmployeeOption,
  HandoverRow,
  HolderRow,
  KeyRow,
  PolicyRow,
} from "@/components/schliessanlage/types";
import { isOverdue } from "@/lib/keying";
import { cn } from "@/lib/utils";

interface Props {
  handovers: HandoverRow[];
  keys: KeyRow[];
  holders: HolderRow[];
  employees: EmployeeOption[];
  policies: PolicyRow[];
  readonly: boolean;
}

export function HandoversTab({ handovers, keys, holders, employees, policies, readonly }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [returnFor, setReturnFor] = useState<HandoverRow | null>(null);
  const [signatureFor, setSignatureFor] = useState<HandoverRow | null>(null);
  const [error, setError] = useState("");

  const now = new Date();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return handovers.filter((h) => {
      if (onlyOpen && h.status !== "ISSUED" && h.status !== "PARTIALLY_RETURNED") return false;
      if (!q) return true;
      return [h.holderName, ...h.items.map((i) => i.keyNumber)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [handovers, query, onlyOpen]);

  const overdueCount = handovers.filter((h) =>
    isOverdue({ dueAt: h.dueAt ? new Date(h.dueAt) : null, status: h.status }, now),
  ).length;

  async function remove(handover: HandoverRow) {
    if (
      !confirm(
        `Protokoll #${handover.id} (${handover.holderName}) wirklich löschen? Offene Schlüssel gehen zurück in den Bestand.`,
      )
    ) {
      return;
    }
    setError("");
    const res = await apiRequest(`/api/schliessanlage/handovers/${handover.id}`, "DELETE");
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base sm:text-xl">
              {handovers.length} Protokolle
              {overdueCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-rose-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {overdueCount} überfällig
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Ausgabe und Rücknahme von Schlüsseln. Die Belehrung wird per QR-Code digital
              unterschrieben.
            </CardDescription>
          </div>
          {!readonly && (
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="h-8 bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Ausgeben
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <ErrorLine message={error} />

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Empfänger oder Schlüsselnummer suchen…"
              className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyOpen((v) => !v)}
            className={cn(
              "h-9 rounded-md border px-3 text-xs font-medium transition-colors",
              onlyOpen
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                : "border-slate-200 text-slate-500 dark:border-slate-700",
            )}
          >
            Nur offene
          </button>
        </div>

        {filtered.length === 0 ? (
          <EmptyHint>
            {handovers.length === 0
              ? "Noch keine Schlüssel ausgegeben."
              : "Keine Protokolle passen zu den Filtern."}
          </EmptyHint>
        ) : (
          <div className="space-y-2">
            {filtered.map((h) => {
              const overdue = isOverdue(
                { dueAt: h.dueAt ? new Date(h.dueAt) : null, status: h.status },
                now,
              );
              const openItems = h.items.filter((i) => i.itemStatus === "ISSUED");
              const signature = h.signatures[0] ?? null;
              const signed = signature?.signedAt != null;

              return (
                <div
                  key={h.id}
                  className={cn(
                    "rounded-md border p-3",
                    overdue
                      ? "border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/10"
                      : "border-slate-200 dark:border-slate-700",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {h.holderName}
                        </span>
                        <HandoverStatusBadge status={h.status} />
                        {signed && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                            title={`Signiert von ${signature!.signedName} am ${fmtDateTime(signature!.signedAt)}`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            signiert
                          </span>
                        )}
                        {overdue && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600">
                            <AlertTriangle className="h-3 w-3" />
                            überfällig seit {fmtDate(h.dueAt)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Protokoll #{h.id} · ausgegeben {fmtDate(h.issuedAt)}
                        {h.issuedByName ? ` von ${h.issuedByName}` : ""}
                        {h.dueAt && !overdue ? ` · Rückgabe bis ${fmtDate(h.dueAt)}` : ""}
                        {h.deposit != null ? ` · Pfand ${h.deposit.toFixed(2)} EUR` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.items.map((item) => (
                          <span
                            key={item.id}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]",
                              item.itemStatus === "RETURNED"
                                ? "bg-emerald-100 text-emerald-700 line-through dark:bg-emerald-950/30 dark:text-emerald-300"
                                : item.itemStatus === "LOST"
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
                            )}
                            title={item.keyLabel ?? undefined}
                          >
                            {item.keyNumber}
                          </span>
                        ))}
                      </div>
                      {h.notes && <p className="mt-1 text-[11px] text-slate-400">{h.notes}</p>}
                    </div>

                    {!readonly && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {signed ? (
                          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                            <a
                              href={`/api/schliessanlage/signatures/${signature!.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FileDown className="mr-1 h-3 w-3" />
                              PDF
                            </a>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSignatureFor(h)}
                            className="h-7 text-xs"
                          >
                            <QrCode className="mr-1 h-3 w-3" />
                            Signieren
                          </Button>
                        )}
                        {openItems.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setReturnFor(h)}
                            className="h-7 text-xs"
                          >
                            <ArrowLeftCircle className="mr-1 h-3 w-3" />
                            Rücknahme ({openItems.length})
                          </Button>
                        )}
                        {!signed && (
                          <button
                            type="button"
                            onClick={() => remove(h)}
                            className="p-1 text-slate-400 hover:text-rose-500"
                            title="Protokoll löschen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {createOpen && (
        <HandoverDialog
          keys={keys}
          holders={holders}
          employees={employees}
          policies={policies}
          open
          onClose={() => setCreateOpen(false)}
        />
      )}
      {returnFor && (
        <ReturnDialog handover={returnFor} open onClose={() => setReturnFor(null)} />
      )}
      {signatureFor && (
        <SignatureDialog handover={signatureFor} open onClose={() => setSignatureFor(null)} />
      )}
    </Card>
  );
}
