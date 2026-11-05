"use client";

/**
 * Vollbild-Overlay fuer die Bulk-Erstellung am Shop-/Checkin-Monitor.
 *
 * Zwei Betriebsarten, umschaltbar oben im Overlay:
 *  1) Bons – N Tickets mit generiertem Barcode, direkt auf den Bondrucker.
 *  2) Baendchen – ein Ticket je gescanntem RFID-Code, ohne Druck.
 *
 * Fachlich dasselbe wie die beiden Bulk-Dialoge im Dashboard, nur fuer die
 * Bedienung am Tresen: grosse Tap-Targets, dunkles Kiosk-Layout und ein
 * Scanfeld, das den Fokus nach jedem Baendchen von selbst zurueckholt.
 *
 * Datenlieferant ist /api/checkin/public/[token]/tickets/bulk – damit greift
 * dieselbe Tenant-Aufloesung ueber den Monitor-Token wie bei den anderen
 * Overlays.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eraser,
  ExternalLink,
  Layers,
  ListPlus,
  Loader2,
  Minus,
  Plus,
  Printer,
  Radio,
  ScanLine,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";
import {
  printTicketsBulk,
  type PrintableTicket,
  type PrintMode,
  type PrintResult,
} from "@/lib/print-tickets";

interface DefaultValidity {
  defaultValidityType?: string | null;
  defaultStartDate?: string | Date | null;
  defaultEndDate?: string | Date | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
}

interface ServiceOption extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
  mainAccessAreaId?: number | null;
}

interface SubOption extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
}

interface BulkOverlayProps {
  token: string;
  accountName: string;
  areas: { id: number; name: string }[];
  services: ServiceOption[];
  subscriptions: SubOption[];
  onClose: () => void;
  /** Nach erfolgreicher Erstellung: Tagesliste im Monitor nachladen. */
  onCreated: () => void;
}

type Mode = "print" | "rfid";

const QUICK_COUNTS = [5, 10, 20, 50];
const MAX_COUNT = 100;
const CUT_STORAGE_KEY = "checkin-bulk-cut-per-ticket";

