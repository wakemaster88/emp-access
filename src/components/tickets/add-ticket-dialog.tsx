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
import { Plus, Loader2 } from "lucide-react";

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
};

export function AddTicketDialog({ areas }: AddTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
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
          {/* Name */}
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

          {/* Person */}
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
