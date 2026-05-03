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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { printTicketsBulk, type PrintableTicket } from "@/lib/print-tickets";

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
        await printTicketsBulk(tickets, accountName ?? "EMP Access");
      }

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
                  Gueltigkeits-Defaults werden uebernommen.
                </p>
              )}
            </div>
          )}

          {areas.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-area">
                Bereich <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={loading}>
                <SelectTrigger id="bulk-area" className="h-9 text-sm">
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
              {doneCount} Tickets erstellt. Druckdialog wurde geoeffnet.
            </p>
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