export function BulkOverlay({
  token,
  accountName,
  areas,
  services,
  subscriptions,
  onClose,
  onCreated,
}: BulkOverlayProps) {
  const [mode, setMode] = useState<Mode>("print");
  const [count, setCount] = useState(10);
  const [namePrefix, setNamePrefix] = useState("Tagesgast");
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [duplicateFlash, setDuplicateFlash] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ type: "service" | "subscription"; id: number } | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  // Am Tresen ist Schneiden der Normalfall – ohne Trennung kommt die Serie als
  // ein langer Streifen raus. Nur ein ausdrueckliches Abwaehlen wird gemerkt.
  const [cutPerTicket, setCutPerTicket] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(CUT_STORAGE_KEY) !== "0";
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conflictCodes, setConflictCodes] = useState<string[]>([]);
  const [created, setCreated] = useState<PrintableTicket[] | null>(null);
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);
  const [reprinting, setReprinting] = useState(false);

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const codesListRef = useRef<HTMLDivElement | null>(null);

  // Im Baendchen-Modus muss der Fokus im Scanfeld liegen, sonst tippt der
  // USB-Reader ins Leere.
  useEffect(() => {
    if (mode !== "rfid") return;
    const t = setTimeout(() => scanInputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    if (codesListRef.current) {
      codesListRef.current.scrollTop = codesListRef.current.scrollHeight;
    }
  }, [scannedCodes.length]);

  const options = useMemo(
    () => [
      ...services.map((s) => ({ type: "service" as const, id: s.id, name: s.name, data: s as ServiceOption })),
      ...subscriptions.map((s) => ({ type: "subscription" as const, id: s.id, name: s.name, data: s as SubOption })),
    ],
    [services, subscriptions],
  );

  const selectedOpt = options.find((o) => o.type === selected?.type && o.id === selected?.id);
  const isService = selectedOpt?.type === "service";
  const serviceAreaIds = isService ? (selectedOpt.data.areaIds ?? []) : [];
  const visibleAreas =
    isService && serviceAreaIds.length > 0
      ? areas.filter((a) => serviceAreaIds.includes(a.id))
      : areas;
  // Bei mehreren Ressourcen ohne konfigurierte Hauptressource muss der
  // Verkaeufer waehlen – sonst startet die Zeitgueltigkeit an jedem Gate.
  const needsExplicitMainArea =
    isService
    && serviceAreaIds.length > 1
    && (selectedOpt.data as ServiceOption).mainAccessAreaId == null
    && areaId == null;

  function toggleCut(v: boolean) {
    setCutPerTicket(v);
    localStorage.setItem(CUT_STORAGE_KEY, v ? "1" : "0");
  }

  function clampCount(n: number): number {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_COUNT, Math.round(n)));
  }

  function resetResult() {
    setError("");
    setConflictCodes([]);
    setCreated(null);
    setPrintResult(null);
  }

  function addCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    if (scannedCodes.includes(code)) {
      // Duplikate sichtbar machen statt stumm zu schlucken – sonst haelt man
      // den Scan am Reader fuer fehlgeschlagen und zieht das Baendchen erneut.
      setDuplicateFlash(code);
      setTimeout(() => setDuplicateFlash((cur) => (cur === code ? null : cur)), 1500);
      return;
    }
    if (scannedCodes.length >= MAX_COUNT) {
      setError(`Maximal ${MAX_COUNT} Bändchen pro Durchgang.`);
      return;
    }
    setScannedCodes((cur) => [...cur, code]);
    resetResult();
  }

  function handleScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Reader schliessen den Scan meist mit Enter ab; Tab und Komma als
    // Fallback fuer abweichend konfigurierte Geraete.
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      const value = scanInput;
      setScanInput("");
      addCode(value);
      requestAnimationFrame(() => scanInputRef.current?.focus());
    }
  }

  const runPrint = useCallback(
    async (tickets: PrintableTicket[]) => {
      const printMode: PrintMode = cutPerTicket ? "perTicket" : "combined";
      try {
        return await printTicketsBulk(tickets, accountName || "EMP Access", { mode: printMode });
      } catch (e) {
        return {
          ok: false,
          transport: "iframe" as const,
          error: e instanceof Error ? e.message : "Druckfehler",
        };
      }
    },
    [accountName, cutPerTicket],
  );

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> =
      mode === "rfid"
        ? { rfidCodes: scannedCodes, namePrefix: namePrefix.trim() }
        : { count, namePrefix: namePrefix.trim() };

    if (selectedOpt) {
      if (selectedOpt.type === "service") payload.serviceId = selectedOpt.id;
      else payload.subscriptionId = selectedOpt.id;
      payload.ticketTypeName = selectedOpt.name;

      const def = selectedOpt.data;
      if (def.defaultValidityType) {
        payload.validityType = def.defaultValidityType;
        if (def.defaultValidityType === "DATE_RANGE") {
          if (def.defaultStartDate) payload.startDate = new Date(def.defaultStartDate).toISOString();
          if (def.defaultEndDate) payload.endDate = new Date(def.defaultEndDate).toISOString();
        } else if (def.defaultValidityType === "TIME_SLOT") {
          if (def.defaultSlotStart) payload.slotStart = def.defaultSlotStart;
          if (def.defaultSlotEnd) payload.slotEnd = def.defaultSlotEnd;
        } else if (
          def.defaultValidityType === "DURATION"
          && def.defaultValidityDurationMinutes != null
        ) {
          payload.validityDurationMinutes = def.defaultValidityDurationMinutes;
        }
      }
      // Kurszeit auch ohne TIME_SLOT-Validitaet uebernehmen - siehe
      // Ticket-Dialog: sonst fehlt der Serie die Uhrzeit und die Tickets
      // landen im Monitor unter "Ohne feste Uhrzeit".
      if (payload.slotStart == null && def.defaultSlotStart && def.defaultSlotEnd) {
        payload.slotStart = def.defaultSlotStart;
        payload.slotEnd = def.defaultSlotEnd;
      }

      const ids = selectedOpt.data.areaIds ?? [];
      if (selectedOpt.type === "service") {
        const main = (selectedOpt.data as ServiceOption).mainAccessAreaId;
        if (main != null) payload.accessAreaId = main;
        else if (ids.length === 1) payload.accessAreaId = ids[0];
      } else if (ids.length > 0) {
        payload.accessAreaId = ids[0];
      }
    }

    if (areaId != null) payload.accessAreaId = areaId;
    return payload;
  }

  async function handleSubmit(withPrint: boolean) {
    if (!namePrefix.trim()) {
      setError("Bitte einen Namens-Präfix angeben.");
      return;
    }
    if (mode === "rfid" && scannedCodes.length === 0) {
      setError("Bitte mindestens ein Bändchen einscannen.");
      return;
    }

    setLoading(true);
    resetResult();

    try {
      const res = await fetch(`/api/checkin/public/${token}/tickets/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = data?.error as
          | { formErrors?: string[]; code?: string; conflictCodes?: string[] }
          | string
          | undefined;
        if (typeof err === "string") {
          setError(err);
        } else {
          if (err?.code === "CODE_CONFLICT") setConflictCodes(err.conflictCodes ?? []);
          setError(err?.formErrors?.[0] ?? "Erstellung fehlgeschlagen.");
        }
        return;
      }

      const data = (await res.json()) as { tickets: PrintableTicket[] };
      const tickets = data.tickets ?? [];
      setCreated(tickets);
      if (mode === "rfid") setScannedCodes([]);
      onCreated();

      if (withPrint && tickets.length > 0) {
        setPrintResult(await runPrint(tickets));
      }
    } catch {
      setError("Netzwerkfehler bei der Erstellung.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReprint() {
    if (!created?.length) return;
    setReprinting(true);
    setPrintResult(await runPrint(created));
    setReprinting(false);
  }

  const busy = loading || reprinting;
  const submitDisabled =
    busy || !namePrefix.trim() || (mode === "rfid" && scannedCodes.length === 0);

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
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2 truncate text-foreground">
            <Layers className="h-5 w-5 text-primary shrink-0" />
            Serie erstellen
          </h2>
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={onClose}
            className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
            title="Schließen"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div
          className="flex-1 overflow-y-auto monitor-scrollbar p-4 sm:p-5 space-y-5"
          // Nach jedem Tipp auf einen Button (Ticket-Typ, Anzahl, …) den Fokus
          // zurueck ins Scanfeld holen – sonst tippt der Reader ins Nichts und
          // das naechste Baendchen geht verloren.
          onClick={(e) => {
            if (mode !== "rfid") return;
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
            requestAnimationFrame(() => scanInputRef.current?.focus());
          }}
        >
          {/* Betriebsart */}
          <div className="grid grid-cols-2 gap-2">
            <ModeButton
              active={mode === "print"}
              disabled={busy}
              icon={<Printer className="h-5 w-5" />}
              title="Bons drucken"
              subtitle="Mit Barcode"
              onClick={() => {
                setMode("print");
                resetResult();
                setNamePrefix((p) => (p === "Bändchen" ? "Tagesgast" : p));
              }}
            />
            <ModeButton
              active={mode === "rfid"}
              disabled={busy}
              icon={<Radio className="h-5 w-5" />}
              title="Bändchen scannen"
              subtitle="Ohne Druck"
              onClick={() => {
                setMode("rfid");
                resetResult();
                setNamePrefix((p) => (p === "Tagesgast" ? "Bändchen" : p));
              }}
            />
          </div>

          {mode === "print" ? (
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">Anzahl</label>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="icon-lg"
                  onClick={() => setCount((c) => clampCount(c - 1))}
                  disabled={busy || count <= 1}
                  className="size-14 rounded-tile"
                  aria-label="Anzahl verringern"
                >
                  <Minus className="size-6" />
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_COUNT}
                  value={count}
                  onChange={(e) => setCount(clampCount(Number(e.target.value)))}
                  disabled={busy}
                  className="flex-1 h-14 text-center text-2xl md:text-2xl font-bold tabular-nums"
                />
                <Button
                  variant="secondary"
                  size="icon-lg"
                  onClick={() => setCount((c) => clampCount(c + 1))}
                  disabled={busy || count >= MAX_COUNT}
                  className="size-14 rounded-tile"
                  aria-label="Anzahl erhöhen"
                >
                  <Plus className="size-6" />
                </Button>
              </div>
              {/* Schnellwahl als einzelne Tasten (44 px), nicht als Segmentwahl: die
                  Anzahl ist oft kein Vorgabewert, und jede Taste bleibt per Tab erreichbar. */}
              <div className="flex flex-wrap items-center gap-2">
                {QUICK_COUNTS.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={count === n ? "default" : "outline"}
                    aria-pressed={count === n}
                    onClick={() => setCount(n)}
                    disabled={busy}
                    className="h-11 min-w-14 px-5 font-semibold tabular-nums"
                  >
                    {n}
                  </Button>
                ))}
                <span className="self-center text-xs text-muted-foreground">max. {MAX_COUNT}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="bulk-scan" className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-muted-foreground" />
                Bändchen nacheinander scannen
              </label>
              <Input
                ref={scanInputRef}
                id="bulk-scan"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScanKeyDown}
                placeholder="RFID-Code …"
                autoComplete="off"
                disabled={busy}
                className={cn(
                  "h-14 px-4 font-mono text-lg md:text-lg",
                  duplicateFlash && "border-warning focus-visible:border-warning",
                )}
              />
              {duplicateFlash ? (
                <p className="text-xs text-warning flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-mono">{duplicateFlash}</span> wurde bereits gescannt.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Der Reader schließt jeden Scan selbst ab. Max. {MAX_COUNT} Bändchen.
                </p>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  Gescannt
                  <Badge variant="secondary" className="ml-2 font-bold tabular-nums">
                    {scannedCodes.length}
                  </Badge>
                </span>
                {scannedCodes.length > 0 && !busy && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setScannedCodes([])}
                    className="h-10 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Eraser className="size-3.5" />
                    Liste leeren
                  </Button>
                )}
              </div>

              <div
                ref={codesListRef}
                className="glass-tile p-2 max-h-52 overflow-y-auto monitor-scrollbar"
              >
                {scannedCodes.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-2 py-3">Noch nichts gescannt.</p>
                ) : (
                  <ul className="space-y-1">
                    {scannedCodes.map((c, i) => {
                      const conflict = conflictCodes.includes(c);
                      return (
                        <li
                          key={c}
                          className={cn(
                            "flex items-center gap-3 px-3 py-1 rounded-control",
                            conflict ? "bg-destructive/15 text-destructive" : "bg-glass-tile text-foreground",
                          )}
                        >
                          <span className="text-xs tabular-nums text-muted-foreground w-6 text-right shrink-0">
                            {i + 1}.
                          </span>
                          <span className="font-mono text-sm flex-1 truncate">{c}</span>
                          {conflict && (
                            <span className="text-[10px] uppercase tracking-wide font-bold">vergeben</span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setScannedCodes((cur) => cur.filter((x) => x !== c))}
                            disabled={busy}
                            className="size-11 text-muted-foreground hover:text-destructive"
                            aria-label={`${c} entfernen`}
                          >
                            <Trash2 />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Ticket-Typ */}
          {options.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                Ticket-Typ <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {options.map((opt) => {
                  const active = selected?.type === opt.type && selected.id === opt.id;
                  return (
                    <button
                      key={`${opt.type}-${opt.id}`}
                      disabled={busy}
                      onClick={() => {
                        setSelected(active ? null : { type: opt.type, id: opt.id });
                        // Beim Wechsel des Typs die Ressourcen-Auswahl leeren,
                        // damit kein fremder Bereich haengen bleibt.
                        setAreaId(null);
                      }}
                      className={cn(
                        "min-h-11 px-4 py-2.5 rounded-control text-sm font-semibold border transition-colors active:scale-95",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-glass-tile text-foreground border-glass-border hover:border-primary/50",
                      )}
                    >
                      {opt.name}
                    </button>
                  );
                })}
              </div>
              {selectedOpt && (
                <p className="text-xs text-muted-foreground">Gültigkeits-Vorgaben werden übernommen.</p>
              )}
            </div>
          )}

          {/* Bereich / Hauptressource */}
          {visibleAreas.length > 0 && (
            <div className="space-y-2">
              <label htmlFor="bulk-area" className="text-sm font-semibold text-foreground">
                {isService ? "Hauptressource" : "Bereich"}{" "}
                <span className="text-muted-foreground font-normal">
                  {needsExplicitMainArea ? "(bitte wählen)" : "(optional)"}
                </span>
              </label>
              <select
                id="bulk-area"
                value={areaId == null ? "none" : String(areaId)}
                onChange={(e) => setAreaId(e.target.value === "none" ? null : Number(e.target.value))}
                disabled={busy}
                className={cn(
                  "glass-field w-full h-12 px-3 text-foreground outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
                  needsExplicitMainArea && "border-warning",
                )}
              >
                <option value="none">{isService ? "Keine Hauptressource" : "Kein Bereich"}</option>
                {visibleAreas.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
              </select>
              {needsExplicitMainArea && (
                <p className="text-xs text-warning">
                  Ohne Auswahl startet die Zeitgültigkeit an jedem Gate.
                </p>
              )}
            </div>
          )}

          {/* Namens-Praefix */}
          <div className="space-y-2">
            <label htmlFor="bulk-prefix" className="text-sm font-semibold text-foreground">
              Namens-Präfix
            </label>
            <Input
              id="bulk-prefix"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              disabled={busy}
              className="h-12 px-3"
            />
            <p className="text-xs text-muted-foreground">
              Ergibt{" "}
              <span className="font-mono text-foreground">
                {namePrefix.trim() || "Ticket"}{" "}
                {mode === "rfid" ? (scannedCodes[0] ?? "RFID-CODE") : "1"}
              </span>
              {mode === "print" ? ", … fortlaufend nummeriert." : " – der Code dient als Kennung."}
            </p>
          </div>

          {mode === "print" && (
            // Ganze Kachel ist die Beschriftung des Kästchens (große Tippfläche).
            <label
              className={cn(
                "glass-tile w-full flex items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer",
                cutPerTicket ? "border-primary/50 bg-primary/10" : "hover:bg-glass-strong",
              )}
            >
              <Checkbox
                checked={cutPerTicket}
                onCheckedChange={(v) => toggleCut(v === true)}
                disabled={busy}
                className="mt-0.5 size-6 rounded-lg [&_svg]:size-4"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
                  Nach jedem Bon schneiden
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Jeder Bon geht als eigener Druckjob raus – der Drucker schneidet
                  sicher dazwischen, dafür kann der Druckdialog mehrfach kommen.
                </p>
              </div>
            </label>
          )}

          {error && (
            <Notice tone="danger" icon={AlertTriangle} compact title={error} />
          )}

          {created && !error && (
            <div className="space-y-2">
              <Notice
                tone="success"
                icon={CheckCircle2}
                compact
                title={
                  <>
                    {created.length} {mode === "rfid" ? "Bändchen-Tickets" : "Tickets"} erstellt
                    {printResult?.ok && printResult.transport === "iframe" ? " · Druck gestartet." : "."}
                  </>
                }
              />

              {printResult?.ok && printResult.transport === "newTab" && (
                <Notice
                  tone="warning"
                  icon={ExternalLink}
                  compact
                  title="Das PDF wurde in einem neuen Tab geöffnet – dort mit Strg/⌘+P drucken."
                />
              )}

              {printResult && !printResult.ok && (
                <Notice
                  tone="warning"
                  icon={AlertTriangle}
                  compact
                  title={
                    <>
                      Druck ließ sich nicht starten
                      {printResult.error ? `: ${printResult.error}` : ""}. Die Tickets sind
                      trotzdem angelegt.
                    </>
                  }
                >
                  {printResult.fallbackUrl && printResult.fallbackFilename && (
                    <a
                      href={printResult.fallbackUrl}
                      download={printResult.fallbackFilename}
                      className="mt-1 inline-flex items-center gap-1.5 font-semibold text-foreground underline underline-offset-2"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF herunterladen
                    </a>
                  )}
                </Notice>
              )}

              {mode === "print" && (
                <Button
                  variant="secondary"
                  onClick={handleReprint}
                  disabled={busy}
                  className="w-full h-12 font-semibold"
                >
                  {reprinting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Printer />
                  )}
                  Dieselben Bons erneut drucken
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Aktionen */}
        {/* Auf dem Handy steht die Primärtaste oben (docs/design-regeln.md, Abschnitt 16).
            `flex-1` erst ab sm: In der Spalte setzte es die Grundhöhe auf 0, und die
            Primärtaste schrumpfte auf 40 px. */}
        <div className="p-4 sm:p-5 border-t border-border shrink-0 flex flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="sm:w-40 h-14 font-semibold"
          >
            Schließen
          </Button>
          {mode === "print" && (
            <Button
              variant="secondary"
              onClick={() => handleSubmit(false)}
              disabled={submitDisabled}
              className="sm:w-44 h-14 font-semibold"
            >
              <ListPlus className="size-5" />
              Nur erstellen
            </Button>
          )}
          <Button
            onClick={() => handleSubmit(mode === "print")}
            disabled={submitDisabled}
            className="h-14 font-bold text-base sm:flex-1"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : mode === "print" ? (
              <Printer className="size-5" />
            ) : (
              <ListPlus className="size-5" />
            )}
            {loading
              ? "Erstelle …"
              : mode === "print"
                ? `${count} erstellen & drucken`
                : `${scannedCodes.length} Bändchen erstellen`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Kachel; die gewählte Betriebsart ist in Akzentfarbe getönt (Auswahl).
        "glass-tile px-4 py-3 text-left text-foreground transition-colors disabled:opacity-50 active:scale-95",
        active
          ? "border-primary/50 bg-primary/15"
          : "hover:bg-glass-strong",
      )}
    >
      <div className="flex items-center gap-2 font-bold">
        {icon}
        {title}
      </div>
      <p className="text-xs mt-0.5 text-muted-foreground">
        {subtitle}
      </p>
    </button>
  );
}
