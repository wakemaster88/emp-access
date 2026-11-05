"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Notice, type NoticeTone } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, Loader2, Car, History, Play, CheckCircle2, XCircle, Cctv, Link2, UserPlus, DoorOpen, ParkingSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ParkingLot } from "./parking-lot";
import type { ParkingCamMatch, ParkingSnapshot } from "@/lib/parking";

export interface SightingRow {
  id: number;
  plate: string | null;
  source: string;
  matched: boolean;
  shellyTriggered: boolean;
  shellyOk: boolean | null;
  seenAt: string;
  hasSnapshot: boolean;
  camera: { id: number; name: string } | null;
  allowedVehicle: { id: number; name: string; plate: string } | null;
}

export interface VehicleRow {
  id: number;
  name: string;
  plate: string;
  isActive: boolean;
  notes: string | null;
  cameraId: number | null;
  doorbirdCameraId: number | null;
  shellyDeviceId: number | null;
  shellyAction: string;
  timerSeconds: number | null;
  cooldownMinutes: number;
  notifyOnDetection: boolean;
  lastTriggeredAt: string | null;
  shellyDevice: { id: number; name: string } | null;
  camera: { id: number; name: string } | null;
  doorbird: { id: number; name: string } | null;
  _count: { sightings: number };
  recentSightings: SightingRow[];
}

export interface ShellyOption { id: number; name: string }
export interface CameraOption { id: number; name: string; kind?: string }

interface Props {
  vehicles: VehicleRow[];
  sightings: SightingRow[];
  shellyDevices: ShellyOption[];
  cameras: CameraOption[];
  parkingCameras: ParkingCamMatch[];
  hubOnline: boolean;
  hubName: string | null;
  parking: ParkingSnapshot | null;
}

const EMPTY = {
  name: "",
  plate: "",
  isActive: true,
  notes: "",
  cameraId: "",
  doorbirdCameraId: "",
  shellyDeviceId: "",
  shellyAction: "ON",
  timerSeconds: "3",
  cooldownMinutes: "2",
  notifyOnDetection: false,
};

