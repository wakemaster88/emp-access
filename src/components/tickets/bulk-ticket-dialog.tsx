"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Checkbox } from "@/components/ui/checkbox";
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

// Dialog auf dem Handy: Felder und Tasten 44 px hoch (docs/design-regeln.md, Abschnitt 16).
const FIELD = "h-11 sm:h-9";
const SELECT_FIELD = "w-full data-[size=default]:h-11 sm:data-[size=default]:h-9";

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
        <Button variant="outline" className="gap-1.5">
          <Layers className="h-4 w-4" />
          <span className="hidden xs:inline">Bulk &amp; Drucken</span>
          <span className="xs:hidden">Bulk</span>
        </Button>
      </DialogTrigger>

      {/* Breite wie der Dialog-Standard (lg): drei Tasten passen nebeneinander. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
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
                className="size-11 sm:size-9 shrink-0"
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
                className={cn("text-center font-semibold tabular-nums text-base", FIELD)}
                disabled={loading}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 sm:size-9 shrink-0"
                onClick={() => setCount((c) => clampCount(c + 1))}
                disabled={loading || count >= MAX_COUNT}
                aria-label="Anzahl erhoehen"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_COUNTS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={count === n ? "default" : "outline"}
                  aria-pressed={count === n}
                  onClick={() => setCount(n)}
                  disabled={loading}
                  className="min-w-11 rounded-full tabular-nums max-sm:h-9"
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Max. {MAX_COUNT} Tickets pro Bulk.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-prefix">Namens-Praefix</Label>
            <Input
              id="bulk-prefix"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              placeholder="Tagesgast"
              disabled={loading}
              className={FIELD}
            />
            <p className="text-xs text-muted-foreground">
              Wird durchnummeriert: <span className="font-mono">{namePrefix.trim() || "Ticket"} 1</span>,{" "}
              <span className="font-mono">{namePrefix.trim() || "Ticket"} 2</span> …
            </p>
          </div>

          {allOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Ticket-Typ <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="flex flex-wrap gap-2">
                {allOptions.map((opt) => (
                  <Button
                    key={`${opt.type}-${opt.id}`}
                    type="button"
                    size="sm"
                    variant={selectedId === opt.id && selectedType === opt.type ? "default" : "outline"}
                    aria-pressed={selectedId === opt.id && selectedType === opt.type}
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
                    className="rounded-full max-sm:h-9"
                  >
                    {opt.name}
                  </Button>
                ))}
              </div>
              {selectedOpt && (
                <p className="text-xs text-muted-foreground">
                  Gueltigkeits-Defaults werden uebernommen.
                </p>
              )}
            </div>
          )}

          {visibleAreas.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-area">
                {isService ? "Hauptressource" : "Bereich"}{" "}
                <span className="text-muted-foreground font-normal">
                  {isService && serviceAreaIds.length > 1 ? "(empfohlen)" : "(optional)"}
                </span>
              </Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={loading}>
                <SelectTrigger
                  id="bulk-area"
                  className={cn(
                    SELECT_FIELD,
                    needsExplicitMainArea
                      ? "border-warning"
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
                      ? "text-warning"
                      : "text-muted-foreground",
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

          {/* Häkchen aus dem Baustein wie im Bulk-Verlauf; Titel und Erklärung bilden die
              Beschriftung daneben, ein Tipp darauf schaltet das Häkchen mit. */}
          <div className="glass-tile flex items-start gap-3 px-3 py-2.5">
            <Checkbox
              id="bulk-cut-mode"
              checked={cutPerTicket}
              onCheckedChange={(v) => toggleCutPerTicket(v === true)}
              disabled={loading}
              className="mt-px"
            />
            <Label
              htmlFor="bulk-cut-mode"
              className="flex-1 min-w-0 flex-col items-start gap-0.5 cursor-pointer leading-snug"
            >
              <span className="flex items-center gap-1.5 text-foreground/90">
                <Scissors className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Nach jedem Ticket schneiden
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                Druckt jeden Bon als eigenen Druckjob – der Bondrucker schneidet
                garantiert dazwischen. Achtung: der Druckdialog kann pro Bon
                erscheinen.
              </span>
            </Label>
          </div>

          {error && (
            <Notice tone="danger" compact title={error} />
          )}

          {doneCount != null && !error && !printResult && (
            <Notice tone="success" compact icon={CheckCircle2} title={<>{doneCount} Tickets erstellt.</>} />
          )}

          {doneCount != null && printResult && (
            <div className="space-y-2">
              {printResult.ok && printResult.transport === "iframe" && (
                <Notice
                  tone="success"
                  compact
                  icon={CheckCircle2}
                  title={<>{doneCount} Tickets erstellt. Druckdialog wurde geöffnet.</>}
                />
              )}

              {printResult.ok && printResult.transport === "newTab" && (
                <Notice
                  tone="warning"
                  compact
                  icon={ExternalLink}
                  title={<>{doneCount} Tickets erstellt. PDF wurde im neuen Tab geöffnet.</>}
                >
                  <p>
                    Drucken funktioniert über Strg/⌘+P im neuen Tab. Direkter Druckdialog war nicht möglich
                    {printResult.error ? ` (${printResult.error})` : ""}.
                  </p>
                </Notice>
              )}

              {!printResult.ok && printResult.transport === "download" && (
                <Notice
                  tone="warning"
                  compact
                  icon={AlertTriangle}
                  title={<>{doneCount} Tickets erstellt. Druck konnte nicht direkt gestartet werden.</>}
                >
                  <p>
                    Das PDF wurde stattdessen heruntergeladen
                    {printResult.error ? ` (${printResult.error})` : ""}. Öffne es manuell und drucke es aus dem
                    Reader (z. B. Adobe oder Vorschau) – dort kannst du auch das richtige Druckerprofil
                    auswählen.
                  </p>
                  {printResult.fallbackUrl && printResult.fallbackFilename && (
                    <a
                      href={printResult.fallbackUrl}
                      download={printResult.fallbackFilename}
                      className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF erneut herunterladen
                    </a>
                  )}
                </Notice>
              )}

              {!printResult.ok && printResult.transport !== "download" && (
                <Notice
                  tone="danger"
                  compact
                  icon={AlertTriangle}
                  title={<>Druck fehlgeschlagen{printResult.error ? `: ${printResult.error}` : ""}.</>}
                />
              )}
            </div>
          )}

          <DialogFooter className="pt-2 sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className={FIELD}
            >
              Schliessen
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSubmit({ print: false })}
              disabled={loading || !namePrefix.trim()}
              className={cn("gap-1.5", FIELD)}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
              Nur erstellen
            </Button>
            <Button
              type="button"
              onClick={() => handleSubmit({ print: true })}
              disabled={loading || !namePrefix.trim()}
              className={cn("gap-1.5 min-w-44", FIELD)}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {loading ? "Erstelle…" : `${count} erstellen & drucken`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
