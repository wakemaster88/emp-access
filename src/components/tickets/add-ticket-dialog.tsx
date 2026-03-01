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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Camera, ScanLine } from "lucide-react";
import { CameraCapture } from "./camera-capture";

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

const EMPTY = {
  firstName: "",
  lastName: "",
  ticketTypeName: "",
  code: "",
  accessAreaId: "none",
  subscriptionId: "none",
  serviceId: "none",
  status: "VALID",
  startDate: "",
  endDate: "",
  validityType: "DATE_RANGE",
  slotStart: "",
  slotEnd: "",
  validityDurationMinutes: "",
};

export function AddTicketDialog({ areas, subscriptions = [], services = [] }: AddTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(key: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyDefaultValidity(def: DefaultValidity | undefined) {
    if (!def?.defaultValidityType) return;
    set("validityType", def.defaultValidityType);
    if (def.defaultValidityType === "DATE_RANGE") {
      set("startDate", toDateInput(def.defaultStartDate));
      set("endDate", toDateInput(def.defaultEndDate));
      set("slotStart", "");
      set("slotEnd", "");
      set("validityDurationMinutes", "");
    } else if (def.defaultValidityType === "TIME_SLOT") {
      set("startDate", "");
      set("endDate", "");
      set("slotStart", def.defaultSlotStart ?? "");
      set("slotEnd", def.defaultSlotEnd ?? "");
      set("validityDurationMinutes", "");
    } else if (def.defaultValidityType === "DURATION") {
      set("startDate", "");
      set("endDate", "");
      set("slotStart", "");
      set("slotEnd", "");
      set("validityDurationMinutes", def.defaultValidityDurationMinutes != null ? String(def.defaultValidityDurationMinutes) : "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim() && !form.lastName.trim()) return;
    setLoading(true);
    setError("");

    const fullName = `${form.firstName} ${form.lastName}`.trim() || "Ticket";
    const payload: Record<string, unknown> = {
      name: fullName,
      status: form.status,
      validityType: form.validityType,
    };
    if (form.firstName) payload.firstName = form.firstName;
    if (form.lastName) payload.lastName = form.lastName;
    if (form.serviceId && form.serviceId !== "none") {
      payload.serviceId = Number(form.serviceId);
      const svc = services.find((s) => String(s.id) === form.serviceId);
      if (svc) payload.ticketTypeName = svc.name;
    } else if (form.ticketTypeName) {
      payload.ticketTypeName = form.ticketTypeName;
    }
    if (form.code) {
      payload.barcode = form.code;
      payload.qrCode = form.code;
      payload.rfidCode = form.code;
    }
    if (form.subscriptionId && form.subscriptionId !== "none") {
      payload.subscriptionId = Number(form.subscriptionId);
    } else if (form.accessAreaId && form.accessAreaId !== "none") {
      payload.accessAreaId = Number(form.accessAreaId);
    }
    if (form.startDate) payload.startDate = new Date(form.startDate).toISOString();
    if (form.endDate) payload.endDate = new Date(form.endDate).toISOString();
    if (form.validityType === "TIME_SLOT") {
      if (form.slotStart) payload.slotStart = form.slotStart;
      if (form.slotEnd) payload.slotEnd = form.slotEnd;
    }
    if (form.validityType === "DURATION" && form.validityDurationMinutes) {
      payload.validityDurationMinutes = Number(form.validityDurationMinutes);
    }
    if (profileImage) payload.profileImage = profileImage;

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
        setForm(EMPTY);
        setProfileImage(null);
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <Plus className="h-4 w-4" />
          Ticket erstellen
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neues Ticket erstellen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="flex gap-4 items-start">
            <div className="shrink-0">
              <div
                className="relative group h-16 w-16 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center cursor-pointer overflow-hidden hover:border-indigo-400 transition-colors"
                onClick={() => setCameraOpen(true)}
              >
                {profileImage ? (
                  <>
                    <img src={profileImage} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="h-4 w-4 text-white" />
                    </div>
                  </>
                ) : (
                  <Camera className="h-5 w-5 text-slate-400" />
                )}
              </div>
              {profileImage && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setProfileImage(null); }}
                  className="mt-1 text-[10px] text-slate-400 hover:text-rose-500 transition-colors w-full text-center"
                >
                  Entfernen
                </button>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-first">Vorname <span className="text-rose-500">*</span></Label>
                  <Input
                    id="t-first"
                    placeholder="Max"
                    value={form.firstName}
                    onChange={(e) => set("firstName", e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-last">Nachname <span className="text-rose-500">*</span></Label>
                  <Input
                    id="t-last"
                    placeholder="Mustermann"
                    value={form.lastName}
                    onChange={(e) => set("lastName", e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {cameraOpen && (
            <CameraCapture
              onCapture={(dataUrl) => { setProfileImage(dataUrl); setCameraOpen(false); }}
              onClose={() => setCameraOpen(false)}
            />
          )}

          {/* Service / Ticket Type + Code */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ticket-Typ</Label>
              {services.length > 0 ? (
                <Select value={form.serviceId} onValueChange={(v) => {
                  set("serviceId", v);
                  if (v !== "none") {
                    const svc = services.find((s) => String(s.id) === v);
                    if (svc) {
                      set("ticketTypeName", svc.name);
                      applyDefaultValidity(svc);
                      if (svc.areaIds?.length) {
                        set("accessAreaId", String(svc.areaIds[0]));
                      }
                    }
                  } else {
                    set("ticketTypeName", "");
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kein Service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Service</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="t-type"
                  placeholder="z.B. Tageskarte"
                  value={form.ticketTypeName}
                  onChange={(e) => set("ticketTypeName", e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-code" className="flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5 text-slate-400" />
                Code
              </Label>
              <Input
                id="t-code"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                className="font-mono text-sm"
                placeholder="Scannen / eingeben"
                autoComplete="off"
              />
            </div>
          </div>

          {/* Abo + Resource/Status */}
          {(() => {
            const hideResource = form.subscriptionId !== "none" || form.serviceId !== "none";
            const cols = subscriptions.length > 0 ? (hideResource ? 2 : 3) : (hideResource ? 1 : 2);
            return (
              <div className={`grid gap-3 grid-cols-${cols}`}>
                {subscriptions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Abo</Label>
                    <Select value={form.subscriptionId} onValueChange={(v) => {
                      set("subscriptionId", v);
                      if (v !== "none") {
                        const sub = subscriptions.find((s) => String(s.id) === v);
                        if (sub) {
                          applyDefaultValidity(sub);
                          if (sub.areaIds?.length) {
                            set("accessAreaId", String(sub.areaIds[0]));
                          }
                        }
                      }
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Kein Abo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Kein Abo</SelectItem>
                        {subscriptions.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!hideResource && (
                  <div className="space-y-1.5">
                    <Label>Resource</Label>
                    <Select value={form.accessAreaId} onValueChange={(v) => set("accessAreaId", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Keine" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine</SelectItem>
                        {areas.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VALID">Gültig</SelectItem>
                      <SelectItem value="INVALID">Ungültig</SelectItem>
                      <SelectItem value="PROTECTED">Geschützt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}

          {/* Validity Type */}
          <div className="space-y-1.5">
            <Label>Gültigkeitstyp</Label>
            <Select value={form.validityType} onValueChange={(v) => set("validityType", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DATE_RANGE">Zeitraum (Tage)</SelectItem>
                <SelectItem value="TIME_SLOT">Zeitslot (Uhrzeit)</SelectItem>
                <SelectItem value="DURATION">Dauer ab 1. Scan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-start">Gültig ab</Label>
              <Input
                id="t-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-end">Gültig bis</Label>
              <Input
                id="t-end"
                type="date"
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </div>
          </div>

          {/* Time Slot */}
          {form.validityType === "TIME_SLOT" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-slot-start">Slot von</Label>
                <Input
                  id="t-slot-start"
                  type="time"
                  value={form.slotStart}
                  onChange={(e) => set("slotStart", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-slot-end">Slot bis</Label>
                <Input
                  id="t-slot-end"
                  type="time"
                  value={form.slotEnd}
                  onChange={(e) => set("slotEnd", e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Duration */}
          {form.validityType === "DURATION" && (
            <div className="space-y-1.5">
              <Label htmlFor="t-duration">Gültigkeitsdauer (Minuten)</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="t-duration"
                  type="number"
                  min="1"
                  placeholder="z.B. 120 für 2 Stunden"
                  value={form.validityDurationMinutes}
                  onChange={(e) => set("validityDurationMinutes", e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => set("validityDurationMinutes", "1440")}>
                  1 Tag
                </Button>
              </div>
              <p className="text-xs text-slate-400">1 Tag = 1440 Minuten</p>
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
              disabled={loading || (!form.firstName.trim() && !form.lastName.trim())}
              className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ticket erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
