"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  History,
  Printer,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  ExternalLink,
  Layers,
  Inbox,
  Scissors,
  Radio,
} from "lucide-react";
import {
  printTicketsBulk,
  type PrintableTicket,
  type PrintResult,
  type PrintMode,
} from "@/lib/print-tickets";

interface BulkOverview {
  id: string;
  count: number;
  createdAt: string | null;
  lastCreatedAt: string | null;
  namePrefix: string | null;
  ticketTypeName: string | null;
  serviceId: number | null;
  serviceName: string | null;
  subscriptionId: number | null;
  subscriptionName: string | null;
  accessAreaId: number | null;
  accessAreaName: string | null;
  startDate: string | null;
  endDate: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  statusCounts: Record<string, number>;
  /** "PRINT" = Bondrucker-Bulk, "RFID" = Bändchen-Bulk, "MIXED" = Mischform. */
  kind?: "PRINT" | "RFID" | "MIXED";
}

type BulkFilter = "PRINT" | "RFID";

interface BulkHistoryDialogProps {
  accountName?: string | null;
}

// Status als Badge-Variante in der festen Zustandsfarbe (wie in der Tickettabelle).
type StatusTone = "success" | "info" | "neutral" | "danger" | "warning";

const STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  VALID: {
    label: "Gültig",
    tone: "success",
  },
  REDEEMED: {
    label: "Eingelöst",
    tone: "info",
  },
  EXPIRED: {
    label: "Abgelaufen",
    tone: "neutral",
  },
  CANCELED: {
    label: "Storniert",
    tone: "danger",
  },
  PAUSED: {
    label: "Pausiert",
    tone: "warning",
  },
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function describeValidity(b: BulkOverview): string {
  if (b.validityType === "TIME_SLOT" && b.slotStart && b.slotEnd) {
    return `${b.slotStart}–${b.slotEnd} Uhr`;
  }
  if (b.validityType === "DURATION" && b.validityDurationMinutes) {
    const mins = b.validityDurationMinutes;
    return mins >= 60
      ? `${Math.round((mins / 60) * 10) / 10} h ab Erstscan`
      : `${mins} Min. ab Erstscan`;
  }
  if (b.startDate && b.endDate) {
    const s = fmtDate(b.startDate);
    const e = fmtDate(b.endDate);
    return s === e ? s : `${s} – ${e}`;
  }
  if (b.startDate) return fmtDate(b.startDate);
  if (b.endDate) return fmtDate(b.endDate);
  return "Keine Gültigkeit";
}

