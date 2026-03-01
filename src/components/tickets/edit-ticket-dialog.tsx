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
import { ChevronDown, Loader2, Trash2, Save, Pencil, ScanLine, CheckCircle2, XCircle, ShieldAlert, Camera, CalendarDays } from "lucide-react";
import { cn, fmtDateTime } from "@/lib/utils";

interface AnnyBookingEntry {
  id: string;
  start: string | null;
  end: string | null;
  status: string | null;
}

function parseAnnyEntries(qrCode: string | null): AnnyBookingEntry[] {
  if (!qrCode) return [];
  try {
    const parsed = JSON.parse(qrCode);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((e: AnnyBookingEntry) => {
      const key = e.id || `${e.start}|${e.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { /* not JSON */ }
  return [];
}

function fmtBookingDate(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtBookingTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function annyStatusLabel(status: string | null): { label: string; color: string } {
  if (!status) return { label: "–", color: "text-slate-400" };
  const s = status.toLowerCase();
  if (s === "confirmed" || s === "pending") return { label: "Bestätigt", color: "text-emerald-600 dark:text-emerald-400" };
  if (s === "checked_in") return { label: "Eingecheckt", color: "text-sky-600 dark:text-sky-400" };
  if (s === "checked_out" || s === "completed") return { label: "Abgeschlossen", color: "text-slate-500" };
  if (s === "cancelled" || s === "canceled") return { label: "Storniert", color: "text-rose-600 dark:text-rose-400" };
  if (s === "no_show") return { label: "Nicht erschienen", color: "text-amber-600 dark:text-amber-400" };
  return { label: status, color: "text-slate-500" };
}
import { CameraCapture } from "./camera-capture";

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
  subscriptionId: number | null;
  serviceId: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  validityType: string;
  slotStart: string | null;
  slotEnd: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | string | null;
  profileImage: string | null;
  uuid: string | null;
  source: string | null;
  _count: { scans: number };
}

interface Area {
  id: number;
  name: string;
}

interface Sub {
  id: number;
  name: string;
  areaIds?: number[];
}

interface Svc {
  id: number;
  name: string;
  requiresPhoto?: boolean;
  areaIds?: number[];
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
  subscriptions?: Sub[];
  services?: Svc[];
  autoFocusCode?: boolean;
  onClose: () => void;
}

function toDateInput(val: Date | string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export function EditTicketDialog({ ticket, areas, subscriptions = [], services = [], autoFocusCode, onClose }: EditTicketDialogProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"edit" | "bookings" | "scans">("edit");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    ticketTypeName: "",
    code: "",
    status: "VALID",
    accessAreaId: "none",
    subscriptionId: "none",
    serviceId: "none",
    startDate: "",
    endDate: "",
    validityType: "DATE_RANGE",
    slotStart: "",
    slotEnd: "",
    validityDurationMinutes: "",
  });
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedService = services.find((s) => String(s.id) === form.serviceId);
  const needsPhoto = !!selectedService?.requiresPhoto && !profileImage;

  useEffect(() => {
    if (ticket) {
      setForm({
        firstName: ticket.firstName ?? "",
        lastName: ticket.lastName ?? "",
        ticketTypeName: ticket.ticketTypeName ?? "",
        code: ticket.barcode || (ticket.source !== "ANNY" ? ticket.qrCode : null) || ticket.rfidCode || "",
        status: ticket.status,
        accessAreaId: ticket.accessAreaId ? String(ticket.accessAreaId) : "none",
        subscriptionId: ticket.subscriptionId ? String(ticket.subscriptionId) : "none",
        serviceId: ticket.serviceId ? String(ticket.serviceId) : "none",
        startDate: toDateInput(ticket.startDate),
        endDate: toDateInput(ticket.endDate),
        validityType: ticket.validityType ?? "DATE_RANGE",
        slotStart: ticket.slotStart ?? "",
        slotEnd: ticket.slotEnd ?? "",
        validityDurationMinutes: ticket.validityDurationMinutes ? String(ticket.validityDurationMinutes) : "",
      });
      setProfileImage(ticket.profileImage ?? null);
      setError("");
      setTab("edit");
      setScans([]);
      setCameraOpen(false);
    }
  }, [ticket]);

  useEffect(() => {
    if (!ticket || cameraOpen || profileImage) return;
    const svc = services.find((s) => s.id === ticket.serviceId);
    if (svc?.requiresPhoto && !ticket.profileImage) {
      const timer = setTimeout(() => setCameraOpen(true), 400);
      return () => clearTimeout(timer);
    }
  }, [ticket, services, profileImage, cameraOpen]);

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

    const fullName = `${form.firstName} ${form.lastName}`.trim() || "Ticket";
    const isAnny = ticket.source === "ANNY";
    const payload: Record<string, unknown> = {
      name: fullName,
      status: form.status,
      firstName: form.firstName || null,
      lastName: form.lastName || null,
      serviceId: form.serviceId && form.serviceId !== "none" ? Number(form.serviceId) : null,
      ticketTypeName: form.serviceId && form.serviceId !== "none"
        ? (services.find((s) => String(s.id) === form.serviceId)?.name ?? form.ticketTypeName ?? null)
        : (form.ticketTypeName || null),
      barcode: form.code || null,
      ...(!isAnny && { qrCode: form.code || null }),
      rfidCode: form.code || null,
      accessAreaId: form.accessAreaId && form.accessAreaId !== "none" ? Number(form.accessAreaId) : null,
      subscriptionId: form.subscriptionId && form.subscriptionId !== "none" ? Number(form.subscriptionId) : null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
      validityType: form.validityType,
      slotStart: form.validityType === "TIME_SLOT" && form.slotStart ? form.slotStart : null,
      slotEnd: form.validityType === "TIME_SLOT" && form.slotEnd ? form.slotEnd : null,
      validityDurationMinutes: form.validityType === "DURATION" && form.validityDurationMinutes
        ? Number(form.validityDurationMinutes) : null,
      profileImage: profileImage,
    };

    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error?.formErrors?.[0] ?? data.error ?? `Fehler ${res.status}`);
        } catch {
          setError(`Server-Fehler (${res.status})`);
        }
      } else {
        onClose();
        router.refresh();
      }
    } catch (err) {
      setError(`Netzwerkfehler: ${err instanceof Error ? err.message : "Unbekannt"}`);

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
    REDEEMED: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <div
              className={`relative group h-14 w-14 rounded-xl ${needsPhoto ? "ring-2 ring-amber-400 ring-offset-2 dark:ring-offset-slate-950" : ""} bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer overflow-hidden hover:border-indigo-400 transition-all shrink-0`}
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
                <Camera className={`h-5 w-5 ${needsPhoto ? "text-amber-500" : "text-slate-400"}`} />
              )}
              {profileImage && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setProfileImage(null); }}
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-slate-700 text-white flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <DialogHeader className="p-0">
                <DialogTitle className="text-base leading-tight truncate text-left">
                  {[ticket?.firstName, ticket?.lastName].filter(Boolean).join(" ") || ticket?.name}
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-1.5 mt-1">
                {ticket?.source && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{ticket.source}</Badge>
                )}
                <Badge className={`text-[10px] px-1.5 py-0 ${statusColor}`}>
                  {ticket?.status === "VALID" ? "Gültig" : ticket?.status === "REDEEMED" ? "Eingelöst" : ticket?.status === "INVALID" ? "Ungültig" : "Geschützt"}
                </Badge>
                {needsPhoto && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Foto fehlt
                  </Badge>
                )}
              </div>
              {ticket?.ticketTypeName && (
                <p className="text-xs text-slate-400 mt-0.5 truncate">{ticket.ticketTypeName}</p>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        {(() => {
          const isAnny = ticket?.source === "ANNY";
          const annyEntries = isAnny ? parseAnnyEntries(ticket?.qrCode ?? null) : [];
          const tabClass = (active: boolean) =>
            `flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium transition-colors border-b-2 ${
              active
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`;

          return (
            <div className="flex border-b border-slate-200 dark:border-slate-800 px-5">
              <button type="button" onClick={() => setTab("edit")} className={tabClass(tab === "edit")}>
                <Pencil className="h-3 w-3" />
                Bearbeiten
              </button>
              {isAnny && annyEntries.length > 0 && (
                <button type="button" onClick={() => setTab("bookings")} className={tabClass(tab === "bookings")}>
                  <CalendarDays className="h-3 w-3" />
                  Buchungen ({annyEntries.length})
                </button>
              )}
              <button type="button" onClick={() => setTab("scans")} className={tabClass(tab === "scans")}>
                <ScanLine className="h-3 w-3" />
                Scans ({ticket?._count.scans ?? 0})
              </button>
            </div>
          );
        })()}

        {tab === "edit" && (
          <form onSubmit={handleSave} className="px-5 py-4 space-y-3">
            {cameraOpen && (
              <CameraCapture
                onCapture={(dataUrl) => { setProfileImage(dataUrl); setCameraOpen(false); }}
                onClose={() => setCameraOpen(false)}
              />
            )}

            {/* 1. Code (primary) */}
            <div className="space-y-1">
              <Label htmlFor="e-code" className="text-xs flex items-center gap-1 font-medium">
                <ScanLine className="h-3.5 w-3.5 text-indigo-500" />Code
              </Label>
              <Input id="e-code" value={form.code} onChange={(e) => set("code", e.target.value)} className="font-mono text-sm h-10" placeholder="Scannen oder eingeben …" autoComplete="off" autoFocus={autoFocusCode} />
            </div>

            {/* 2. Name */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="e-first" className="text-xs">Vorname</Label>
                <Input id="e-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Vorname" required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="e-last" className="text-xs">Nachname</Label>
                <Input id="e-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Nachname" required className="h-9" />
              </div>
            </div>

            {/* 3. Ticket-Typ (Service) */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Ticket-Typ / Service</Label>
              {services.length > 0 ? (
                <Select value={form.serviceId} onValueChange={(v) => {
                  set("serviceId", v);
                  if (v !== "none") {
                    const svc = services.find((s) => String(s.id) === v);
                    if (svc) {
                      set("ticketTypeName", svc.name);
                      if (svc.areaIds?.length && form.accessAreaId === "none") {
                        set("accessAreaId", String(svc.areaIds[0]));
                      }
                    }
                  }
                }}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Kein Service" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Service</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id="e-type" value={form.ticketTypeName} onChange={(e) => set("ticketTypeName", e.target.value)} placeholder="z.B. Tageskarte" className="h-9" />
              )}
            </div>

            {/* 4. Details (einklappbar) */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setDetailsOpen(!detailsOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <span>Details (Resource, Status, Gültigkeit)</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")} />
              </button>

              {detailsOpen && (
                <div className="px-3 pb-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Resource</Label>
                      <Select value={form.accessAreaId} onValueChange={(v) => set("accessAreaId", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Keine" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Resource</SelectItem>
                          {areas.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Abo</Label>
                      <Select value={form.subscriptionId} onValueChange={(v) => {
                        set("subscriptionId", v);
                        if (v !== "none") {
                          const sub = subscriptions.find((s) => String(s.id) === v);
                          if (sub?.areaIds?.length && form.accessAreaId === "none") {
                            set("accessAreaId", String(sub.areaIds[0]));
                          }
                        }
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Kein Abo" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Kein Abo</SelectItem>
                          {subscriptions.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Status</Label>
                      <Select value={form.status} onValueChange={(v) => set("status", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="VALID">Gültig</SelectItem>
                          <SelectItem value="REDEEMED">Eingelöst</SelectItem>
                          <SelectItem value="INVALID">Ungültig</SelectItem>
                          <SelectItem value="PROTECTED">Geschützt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Gültigkeit</Label>
                      <Select value={form.validityType} onValueChange={(v) => set("validityType", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DATE_RANGE">Zeitraum</SelectItem>
                          <SelectItem value="TIME_SLOT">Zeitslot</SelectItem>
                          <SelectItem value="DURATION">Dauer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="e-start" className="text-[11px] text-slate-500">Gültig ab</Label>
                      <Input id="e-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="e-end" className="text-[11px] text-slate-500">Gültig bis</Label>
                      <Input id="e-end" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  {form.validityType === "TIME_SLOT" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="e-slot-start" className="text-[11px] text-slate-500">Slot von</Label>
                        <Input id="e-slot-start" type="time" value={form.slotStart} onChange={(e) => set("slotStart", e.target.value)} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="e-slot-end" className="text-[11px] text-slate-500">Slot bis</Label>
                        <Input id="e-slot-end" type="time" value={form.slotEnd} onChange={(e) => set("slotEnd", e.target.value)} className="h-8 text-xs" />
                      </div>
                    </div>
                  )}

                  {form.validityType === "DURATION" && (
                    <div className="space-y-1">
                      <Label htmlFor="e-duration" className="text-[11px] text-slate-500">Dauer (Minuten)</Label>
                      <div className="flex gap-2 items-center">
                        <Input id="e-duration" type="number" min="1" placeholder="z.B. 120" value={form.validityDurationMinutes} onChange={(e) => set("validityDurationMinutes", e.target.value)} className="h-8 text-xs flex-1" />
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => set("validityDurationMinutes", "1440")}>
                          1 Tag
                        </Button>
                      </div>
                      {ticket?.firstScanAt && (
                        <p className="text-[10px] text-slate-400">1. Scan: {fmtDateTime(ticket.firstScanAt)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 rounded-lg">{error}</p>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={deleting || saving}
                className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 h-8 text-xs">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                Löschen
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving || deleting} className="h-8">Abbrechen</Button>
                <Button type="submit" size="sm" disabled={saving || deleting || (!form.firstName.trim() && !form.lastName.trim())} className="bg-indigo-600 hover:bg-indigo-700 min-w-24 h-8">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1" />Speichern</>}
                </Button>
              </div>
            </div>
          </form>
        )}

        {tab === "bookings" && ticket?.source === "ANNY" && (() => {
          const entries = parseAnnyEntries(ticket.qrCode);
          return (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[350px] overflow-y-auto px-5 py-2">
              {entries.map((entry, i) => {
                const st = annyStatusLabel(entry.status);
                const startTime = fmtBookingTime(entry.start);
                const endTime = fmtBookingTime(entry.end);
                const timeRange = startTime && endTime ? `${startTime}–${endTime}` : startTime || endTime || "";

                return (
                  <div key={entry.id || i} className="flex items-center gap-2.5 py-2 px-1">
                    <div className="h-6 w-6 rounded bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {fmtBookingDate(entry.start)}
                        {timeRange && <span className="text-slate-400 font-mono ml-1.5">{timeRange}</span>}
                      </p>
                    </div>
                    <span className={`text-[11px] font-medium shrink-0 ${st.color}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {tab === "scans" && (
          <div className="px-5 py-2">
            {scansLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            )}
            {!scansLoading && scans.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">Keine Scans vorhanden</p>
            )}
            {!scansLoading && scans.length > 0 && (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[350px] overflow-y-auto">
                {scans.map((scan) => (
                  <div key={scan.id} className="flex items-center gap-2.5 py-2 px-1">
                    {resultIcon(scan.result)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {resultLabel(scan.result)}
                        {scan.device?.name && <span className="text-slate-400 ml-1.5">· {scan.device.name}</span>}
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0">
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
