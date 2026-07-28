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
  Check,
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-2xl max-h-[92dvh] flex flex-col pb-[env(safe-area-inset-bottom)] monitor-scrollbar overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2 truncate text-white">
            <Layers className="h-5 w-5 text-indigo-400 shrink-0" />
            Serie erstellen
          </h2>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white active:scale-95"
            title="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
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
              <label className="text-sm font-semibold text-slate-300">Anzahl</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCount((c) => clampCount(c - 1))}
                  disabled={busy || count <= 1}
                  className="h-14 w-14 shrink-0 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center disabled:opacity-40 active:scale-95"
                  aria-label="Anzahl verringern"
                >
                  <Minus className="h-6 w-6" />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_COUNT}
                  value={count}
                  onChange={(e) => setCount(clampCount(Number(e.target.value)))}
                  disabled={busy}
                  className="flex-1 h-14 rounded-2xl bg-slate-800 border border-slate-700 text-center text-2xl font-bold tabular-nums text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => setCount((c) => clampCount(c + 1))}
                  disabled={busy || count >= MAX_COUNT}
                  className="h-14 w-14 shrink-0 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center disabled:opacity-40 active:scale-95"
                  aria-label="Anzahl erhöhen"
                >
                  <Plus className="h-6 w-6" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_COUNTS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    disabled={busy}
                    className={cn(
                      "px-4 py-2 rounded-xl text-sm font-semibold border transition-colors active:scale-95",
                      count === n
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-slate-800 text-slate-300 border-slate-700 hover:border-indigo-500",
                    )}
                  >
                    {n}
                  </button>
                ))}
                <span className="self-center text-xs text-slate-500">max. {MAX_COUNT}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="bulk-scan" className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-slate-500" />
                Bändchen nacheinander scannen
              </label>
              <input
                ref={scanInputRef}
                id="bulk-scan"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScanKeyDown}
                placeholder="RFID-Code …"
                autoComplete="off"
                disabled={busy}
                className={cn(
                  "w-full h-14 rounded-2xl bg-slate-800 border px-4 font-mono text-lg text-white placeholder:text-slate-600 focus:outline-none",
                  duplicateFlash
                    ? "border-amber-500 focus:border-amber-400"
                    : "border-slate-700 focus:border-indigo-500",
                )}
              />
              {duplicateFlash ? (
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-mono">{duplicateFlash}</span> wurde bereits gescannt.
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Der Reader schließt jeden Scan selbst ab. Max. {MAX_COUNT} Bändchen.
                </p>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">
                  Gescannt
                  <span className="ml-2 px-2 py-0.5 rounded-lg bg-indigo-950/60 text-indigo-300 text-xs font-bold tabular-nums">
                    {scannedCodes.length}
                  </span>
                </span>
                {scannedCodes.length > 0 && !busy && (
                  <button
                    onClick={() => setScannedCodes([])}
                    className="text-xs text-slate-400 hover:text-rose-400 inline-flex items-center gap-1"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    Liste leeren
                  </button>
                )}
              </div>

              <div
                ref={codesListRef}
                className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2 max-h-52 overflow-y-auto monitor-scrollbar"
              >
                {scannedCodes.length === 0 ? (
                  <p className="text-sm text-slate-600 italic px-2 py-3">Noch nichts gescannt.</p>
                ) : (
                  <ul className="space-y-1">
                    {scannedCodes.map((c, i) => {
                      const conflict = conflictCodes.includes(c);
                      return (
                        <li
                          key={c}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-xl",
                            conflict ? "bg-rose-950/50 text-rose-300" : "bg-slate-900 text-slate-200",
                          )}
                        >
                          <span className="text-xs tabular-nums text-slate-600 w-6 text-right shrink-0">
                            {i + 1}.
                          </span>
                          <span className="font-mono text-sm flex-1 truncate">{c}</span>
                          {conflict && (
                            <span className="text-[10px] uppercase tracking-wide font-bold">vergeben</span>
                          )}
                          <button
                            onClick={() => setScannedCodes((cur) => cur.filter((x) => x !== c))}
                            disabled={busy}
                            className="text-slate-500 hover:text-rose-400 shrink-0 p-1"
                            aria-label={`${c} entfernen`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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
              <label className="text-sm font-semibold text-slate-300">
                Ticket-Typ <span className="text-slate-500 font-normal">(optional)</span>
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
                        "px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors active:scale-95",
                        active
                          ? "bg-indigo-600 text-white border-indigo-500"
                          : "bg-slate-800 text-slate-300 border-slate-700 hover:border-indigo-500",
                      )}
                    >
                      {opt.name}
                    </button>
                  );
                })}
              </div>
              {selectedOpt && (
                <p className="text-xs text-slate-500">Gültigkeits-Vorgaben werden übernommen.</p>
              )}
            </div>
          )}

          {/* Bereich / Hauptressource */}
          {visibleAreas.length > 0 && (
            <div className="space-y-2">
              <label htmlFor="bulk-area" className="text-sm font-semibold text-slate-300">
                {isService ? "Hauptressource" : "Bereich"}{" "}
                <span className="text-slate-500 font-normal">
                  {needsExplicitMainArea ? "(bitte wählen)" : "(optional)"}
                </span>
              </label>
              <select
                id="bulk-area"
                value={areaId == null ? "none" : String(areaId)}
                onChange={(e) => setAreaId(e.target.value === "none" ? null : Number(e.target.value))}
                disabled={busy}
                className={cn(
                  "w-full h-12 rounded-xl bg-slate-800 border px-3 text-white focus:outline-none",
                  needsExplicitMainArea ? "border-amber-600" : "border-slate-700 focus:border-indigo-500",
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
                <p className="text-xs text-amber-400">
                  Ohne Auswahl startet die Zeitgültigkeit an jedem Gate.
                </p>
              )}
            </div>
          )}

          {/* Namens-Praefix */}
          <div className="space-y-2">
            <label htmlFor="bulk-prefix" className="text-sm font-semibold text-slate-300">
              Namens-Präfix
            </label>
            <input
              id="bulk-prefix"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              disabled={busy}
              className="w-full h-12 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-slate-500">
              Ergibt{" "}
              <span className="font-mono text-slate-400">
                {namePrefix.trim() || "Ticket"}{" "}
                {mode === "rfid" ? (scannedCodes[0] ?? "RFID-CODE") : "1"}
              </span>
              {mode === "print" ? ", … fortlaufend nummeriert." : " – der Code dient als Kennung."}
            </p>
          </div>

          {mode === "print" && (
            <button
              onClick={() => toggleCut(!cutPerTicket)}
              disabled={busy}
              className={cn(
                "w-full flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                cutPerTicket
                  ? "border-indigo-600 bg-indigo-950/40"
                  : "border-slate-700 bg-slate-800/60",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 h-6 w-6 rounded-lg flex items-center justify-center shrink-0",
                  cutPerTicket ? "bg-indigo-600 text-white" : "bg-slate-700 text-transparent",
                )}
              >
                <Check className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <Scissors className="h-3.5 w-3.5 text-indigo-400" />
                  Nach jedem Bon schneiden
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Jeder Bon geht als eigener Druckjob raus – der Drucker schneidet
                  sicher dazwischen, dafür kann der Druckdialog mehrfach kommen.
                </p>
              </div>
            </button>
          )}

          {error && (
            <p className="text-sm text-rose-300 bg-rose-950/50 border border-rose-900 px-4 py-3 rounded-2xl flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </p>
          )}

          {created && !error && (
            <div className="space-y-2">
              <p className="text-sm text-emerald-300 bg-emerald-950/50 border border-emerald-900 px-4 py-3 rounded-2xl flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {created.length} {mode === "rfid" ? "Bändchen-Tickets" : "Tickets"} erstellt
                {printResult?.ok && printResult.transport === "iframe" ? " · Druck gestartet." : "."}
              </p>

              {printResult?.ok && printResult.transport === "newTab" && (
                <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 px-4 py-3 rounded-2xl flex items-start gap-2">
                  <ExternalLink className="h-4 w-4 shrink-0 mt-0.5" />
                  Das PDF wurde in einem neuen Tab geöffnet – dort mit Strg/⌘+P drucken.
                </p>
              )}

              {printResult && !printResult.ok && (
                <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 px-4 py-3 rounded-2xl space-y-2">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    Druck ließ sich nicht starten
                    {printResult.error ? `: ${printResult.error}` : ""}. Die Tickets sind
                    trotzdem angelegt.
                  </p>
                  {printResult.fallbackUrl && printResult.fallbackFilename && (
                    <a
                      href={printResult.fallbackUrl}
                      download={printResult.fallbackFilename}
                      className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-2"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF herunterladen
                    </a>
                  )}
                </div>
              )}

              {mode === "print" && (
                <button
                  onClick={handleReprint}
                  disabled={busy}
                  className="w-full h-12 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
                >
                  {reprinting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  Dieselben Bons erneut drucken
                </button>
              )}
            </div>
          )}
        </div>

        {/* Aktionen */}
        <div className="p-4 sm:p-5 border-t border-slate-800 shrink-0 flex flex-col sm:flex-row gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="sm:w-40 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold disabled:opacity-50 active:scale-95"
          >
            Schließen
          </button>
          {mode === "print" && (
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitDisabled}
              className="sm:w-44 h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
            >
              <ListPlus className="h-5 w-5" />
              Nur erstellen
            </button>
          )}
          <button
            onClick={() => handleSubmit(mode === "print")}
            disabled={submitDisabled}
            className="flex-1 h-14 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : mode === "print" ? (
              <Printer className="h-5 w-5" />
            ) : (
              <ListPlus className="h-5 w-5" />
            )}
            {loading
              ? "Erstelle …"
              : mode === "print"
                ? `${count} erstellen & drucken`
                : `${scannedCodes.length} Bändchen erstellen`}
          </button>
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
        "rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-50 active:scale-95",
        active
          ? "bg-indigo-600 border-indigo-500 text-white"
          : "bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-500",
      )}
    >
      <div className="flex items-center gap-2 font-bold">
        {icon}
        {title}
      </div>
      <p className={cn("text-xs mt-0.5", active ? "text-indigo-100" : "text-slate-500")}>
        {subtitle}
      </p>
    </button>
  );
}
