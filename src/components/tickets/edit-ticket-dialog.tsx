"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Separator } from "@/components/ui/separator";
import { Loader2, Trash2, Save, Pencil, ScanLine, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { fmtDateTime } from "@/lib/utils";

export interface TicketData {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  barcode: string | null;
  qrCode: string | null;
  rfidCode: string | null;
  status: string;
  accessAreaId: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  source: string | null;
  _count: { scans: number };
}

interface Area {
  id: number;
  name: string;
}

interface ScanRecord {
  id: number;
  code: string;
  result: string;
  scanTime: string;
  device?: { name: string } | null;
}

interface EditTicketDialogProps {
  ticket: TicketData | null;
  areas: Area[];
  onClose: () => void;
}

function toDateInput(val: Date | string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export function EditTicketDialog({ ticket, areas, onClose }: EditTicketDialogProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"edit" | "scans">("edit");
  const [form, setForm] = useState({
    name: "",
    firstName: "",
    lastName: "",
    ticketTypeName: "",
    barcode: "",
    qrCode: "",
    rfidCode: "",
    status: "VALID",
    accessAreaId: "none",
    startDate: "",
    endDate: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [scansLoading, setScansLoading] = useState(false);

  useEffect(() => {
    if (ticket) {
      setForm({
        name: ticket.name,
        firstName: ticket.firstName ?? "",
        lastName: ticket.lastName ?? "",
        ticketTypeName: ticket.ticketTypeName ?? "",
        barcode: ticket.barcode ?? "",
        qrCode: ticket.qrCode ?? "",
        rfidCode: ticket.rfidCode ?? "",
        status: ticket.status,
        accessAreaId: ticket.accessAreaId ? String(ticket.accessAreaId) : "none",
        startDate: toDateInput(ticket.startDate),
        endDate: toDateInput(ticket.endDate),
      });
      setError("");
      setTab("edit");
      setScans([]);
    }
  }, [ticket]);

  useEffect(() => {
    if (tab === "scans" && ticket && scans.length === 0) {
      setScansLoading(true);
      fetch(`/api/tickets/${ticket.id}/scans`)
        .then((r) => r.json())
        .then((data) => setScans(Array.isArray(data) ? data : []))
        .catch(() => setScans([]))
        .finally(() => setScansLoading(false));
    }
  }, [tab, ticket, scans.length]);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    setSaving(true);
    setError("");

    const payload: Record<string, unknown> = {
      name: form.name,
      status: form.status,
      firstName: form.firstName || null,
      lastName: form.lastName || null,
      ticketTypeName: form.ticketTypeName || null,
      barcode: form.barcode || null,
      qrCode: form.qrCode || null,
      rfidCode: form.rfidCode || null,
      accessAreaId: form.accessAreaId && form.accessAreaId !== "none" ? Number(form.accessAreaId) : null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
    };

    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.formErrors?.[0] ?? "Fehler beim Speichern");
      } else {
        onClose();
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!ticket || !confirm(`Ticket "${ticket.name}" wirklich löschen?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const statusColor = {
    VALID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    INVALID: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    PROTECTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  }[ticket?.status ?? "VALID"] ?? "";

  const resultIcon = (result: string) => {
    if (result === "GRANTED") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (result === "PROTECTED") return <ShieldAlert className="h-4 w-4 text-amber-500" />;
    return <XCircle className="h-4 w-4 text-rose-500" />;
  };

  const resultLabel = (result: string) => {
    if (result === "GRANTED") return "Gewährt";
    if (result === "PROTECTED") return "Geschützt";
    return "Abgelehnt";
  };

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogTitle className="leading-tight">{ticket?.name}</DialogTitle>
            <div className="flex items-center gap-2 shrink-0">
              {ticket?.source && (
                <Badge variant="secondary" className="text-xs">{ticket.source}</Badge>
              )}
              <Badge className={`text-xs ${statusColor}`}>
                {ticket?.status === "VALID" ? "Gültig" : ticket?.status === "INVALID" ? "Ungültig" : "Geschützt"}
              </Badge>
              <Badge variant="outline" className="text-xs font-mono">
                {ticket?._count.scans} Scans
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "edit"
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => setTab("scans")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "scans"
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <ScanLine className="h-3.5 w-3.5" />
            Scan-Historie ({ticket?._count.scans ?? 0})
          </button>
        </div>

        {tab === "edit" && (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="e-name">Name <span className="text-rose-500">*</span></Label>
              <Input id="e-name" value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-first">Vorname</Label>
                <Input id="e-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Max" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-last">Nachname</Label>
                <Input id="e-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Mustermann" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="e-type">Ticket-Typ</Label>
              <Input id="e-type" value={form.ticketTypeName} onChange={(e) => set("ticketTypeName", e.target.value)} placeholder="z.B. Tageskarte" />
            </div>

            <div className="space-y-1.5">
              <Label>Code</Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <span className="text-xs text-slate-500">Barcode</span>
                  <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} className="font-mono text-xs" placeholder="123456789" />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-slate-500">QR-Code</span>
                  <Input value={form.qrCode} onChange={(e) => set("qrCode", e.target.value)} className="font-mono text-xs" placeholder="QR..." />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-slate-500">RFID</span>
                  <Input value={form.rfidCode} onChange={(e) => set("rfidCode", e.target.value)} className="font-mono text-xs" placeholder="RFID..." />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Zugangsbereich</Label>
                <Select value={form.accessAreaId} onValueChange={(v) => set("accessAreaId", v)}>
                  <SelectTrigger><SelectValue placeholder="Alle Bereiche" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Alle Bereiche</SelectItem>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VALID">Gültig</SelectItem>
                    <SelectItem value="INVALID">Ungültig</SelectItem>
                    <SelectItem value="PROTECTED">Geschützt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-start">Gültig ab</Label>
                <Input id="e-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-end">Gültig bis</Label>
                <Input id="e-end" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
              </div>
            </div>

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <Separator className="dark:bg-slate-800" />

            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={deleting || saving}
                className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                Löschen
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting}>Abbrechen</Button>
                <Button type="submit" disabled={saving || deleting || !form.name.trim()} className="bg-indigo-600 hover:bg-indigo-700 min-w-28">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" />Speichern</>}
                </Button>
              </div>
            </div>
          </form>
        )}

        {tab === "scans" && (
          <div className="space-y-2">
            {scansLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            )}
            {!scansLoading && scans.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">Keine Scans vorhanden</p>
            )}
            {!scansLoading && scans.length > 0 && (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[400px] overflow-y-auto">
                {scans.map((scan) => (
                  <div key={scan.id} className="flex items-center gap-3 py-2.5 px-1">
                    {resultIcon(scan.result)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {resultLabel(scan.result)}
                      </p>
                      {scan.device?.name && (
                        <p className="text-xs text-slate-400 truncate">{scan.device.name}</p>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 font-mono shrink-0">
                      {fmtDateTime(scan.scanTime)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
