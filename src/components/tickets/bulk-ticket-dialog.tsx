"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  Loader2,
  Minus,
  Plus,
  Printer,
  CheckCircle2,
  ListPlus,
  AlertTriangle,
  Download,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  printTicketsBulk,
  type PrintableTicket,
  type PrintResult,
  type PrintMode,
} from "@/lib/print-tickets";
import { Scissors } from "lucide-react";

interface Area {
  id: number;
  name: string;
}

interface DefaultValidity {
  defaultValidityType?: string | null;
  defaultStartDate?: string | Date | null;
  defaultEndDate?: string | Date | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
}

interface Sub extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
}

interface Svc extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
  /** Hauptressource des Service. Wenn gesetzt, wird sie als
   *  `Ticket.accessAreaId` vorbelegt - die anderen `serviceAreas` sind
   *  Transit/Nebenressourcen. */
  mainAccessAreaId?: number | null;
}

interface BulkTicketDialogProps {
  areas: Area[];
  subscriptions?: Sub[];
  services?: Svc[];
  accountName?: string | null;
}

const QUICK_COUNTS = [5, 10, 20, 50];
const MAX_COUNT = 100;

export function BulkTicketDialog({
  areas,
  subscriptions = [],
  services = [],
  accountName,
}: BulkTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number>(10);
  const [namePrefix, setNamePrefix] = useState<string>("Tagesgast");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<"service" | "subscription" | null>(null);
  const [areaId, setAreaId] = useState<string>("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);
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

  const allOptions = useMemo(
    () => [
      ...services.map((s) => ({ id: String(s.id), name: s.name, type: "service" as const, data: s })),
      ...subscriptions.map((s) => ({ id: String(s.id), name: s.name, type: "subscription" as const, data: s })),
    ],
    [services, subscriptions],
  );

  function reset() {
    setCount(10);
    setNamePrefix("Tagesgast");
    setSelectedId(null);
    setSelectedType(null);
    setAreaId("none");
    setError("");
    setDoneCount(null);
    setPrintResult(null);
  }

  function clampCount(n: number): number {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_COUNT, Math.round(n)));
  }

  async function handleSubmit(opts: { print: boolean }) {
    if (!namePrefix.trim()) {
      setError("Bitte einen Namens-Praefix angeben.");
      return;
    }
    setLoading(true);
    setError("");
    setDoneCount(null);
    setPrintResult(null);

    const payload: Record<string, unknown> = {
      count,
      namePrefix: namePrefix.trim(),
    };

    const selected = allOptions.find((o) => o.id === selectedId && o.type === selectedType);
    if (selected) {
      if (selected.type === "service") {
        payload.serviceId = Number(selected.id);
        payload.ticketTypeName = selected.name;
      } else {
        payload.subscriptionId = Number(selected.id);
        payload.ticketTypeName = selected.name;
      }

      const def = selected.data as DefaultValidity;
      if (def.defaultValidityType) {
        payload.validityType = def.defaultValidityType;
        if (def.defaultValidityType === "DATE_RANGE") {
          if (def.defaultStartDate) payload.startDate = new Date(def.defaultStartDate).toISOString();
          if (def.defaultEndDate) payload.endDate = new Date(def.defaultEndDate).toISOString();
        } else if (def.defaultValidityType === "TIME_SLOT") {
          if (def.defaultSlotStart) payload.slotStart = def.defaultSlotStart;
          if (def.defaultSlotEnd) payload.slotEnd = def.defaultSlotEnd;
        } else if (def.defaultValidityType === "DURATION" && def.defaultValidityDurationMinutes != null) {
          payload.validityDurationMinutes = def.defaultValidityDurationMinutes;
        }
      }

      // Hauptressource:
      //   * Service: bevorzugt `Service.mainAccessAreaId` (vom Admin
      //     konfiguriert). Bei genau einer ServiceArea ist sie automatisch
      //     die Hauptressource - hier zaehlt der konfigurierte Wert oder
      //     diese eine Area. Wenn der Service mehrere Areas hat und keine
      //     Hauptressource konfiguriert ist, MUSS der User unten explizit
      //     waehlen (`needsExplicitMainArea`).
      //   * Subscription: erste Area als Default (legacy).
      const areaIds = selected.data.areaIds ?? [];
      if (selected.type === "service") {
        const svc = selected.data as Svc;
        if (svc.mainAccessAreaId != null) {
          payload.accessAreaId = svc.mainAccessAreaId;
        } else if (areaIds.length === 1) {
          payload.accessAreaId = areaIds[0];
        }
      } else if (areaIds.length > 0) {
        payload.accessAreaId = areaIds[0];
      }
    }

    if (areaId !== "none") {
      payload.accessAreaId = Number(areaId);
    }

    try {
      const res = await fetch("/api/tickets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data?.error?.formErrors?.[0] ??
            (typeof data?.error === "string" ? data.error : null) ??
            "Fehler beim Erstellen der Tickets",
        );
        setLoading(false);
        return;
      }

      const data = (await res.json()) as { tickets: PrintableTicket[] };
      const tickets = data.tickets ?? [];
      setDoneCount(tickets.length);

      if (opts.print && tickets.length > 0) {
        const mode: PrintMode = cutPerTicket ? "perTicket" : "combined";
        try {
          const result = await printTicketsBulk(
            tickets,
            accountName ?? "EMP Access",
            { mode },
          );
          setPrintResult(result);
        } catch (e) {
          setPrintResult({
            ok: false,
            transport: "iframe",
            error: e instanceof Error ? e.message : "Druckfehler",
          });
        }
      }

      router.refresh();
    } catch {
      setError("Netzwerkfehler beim Erstellen der Tickets.");
    } finally {
      setLoading(false);
    }
  }

  const selectedOpt = allOptions.find((o) => o.id === selectedId && o.type === selectedType);

  // Bei Service-Tickets schraenken wir die Bereichs-Auswahl auf die zum
  // Service gehoerenden Ressourcen ein (das sind die einzigen, die fuer
  // dieses Ticket Sinn als Hauptressource ergeben). Bei Subscription /
  // ohne Auswahl bleiben alle Bereiche sichtbar.
  const isService = selectedOpt?.type === "service";
  const serviceAreaIds = isService ? selectedOpt!.data.areaIds ?? [] : [];
  const visibleAreas = isService && serviceAreaIds.length > 0
    ? areas.filter((a) => serviceAreaIds.includes(a.id))
    : areas;
  const serviceMainConfigured =
    isService && (selectedOpt!.data as Svc).mainAccessAreaId != null;
  const needsExplicitMainArea =
    isService
    && serviceAreaIds.length > 1
    && !serviceMainConfigured
    && areaId === "none";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Layers className="h-4 w-4" />
          <span className="hidden xs:inline">Bulk &amp; Drucken</span>
          <span className="xs:hidden">Bulk</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            Tickets bulk erstellen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-count">Anzahl</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setCount((c) => clampCount(c - 1))}
                disabled={loading || count <= 1}
                aria-label="Anzahl verringern"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id="bulk-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={(e) => setCount(clampCount(Number(e.target.value)))}
                className="text-center font-semibold tabular-nums text-base h-9"
                disabled={loading}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setCount((c) => clampCount(c + 1))}
                disabled={loading || count >= MAX_COUNT}
                aria-label="Anzahl erhoehen"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  disabled={loading}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                    count === n
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">Max. {MAX_COUNT} Tickets pro Bulk.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-prefix">Namens-Praefix</Label>
            <Input
              id="bulk-prefix"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              placeholder="Tagesgast"
              disabled={loading}
            />
            <p className="text-xs text-slate-400">
              Wird durchnummeriert: <span className="font-mono">{namePrefix.trim() || "Ticket"} 1</span>,{" "}
              <span className="font-mono">{namePrefix.trim() || "Ticket"} 2</span> …
            </p>
          </div>

          {allOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Ticket-Typ <span className="text-slate-400 font-normal">(optional)</span></Label>
              <div className="flex flex-wrap gap-2">
                {allOptions.map((opt) => (
                  <button
                    key={`${opt.type}-${opt.id}`}
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (selectedId === opt.id && selectedType === opt.type) {
                        setSelectedId(null);
                        setSelectedType(null);
                        setAreaId("none");
                      } else {
                        setSelectedId(opt.id);
                        setSelectedType(opt.type);
                        // Beim Wechsel des Ticket-Typs die Hauptressourcen-
                        // Auswahl resetten, damit kein veralteter (nicht zum
                        // neuen Service gehoerender) Bereich haengen bleibt.
                        setAreaId("none");
                      }
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                      selectedId === opt.id && selectedType === opt.type
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600",
                    )}
                  >
                    {opt.name}
                  </button>
                ))}
              </div>
              {selectedOpt && (
                <p className="text-xs text-slate-400">
                  Gueltigkeits-Defaults werden uebernommen.
                </p>
              )}
            </div>
          )}

          {visibleAreas.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-area">
                {isService ? "Hauptressource" : "Bereich"}{" "}
                <span className="text-slate-400 font-normal">
                  {isService && serviceAreaIds.length > 1 ? "(empfohlen)" : "(optional)"}
                </span>
              </Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={loading}>
                <SelectTrigger
                  id="bulk-area"
                  className={cn(
                    "h-9 text-sm",
                    needsExplicitMainArea
                      ? "border-amber-400 dark:border-amber-600"
                      : "",
                  )}
                >
                  <SelectValue placeholder={isService ? "Hauptressource waehlen" : "Kein Bereich"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {isService ? "Keine Hauptressource" : "Kein Bereich"}
                  </SelectItem>
                  {visibleAreas.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isService && (
                <p
                  className={cn(
                    "text-[11px]",
                    needsExplicitMainArea
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-slate-400",
                  )}
                >
                  Hier startet die Zeitg&uuml;ltigkeit (DURATION) und wird das Ticket
                  als eingel&ouml;st markiert. Scans an anderen Ressourcen lassen den
                  Gast nur durch, ohne die Stunde anzuziehen.
                  {needsExplicitMainArea && " Ohne Auswahl startet die Stunde an JEDEM Gate."}
                </p>
              )}
            </div>
          )}

          <label
            htmlFor="bulk-cut-mode"
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
              cutPerTicket
                ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30"
                : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40",
            )}
          >
            <input
              id="bulk-cut-mode"
              type="checkbox"
              checked={cutPerTicket}
              onChange={(e) => toggleCutPerTicket(e.target.checked)}
              disabled={loading}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Scissors className="h-3.5 w-3.5 text-indigo-600" />
                Nach jedem Ticket schneiden
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Druckt jeden Bon als eigenen Druckjob – der Bondrucker schneidet
                garantiert dazwischen. Achtung: der Druckdialog kann pro Bon
                erscheinen.
              </p>
            </div>
          </label>

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {doneCount != null && !error && !printResult && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {doneCount} Tickets erstellt.
            </p>
          )}

          {doneCount != null && printResult && (
            <div className="space-y-2">
              {printResult.ok && printResult.transport === "iframe" && (
                <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {doneCount} Tickets erstellt. Druckdialog wurde geöffnet.
                </p>
              )}

              {printResult.ok && printResult.transport === "newTab" && (
                <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg space-y-1">
                  <p className="flex items-center gap-2 font-medium">
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    {doneCount} Tickets erstellt. PDF wurde im neuen Tab geöffnet.
                  </p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                    Drucken funktioniert über Strg/⌘+P im neuen Tab. Direkter Druckdialog war nicht möglich
                    {printResult.error ? ` (${printResult.error})` : ""}.
                  </p>
                </div>
              )}

              {!printResult.ok && printResult.transport === "download" && (
                <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg space-y-2">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {doneCount} Tickets erstellt. Druck konnte nicht direkt gestartet werden.
                  </p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                    Das PDF wurde stattdessen heruntergeladen
                    {printResult.error ? ` (${printResult.error})` : ""}. Öffne es manuell und drucke es aus dem
                    Reader (z. B. Adobe oder Vorschau) – dort kannst du auch das richtige Druckerprofil
                    auswählen.
                  </p>
                  {printResult.fallbackUrl && printResult.fallbackFilename && (
                    <a
                      href={printResult.fallbackUrl}
                      download={printResult.fallbackFilename}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 underline underline-offset-2 hover:text-amber-900"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF erneut herunterladen
                    </a>
                  )}
                </div>
              )}

              {!printResult.ok && printResult.transport !== "download" && (
                <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Druck fehlgeschlagen{printResult.error ? `: ${printResult.error}` : ""}.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Schliessen
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSubmit({ print: false })}
              disabled={loading || !namePrefix.trim()}
              className="gap-1.5"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
              Nur erstellen
            </Button>
            <Button
              type="button"
              onClick={() => handleSubmit({ print: true })}
              disabled={loading || !namePrefix.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 min-w-44"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {loading ? "Erstelle…" : `${count} erstellen & drucken`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
