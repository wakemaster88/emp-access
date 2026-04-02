"use client";

import { useState } from "react";
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
import { Plus, Loader2, ScanLine } from "lucide-react";
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

function toDateInput(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

interface AddTicketDialogProps {
  areas: Area[];
  subscriptions?: Sub[];
  services?: Svc[];
}

export function AddTicketDialog({ areas, subscriptions = [], services = [] }: AddTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<"service" | "subscription" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allOptions = [
    ...services.map((s) => ({ id: String(s.id), name: s.name, type: "service" as const, data: s })),
    ...subscriptions.map((s) => ({ id: String(s.id), name: s.name, type: "subscription" as const, data: s })),
  ];

  function reset() {
    setFirstName("");
    setLastName("");
    setCode("");
    setSelectedId(null);
    setSelectedType(null);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() && !lastName.trim()) return;
    setLoading(true);
    setError("");

    const fullName = `${firstName} ${lastName}`.trim() || "Ticket";
    const payload: Record<string, unknown> = {
      name: fullName,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      status: "VALID",
    };

    if (code) {
      payload.barcode = code;
      payload.qrCode = code;
      payload.rfidCode = code;
    }

    const selected = allOptions.find((o) => o.id === selectedId && o.type === selectedType);
    if (selected) {
      if (selected.type === "service") {
        payload.serviceId = Number(selected.id);
        payload.ticketTypeName = selected.name;
        if (selected.data.areaIds?.length) {
          payload.accessAreaId = selected.data.areaIds[0];
        }
      } else {
        payload.subscriptionId = Number(selected.id);
        if (selected.data.areaIds?.length) {
          payload.accessAreaId = selected.data.areaIds[0];
        }
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
    }

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.formErrors?.[0] ?? "Fehler beim Erstellen");
      } else {
        setOpen(false);
        reset();
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <Plus className="h-4 w-4" />
          Ticket erstellen
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Neues Ticket erstellen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-first">Vorname <span className="text-rose-500">*</span></Label>
              <Input
                id="t-first"
                placeholder="Max"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-last">Nachname <span className="text-rose-500">*</span></Label>
              <Input
                id="t-last"
                placeholder="Mustermann"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-code" className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-slate-400" />
              Code
            </Label>
            <Input
              id="t-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono text-sm"
              placeholder="RFID / Barcode / QR"
              autoComplete="off"
            />
          </div>

          {allOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Ticket-Typ</Label>
              <div className="flex flex-wrap gap-2">
                {allOptions.map((opt) => (
                  <button
                    key={`${opt.type}-${opt.id}`}
                    type="button"
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
            </div>
          )}

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={loading || (!firstName.trim() && !lastName.trim())}
              className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
