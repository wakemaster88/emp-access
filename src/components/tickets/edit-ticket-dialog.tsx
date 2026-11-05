"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, Loader2, Trash2, Save, Pencil, ScanLine, CheckCircle2, XCircle, ShieldAlert, Camera, CalendarDays, MapPin, X } from "lucide-react";
import { cn, fmtDateTime } from "@/lib/utils";

// Dialog auf dem Handy: Felder und Tasten 44 px hoch (docs/design-regeln.md, Abschnitt 16).
const FIELD = "h-11 sm:h-9";
const SELECT_FIELD = "w-full data-[size=default]:h-11 sm:data-[size=default]:h-9";

function isExpired(ticket: { endDate?: string | Date | null }): boolean {
  if (!ticket.endDate) return false;
  return new Date(ticket.endDate) < new Date();
}

/**
 * Ticket-Status als Badge in der festen Zustandsfarbe – eine Quelle für
 * Tickettabelle, diesen Dialog und die E-Abo-Auswertung.
 */
export function statusBadge(status: string, ticket?: { endDate?: string | Date | null; extras?: Record<string, unknown> | null }) {
  if (ticket && (status === "VALID" || status === "REDEEMED") && isExpired(ticket)) {
    return <Badge variant="danger">Abgelaufen</Badge>;
  }
  switch (status) {
    case "VALID":
      return <Badge variant="success">Gültig</Badge>;
    case "REDEEMED":
      return <Badge variant="info">Eingelöst</Badge>;
    case "INVALID":
      return <Badge variant="destructive">Ungültig</Badge>;
    case "PAUSED":
      // Zahlungs-Pause (Auto-Pause bei offener Rechnung) deutlich kennzeichnen.
      if (ticket?.extras && (ticket.extras as Record<string, unknown>).paymentPause) {
        return <Badge variant="danger">Zahlung offen</Badge>;
      }
      return <Badge variant="warning">Pausiert</Badge>;
    case "CANCELED":
      return <Badge variant="danger">Gekündigt</Badge>;
    case "PROTECTED":
      return <Badge variant="warning">Geschützt</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

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
  if (!status) return { label: "–", color: "text-muted-foreground" };
  const s = status.toLowerCase();
  if (s === "confirmed" || s === "pending") return { label: "Bestätigt", color: "text-success" };
  if (s === "checked_in") return { label: "Eingecheckt", color: "text-info" };
  if (s === "checked_out" || s === "completed") return { label: "Abgeschlossen", color: "text-muted-foreground" };
  if (s === "cancelled" || s === "canceled") return { label: "Storniert", color: "text-destructive" };
  if (s === "no_show") return { label: "Nicht erschienen", color: "text-warning" };
  return { label: status, color: "text-muted-foreground" };
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
  vereinId: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  validityType: string;
  slotStart: string | null;
  slotEnd: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | string | null;
  profileImage: string | null;
  birthDate: Date | string | null;
  uuid: string | null;
  source: string | null;
  extras?: Record<string, unknown> | null;
  _count: { scans: number };
  ticketAreas?: { accessArea: { id: number; name: string } }[];
}

interface Area {
  id: number;
  name: string;
}

interface Sub {
  id: number;
  name: string;
  areaIds?: number[];
  requiresRfid?: boolean;
}

interface Svc {
  id: number;
  name: string;
  requiresPhoto?: boolean;
  requiresRfid?: boolean;
  areaIds?: number[];
}

interface VereinRef {
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
  subscriptions?: Sub[];
  services?: Svc[];
  vereine?: VereinRef[];
  autoFocusCode?: boolean;
  onClose: () => void;
}

function toDateInput(val: Date | string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export function EditTicketDialog({ ticket, areas, subscriptions = [], services = [], vereine = [], autoFocusCode, onClose }: EditTicketDialogProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"edit" | "bookings" | "scans">("edit");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    ticketTypeName: "",
    code: "",
    status: "VALID",
    accessAreaId: "none",
    subscriptionId: "none",
    serviceId: "none",
    vereinId: "none",
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
  // Löschen fragt im Dialog nach (kein Browser-Dialog, keine zweite Ebene).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [pendingConflict, setPendingConflict] = useState<{
    label: string;
    type: string | null;
    payload: Record<string, unknown>;
  } | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedService = services.find((s) => String(s.id) === form.serviceId);
  const needsPhoto = !!selectedService?.requiresPhoto && !profileImage;

  // Abo/Service verlangt eine Karte, es ist aber keine hinterlegt. Dann ist
  // dieses Ticket nicht scanbar: Der Scanner findet ueber die Karte nur das
  // alte Ticket der Person und weist ab, sobald das abgelaufen ist.
  const selectedSub = subscriptions.find((s) => String(s.id) === form.subscriptionId);
  const needsCard =
    (!!selectedSub?.requiresRfid || !!selectedService?.requiresRfid)
    && !form.code.trim();

  useEffect(() => {
    if (ticket) {
      setForm({
        firstName: ticket.firstName ?? "",
        lastName: ticket.lastName ?? "",
        email: (ticket as { email?: string | null }).email ?? "",
        ticketTypeName: ticket.ticketTypeName ?? "",
        code: ticket.barcode || (ticket.source !== "ANNY" ? ticket.qrCode : null) || ticket.rfidCode || "",
        status: ticket.status,
        accessAreaId: ticket.accessAreaId ? String(ticket.accessAreaId) : "none",
        subscriptionId: ticket.subscriptionId ? String(ticket.subscriptionId) : "none",
        serviceId: ticket.serviceId ? String(ticket.serviceId) : "none",
        vereinId: ticket.vereinId ? String(ticket.vereinId) : "none",
        startDate: toDateInput(ticket.startDate),
        endDate: toDateInput(ticket.endDate),
        validityType: ticket.validityType ?? "DATE_RANGE",
        slotStart: ticket.slotStart ?? "",
        slotEnd: ticket.slotEnd ?? "",
        validityDurationMinutes: ticket.validityDurationMinutes ? String(ticket.validityDurationMinutes) : "",
      });
      setProfileImage(ticket.profileImage ?? null);
      setError("");
      setConfirmDelete(false);
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
      vereinId: form.vereinId && form.vereinId !== "none" ? Number(form.vereinId) : null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
      validityType: form.validityType,
      slotStart: form.validityType === "TIME_SLOT" && form.slotStart ? form.slotStart : null,
      slotEnd: form.validityType === "TIME_SLOT" && form.slotEnd ? form.slotEnd : null,
      validityDurationMinutes: form.validityType === "DURATION" && form.validityDurationMinutes
        ? Number(form.validityDurationMinutes) : null,
      profileImage: profileImage,
      email: form.email.trim() || null,
    };

    await submitWithPayload(payload);
  }

  async function submitWithPayload(payload: Record<string, unknown>) {
    if (!ticket) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errVal = data?.error as
          | {
              formErrors?: string[];
              code?: string;
              conflictTicketLabel?: string;
              conflictTicketType?: string | null;
            }
          | string
          | undefined;

        if (
          res.status === 409
          && typeof errVal === "object"
          && errVal?.code === "CODE_CONFLICT"
          && !payload.transferCode
        ) {
          setPendingConflict({
            label: errVal.conflictTicketLabel ?? "ein anderes Ticket",
            type: errVal.conflictTicketType ?? null,
            payload,
          });
          setError("");
          setSaving(false);
          return;
        }

        const msg =
          typeof errVal === "object"
            ? errVal?.formErrors?.[0] ?? `Fehler ${res.status}`
            : errVal ?? `Fehler ${res.status}`;
        setError(msg);
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

  async function confirmTransfer() {
    if (!pendingConflict) return;
    const retryPayload = { ...pendingConflict.payload, transferCode: true };
    setPendingConflict(null);
    await submitWithPayload(retryPayload);
  }

  async function handleDelete() {
    if (!ticket) return;
    setConfirmDelete(false);
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

  const annyEntries = ticket?.source === "ANNY" ? parseAnnyEntries(ticket.qrCode) : [];

  const resultIcon = (result: string) => {
    if (result === "GRANTED") return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (result === "PROTECTED") return <ShieldAlert className="h-4 w-4 text-warning" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const resultLabel = (result: string) => {
    if (result === "GRANTED") return "Gewährt";
    if (result === "PROTECTED") return "Geschützt";
    return "Abgelehnt";
  };

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {/* Header */}
        <div>
          <div className="flex items-start gap-3">
            {/* Foto-Kachel als Taste; „Foto entfernen“ daneben, mit Touch immer sichtbar. */}
            <div className="relative group shrink-0">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                aria-label="Kamera öffnen"
                className={cn(
                  "relative h-14 w-14 rounded-tile border border-input bg-field flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary/60 transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  needsPhoto && "ring-2 ring-warning ring-offset-2 ring-offset-popover",
                )}
              >
                {profileImage ? (
                  <>
                    <img src={profileImage} alt="" className="h-full w-full object-cover" />
                    {/* Abdunklung über dem Foto: schwarz und weiß sind auf Bildern erlaubt. */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="h-4 w-4 text-white" />
                    </div>
                  </>
                ) : (
                  <Camera className={`h-5 w-5 ${needsPhoto ? "text-warning" : "text-muted-foreground"}`} />
                )}
              </button>
              {profileImage && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  onClick={() => setProfileImage(null)}
                  aria-label="Foto entfernen"
                  className="absolute -top-2.5 -right-2.5 rounded-full pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <DialogHeader className="p-0">
                <DialogTitle className="text-base leading-tight truncate text-left">
                  {[ticket?.firstName, ticket?.lastName].filter(Boolean).join(" ") || ticket?.name}
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {ticket?.source && (
                  <Badge variant="neutral">{ticket.source}</Badge>
                )}
                {ticket && statusBadge(ticket.status, ticket)}
                {needsPhoto && (
                  <Badge variant="warning">
                    Foto fehlt
                  </Badge>
                )}
                {needsCard && (
                  <Badge variant="warning">
                    Karte fehlt
                  </Badge>
                )}
              </div>
              {ticket?.ticketTypeName && (
                <p className="text-xs text-muted-foreground mt-1 truncate">{ticket.ticketTypeName}</p>
              )}
              {ticket?.source === "EMP_CONTROL" && ticket.ticketAreas && ticket.ticketAreas.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1.5">
                  {ticket.ticketAreas.map((ta) => (
                    <Badge key={ta.accessArea.id} variant="secondary" className="font-normal">
                      <MapPin />
                      {ta.accessArea.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reiter als Kapsel; jeder Reiter hat seinen Inhaltsbereich (TabsContent). */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="edit" className="px-2.5">
              <Pencil className="size-3.5" />
              Bearbeiten
            </TabsTrigger>
            {annyEntries.length > 0 && (
              <TabsTrigger value="bookings" className="px-2.5">
                <CalendarDays className="size-3.5" />
                Buchungen ({annyEntries.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="scans" className="px-2.5">
              <ScanLine className="size-3.5" />
              Scans ({ticket?._count.scans ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="edit">
            <form onSubmit={handleSave} className="space-y-4">
              {cameraOpen && (
                <CameraCapture
                  onCapture={(dataUrl) => { setProfileImage(dataUrl); setCameraOpen(false); }}
                  onClose={() => setCameraOpen(false)}
                />
              )}

              {/* 1. Code (primary) */}
              <div className="space-y-1.5">
                <Label htmlFor="e-code" className="flex items-center gap-1.5">
                  <ScanLine className="h-3.5 w-3.5 text-primary" />Code
                </Label>
                <Input id="e-code" value={form.code} onChange={(e) => set("code", e.target.value)} className={cn("font-mono", FIELD)} placeholder="Scannen oder eingeben …" autoComplete="off" autoFocus={autoFocusCode} />
                {needsCard && (
                  <Notice tone="warning" compact>
                    Dieser Tarif verlangt eine Karte. Ohne Code ist das Ticket nicht
                    scanbar – hängt die Karte noch am alten Ticket, hier einscannen
                    und „Bändchen umhängen“ bestätigen.
                  </Notice>
                )}
              </div>

              {/* 2. Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e-first">Vorname</Label>
                  <Input id="e-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Vorname" required className={FIELD} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-last">Nachname</Label>
                  <Input id="e-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Nachname" required className={FIELD} />
                </div>
              </div>

              {/* 2b. Email (für automatische Mails) */}
              <div className="space-y-1.5">
                <Label htmlFor="e-email" className="flex items-center gap-1.5">
                  Email
                  <span className="text-muted-foreground font-normal text-xs">– für automatische Mails</span>
                </Label>
                <Input
                  id="e-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="name@example.com"
                  className={FIELD}
                  autoComplete="email"
                />
              </div>

              {/* 3. Ticket-Typ (Service) */}
              <div className="space-y-1.5">
                <Label>Ticket-Typ / Service</Label>
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
                    <SelectTrigger className={SELECT_FIELD}><SelectValue placeholder="Kein Service" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Service</SelectItem>
                      {services.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id="e-type" value={form.ticketTypeName} onChange={(e) => set("ticketTypeName", e.target.value)} placeholder="z.B. Tageskarte" className={FIELD} />
                )}
              </div>

              {/* 4. Details (einklappbar) */}
              <div className="rounded-tile border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(!detailsOpen)}
                  aria-expanded={detailsOpen}
                  className="w-full flex items-center justify-between gap-2 px-3 min-h-11 sm:min-h-9 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:bg-muted/50 outline-none transition-colors"
                >
                  <span>Details (Resource, Status, Gültigkeit)</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", detailsOpen && "rotate-180")} />
                </button>

                {detailsOpen && (
                  <div className="px-3 pb-3 pt-3 space-y-3 border-t border-border">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Resource</Label>
                        <Select value={form.accessAreaId} onValueChange={(v) => set("accessAreaId", v)}>
                          <SelectTrigger className={SELECT_FIELD}><SelectValue placeholder="Keine" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Keine Resource</SelectItem>
                            {areas.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Abo</Label>
                        <Select value={form.subscriptionId} onValueChange={(v) => {
                          set("subscriptionId", v);
                          if (v !== "none") {
                            const sub = subscriptions.find((s) => String(s.id) === v);
                            if (sub?.areaIds?.length && form.accessAreaId === "none") {
                              set("accessAreaId", String(sub.areaIds[0]));
                            }
                          }
                        }}>
                          <SelectTrigger className={SELECT_FIELD}><SelectValue placeholder="Kein Abo" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Kein Abo</SelectItem>
                            {subscriptions.map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Status</Label>
                        <Select value={form.status} onValueChange={(v) => set("status", v)}>
                          <SelectTrigger className={SELECT_FIELD}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="VALID">Gültig</SelectItem>
                            <SelectItem value="REDEEMED">Eingelöst</SelectItem>
                            <SelectItem value="INVALID">Ungültig</SelectItem>
                            <SelectItem value="PROTECTED">Geschützt</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gültigkeit</Label>
                        <Select value={form.validityType} onValueChange={(v) => set("validityType", v)}>
                          <SelectTrigger className={SELECT_FIELD}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DATE_RANGE">Zeitraum</SelectItem>
                            <SelectItem value="TIME_SLOT">Zeitslot</SelectItem>
                            <SelectItem value="DURATION">Dauer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {vereine.length > 0 && (
                      <div className="space-y-1.5">
                        <Label>Verein (Bulk-Zutritt)</Label>
                        <Select value={form.vereinId} onValueChange={(v) => set("vereinId", v)}>
                          <SelectTrigger className={SELECT_FIELD}><SelectValue placeholder="Kein Verein" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Kein Verein</SelectItem>
                            {vereine.map((v) => (
                              <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Mitglied erbt automatisch alle Resourcen des Vereins.</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="e-start">Gültig ab</Label>
                        <Input id="e-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className={FIELD} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="e-end">Gültig bis</Label>
                        <Input id="e-end" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className={FIELD} />
                      </div>
                    </div>

                    {form.validityType === "TIME_SLOT" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="e-slot-start">Slot von</Label>
                          <Input id="e-slot-start" type="time" value={form.slotStart} onChange={(e) => set("slotStart", e.target.value)} className={FIELD} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="e-slot-end">Slot bis</Label>
                          <Input id="e-slot-end" type="time" value={form.slotEnd} onChange={(e) => set("slotEnd", e.target.value)} className={FIELD} />
                        </div>
                      </div>
                    )}

                    {form.validityType === "DURATION" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="e-duration">Dauer (Minuten)</Label>
                        <div className="flex gap-2 items-center">
                          <Input id="e-duration" type="number" min="1" placeholder="z.B. 120" value={form.validityDurationMinutes} onChange={(e) => set("validityDurationMinutes", e.target.value)} className={cn("flex-1", FIELD)} />
                          <Button type="button" variant="outline" className={cn("shrink-0", FIELD)} onClick={() => set("validityDurationMinutes", "1440")}>
                            1 Tag
                          </Button>
                        </div>
                        {ticket?.firstScanAt && (
                          <p className="text-xs text-muted-foreground tabular-nums">1. Scan: {fmtDateTime(ticket.firstScanAt)}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {pendingConflict && (
                <Notice tone="warning" title="Code bereits vergeben">
                  <p>
                    Der Code ist aktuell Ticket{" "}
                    <span className="font-semibold text-foreground">{pendingConflict.label}</span>
                    {pendingConflict.type ? (
                      <span className="opacity-80"> ({pendingConflict.type})</span>
                    ) : null}{" "}
                    zugeordnet. Auf dieses Ticket umhängen? Das andere Ticket
                    verliert dann seinen Code.
                  </p>
                  {/* Auf dem Handy gestapelt, Bestätigen oben; der Hinweis trägt schon die Warnfarbe. */}
                  <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingConflict(null)}
                      disabled={saving}
                      className={cn("sm:flex-1", FIELD)}
                    >
                      Abbrechen
                    </Button>
                    <Button
                      type="button"
                      onClick={confirmTransfer}
                      disabled={saving}
                      className={cn("sm:flex-1", FIELD)}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Code umhängen"}
                    </Button>
                  </div>
                </Notice>
              )}

              {error && (
                <Notice tone="danger" compact title={error} />
              )}

              {confirmDelete && (
                <Notice tone="danger" title={`Ticket "${ticket?.name}" wirklich löschen?`}>
                  <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      autoFocus
                      className={cn("sm:flex-1", FIELD)}
                    >
                      Abbrechen
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleting}
                      className={cn("sm:flex-1", FIELD)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </Button>
                  </div>
                </Notice>
              )}

              {/* Löschen links, Abbrechen und Speichern rechts; auf dem Handy gestapelt, Speichern oben. */}
              <DialogFooter className="pt-1">
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={deleting || saving}
                  className={cn("text-muted-foreground hover:text-destructive hover:bg-destructive/10 sm:mr-auto", FIELD)}>
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Löschen
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting} className={FIELD}>Abbrechen</Button>
                <Button type="submit" disabled={saving || deleting || pendingConflict !== null || (!form.firstName.trim() && !form.lastName.trim())} className={cn("min-w-24", FIELD)}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Speichern</>}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {annyEntries.length > 0 && (
            <TabsContent value="bookings">
              <div className="divide-y divide-border max-h-[350px] overflow-y-auto overscroll-contain scrollbar-thin">
                {annyEntries.map((entry, i) => {
                  const st = annyStatusLabel(entry.status);
                  const startTime = fmtBookingTime(entry.start);
                  const endTime = fmtBookingTime(entry.end);
                  const timeRange = startTime && endTime ? `${startTime}–${endTime}` : startTime || endTime || "";

                  return (
                    <div key={entry.id || i} className="flex items-center gap-2.5 py-2.5 px-1">
                      <div className="h-6 w-6 rounded-[8px] bg-muted flex items-center justify-center shrink-0">
                        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {fmtBookingDate(entry.start)}
                          {timeRange && <span className="text-muted-foreground font-normal tabular-nums ml-1.5">{timeRange}</span>}
                        </p>
                      </div>
                      <span className={`text-[11px] font-medium shrink-0 ${st.color}`}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          )}

          <TabsContent value="scans">
            <div>
              {scansLoading && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lädt …
                </div>
              )}
              {!scansLoading && scans.length === 0 && (
                <EmptyState compact icon={ScanLine} title="Keine Scans vorhanden" />
              )}
              {!scansLoading && scans.length > 0 && (
                <div className="divide-y divide-border max-h-[350px] overflow-y-auto overscroll-contain scrollbar-thin">
                  {scans.map((scan) => (
                    <div key={scan.id} className="flex items-center gap-2.5 py-2.5 px-1">
                      {resultIcon(scan.result)}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {resultLabel(scan.result)}
                          {scan.device?.name && <span className="text-muted-foreground font-normal ml-1.5">· {scan.device.name}</span>}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {fmtDateTime(scan.scanTime)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
