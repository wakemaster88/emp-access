"use client";

import { useState } from "react";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, ScanLine, Users, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  requiresRfid?: boolean;
}

interface Svc extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
  /** Hauptressource des Service - bevorzugt vor `areaIds[0]`. */
  mainAccessAreaId?: number | null;
  requiresRfid?: boolean;
}

function toDateInput(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

interface VereinRef {
  id: number;
  name: string;
}

interface AddTicketDialogProps {
  areas: Area[];
  subscriptions?: Sub[];
  services?: Svc[];
  vereine?: VereinRef[];
}

export function AddTicketDialog({ areas, subscriptions = [], services = [], vereine = [] }: AddTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<"service" | "subscription" | null>(null);
  const [vereinId, setVereinId] = useState<string>("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingConflict, setPendingConflict] = useState<{
    label: string;
    type: string | null;
    payload: Record<string, unknown>;
  } | null>(null);

  const allOptions = [
    ...services.map((s) => ({ id: String(s.id), name: s.name, type: "service" as const, data: s })),
    ...subscriptions.map((s) => ({ id: String(s.id), name: s.name, type: "subscription" as const, data: s })),
  ];

  const selectedOption = allOptions.find((o) => o.id === selectedId && o.type === selectedType);
  // Ohne Code ist ein Abo-Ticket nicht scanbar. Haengt die Karte noch am
  // Vorgaenger-Ticket, findet der Scanner nur dieses und weist ab, sobald es
  // abgelaufen ist.
  const missingCard = !!selectedOption?.data.requiresRfid && !code.trim();

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setCode("");
    setSelectedId(null);
    setSelectedType(null);
    setVereinId("none");
    setError("");
    setPendingConflict(null);
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
      email: email.trim() || undefined,
      status: "VALID",
    };

    if (code) {
      payload.barcode = code;
      payload.qrCode = code;
      payload.rfidCode = code;
    }

    if (vereinId && vereinId !== "none") {
      payload.vereinId = Number(vereinId);
    }

    const selected = selectedOption;
    if (selected) {
      if (selected.type === "service") {
        payload.serviceId = Number(selected.id);
        payload.ticketTypeName = selected.name;
        // Service-Hauptressource: explizit konfiguriertes Feld vor erster
        // ServiceArea. Verhindert das Strandbad/Seilbahn-A-Vertauschen,
        // das frueher zu fehlerhaften DURATION-Sperren gefuehrt hat.
        const svc = selected.data as Svc;
        const mainAreaId = svc.mainAccessAreaId ?? svc.areaIds?.[0] ?? null;
        if (mainAreaId != null) payload.accessAreaId = mainAreaId;
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

    await submitWithPayload(payload);
  }

  async function submitWithPayload(payload: Record<string, unknown>) {
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errVal = data?.error as
          | {
              formErrors?: string[];
              fieldErrors?: Record<string, string[]>;
              code?: string;
              conflictTicketLabel?: string;
              conflictTicketType?: string | null;
            }
          | undefined;

        if (
          res.status === 409
          && errVal?.code === "CODE_CONFLICT"
          && !payload.transferCode
        ) {
          setPendingConflict({
            label: errVal.conflictTicketLabel ?? "ein anderes Ticket",
            type: errVal.conflictTicketType ?? null,
            payload,
          });
          setError("");
          setLoading(false);
          return;
        }

        setError(errVal?.formErrors?.[0] ?? "Fehler beim Erstellen");
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

  async function confirmTransfer() {
    if (!pendingConflict) return;
    setLoading(true);
    setError("");
    const retryPayload = { ...pendingConflict.payload, transferCode: true };
    setPendingConflict(null);
    await submitWithPayload(retryPayload);
  }

  function cancelTransfer() {
    setPendingConflict(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2 max-sm:h-11">
          <Plus className="h-4 w-4" />
          {/* Kopf der Karte (Abschnitt 13): auf dem Handy kürzer („+ Ticket“), damit der Titel
              daneben Platz hat; „erstellen“ bleibt für Screenreader im Namen. Auf dem Handy
              44 px hoch wie die Primärtasten der übrigen Listen („+ Abo“, „+ Service“). */}
          <span>
            Ticket<span className="max-sm:sr-only"> erstellen</span>
          </span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Neues Ticket erstellen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-first">Vorname <span className="text-destructive">*</span></Label>
              <Input
                id="t-first"
                placeholder="Max"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
                className={FIELD}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-last">Nachname <span className="text-destructive">*</span></Label>
              <Input
                id="t-last"
                placeholder="Mustermann"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className={FIELD}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-email">
              Email <span className="text-muted-foreground font-normal">(für automatische Mails)</span>
            </Label>
            <Input
              id="t-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={FIELD}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-code" className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
              Code
            </Label>
            <Input
              id="t-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={cn("font-mono", FIELD)}
              placeholder="RFID / Barcode / QR"
              autoComplete="off"
            />
            {missingCard && (
              <Notice tone="warning" compact icon={AlertTriangle}>
                <span>
                  „{selectedOption?.name}“ verlangt eine Karte. Ohne Code ist das
                  Ticket nicht scanbar – hat die Person schon eine Karte, hier
                  einscannen und beim Hinweis „Bändchen umhängen“ bestätigen.
                </span>
              </Notice>
            )}
          </div>

          {allOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Ticket-Typ</Label>
              <div className="flex flex-wrap gap-2">
                {allOptions.map((opt) => (
                  <Button
                    key={`${opt.type}-${opt.id}`}
                    type="button"
                    size="sm"
                    variant={selectedId === opt.id && selectedType === opt.type ? "default" : "outline"}
                    aria-pressed={selectedId === opt.id && selectedType === opt.type}
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
            </div>
          )}

          {vereine.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="t-verein" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Verein <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Select value={vereinId} onValueChange={setVereinId}>
                <SelectTrigger id="t-verein" className={SELECT_FIELD}><SelectValue placeholder="Kein Verein" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Verein</SelectItem>
                  {vereine.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {pendingConflict && (
            <Notice tone="warning" title="Bändchen bereits vergeben">
              <p>
                Der Code ist aktuell Ticket{" "}
                <span className="font-semibold text-foreground">{pendingConflict.label}</span>
                {pendingConflict.type ? (
                  <span className="opacity-80"> ({pendingConflict.type})</span>
                ) : null}{" "}
                zugeordnet. Bändchen auf das neue Ticket umhängen? Das alte
                Ticket verliert dann seinen Code.
              </p>
              {/* Auf dem Handy gestapelt, Bestätigen oben; der Hinweis trägt schon die Warnfarbe. */}
              <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelTransfer}
                  disabled={loading}
                  className={cn("sm:flex-1", FIELD)}
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  onClick={confirmTransfer}
                  disabled={loading}
                  className={cn("sm:flex-1", FIELD)}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Bändchen umhängen"
                  )}
                </Button>
              </div>
            </Notice>
          )}

          {error && (
            <Notice tone="danger" compact title={error} />
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading} className={FIELD}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={
                loading
                || pendingConflict !== null
                || (!firstName.trim() && !lastName.trim())
              }
              className={cn("min-w-28", FIELD)}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
