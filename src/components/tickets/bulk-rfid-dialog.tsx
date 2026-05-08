"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Radio,
  ScanLine,
  Loader2,
  ListPlus,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Eraser,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
}

interface BulkRfidDialogProps {
  areas: Area[];
  subscriptions?: Sub[];
  services?: Svc[];
}

const MAX_CODES = 100;

export function BulkRfidDialog({
  areas,
  subscriptions = [],
  services = [],
}: BulkRfidDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [namePrefix, setNamePrefix] = useState<string>("Bändchen");
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState<string>("");
  const [duplicateFlash, setDuplicateFlash] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<"service" | "subscription" | null>(null);
  const [areaId, setAreaId] = useState<string>("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [conflictCodes, setConflictCodes] = useState<string[] | null>(null);

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const codesListRef = useRef<HTMLDivElement | null>(null);

  // Beim Öffnen / nach jedem Scan Fokus zurück auf das Eingabefeld setzen,
  // damit der USB-RFID-Reader weiterhin in den richtigen Input tippt.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => scanInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Liste auto-scrollen, sobald ein Code dazukommt – damit immer der
  // letzte Scan sichtbar ist (besonders an einem Kassen-Display).
  useEffect(() => {
    if (codesListRef.current) {
      codesListRef.current.scrollTop = codesListRef.current.scrollHeight;
    }
  }, [scannedCodes.length]);

  const allOptions = useMemo(
    () => [
      ...services.map((s) => ({ id: String(s.id), name: s.name, type: "service" as const, data: s })),
      ...subscriptions.map((s) => ({ id: String(s.id), name: s.name, type: "subscription" as const, data: s })),
    ],
    [services, subscriptions],
  );

  function reset() {
    setScannedCodes([]);
    setScanInput("");
    setDuplicateFlash(null);
    setNamePrefix("Bändchen");
    setSelectedId(null);
    setSelectedType(null);
    setAreaId("none");
    setError("");
    setDoneCount(null);
    setConflictCodes(null);
  }

  function addCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    if (scannedCodes.includes(code)) {
      // Duplikate visuell markieren statt stumm zu schlucken – sonst denkt
      // man am Reader, der Scan haette nicht funktioniert.
      setDuplicateFlash(code);
      setTimeout(() => {
        setDuplicateFlash((cur) => (cur === code ? null : cur));
      }, 1500);
      return;
    }
    if (scannedCodes.length >= MAX_CODES) {
      setError(`Maximal ${MAX_CODES} Bändchen pro Bulk.`);
      return;
    }
    setScannedCodes((cur) => [...cur, code]);
    setError("");
    setDoneCount(null);
    setConflictCodes(null);
  }

  function removeCode(code: string) {
    setScannedCodes((cur) => cur.filter((c) => c !== code));
    if (conflictCodes) {
      setConflictCodes((cur) => (cur ? cur.filter((c) => c !== code) : cur));
    }
  }

  function handleScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // RFID-Scanner schliessen den Scan i. d. R. mit Enter ab. Tab/Komma als
    // Fallback fuer Reader, die das anders konfiguriert sind.
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      const value = scanInput;
      setScanInput("");
      addCode(value);
      requestAnimationFrame(() => scanInputRef.current?.focus());
    }
  }

  async function handleSubmit() {
    if (scannedCodes.length === 0) {
      setError("Bitte mindestens ein Bändchen einscannen.");
      return;
    }
    if (!namePrefix.trim()) {
      setError("Bitte einen Namens-Präfix angeben.");
      return;
    }

    setLoading(true);
    setError("");
    setDoneCount(null);
    setConflictCodes(null);

    const payload: Record<string, unknown> = {
      rfidCodes: scannedCodes,
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

      if (selected.data.areaIds?.length) {
        payload.accessAreaId = selected.data.areaIds[0];
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
        const errVal = data?.error as
          | {
              formErrors?: string[];
              code?: string;
              conflictCodes?: string[];
            }
          | undefined;

        if (res.status === 409 && errVal?.code === "CODE_CONFLICT") {
          setConflictCodes(errVal.conflictCodes ?? []);
          setError(
            errVal.formErrors?.[0] ??
              "Ein oder mehrere RFID-Codes sind bereits vergeben.",
          );
        } else {
          setError(
            errVal?.formErrors?.[0] ??
              (typeof data?.error === "string" ? data.error : null) ??
              "Fehler beim Erstellen der Tickets",
          );
        }
        setLoading(false);
        return;
      }

      const data = (await res.json()) as { tickets: unknown[] };
      const tickets = data.tickets ?? [];
      setDoneCount(tickets.length);
      setScannedCodes([]);
      router.refresh();
    } catch {
      setError("Netzwerkfehler beim Erstellen der Tickets.");
    } finally {
      setLoading(false);
    }
  }

  const selectedOpt = allOptions.find((o) => o.id === selectedId && o.type === selectedType);

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
          <Radio className="h-4 w-4" />
          <span className="hidden xs:inline">Bändchen-Bulk</span>
          <span className="xs:hidden">RFID</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-indigo-600" />
            RFID-Bändchen bulk erfassen
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
            Bändchen einfach nacheinander am RFID-Reader scannen – jedes
            wird hier in der Liste eingetragen. Kein Druck, keine Bons.
          </p>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rfid-scan" className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-slate-400" />
              Bändchen scannen
            </Label>
            <Input
              ref={scanInputRef}
              id="rfid-scan"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleScanKeyDown}
              placeholder="RFID-Code …"
              className={cn(
                "font-mono text-sm",
                duplicateFlash &&
                  "border-amber-400 focus-visible:ring-amber-400/40",
              )}
              autoComplete="off"
              autoFocus
              disabled={loading}
            />
            {duplicateFlash ? (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Bändchen{" "}
                <span className="font-mono">{duplicateFlash}</span> wurde
                bereits gescannt.
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                Reader sendet meist Code + Enter. Max. {MAX_CODES} Bändchen.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                Gescannte Bändchen
                <Badge
                  variant="secondary"
                  className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900 font-normal"
                >
                  {scannedCodes.length}
                </Badge>
              </Label>
              {scannedCodes.length > 0 && !loading && (
                <button
                  type="button"
                  onClick={() => setScannedCodes([])}
                  className="text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1"
                >
                  <Eraser className="h-3 w-3" />
                  Liste leeren
                </button>
              )}
            </div>

            <div
              ref={codesListRef}
              className="border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2 py-2 max-h-48 overflow-y-auto"
            >
              {scannedCodes.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic px-1 py-2">
                  Noch keine Bändchen gescannt.
                </p>
              ) : (
                <ul className="space-y-1">
                  {scannedCodes.map((c, i) => {
                    const isConflict = conflictCodes?.includes(c) ?? false;
                    return (
                      <li
                        key={c}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1 rounded-md text-sm",
                          isConflict
                            ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"
                            : "bg-white dark:bg-slate-900",
                        )}
                      >
                        <span className="text-[10px] tabular-nums text-slate-400 w-6 shrink-0 text-right">
                          {i + 1}.
                        </span>
                        <span className="font-mono text-xs flex-1 truncate">
                          {c}
                        </span>
                        {isConflict && (
                          <span className="text-[10px] uppercase tracking-wide font-semibold">
                            vergeben
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeCode(c)}
                          disabled={loading}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0"
                          aria-label={`${c} entfernen`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rfid-prefix">Namens-Präfix</Label>
            <Input
              id="rfid-prefix"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              placeholder="Bändchen"
              disabled={loading}
            />
            <p className="text-xs text-slate-400">
              Ticket-Name wird zu{" "}
              <span className="font-mono">
                {namePrefix.trim() || "Ticket"}{" "}
                {scannedCodes[0] ?? "RFID-CODE"}
              </span>
              .
            </p>
          </div>

          {allOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>
                Ticket-Typ{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
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
                      } else {
                        setSelectedId(opt.id);
                        setSelectedType(opt.type);
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
                  Gültigkeits-Defaults werden übernommen.
                </p>
              )}
            </div>
          )}

          {areas.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="rfid-area">
                Bereich{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={loading}>
                <SelectTrigger id="rfid-area" className="h-9 text-sm">
                  <SelectValue placeholder="Kein Bereich" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Bereich</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {doneCount != null && !error && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {doneCount} Bändchen-Tickets erstellt.
            </p>
          )}

          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Schließen
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading || scannedCodes.length === 0 || !namePrefix.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 min-w-44"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListPlus className="h-4 w-4" />
              )}
              {loading
                ? "Erstelle…"
                : `${scannedCodes.length || ""} ${
                    scannedCodes.length === 1 ? "Bändchen" : "Bändchen"
                  } erstellen`.trim()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
