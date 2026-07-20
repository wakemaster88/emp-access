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
  Plus, Pencil, Trash2, Loader2, Car, History, Play, CheckCircle2, XCircle, Cctv,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  lastTriggeredAt: string | null;
  shellyDevice: { id: number; name: string } | null;
  camera: { id: number; name: string } | null;
  _count: { sightings: number };
}

export interface SightingRow {
  id: number;
  plate: string | null;
  source: string;
  matched: boolean;
  shellyTriggered: boolean;
  shellyOk: boolean | null;
  seenAt: string;
  camera: { id: number; name: string } | null;
  allowedVehicle: { id: number; name: string; plate: string } | null;
}

export interface ShellyOption {
  id: number;
  name: string;
}

export interface CameraOption {
  id: number;
  name: string;
}

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
  cameraId: "" as string,
  shellyDeviceId: "" as string,
  shellyAction: "ON",
  timerSeconds: "3",
  cooldownMinutes: "2",
};

const SOURCE_LABEL: Record<string, string> = {
  CAMERA_VEHICLE: "Kamera (Fahrzeug)",
  CAMERA_PLATE: "Kamera (Kennzeichen)",
  MANUAL: "Manuell",
};

export function VehiclesClient({ vehicles, sightings, shellyDevices, cameras }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState("");

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
      };
      const res = await fetch(
        editing ? `/api/vehicles/${editing.id}` : "/api/vehicles",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
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

  return (
    <div className="space-y-4 sm:space-y-6 max-w-6xl">
      <Tabs defaultValue="vehicles">
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
              Bekannte Kennzeichen anlegen und optional eine Kamera zuweisen.
              Nur bei Erkennung an dieser Kamera schaltet der Shelly (z. B. Tor öffnen).
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
                <p className="text-sm mt-1">Lege erlaubte Kennzeichen an und verknüpfe einen Shelly.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {vehicles.map((v) => (
                <Card
                  key={v.id}
                  className={cn(
                    "border-slate-200 dark:border-slate-800",
                    !v.isActive && "opacity-60"
                  )}
                >
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{v.name}</h3>
                        <Badge className="font-mono text-xs bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                          {v.plate}
                        </Badge>
                        {!v.isActive && <Badge variant="secondary">Pausiert</Badge>}
                        {v.camera ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Cctv className="h-3 w-3" /> {v.camera.name}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">alle Kameras</Badge>
                        )}
                        {v.shellyDevice ? (
                          <Badge variant="outline" className="text-xs">
                            → {v.shellyDevice.name} ({v.shellyAction}
                            {v.timerSeconds ? `, ${v.timerSeconds}s` : ""})
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">kein Shelly</Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {v._count.sightings} Sichtung{v._count.sightings !== 1 ? "en" : ""}
                        {v.lastTriggeredAt && (
                          <> · Zuletzt geschaltet: {new Date(v.lastTriggeredAt).toLocaleString("de-DE")}</>
                        )}
                        {v.notes ? <> · {v.notes}</> : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => trigger(v)}
                        disabled={triggeringId === v.id || !v.shellyDeviceId}
                        title="Testen"
                      >
                        {triggeringId === v.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => openEdit(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-rose-600"
                        onClick={() => remove(v)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
                  <Input
                    id="manual-plate"
                    value={manualPlate}
                    onChange={(e) => setManualPlate(e.target.value)}
                    placeholder="z.B. BOR-AB 123"
                    className="font-mono uppercase"
                  />
                </div>
                <Button type="submit" disabled={manualBusy || !manualPlate.trim()} className="gap-1.5">
                  {manualBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Prüfen & ggf. öffnen
                </Button>
              </form>
              {manualMsg && <p className="text-sm text-slate-600 mt-2">{manualMsg}</p>}
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Letzte Sichtungen</CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:px-6 sm:pb-6">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead>Zeit</TableHead>
                      <TableHead>Kennzeichen</TableHead>
                      <TableHead>Fahrzeug</TableHead>
                      <TableHead className="hidden sm:table-cell">Kamera</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead className="hidden md:table-cell">Shelly</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sightings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-sm text-slate-400">
                          Noch keine Sichtungen.
                        </TableCell>
                      </TableRow>
                    )}
                    {sightings.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs text-slate-500 whitespace-nowrap">
                          {new Date(s.seenAt).toLocaleString("de-DE")}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {s.plate ?? <span className="text-slate-400">–</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.allowedVehicle?.name ?? (
                            <span className="text-slate-400">unbekannt</span>
                          )}
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
                        <TableCell className="hidden md:table-cell text-xs text-slate-500">
                          {!s.shellyTriggered
                            ? "–"
                            : s.shellyOk
                              ? "OK"
                              : "Fehler"}
                          <span className="text-slate-400 ml-1">
                            ({SOURCE_LABEL[s.source] ?? s.source})
                          </span>
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
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Lieferwagen Müller"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kennzeichen <span className="text-rose-500">*</span></Label>
              <Input
                value={form.plate}
                onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
                placeholder="z.B. BOR-AB 123"
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kamera für Erkennung</Label>
              <Select
                value={form.cameraId || "all"}
                onValueChange={(v) => setForm((f) => ({ ...f, cameraId: v === "all" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Kamera wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Kameras</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Shelly wird nur ausgelöst, wenn das Kennzeichen an dieser Kamera erkannt wird.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Shelly bei Erkennung</Label>
              <Select
                value={form.shellyDeviceId || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, shellyDeviceId: v === "none" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Shelly wählen" />
                </SelectTrigger>
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
                  <Select
                    value={form.shellyAction}
                    onValueChange={(v) => setForm((f) => ({ ...f, shellyAction: v }))}
                  >
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
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={form.timerSeconds}
                    onChange={(e) => setForm((f) => ({ ...f, timerSeconds: e.target.value }))}
                    placeholder="z.B. 3"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Cooldown (Minuten)</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={form.cooldownMinutes}
                onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="optional"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label htmlFor="v-active">Aktiv</Label>
              <Switch
                id="v-active"
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
            </div>
            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Abbrechen</Button>
            <Button
              onClick={save}
              disabled={saving || !form.name.trim() || !form.plate.trim()}
              className="gap-1.5 bg-indigo-600 hover:bg-indigo-700"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
