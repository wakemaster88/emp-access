"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";
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

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  VALID: {
    label: "Gültig",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
  },
  REDEEMED: {
    label: "Eingelöst",
    tone: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900",
  },
  EXPIRED: {
    label: "Abgelaufen",
    tone: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
  CANCELED: {
    label: "Storniert",
    tone: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900",
  },
  PAUSED: {
    label: "Pausiert",
    tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
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
        <Button variant="outline" size="sm" className="gap-1.5">
          <History className="h-4 w-4" />
          <span className="hidden xs:inline">Bulk-Verlauf</span>
          <span className="xs:hidden">Verlauf</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            Bulk-Verlauf
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
            Übersicht aller per Bulk erstellten Tickets. Bondrucker-Bulks
            lassen sich erneut ausdrucken (z. B. wenn der Drucker einen Bon
            verschluckt hat). RFID-Bulks werden separat gelistet.
          </p>
        </DialogHeader>

        {(() => {
          const printBulks = bulks.filter((b) => (b.kind ?? "PRINT") !== "RFID");
          const rfidBulks = bulks.filter((b) => b.kind === "RFID");
          const visibleBulks = filter === "PRINT" ? printBulks : rfidBulks;
          const isRfidView = filter === "RFID";

          return (
            <>
              {!loading && !error && bulks.length > 0 && (
                <Tabs
                  value={filter}
                  onValueChange={(v) => setFilter(v as BulkFilter)}
                  className="mt-2"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="PRINT" className="gap-1.5">
                      <Printer className="h-3.5 w-3.5" />
                      Druck-Bulks
                      <Badge
                        variant="secondary"
                        className="ml-1 px-1.5 h-5 text-[10px] font-normal"
                      >
                        {printBulks.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="RFID" className="gap-1.5">
                      <Radio className="h-3.5 w-3.5" />
                      RFID-Bulks
                      <Badge
                        variant="secondary"
                        className="ml-1 px-1.5 h-5 text-[10px] font-normal"
                      >
                        {rfidBulks.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}

              <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-2">
                {loading && (
                  <div className="flex items-center justify-center py-12 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Lade Bulks…
                  </div>
                )}

                {!loading && error && (
                  <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}

                {!loading && !error && bulks.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                    <Inbox className="h-10 w-10 mb-3 text-slate-400" />
                    <p className="text-sm font-medium">Noch keine Bulks erstellt.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Sobald du über &quot;Bulk &amp; Drucken&quot; oder
                      &quot;Bändchen-Bulk&quot; mehrere Tickets auf einmal
                      erstellst, erscheinen sie hier.
                    </p>
                  </div>
                )}

                {!loading && !error && bulks.length > 0 && visibleBulks.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-center text-slate-500">
                    <Inbox className="h-8 w-8 mb-2 text-slate-400" />
                    <p className="text-sm font-medium">
                      {isRfidView
                        ? "Noch keine RFID-Bulks erstellt."
                        : "Noch keine Druck-Bulks erstellt."}
                    </p>
                  </div>
                )}

                {!loading && !error && !isRfidView && visibleBulks.length > 0 && (
                  <label
                    htmlFor="reprint-cut-mode"
                    className={cn(
                      "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors text-xs",
                      cutPerTicket
                        ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30"
                        : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40",
                    )}
                  >
                    <input
                      id="reprint-cut-mode"
                      type="checkbox"
                      checked={cutPerTicket}
                      onChange={(e) => toggleCutPerTicket(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-indigo-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <Scissors className="h-3 w-3 text-indigo-600" />
                        Nach jedem Ticket schneiden (eigener Druckjob pro Bon)
                      </p>
                    </div>
                  </label>
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
                    className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-white dark:bg-slate-900/40 hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {b.namePrefix ?? "Tickets"}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              isRfid
                                ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900"
                                : "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
                            )}
                          >
                            {b.count}× {isRfid ? "Bändchen" : "Tickets"}
                          </Badge>
                          {isRfid && (
                            <Badge
                              variant="outline"
                              className="gap-1 font-normal border-violet-200 text-violet-700 dark:border-violet-900 dark:text-violet-300"
                            >
                              <Radio className="h-3 w-3" />
                              RFID-Bulk
                            </Badge>
                          )}
                          {b.accessAreaName && (
                            <Badge variant="outline" className="font-normal">
                              {b.accessAreaName}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                          {subline}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {describeValidity(b)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Erstellt {fmtDateTime(b.createdAt)}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {valid > 0 && (
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[11px] border",
                                STATUS_LABELS.VALID.tone,
                              )}
                            >
                              {valid} {STATUS_LABELS.VALID.label}
                            </span>
                          )}
                          {redeemed > 0 && (
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[11px] border",
                                STATUS_LABELS.REDEEMED.tone,
                              )}
                            >
                              {redeemed} {STATUS_LABELS.REDEEMED.label}
                            </span>
                          )}
                          {otherStatuses.map(([k, n]) => {
                            const meta = STATUS_LABELS[k] ?? {
                              label: k,
                              tone: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
                            };
                            return (
                              <span
                                key={k}
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[11px] border",
                                  meta.tone,
                                )}
                              >
                                {n} {meta.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-col items-stretch sm:items-end gap-2 sm:min-w-44">
                        {isRfid ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 sm:justify-end">
                            <Radio className="h-3.5 w-3.5 text-violet-600" />
                            Kein Druck – RFID-Bändchen
                          </p>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleReprint(b)}
                            disabled={isReprinting}
                            className="bg-indigo-600 hover:bg-indigo-700 gap-1.5"
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
                              <p className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Druckdialog geöffnet.
                              </p>
                            )}
                            {result.ok && result.transport === "newTab" && (
                              <p className="text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                <ExternalLink className="h-3.5 w-3.5" />
                                Im neuen Tab geöffnet.
                              </p>
                            )}
                            {!result.ok && result.transport === "download" && (
                              <div className="text-amber-700 dark:text-amber-400 space-y-1">
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
                              <p className="text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
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
