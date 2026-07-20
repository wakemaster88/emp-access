"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Plus, Pencil, Trash2, Loader2, Car, History, Play, CheckCircle2, XCircle, Cctv, Link2, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  shellyDeviceId: number | null;
  shellyAction: string;
  timerSeconds: number | null;
  cooldownMinutes: number;
  notifyOnDetection: boolean;
  lastTriggeredAt: string | null;
  shellyDevice: { id: number; name: string } | null;
  camera: { id: number; name: string } | null;
  _count: { sightings: number };
  recentSightings: SightingRow[];
}

export interface ShellyOption { id: number; name: string }
export interface CameraOption { id: number; name: string }

interface Props {
  vehicles: VehicleRow[];
  sightings: SightingRow[];
  shellyDevices: ShellyOption[];
  cameras: CameraOption[];
}

const EMPTY = {
  name: "",
  plate: "",
  isActive: true,
  notes: "",
  cameraId: "",
  shellyDeviceId: "",
  shellyAction: "ON",
  timerSeconds: "3",
  cooldownMinutes: "2",
  notifyOnDetection: false,
};

export function VehiclesClient({ vehicles, sightings, shellyDevices, cameras }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"vehicles" | "history">("vehicles");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState("");
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

  async function remove(v: VehicleRow) {
    if (!confirm(`Fahrzeug „${v.name}" (${v.plate}) löschen?`)) return;
    await fetch(`/api/vehicles/${v.id}`, { method: "DELETE" });
    refresh();
  }

  async function trigger(v: VehicleRow) {
    setTriggeringId(v.id);
    try {
      const res = await fetch(`/api/vehicles/${v.id}/trigger`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof data.error === "string" ? data.error : "Auslösen fehlgeschlagen");
      } else if (data.shellyTriggered && data.shellyOk === false) {
        alert("Erkannt, aber Shelly nicht erreichbar.");
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
    setManualMsg("");
    try {
      const res = await fetch("/api/vehicle-sightings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate: manualPlate.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setManualMsg(typeof data.error === "string" ? data.error : "Fehler");
      } else if (data.matched) {
        setManualMsg(
          data.shellyTriggered
            ? `Match: ${data.vehicleName} – Shelly ${data.shellyOk ? "OK" : "Fehler"}`
            : `Match: ${data.vehicleName} (kein Shelly / Cooldown)`
        );
        setManualPlate("");
        refresh();
      } else {
        setManualMsg("Kein erlaubtes Fahrzeug mit diesem Kennzeichen.");
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
    if (!confirm("Diese Sichtung wirklich löschen?")) return;
    setDeletingId(s.id);
    try {
      const res = await fetch(`/api/vehicle-sightings/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(typeof data.error === "string" ? data.error : "Löschen fehlgeschlagen");
        return;
      }
      refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-6xl">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="vehicles" className="gap-1.5">
            <Car className="h-4 w-4" /> Erlaubte Fahrzeuge
            <Badge variant="secondary" className="ml-1 text-xs">{vehicles.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> Historie
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="space-y-3 mt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Kennzeichen-Whitelist. Hub speichert Schnappschüsse; Match steuert Shelly und optional Push.
            </p>
            <Button onClick={openAdd} className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 shrink-0">
              <Plus className="h-4 w-4" /> Fahrzeug hinzufügen
            </Button>
          </div>

          {vehicles.length === 0 ? (
            <Card className="border-dashed border-slate-300 dark:border-slate-700">
              <CardContent className="py-12 text-center text-slate-500">
                <Car className="h-10 w-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Noch keine Fahrzeuge</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {vehicles.map((v) => {
                const recent = v.recentSightings ?? [];
                return (
                  <Card key={v.id} className={cn("border-slate-200 dark:border-slate-800", !v.isActive && "opacity-60")}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{v.name}</h3>
                            <Badge className="font-mono text-xs bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                              {v.plate}
                            </Badge>
                            {!v.isActive && <Badge variant="secondary">Pausiert</Badge>}
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
                              <Badge variant="secondary" className="text-xs">kein Shelly</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            {v._count.sightings} Sichtung{v._count.sightings !== 1 ? "en" : ""}
                            {v.notes ? <> · {v.notes}</> : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => trigger(v)} disabled={triggeringId === v.id || !v.shellyDeviceId}>
                            {triggeringId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => openEdit(v)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 px-2 text-rose-600" onClick={() => remove(v)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {recent.length > 0 ? (
                        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                          <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5">
                            <History className="h-3.5 w-3.5" /> Letzte Sichtungen
                          </p>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {recent.map((s) => (
                              <div key={s.id} className="shrink-0 w-28 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-900">
                                {s.hasSnapshot ? (
                                  <a href={`/api/vehicle-sightings/${s.id}/snapshot`} target="_blank" rel="noreferrer" className="block aspect-square bg-slate-100 dark:bg-slate-950">
                                    <img src={`/api/vehicle-sightings/${s.id}/snapshot`} alt="" className="h-full w-full object-cover" />
                                  </a>
                                ) : (
                                  <div className="aspect-square flex items-center justify-center text-slate-300">
                                    <Car className="h-5 w-5" />
                                  </div>
                                )}
                                <div className="px-1.5 py-1">
                                  <p className="text-[10px] font-mono text-slate-500">
                                    {new Date(s.seenAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                  <p className="text-[10px] text-slate-400 truncate">{s.camera?.name ?? "–"}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          {v._count.sightings > recent.length && (
                            <button type="button" className="mt-2 text-xs text-indigo-600 hover:underline" onClick={() => setTab("history")}>
                              Alle {v._count.sightings} in Historie anzeigen
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                          <p className="text-xs text-slate-400">Noch keine Sichtungen.</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Kennzeichen manuell prüfen</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitManualSighting} className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1.5 flex-1 min-w-[160px]">
                  <Label htmlFor="manual-plate">Kennzeichen</Label>
                  <Input id="manual-plate" value={manualPlate} onChange={(e) => setManualPlate(e.target.value)} placeholder="z.B. BOR-AB 123" className="font-mono uppercase" />
                </div>
                <Button type="submit" disabled={manualBusy || !manualPlate.trim()} className="gap-1.5">
                  {manualBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Prüfen & ggf. öffnen
                </Button>
              </form>
              {manualMsg && <p className="text-sm text-slate-600 mt-2">{manualMsg}</p>}
              <p className="text-xs text-slate-500 mt-3">
                Unbekannte Kamerasichtungen kannst du zuordnen oder Kennzeichen nachtragen.
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="p-0 sm:p-6">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="w-16">Bild</TableHead>
                      <TableHead>Zeit</TableHead>
                      <TableHead>Kennzeichen</TableHead>
                      <TableHead>Fahrzeug</TableHead>
                      <TableHead className="hidden sm:table-cell">Kamera</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead className="w-[1%] text-right">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sightings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-sm text-slate-400">
                          Noch keine Sichtungen.
                        </TableCell>
                      </TableRow>
                    )}
                    {sightings.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {s.hasSnapshot ? (
                            <button type="button" onClick={() => openAssign(s)} className="block h-12 w-12 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                              <img src={`/api/vehicle-sightings/${s.id}/snapshot`} alt="" className="h-full w-full object-cover" />
                            </button>
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-slate-200 text-slate-300 dark:border-slate-700">
                              <Car className="h-4 w-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500 whitespace-nowrap">
                          {new Date(s.seenAt).toLocaleString("de-DE")}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {s.plate ?? <span className="text-slate-400">–</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.allowedVehicle?.name ?? <span className="text-slate-400">unbekannt</span>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-500">
                          {s.camera?.name ?? "–"}
                        </TableCell>
                        <TableCell>
                          {s.matched ? (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs">
                              <CheckCircle2 className="h-3 w-3" /> ja
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <XCircle className="h-3 w-3" /> nein
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            {!s.matched && (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openAssign(s)}>
                                <Link2 className="h-3.5 w-3.5" /> Zuordnen
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-rose-600" disabled={deletingId === s.id} onClick={() => deleteSighting(s)}>
                              {deletingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Fahrzeug bearbeiten" : "Fahrzeug hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name <span className="text-rose-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="z.B. Lieferwagen Müller" />
            </div>
            <div className="space-y-1.5">
              <Label>Kennzeichen <span className="text-rose-500">*</span></Label>
              <Input value={form.plate} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))} placeholder="z.B. BOR-AB 123" className="font-mono uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label>Kamera für Shelly</Label>
              <Select value={form.cameraId || "all"} onValueChange={(v) => setForm((f) => ({ ...f, cameraId: v === "all" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Kameras</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">Historie läuft auf allen Kameras. Shelly nur an gewählter Kamera (oder allen).</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Push bei Erkennung</p>
                <p className="text-xs text-slate-500">Web-Push bei Kennzeichen-Match</p>
              </div>
              <Switch checked={form.notifyOnDetection} onCheckedChange={(v) => setForm((f) => ({ ...f, notifyOnDetection: v }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Shelly bei Erkennung</Label>
              <Select value={form.shellyDeviceId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, shellyDeviceId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ON">EIN</SelectItem>
                      <SelectItem value="OFF">AUS</SelectItem>
                      <SelectItem value="TOGGLE">TOGGLE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Timer (Sek.)</Label>
                  <Input type="number" min={1} value={form.timerSeconds} onChange={(e) => setForm((f) => ({ ...f, timerSeconds: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Cooldown (Minuten)</Label>
              <Input type="number" min={1} value={form.cooldownMinutes} onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label>Aktiv</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
            {error && <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Abbrechen</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.plate.trim()} className="gap-1.5 bg-indigo-600 hover:bg-indigo-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fahrzeug zuordnen</DialogTitle>
          </DialogHeader>
          {assignSighting && (
            <div className="space-y-4">
              {assignSighting.hasSnapshot && (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700">
                  <img src={`/api/vehicle-sightings/${assignSighting.id}/snapshot`} alt="" className="max-h-64 w-full object-contain" />
                </div>
              )}
              <p className="text-sm text-slate-500">
                {new Date(assignSighting.seenAt).toLocaleString("de-DE")}
                {assignSighting.camera ? ` · ${assignSighting.camera.name}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={assignMode === "existing" ? "default" : "outline"} className="gap-1.5" disabled={vehicles.length === 0} onClick={() => setAssignMode("existing")}>
                  <Link2 className="h-3.5 w-3.5" /> Bestehendes
                </Button>
                <Button type="button" size="sm" variant={assignMode === "new" ? "default" : "outline"} className="gap-1.5" onClick={() => setAssignMode("new")}>
                  <UserPlus className="h-3.5 w-3.5" /> Neu anlegen
                </Button>
                <Button type="button" size="sm" variant={assignMode === "plate" ? "default" : "outline"} onClick={() => setAssignMode("plate")}>
                  Nur Kennzeichen
                </Button>
              </div>
              {assignMode === "existing" && (
                <div className="space-y-1.5">
                  <Label>Fahrzeug</Label>
                  <Select value={assignVehicleId} onValueChange={setAssignVehicleId}>
                    <SelectTrigger><SelectValue placeholder="Fahrzeug wählen" /></SelectTrigger>
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
                    <Input value={assignName} onChange={(e) => setAssignName(e.target.value)} placeholder="optional" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Kennzeichen <span className="text-rose-500">*</span></Label>
                    <Input value={assignPlate} onChange={(e) => setAssignPlate(e.target.value)} className="font-mono uppercase" />
                  </div>
                </div>
              )}
              {assignMode === "plate" && (
                <div className="space-y-1.5">
                  <Label>Kennzeichen <span className="text-rose-500">*</span></Label>
                  <Input value={assignPlate} onChange={(e) => setAssignPlate(e.target.value)} className="font-mono uppercase" />
                  <p className="text-xs text-slate-500">Match gegen Whitelist, falls bekannt.</p>
                </div>
              )}
              {assignError && <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{assignError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignBusy}>Abbrechen</Button>
            <Button onClick={confirmAssign} disabled={assignBusy} className="gap-1.5">
              {assignBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Zuordnen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
