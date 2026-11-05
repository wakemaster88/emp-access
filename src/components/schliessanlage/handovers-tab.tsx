"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftCircle,
  CheckCircle2,
  FileDown,
  FileSignature,
  Plus,
  QrCode,
  Search,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
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
  // Rückfrage vor dem Löschen (docs/design-regeln.md, Abschnitt 18); das Protokoll bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<HandoverRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  function askRemove(handover: HandoverRow) {
    setToDelete(handover);
    setConfirmOpen(true);
  }

  async function remove(handover: HandoverRow) {
    setError("");
    const res = await apiRequest(`/api/schliessanlage/handovers/${handover.id}`, "DELETE");
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="tabular-nums">
              {handovers.length} Protokolle
              {overdueCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-destructive">
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
              className="max-sm:h-11"
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
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Empfänger oder Schlüsselnummer suchen…"
              className="pl-8 max-sm:h-11"
            />
          </div>
          {/* Filter als Segmentwahl (docs/design-regeln.md, Abschnitt 14), aktive Wahl als helle Pille. */}
          <Segmented
            aria-label="Protokolle"
            value={onlyOpen ? "open" : "all"}
            onValueChange={(v) => setOnlyOpen(v === "open")}
            options={[
              { value: "all", label: "Alle" },
              { value: "open", label: "Nur offene" },
            ]}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyHint icon={FileSignature}>
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
                    "p-3",
                    // Überfällig: Kachel in Störungsfarbe statt Glas (wie Notice tone="danger").
                    overdue
                      ? "rounded-tile border border-destructive/45 bg-gradient-to-br from-destructive/14 to-destructive/[0.03]"
                      : "glass-tile",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">
                          {h.holderName}
                        </span>
                        <HandoverStatusBadge status={h.status} />
                        {signed && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-success"
                            title={`Signiert von ${signature!.signedName} am ${fmtDateTime(signature!.signedAt)}`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            signiert
                          </span>
                        )}
                        {overdue && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            überfällig seit {fmtDate(h.dueAt)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                        Protokoll #{h.id} · ausgegeben {fmtDate(h.issuedAt)}
                        {h.issuedByName ? ` von ${h.issuedByName}` : ""}
                        {h.dueAt && !overdue ? ` · Rückgabe bis ${fmtDate(h.dueAt)}` : ""}
                        {h.deposit != null ? ` · Pfand ${h.deposit.toFixed(2)} EUR` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.items.map((item) => (
                          <Badge
                            key={item.id}
                            variant={
                              item.itemStatus === "RETURNED"
                                ? "success"
                                : item.itemStatus === "LOST"
                                  ? "danger"
                                  : "warning"
                            }
                            className={cn(
                              "font-mono text-[11px] font-medium",
                              item.itemStatus === "RETURNED" && "line-through",
                            )}
                            title={item.keyLabel ?? undefined}
                          >
                            {item.keyNumber}
                          </Badge>
                        ))}
                      </div>
                      {h.notes && <p className="mt-1 text-[11px] text-muted-foreground">{h.notes}</p>}
                    </div>

                    {!readonly && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {signed ? (
                          <Button asChild size="sm" variant="outline" className="max-sm:h-11">
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
                            className="max-sm:h-11"
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
                            className="tabular-nums max-sm:h-11"
                          >
                            <ArrowLeftCircle className="mr-1 h-3 w-3" />
                            Rücknahme ({openItems.length})
                          </Button>
                        )}
                        {!signed && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => askRemove(h)}
                            className="text-muted-foreground hover:text-destructive max-sm:size-11"
                            title="Protokoll löschen"
                            aria-label="Protokoll löschen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Protokoll #${toDelete?.id} (${toDelete?.holderName}) wirklich löschen?`}</AlertDialogTitle>
            <AlertDialogDescription>Offene Schlüssel gehen zurück in den Bestand.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="max-sm:h-11"
              onClick={() => {
                if (toDelete) void remove(toDelete);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