export function VehiclesClient({
  vehicles,
  sightings,
  shellyDevices,
  cameras,
  parkingCameras,
  hubOnline,
  hubName,
  parking,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"parking" | "vehicles" | "history">("parking");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  // Ergebnis der Prüfung mit Tönung: Fehler, Treffer und Hinweis sehen verschieden aus (docs/design-regeln.md, Abschnitt 16).
  const [manualMsg, setManualMsg] = useState<{ tone: NoticeTone; text: string } | null>(null);
  // Rückmeldung von „Auslösen“ in der Karte des Fahrzeugs statt Browser-Alert.
  const [triggerMsg, setTriggerMsg] = useState<{ id: number; tone: NoticeTone; text: string } | null>(null);
  const [sightingError, setSightingError] = useState("");
  // Rückfrage vor dem Löschen (Abschnitt 18); der Inhalt bleibt stehen, solange der Dialog ausblendet.
  const [pendingDelete, setPendingDelete] = useState<{ title: string; run: () => Promise<void> } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSighting, setAssignSighting] = useState<SightingRow | null>(null);
  const [assignMode, setAssignMode] = useState<"existing" | "new" | "plate">("existing");
  const [assignVehicleId, setAssignVehicleId] = useState("");
  const [assignPlate, setAssignPlate] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setError("");
    setOpen(true);
  }

  function openEdit(v: VehicleRow) {
    setEditing(v);
    setForm({
      name: v.name,
      plate: v.plate,
      isActive: v.isActive,
      notes: v.notes ?? "",
      cameraId: v.cameraId ? String(v.cameraId) : "",
      doorbirdCameraId: v.doorbirdCameraId ? String(v.doorbirdCameraId) : "",
      shellyDeviceId: v.shellyDeviceId ? String(v.shellyDeviceId) : "",
      shellyAction: v.shellyAction || "ON",
      timerSeconds: v.timerSeconds != null ? String(v.timerSeconds) : "",
      cooldownMinutes: String(v.cooldownMinutes),
      notifyOnDetection: v.notifyOnDetection,
    });
    setError("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        plate: form.plate.trim(),
        isActive: form.isActive,
        notes: form.notes.trim() || null,
        cameraId: form.cameraId ? Number(form.cameraId) : null,
        doorbirdCameraId: form.doorbirdCameraId ? Number(form.doorbirdCameraId) : null,
        shellyDeviceId: form.shellyDeviceId ? Number(form.shellyDeviceId) : null,
        shellyAction: form.shellyAction,
        timerSeconds: form.timerSeconds ? Number(form.timerSeconds) : null,
        cooldownMinutes: Number(form.cooldownMinutes) || 2,
        notifyOnDetection: form.notifyOnDetection,
      };
      const res = await fetch(editing ? `/api/vehicles/${editing.id}` : "/api/vehicles", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        return;
      }
      setOpen(false);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  function askDelete(title: string, run: () => Promise<void>) {
    setPendingDelete({ title, run });
    setConfirmOpen(true);
  }

  async function remove(v: VehicleRow) {
    await fetch(`/api/vehicles/${v.id}`, { method: "DELETE" });
    refresh();
  }

  async function trigger(v: VehicleRow) {
    setTriggeringId(v.id);
    setTriggerMsg(null);
    try {
      const res = await fetch(`/api/vehicles/${v.id}/trigger`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTriggerMsg({ id: v.id, tone: "danger", text: typeof data.error === "string" ? data.error : "Auslösen fehlgeschlagen" });
      } else if (data.shellyTriggered && data.shellyOk === false) {
        setTriggerMsg({ id: v.id, tone: "warning", text: "Erkannt, aber Shelly nicht erreichbar." });
      }
      refresh();
    } finally {
      setTriggeringId(null);
    }
  }

  async function submitManualSighting(e: React.FormEvent) {
    e.preventDefault();
    if (!manualPlate.trim()) return;
    setManualBusy(true);
    setManualMsg(null);
    try {
      const res = await fetch("/api/vehicle-sightings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate: manualPlate.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setManualMsg({ tone: "danger", text: typeof data.error === "string" ? data.error : "Fehler" });
      } else if (data.matched) {
        setManualMsg(
          data.shellyTriggered
            ? { tone: data.shellyOk ? "success" : "warning", text: `Match: ${data.vehicleName} – Shelly ${data.shellyOk ? "OK" : "Fehler"}` }
            : { tone: "warning", text: `Match: ${data.vehicleName} (kein Shelly / Cooldown)` }
        );
        setManualPlate("");
        refresh();
      } else {
        setManualMsg({ tone: "warning", text: "Kein erlaubtes Fahrzeug mit diesem Kennzeichen." });
        refresh();
      }
    } finally {
      setManualBusy(false);
    }
  }

  function openAssign(s: SightingRow) {
    setAssignSighting(s);
    setAssignMode(vehicles.length > 0 ? "existing" : "new");
    setAssignVehicleId("");
    setAssignPlate(s.plate ?? "");
    setAssignName("");
    setAssignError("");
    setAssignOpen(true);
  }

  async function confirmAssign() {
    if (!assignSighting) return;
    setAssignBusy(true);
    setAssignError("");
    try {
      let body: Record<string, unknown> = {};
      if (assignMode === "existing") {
        if (!assignVehicleId) {
          setAssignError("Fahrzeug wählen");
          return;
        }
        body = { allowedVehicleId: Number(assignVehicleId) };
      } else if (assignMode === "new") {
        const plate = assignPlate.trim();
        if (!plate) {
          setAssignError("Kennzeichen fehlt");
          return;
        }
        body = {
          createVehicle: {
            name: assignName.trim() || plate,
            plate,
          },
        };
      } else {
        const plate = assignPlate.trim();
        if (!plate) {
          setAssignError("Kennzeichen fehlt");
          return;
        }
        body = { plate };
      }

      const res = await fetch(`/api/vehicle-sightings/${assignSighting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAssignError(typeof data.error === "string" ? data.error : "Zuordnen fehlgeschlagen");
        return;
      }
      setAssignOpen(false);
      refresh();
    } finally {
      setAssignBusy(false);
    }
  }

  async function deleteSighting(s: SightingRow) {
    setDeletingId(s.id);
    setSightingError("");
    try {
      const res = await fetch(`/api/vehicle-sightings/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSightingError(typeof data.error === "string" ? data.error : "Löschen fehlgeschlagen");
        return;
      }
      refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5 max-w-6xl">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-4 sm:gap-5">
        <TabsList>
          <TabsTrigger value="parking" className="gap-1.5">
            <ParkingSquare className="h-4 w-4" /> Parkplatz
          </TabsTrigger>
          <TabsTrigger value="vehicles" className="gap-1.5">
            <Car className="h-4 w-4" /> Erlaubte Fahrzeuge
            <Badge variant="secondary" className="ml-1 text-xs">{vehicles.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> Historie
          </TabsTrigger>
        </TabsList>

        <TabsContent value="parking" className="space-y-4 sm:space-y-5">
          <p className="text-sm text-muted-foreground">
            Live-Belegung der Parkflächen vom Hub (Kamera Halle). Kennzeichen kommen von der Einfahrt.
          </p>
          <ParkingLot
            cameras={parkingCameras}
            hubOnline={hubOnline}
            hubName={hubName}
            parking={parking}
            sightings={sightings}
            onAssign={(s) => {
              const full = sightings.find((x) => x.id === s.id);
              if (full) openAssign(full);
            }}
          />
        </TabsContent>

        <TabsContent value="vehicles" className="space-y-4 sm:space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Kennzeichen-Whitelist. Hub speichert Schnappschüsse; Match steuert Shelly und optional Push.
            </p>
            <Button onClick={openAdd} className="gap-1.5 shrink-0 max-sm:h-11">
              <Plus className="h-4 w-4" /> Fahrzeug hinzufügen
            </Button>
          </div>

          {vehicles.length === 0 ? (
            <Card className="py-0 sm:py-0">
              <EmptyState icon={Car} title="Noch keine Fahrzeuge" />
            </Card>
          ) : (
            // Eine Spalte mit fester Breite (minmax 0): sonst wächst die Spalte auf die Breite der
            // Sichtungsleiste und schiebt alle Karten auf dem Handy über den Rand.
            <div className="grid grid-cols-1 gap-4 sm:gap-5">
              {vehicles.map((v) => {
                const recent = v.recentSightings ?? [];
                return (
                  <Card key={v.id} className={cn(!v.isActive && "opacity-60")}>
                    <CardContent className="space-y-3">
                      {/* Kopf: Name und Merkmale links, Handlungen rechts (auf dem Handy darunter). */}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-64">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[15px] font-semibold tracking-tight">{v.name}</h3>
                            <Badge variant="mono">{v.plate}</Badge>
                            {!v.isActive && <Badge variant="neutral">Pausiert</Badge>}
                            <Badge variant="outline" className="text-xs gap-1">
                              <Cctv className="h-3 w-3" />
                              {v.camera ? v.camera.name : "Alle Kameras"}
                            </Badge>
                            {v.notifyOnDetection && <Badge variant="outline" className="text-xs">Push</Badge>}
                            {v.shellyDevice ? (
                              <Badge variant="outline" className="text-xs">
                                → {v.shellyDevice.name}
                              </Badge>
                            ) : (
                              <Badge variant="neutral" className="text-xs">kein Shelly</Badge>
                            )}
                            {v.doorbird && (
                              <Badge variant="outline" className="text-xs gap-1">
                                <DoorOpen className="h-3 w-3" />
                                {v.doorbird.name}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {v._count.sightings} Sichtung{v._count.sightings !== 1 ? "en" : ""}
                            {v.notes ? <> · {v.notes}</> : null}
                          </p>
                        </div>
                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          <Button variant="outline" size="icon-sm" className="max-sm:size-11" title="Auslösen" aria-label="Auslösen" onClick={() => trigger(v)} disabled={triggeringId === v.id || !v.shellyDeviceId}>
                            {triggeringId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="outline" size="icon-sm" className="max-sm:size-11" title="Bearbeiten" aria-label="Bearbeiten" onClick={() => openEdit(v)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="icon-sm" className="text-destructive max-sm:size-11" title="Löschen" aria-label="Löschen" onClick={() => askDelete(`Fahrzeug „${v.name}" (${v.plate}) löschen?`, () => remove(v))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {triggerMsg?.id === v.id && <Notice tone={triggerMsg.tone} compact title={triggerMsg.text} />}

                      {recent.length > 0 ? (
                        <div className="border-t border-border pt-3">
                          <p className="text-label mb-2 flex items-center gap-1.5">
                            <History className="h-3.5 w-3.5" /> Letzte Sichtungen
                          </p>
                          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
                            {recent.map((s) => (
                              <div key={s.id} className="glass-tile shrink-0 w-28 overflow-hidden">
                                {s.hasSnapshot ? (
                                  <a href={`/api/vehicle-sightings/${s.id}/snapshot`} target="_blank" rel="noreferrer" className="block aspect-square bg-muted">
                                    <img src={`/api/vehicle-sightings/${s.id}/snapshot`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                  </a>
                                ) : (
                                  <div className="aspect-square flex items-center justify-center text-muted-foreground/50">
                                    <Car className="h-5 w-5" />
                                  </div>
                                )}
                                <div className="px-2 py-1.5">
                                  <p className="text-[11px] font-mono text-muted-foreground">
                                    {new Date(s.seenAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">{s.camera?.name ?? "–"}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          {v._count.sightings > recent.length && (
                            <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setTab("history")}>
                              Alle {v._count.sightings} in Historie anzeigen
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="border-t border-border pt-3">
                          <p className="text-xs text-muted-foreground">Noch keine Sichtungen.</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 sm:space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Kennzeichen manuell prüfen</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitManualSighting} className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1.5 flex-1 min-w-[160px]">
                  <Label htmlFor="manual-plate">Kennzeichen</Label>
                  <Input id="manual-plate" value={manualPlate} onChange={(e) => setManualPlate(e.target.value)} placeholder="z.B. BOR-AB 123" className="font-mono uppercase max-sm:h-11" />
                </div>
                <Button type="submit" disabled={manualBusy || !manualPlate.trim()} className="gap-1.5 max-sm:h-11 max-sm:w-full">
                  {manualBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Prüfen & ggf. öffnen
                </Button>
              </form>
              {manualMsg && <Notice tone={manualMsg.tone} compact title={manualMsg.text} className="mt-2" />}
              <p className="text-xs text-muted-foreground mt-3">
                Unbekannte Kamerasichtungen kannst du zuordnen oder Kennzeichen nachtragen.
              </p>
            </CardContent>
          </Card>

          {sightingError && <Notice tone="danger" compact title={sightingError} />}

          {/* Tabelle bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand ein. */}
          <Card className="py-0 sm:py-0 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16 pl-4 sm:pl-[18px]">Bild</TableHead>
                      <TableHead>Zeit</TableHead>
                      <TableHead>Kennzeichen</TableHead>
                      <TableHead>Fahrzeug</TableHead>
                      <TableHead className="hidden sm:table-cell">Kamera</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead className="w-[1%] text-right pr-4 sm:pr-[18px]">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sightings.length === 0 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0 whitespace-normal">
                          <EmptyState compact icon={History} title="Noch keine Sichtungen." />
                        </TableCell>
                      </TableRow>
                    )}
                    {sightings.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-4 sm:pl-[18px]">
                          {s.hasSnapshot ? (
                            <button type="button" onClick={() => openAssign(s)} aria-label="Fahrzeug zuordnen" className="block h-12 w-12 overflow-hidden rounded-[10px] border border-glass-border bg-muted">
                              <img src={`/api/vehicle-sightings/${s.id}/snapshot`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                            </button>
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-dashed border-border text-muted-foreground/50">
                              <Car className="h-4 w-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(s.seenAt).toLocaleString("de-DE")}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {s.plate ?? <span className="text-muted-foreground">–</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.allowedVehicle?.name ?? <span className="text-muted-foreground">unbekannt</span>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {s.camera?.name ?? "–"}
                        </TableCell>
                        <TableCell>
                          {s.matched ? (
                            <Badge variant="success" className="gap-1 text-xs">
                              <CheckCircle2 className="h-3 w-3" /> ja
                            </Badge>
                          ) : (
                            <Badge variant="neutral" className="text-xs gap-1">
                              <XCircle className="h-3 w-3" /> nein
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-4 sm:pr-[18px]">
                          <div className="inline-flex items-center gap-1">
                            {!s.matched && (
                              <Button size="sm" variant="outline" className="gap-1 max-sm:h-11" onClick={() => openAssign(s)}>
                                <Link2 className="h-3.5 w-3.5" /> Zuordnen
                              </Button>
                            )}
                            <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive max-sm:size-11" title="Löschen" aria-label="Löschen" disabled={deletingId === s.id} onClick={() => askDelete("Diese Sichtung wirklich löschen?", () => deleteSighting(s))}>
                              {deletingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Fahrzeug bearbeiten" : "Fahrzeug hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="z.B. Lieferwagen Müller" className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Kennzeichen <span className="text-destructive">*</span></Label>
              <Input value={form.plate} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))} placeholder="z.B. BOR-AB 123" className="font-mono uppercase max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Kamera für Shelly</Label>
              <Select value={form.cameraId || "all"} onValueChange={(v) => setForm((f) => ({ ...f, cameraId: v === "all" ? "" : v }))}>
                <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Kameras</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Historie läuft auf allen Kameras. Shelly nur an gewählter Kamera (oder allen).</p>
            </div>
            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Push bei Erkennung</p>
                <p className="text-xs text-muted-foreground">Web-Push bei Kennzeichen-Match</p>
              </div>
              <Switch checked={form.notifyOnDetection} onCheckedChange={(v) => setForm((f) => ({ ...f, notifyOnDetection: v }))} />
            </div>
            {cameras.some((c) => c.kind === "DOORBIRD") && (
              <div className="space-y-1.5">
                <Label>DoorBird-Türöffner bei Erkennung</Label>
                <Select
                  value={form.doorbirdCameraId || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, doorbirdCameraId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine Türöffnung</SelectItem>
                    {cameras
                      .filter((c) => c.kind === "DOORBIRD")
                      .map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Öffnet die Tür automatisch, wenn dieses Kennzeichen erkannt wird (Cooldown gilt).
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Shelly bei Erkennung</Label>
              <Select value={form.shellyDeviceId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, shellyDeviceId: v === "none" ? "" : v }))}>
                <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Shelly</SelectItem>
                  {shellyDevices.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.shellyDeviceId && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Aktion</Label>
                  <Select value={form.shellyAction} onValueChange={(v) => setForm((f) => ({ ...f, shellyAction: v }))}>
                    <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ON">EIN</SelectItem>
                      <SelectItem value="OFF">AUS</SelectItem>
                      <SelectItem value="TOGGLE">TOGGLE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Timer (Sek.)</Label>
                  <Input type="number" min={1} value={form.timerSeconds} onChange={(e) => setForm((f) => ({ ...f, timerSeconds: e.target.value }))} className="max-sm:h-11" />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Cooldown (Minuten)</Label>
              <Input type="number" min={1} value={form.cooldownMinutes} onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: e.target.value }))} className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="max-sm:h-11" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label>Aktiv</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
            {error && <Notice tone="danger" compact title={error} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="max-sm:h-11">Abbrechen</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.plate.trim()} className="gap-1.5 max-sm:h-11">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fahrzeug zuordnen</DialogTitle>
          </DialogHeader>
          {assignSighting && (
            <div className="space-y-4">
              {assignSighting.hasSnapshot && (
                // Kamerabild auf schwarzem Grund (Ausnahme laut Farbregeln), auch an den Rändern von object-contain.
                <div className="overflow-hidden rounded-xl border border-border bg-black">
                  <img src={`/api/vehicle-sightings/${assignSighting.id}/snapshot`} alt="" decoding="async" className="max-h-64 w-full object-contain" />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {new Date(assignSighting.seenAt).toLocaleString("de-DE")}
                {assignSighting.camera ? ` · ${assignSighting.camera.name}` : ""}
              </p>
              {/* Art der Zuordnung als Segmentwahl; kleine Größe und keine Symbole auf dem Handy, sonst läuft die Kapsel bei 390 px über. */}
              <Segmented
                aria-label="Fahrzeug zuordnen"
                value={assignMode}
                onValueChange={setAssignMode}
                size="sm"
                stretch
                options={[
                  {
                    value: "existing",
                    label: <><Link2 className="h-3.5 w-3.5 max-sm:hidden" /> Bestehendes</>,
                    disabled: vehicles.length === 0,
                  },
                  {
                    value: "new",
                    label: <><UserPlus className="h-3.5 w-3.5 max-sm:hidden" /> Neu anlegen</>,
                  },
                  { value: "plate", label: "Nur Kennzeichen" },
                ]}
              />
              {assignMode === "existing" && (
                <div className="space-y-1.5">
                  <Label>Fahrzeug</Label>
                  <Select value={assignVehicleId} onValueChange={setAssignVehicleId}>
                    <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue placeholder="Fahrzeug wählen" /></SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>{v.name} ({v.plate})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {assignMode === "new" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={assignName} onChange={(e) => setAssignName(e.target.value)} placeholder="optional" className="max-sm:h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Kennzeichen <span className="text-destructive">*</span></Label>
                    <Input value={assignPlate} onChange={(e) => setAssignPlate(e.target.value)} className="font-mono uppercase max-sm:h-11" />
                  </div>
                </div>
              )}
              {assignMode === "plate" && (
                <div className="space-y-1.5">
                  <Label>Kennzeichen <span className="text-destructive">*</span></Label>
                  <Input value={assignPlate} onChange={(e) => setAssignPlate(e.target.value)} className="font-mono uppercase max-sm:h-11" />
                  <p className="text-xs text-muted-foreground">Match gegen Whitelist, falls bekannt.</p>
                </div>
              )}
              {assignError && <Notice tone="danger" compact title={assignError} />}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignBusy} className="max-sm:h-11">Abbrechen</Button>
            <Button onClick={confirmAssign} disabled={assignBusy} className="gap-1.5 max-sm:h-11">
              {assignBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Zuordnen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.title}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="max-sm:h-11"
              onClick={() => {
                if (pendingDelete) void pendingDelete.run();
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
