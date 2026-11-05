"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
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

// Dialog auf dem Handy: Felder und Tasten 44 px hoch (docs/design-regeln.md, Abschnitt 16).
const FIELD = "h-11 sm:h-9";
const SELECT_FIELD = "w-full data-[size=default]:h-11 sm:data-[size=default]:h-9";

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
        <Button variant="outline" className="gap-1.5">
          <Radio className="h-4 w-4" />
          <span className="hidden xs:inline">Bändchen-Bulk</span>
          <span className="xs:hidden">RFID</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            RFID-Bändchen bulk erfassen
          </DialogTitle>
          <DialogDescription>
            Bändchen einfach nacheinander am RFID-Reader scannen – jedes
            wird hier in der Liste eingetragen. Kein Druck, keine Bons.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rfid-scan" className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
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
                "font-mono",
                FIELD,
                duplicateFlash &&
                  "border-warning focus-visible:border-warning focus-visible:ring-warning/30",
              )}
              autoComplete="off"
              autoFocus
              disabled={loading}
            />
            {duplicateFlash ? (
              <p className="text-xs text-warning flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Bändchen{" "}
                <span className="font-mono">{duplicateFlash}</span> wurde
                bereits gescannt.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reader sendet meist Code + Enter. Max. {MAX_CODES} Bändchen.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                Gescannte Bändchen
                <Badge variant="secondary" className="tabular-nums">
                  {scannedCodes.length}
                </Badge>
              </Label>
              {scannedCodes.length > 0 && !loading && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setScannedCodes([])}
                  className="max-sm:h-9 text-muted-foreground hover:text-destructive"
                >
                  <Eraser />
                  Liste leeren
                </Button>
              )}
            </div>

            {/* Gescannte Codes als Feld-Mulde; neue Einträge laufen unten nach. */}
            <div
              ref={codesListRef}
              className="glass-field max-h-48 overflow-y-auto overscroll-contain scrollbar-thin p-1.5"
            >
              {scannedCodes.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1.5 py-2">
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
                          "flex items-center gap-2 pl-2 pr-1 py-0.5 rounded-[10px] text-sm",
                          isConflict
                            ? "bg-destructive/10 text-destructive"
                            : "bg-glass-tile",
                        )}
                      >
                        <span className="text-[11px] tabular-nums text-muted-foreground w-6 shrink-0 text-right">
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeCode(c)}
                          disabled={loading}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`${c} entfernen`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
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
              className={FIELD}
            />
            <p className="text-xs text-muted-foreground">
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
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
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
                      } else {
                        setSelectedId(opt.id);
                        setSelectedType(opt.type);
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
                  Gültigkeits-Defaults werden übernommen.
                </p>
              )}
            </div>
          )}

          {areas.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="rfid-area">
                Bereich{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={loading}>
                <SelectTrigger id="rfid-area" className={SELECT_FIELD}>
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

          {error && <Notice tone="danger" compact title={error} />}

          {doneCount != null && !error && (
            <Notice
              tone="success"
              compact
              icon={CheckCircle2}
              title={<>{doneCount} Bändchen-Tickets erstellt.</>}
            />
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className={FIELD}
            >
              Schließen
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading || scannedCodes.length === 0 || !namePrefix.trim()}
              className={cn("gap-1.5 min-w-44", FIELD)}
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
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
