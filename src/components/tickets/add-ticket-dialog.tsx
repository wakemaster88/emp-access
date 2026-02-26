"use client";

import { useState, useRef } from "react";
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
import { Plus, Loader2, Camera } from "lucide-react";

interface Area {
  id: number;
  name: string;
}

interface AddTicketDialogProps {
  areas: Area[];
}

const EMPTY = {
  name: "",
  firstName: "",
  lastName: "",
  ticketTypeName: "",
  barcode: "",
  qrCode: "",
  rfidCode: "",
  accessAreaId: "none",
  status: "VALID",
  startDate: "",
  endDate: "",
  validityType: "DATE_RANGE",
  slotStart: "",
  slotEnd: "",
  validityDurationMinutes: "",
};

export function AddTicketDialog({ areas }: AddTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(key: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError("");

    const payload: Record<string, unknown> = {
      name: form.name,
      status: form.status,
      validityType: form.validityType,
    };
    if (form.firstName) payload.firstName = form.firstName;
    if (form.lastName) payload.lastName = form.lastName;
    if (form.ticketTypeName) payload.ticketTypeName = form.ticketTypeName;
    if (form.barcode) payload.barcode = form.barcode;
    if (form.qrCode) payload.qrCode = form.qrCode;
    if (form.rfidCode) payload.rfidCode = form.rfidCode;
    if (form.accessAreaId && form.accessAreaId !== "none") payload.accessAreaId = Number(form.accessAreaId);
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
            {/* Profilbild */}
            <div className="shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500_000) { setError("Bild max. 500 KB"); return; }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                      const canvas = document.createElement("canvas");
                      const max = 200;
                      let w = img.width, h = img.height;
                      if (w > max || h > max) {
                        const ratio = Math.min(max / w, max / h);
                        w = Math.round(w * ratio);
                        h = Math.round(h * ratio);
                      }
                      canvas.width = w;
                      canvas.height = h;
                      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                      setProfileImage(canvas.toDataURL("image/jpeg", 0.8));
                    };
                    img.src = reader.result as string;
                  };
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
              <div
                className="relative group h-16 w-16 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center cursor-pointer overflow-hidden hover:border-indigo-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
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
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Name / Bezeichnung <span className="text-rose-500">*</span></Label>
                <Input
                  id="t-name"
                  placeholder="z.B. Tageskarte Erwachsene"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-first">Vorname</Label>
                  <Input
                    id="t-first"
                    placeholder="Max"
                    value={form.firstName}
                    onChange={(e) => set("firstName", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-last">Nachname</Label>
                  <Input
                    id="t-last"
                    placeholder="Mustermann"
                    value={form.lastName}
                    onChange={(e) => set("lastName", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Ticket Type */}
          <div className="space-y-1.5">
            <Label htmlFor="t-type">Ticket-Typ</Label>
            <Input
              id="t-type"
              placeholder="z.B. Tageskarte, Saisonkarte"
              value={form.ticketTypeName}
              onChange={(e) => set("ticketTypeName", e.target.value)}
            />
          </div>

          {/* Codes */}
          <div className="space-y-1.5">
            <Label>Code</Label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-slate-500">Barcode</span>
                <Input
                  placeholder="123456789"
                  value={form.barcode}
                  onChange={(e) => set("barcode", e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-500">QR-Code</span>
                <Input
                  placeholder="QR..."
                  value={form.qrCode}
                  onChange={(e) => set("qrCode", e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-500">RFID</span>
                <Input
                  placeholder="RFID..."
                  value={form.rfidCode}
                  onChange={(e) => set("rfidCode", e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>

          {/* Area + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Zugangsbereich</Label>
              <Select value={form.accessAreaId} onValueChange={(v) => set("accessAreaId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Alle Bereiche" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Alle Bereiche</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Input
                id="t-duration"
                type="number"
                min="1"
                placeholder="z.B. 120 für 2 Stunden"
                value={form.validityDurationMinutes}
                onChange={(e) => set("validityDurationMinutes", e.target.value)}
              />
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
              disabled={loading || !form.name.trim()}
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