export function BulkHistoryDialog({ accountName }: BulkHistoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [bulks, setBulks] = useState<BulkOverview[]>([]);
  const [filter, setFilter] = useState<BulkFilter>("PRINT");
  const [reprinting, setReprinting] = useState<string | null>(null);
  const [printResult, setPrintResult] = useState<{
    bulkId: string;
    result: PrintResult;
  } | null>(null);
  const [cutPerTicket, setCutPerTicket] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("bulk-cut-per-ticket") === "1";
  });

  function toggleCutPerTicket(v: boolean) {
    setCutPerTicket(v);
    if (typeof window !== "undefined") {
      localStorage.setItem("bulk-cut-per-ticket", v ? "1" : "0");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/tickets/bulk", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { bulks: BulkOverview[] };
        if (!cancelled) setBulks(data.bulks ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fehler beim Laden der Bulks.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleReprint(bulk: BulkOverview) {
    setReprinting(bulk.id);
    setPrintResult(null);
    try {
      const res = await fetch(`/api/tickets/bulk/${encodeURIComponent(bulk.id)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
        setPrintResult({
          bulkId: bulk.id,
          result: { ok: false, transport: "iframe", error: msg },
        });
        return;
      }
      const data = (await res.json()) as { tickets: PrintableTicket[] };
      const tickets = data.tickets ?? [];
      if (tickets.length === 0) {
        setPrintResult({
          bulkId: bulk.id,
          result: { ok: false, transport: "iframe", error: "Keine Tickets in diesem Bulk." },
        });
        return;
      }
      const mode: PrintMode = cutPerTicket ? "perTicket" : "combined";
      const result = await printTicketsBulk(
        tickets,
        accountName ?? "EMP Access",
        { mode },
      );
      setPrintResult({ bulkId: bulk.id, result });
    } catch (e) {
      setPrintResult({
        bulkId: bulk.id,
        result: {
          ok: false,
          transport: "iframe",
          error: e instanceof Error ? e.message : "Druckfehler",
        },
      });
    } finally {
      setReprinting(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setPrintResult(null);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <History className="h-4 w-4" />
          <span className="hidden xs:inline">Bulk-Verlauf</span>
          <span className="xs:hidden">Verlauf</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Bulk-Verlauf
          </DialogTitle>
          <DialogDescription>
            Übersicht aller per Bulk erstellten Tickets. Bondrucker-Bulks
            lassen sich erneut ausdrucken (z. B. wenn der Drucker einen Bon
            verschluckt hat). RFID-Bulks werden separat gelistet.
          </DialogDescription>
        </DialogHeader>

        {(() => {
          const printBulks = bulks.filter((b) => (b.kind ?? "PRINT") !== "RFID");
          const rfidBulks = bulks.filter((b) => b.kind === "RFID");
          const visibleBulks = filter === "PRINT" ? printBulks : rfidBulks;
          const isRfidView = filter === "RFID";

          return (
            <>
              {!loading && !error && bulks.length > 0 && (
                // Filter derselben Liste, kein eigener Inhaltsbereich: Segmentwahl statt Reiter.
                <Segmented
                  aria-label="Bulk-Art"
                  stretch
                  value={filter}
                  onValueChange={setFilter}
                  className="mt-2"
                  options={[
                    {
                      value: "PRINT",
                      label: <><Printer className="h-3.5 w-3.5" />Druck-Bulks</>,
                      count: printBulks.length,
                    },
                    {
                      value: "RFID",
                      label: <><Radio className="h-3.5 w-3.5" />RFID-Bulks</>,
                      count: rfidBulks.length,
                    },
                  ]}
                />
              )}

              <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin -mx-5 px-5 sm:-mx-6 sm:px-6 mt-2">
                {loading && (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Lade Bulks…
                  </div>
                )}

                {!loading && error && (
                  <Notice tone="danger" compact title={error} />
                )}

                {!loading && !error && bulks.length === 0 && (
                  <EmptyState
                    icon={Inbox}
                    title="Noch keine Bulks erstellt."
                    description={"Sobald du über \"Bulk & Drucken\" oder \"Bändchen-Bulk\" mehrere Tickets auf einmal erstellst, erscheinen sie hier."}
                  />
                )}

                {!loading && !error && bulks.length > 0 && visibleBulks.length === 0 && (
                  <EmptyState
                    compact
                    icon={Inbox}
                    title={
                      isRfidView
                        ? "Noch keine RFID-Bulks erstellt."
                        : "Noch keine Druck-Bulks erstellt."
                    }
                  />
                )}

                {!loading && !error && !isRfidView && visibleBulks.length > 0 && (
                  // Häkchen aus dem Baustein, Beschriftung daneben; ein Tipp auf die
                  // Beschriftung schaltet das Häkchen mit.
                  <div className="glass-tile mb-3 flex items-center gap-3 px-3 py-2.5">
                    <Checkbox
                      id="reprint-cut-mode"
                      checked={cutPerTicket}
                      onCheckedChange={(v) => toggleCutPerTicket(v === true)}
                    />
                    <Label
                      htmlFor="reprint-cut-mode"
                      className="flex-1 min-w-0 gap-1.5 cursor-pointer text-xs leading-snug text-foreground/90"
                    >
                      <Scissors className="h-3 w-3 shrink-0 text-muted-foreground" />
                      Nach jedem Ticket schneiden (eigener Druckjob pro Bon)
                    </Label>
                  </div>
                )}
                {!loading && !error && visibleBulks.length > 0 && (
            <ul className="space-y-3 pb-2">
              {visibleBulks.map((b) => {
                const valid = b.statusCounts.VALID ?? 0;
                const redeemed = b.statusCounts.REDEEMED ?? 0;
                const otherStatuses = Object.entries(b.statusCounts).filter(
                  ([k]) => k !== "VALID" && k !== "REDEEMED",
                );
                const isRfid = b.kind === "RFID";
                const isReprinting = reprinting === b.id;
                const result = printResult?.bulkId === b.id ? printResult.result : null;
                const subline = b.subscriptionName
                  ? `Abo · ${b.subscriptionName}`
                  : b.serviceName
                    ? `Service · ${b.serviceName}`
                    : b.ticketTypeName ?? "Ohne Typ";

                return (
                  <li
                    key={b.id}
                    className="glass-tile p-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">
                            {b.namePrefix ?? "Tickets"}
                          </span>
                          <Badge variant="secondary" className="tabular-nums">
                            {b.count}× {isRfid ? "Bändchen" : "Tickets"}
                          </Badge>
                          {isRfid && (
                            <Badge variant="neutral" className="font-normal">
                              <Radio />
                              RFID-Bulk
                            </Badge>
                          )}
                          {b.accessAreaName && (
                            <Badge variant="outline" className="font-normal">
                              {b.accessAreaName}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {subline}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {describeValidity(b)}
                        </p>
                        <p className="text-[11px] text-muted-foreground tabular-nums mt-1">
                          Erstellt {fmtDateTime(b.createdAt)}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {valid > 0 && (
                            <Badge variant={STATUS_LABELS.VALID.tone} className="tabular-nums">
                              {valid} {STATUS_LABELS.VALID.label}
                            </Badge>
                          )}
                          {redeemed > 0 && (
                            <Badge variant={STATUS_LABELS.REDEEMED.tone} className="tabular-nums">
                              {redeemed} {STATUS_LABELS.REDEEMED.label}
                            </Badge>
                          )}
                          {otherStatuses.map(([k, n]) => {
                            const meta = STATUS_LABELS[k] ?? {
                              label: k,
                              tone: "neutral" as StatusTone,
                            };
                            return (
                              <Badge key={k} variant={meta.tone} className="tabular-nums">
                                {n} {meta.label}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-col items-stretch sm:items-end gap-2 sm:min-w-44">
                        {isRfid ? (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 sm:justify-end">
                            <Radio className="h-3.5 w-3.5" />
                            Kein Druck – RFID-Bändchen
                          </p>
                        ) : (
                          // Auf dem Handy volle Breite mit 44 px Tippfläche. Eine Taste je
                          // Eintrag, daher keine Primärtaste.
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleReprint(b)}
                            disabled={isReprinting}
                            className="gap-1.5 max-sm:h-11"
                          >
                            {isReprinting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Printer className="h-4 w-4" />
                            )}
                            {isReprinting ? "Drucke…" : "Erneut drucken"}
                          </Button>
                        )}

                        {result && (
                          <div className="text-xs">
                            {result.ok && result.transport === "iframe" && (
                              <p className="text-success flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Druckdialog geöffnet.
                              </p>
                            )}
                            {result.ok && result.transport === "newTab" && (
                              <p className="text-warning flex items-center gap-1.5">
                                <ExternalLink className="h-3.5 w-3.5" />
                                Im neuen Tab geöffnet.
                              </p>
                            )}
                            {!result.ok && result.transport === "download" && (
                              <div className="text-warning space-y-1">
                                <p className="flex items-center gap-1.5">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  PDF wurde heruntergeladen.
                                </p>
                                {result.fallbackUrl && result.fallbackFilename && (
                                  <a
                                    href={result.fallbackUrl}
                                    download={result.fallbackFilename}
                                    className="inline-flex items-center gap-1 underline underline-offset-2"
                                  >
                                    <Download className="h-3 w-3" />
                                    Erneut speichern
                                  </a>
                                )}
                              </div>
                            )}
                            {!result.ok && result.transport !== "download" && (
                              <p className="text-destructive flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {result.error ?? "Druck fehlgeschlagen"}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
                )}
              </div>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
