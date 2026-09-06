"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Loader2, Pencil, Trash2, Cctv, RefreshCw, AlertTriangle,
  User, Car, PawPrint, Activity, Bell, DoorOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ZoneEditor, type ZonePoint } from "@/components/cameras/zone-editor";
import { DoorHoldBadge, DoorHoldButton, useNow } from "@/components/cameras/door-hold";

export interface CameraRow {
  id: number;
  name: string;
  kind: string;
  host: string;
  httpPort: number;
  https: boolean;
  username: string;
  channel: number;
  enabled: boolean;
  vehicleDetection: boolean;
  /** Anteil der Bildfläche 0..1, null = Hub-Standard (2 %). */
  vehicleMinArea: number | null;
  /** Einfahrtszone, normierte Punkte; null = keine Zone. */
  vehicleZone: ZonePoint[] | null;
  notes: string | null;
  snapshotAt: string | null;
  lastSeenAt: string | null;
  /** Tor offen halten (DoorBird): Endzeit, letzter Hub-Impuls, Fehler. */
  doorHoldUntil: string | null;
  doorHoldPulseAt: string | null;
  doorHoldError: string | null;
}

export interface CameraEventRow {
  id: number;
  type: string;
  startedAt: string;
  endedAt: string | null;
  camera: { id: number; name: string };
}

const EVENT_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  MOTION:  { label: "Bewegung", icon: Activity, color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  PERSON:  { label: "Person",   icon: User,     color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
  VEHICLE: { label: "Fahrzeug", icon: Car,      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  ANIMAL:  { label: "Tier",     icon: PawPrint, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  DOORBELL:{ label: "Klingel",  icon: Bell,     color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  OTHER:   { label: "Sonstiges", icon: Activity, color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

const EMPTY = {
  name: "",
  kind: "REOLINK",
  host: "",
  httpPort: "80",
  https: false,
  username: "admin",
  password: "",
  channel: "0",
  enabled: true,
  vehicleDetection: true,
  /** Prozent der Bildfläche als Text; leer = Hub-Standard. */
  vehicleMinAreaPct: "",
  vehicleZone: [] as ZonePoint[],
  notes: "",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function duration(startIso: string, endIso: string | null): string {
  if (!endIso) return "läuft";
  const s = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export interface NetworkCameraSuggestion {
  id: number;
  name: string;
  ipAddress: string;
}

interface CamerasViewProps {
  cameras: CameraRow[];
  events: CameraEventRow[];
  hubOnline: boolean;
  networkCameras: NetworkCameraSuggestion[];
}

export function CamerasView({ cameras, events, hubOnline, networkCameras }: CamerasViewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CameraRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [snappingId, setSnappingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Tor offen halten: Fehler aus Start/Beenden als Banner; Uhr fuer die Restzeit.
  const [holdError, setHoldError] = useState("");
  const now = useNow();

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  // Vorschlaege aus dem Netzwerk-Bereich: nur Kameras, deren IP noch nicht
  // als Kamera-Host erfasst ist.
  const usedHosts = new Set(cameras.map((c) => c.host));
  const suggestions = networkCameras.filter((n) => !usedHosts.has(n.ipAddress));

  function applySuggestion(idStr: string) {
    const s = suggestions.find((n) => String(n.id) === idStr);
    if (!s) return;
    setForm((p) => ({ ...p, name: s.name, host: s.ipAddress }));
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setError("");
    setOpen(true);
  }

  function openEdit(c: CameraRow) {
    setEditing(c);
    setForm({
      name: c.name,
      kind: c.kind,
      host: c.host,
      httpPort: String(c.httpPort),
      https: c.https,
      username: c.username,
      password: "",
      channel: String(c.channel),
      enabled: c.enabled,
      vehicleDetection: c.vehicleDetection,
      vehicleMinAreaPct: c.vehicleMinArea != null ? String(Math.round(c.vehicleMinArea * 1000) / 10) : "",
      vehicleZone: c.vehicleZone ?? [],
      notes: c.notes ?? "",
    });
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(editing ? `/api/cameras/${editing.id}` : "/api/cameras", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          kind: form.kind,
          host: form.host,
          httpPort: Number(form.httpPort) || 80,
          https: form.https,
          username: form.username,
          password: form.password,
          channel: Number(form.channel) || 0,
          enabled: form.enabled,
          vehicleDetection: form.vehicleDetection,
          // Prozent aus dem Formular → Anteil 0..1; leer = Hub-Standard.
          vehicleMinArea:
            form.vehicleMinAreaPct.trim() === "" ? null : Number(form.vehicleMinAreaPct) / 100,
          vehicleZone: form.vehicleZone.length >= 3 ? form.vehicleZone : null,
          notes: form.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Fehler beim Speichern");
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: CameraRow) {
    if (!confirm(`Kamera "${c.name}" inklusive aller Ereignisse löschen?`)) return;
    setDeletingId(c.id);
    try {
      const res = await fetch(`/api/cameras/${c.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  /** Schnappschuss-Task anlegen; der Hub liefert das Bild in wenigen Sekunden. */
  async function requestSnapshot(c: CameraRow) {
    setSnappingId(c.id);
    try {
      await fetch("/api/hub/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CAMERA_SNAPSHOT", payload: { cameraId: c.id } }),
      });
      // Hub pollt alle 5 s - nach kurzer Wartezeit neu laden.
      setTimeout(() => {
        setSnappingId(null);
        router.refresh();
      }, 9000);
    } catch {
      setSnappingId(null);
    }
  }

  const [openingDoorId, setOpeningDoorId] = useState<number | null>(null);

  /** Türöffner-Task für eine DoorBird anlegen (Hub führt open-door.cgi aus). */
  async function openDoor(c: CameraRow) {
    if (!confirm(`Tür an "${c.name}" wirklich öffnen?`)) return;
    setOpeningDoorId(c.id);
    try {
      await fetch("/api/hub/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "DOORBIRD_OPEN", payload: { cameraId: c.id } }),
      });
    } finally {
      setTimeout(() => setOpeningDoorId(null), 6000);
    }
  }

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  return (
    <div className="space-y-4 sm:space-y-6">
      {!hubOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Der lokale Hub ist offline - Ereignisse und Schnappschüsse werden erst wieder geliefert, wenn er läuft.
        </div>
      )}
      {holdError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">Tor offen halten: {holdError}</span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setHoldError("")}>OK</Button>
        </div>
      )}

      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
          <CardTitle className="text-base sm:text-xl">Kameras ({cameras.length})</CardTitle>
          <Button onClick={openAdd} className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm">
            <Plus className="h-4 w-4" />
            Kamera hinzufügen
          </Button>
        </CardHeader>
        <CardContent>
          {cameras.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
              <Cctv className="h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="font-medium text-slate-600 dark:text-slate-400">Keine Kameras erfasst</p>
              <p className="text-sm text-center max-w-md">
                Lege deine Reolink-Kameras mit IP-Adresse und Zugangsdaten an - der lokale Hub
                überwacht sie dann automatisch auf Bewegung und KI-Erkennungen.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {cameras.map((c) => {
                const online = c.lastSeenAt ? new Date(c.lastSeenAt).getTime() > fiveMinAgo : null;
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900"
                  >
                    <div className="relative aspect-video bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      {c.snapshotAt ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/cameras/${c.id}/snapshot?t=${encodeURIComponent(c.snapshotAt)}`}
                          alt={`Schnappschuss ${c.name}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Cctv className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                      )}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        {online === true && (
                          <Badge className="bg-emerald-500/90 text-white gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" /> Online
                          </Badge>
                        )}
                        {online === false && (
                          <Badge variant="secondary" className="bg-slate-700/80 text-slate-200 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Offline
                          </Badge>
                        )}
                        {!c.enabled && (
                          <Badge variant="secondary" className="bg-slate-700/80 text-slate-300 text-xs h-5">
                            Deaktiviert
                          </Badge>
                        )}
                        {c.kind === "DOORBIRD" && (
                          <DoorHoldBadge
                            hold={{ until: c.doorHoldUntil, pulseAt: c.doorHoldPulseAt, error: c.doorHoldError }}
                            now={now}
                            showPulse={!!c.doorHoldError}
                            className="h-5"
                          />
                        )}
                      </div>
                      {c.snapshotAt && (
                        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white font-mono">
                          {fmtTime(c.snapshotAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{c.name}</p>
                          {c.kind === "DOORBIRD" && (
                            <Bell
                              className="h-3.5 w-3.5 shrink-0 text-violet-500"
                              aria-label="DoorBird Türstation"
                            />
                          )}
                          {c.vehicleDetection && (
                            <Car
                              className="h-3.5 w-3.5 shrink-0 text-amber-500"
                              aria-label="Fahrzeug-Erkennung aktiv"
                            />
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-mono truncate">
                          {c.host}{c.channel > 0 ? ` · Kanal ${c.channel}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.kind === "DOORBIRD" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-emerald-600"
                            title="Tür öffnen"
                            onClick={() => openDoor(c)}
                            disabled={openingDoorId === c.id || !hubOnline}
                          >
                            {openingDoorId === c.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <DoorOpen className="h-4 w-4" />}
                          </Button>
                        )}
                        {c.kind === "DOORBIRD" && (
                          <DoorHoldButton
                            cameraId={c.id}
                            cameraName={c.name}
                            hold={{ until: c.doorHoldUntil, pulseAt: c.doorHoldPulseAt, error: c.doorHoldError }}
                            disabled={!hubOnline || !c.enabled}
                            onChange={() => {
                              setHoldError("");
                              router.refresh();
                            }}
                            onError={setHoldError}
                            className="h-8 w-8 text-slate-400 hover:text-emerald-600"
                            activeClassName="text-emerald-600 hover:text-rose-600"
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                          title="Neuen Schnappschuss anfordern"
                          onClick={() => requestSnapshot(c)}
                          disabled={snappingId === c.id || !hubOnline}
                        >
                          <RefreshCw className={cn("h-4 w-4", snappingId === c.id && "animate-spin")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-rose-600"
                          onClick={() => handleDelete(c)}
                          disabled={deletingId === c.id}
                        >
                          {deletingId === c.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-4">
          <CardTitle className="text-base sm:text-xl">Letzte Ereignisse</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-6 sm:pb-6">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead>Zeitpunkt</TableHead>
                  <TableHead>Kamera</TableHead>
                  <TableHead>Ereignis</TableHead>
                  <TableHead className="hidden sm:table-cell">Dauer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="text-center py-10 text-sm text-slate-400">
                      Noch keine Ereignisse - sobald eine Kamera Bewegung oder eine Person erkennt,
                      erscheint sie hier.
                    </TableCell>
                  </TableRow>
                )}
                {events.map((e) => {
                  const meta = EVENT_META[e.type] ?? EVENT_META.OTHER;
                  const Icon = meta.icon;
                  return (
                    <TableRow key={e.id} className="border-slate-200 dark:border-slate-700">
                      <TableCell className="font-mono text-xs text-slate-500">
                        {fmtTime(e.startedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700 dark:text-slate-300">
                        {e.camera.name}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("gap-1 text-xs", meta.color)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-slate-500">
                        {duration(e.startedAt, e.endedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Kamera bearbeiten" : "Neue Kamera"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editing && suggestions.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
                <Label>Aus dem Netzwerk übernehmen</Label>
                <Select onValueChange={applySuggestion}>
                  <SelectTrigger>
                    <SelectValue placeholder="Im Netzwerk erfasste Kamera wählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {suggestions.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} ({s.ipAddress})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Füllt Name und IP-Adresse automatisch aus - nur noch Zugangsdaten ergänzen.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Gerätetyp</Label>
              <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REOLINK">Reolink-Kamera</SelectItem>
                  <SelectItem value="DOORBIRD">DoorBird Türstation</SelectItem>
                </SelectContent>
              </Select>
              {form.kind === "DOORBIRD" && (
                <p className="text-xs text-slate-500">
                  Klingel- und Bewegungs-Events, Schnappschüsse mit Gesichtserkennung und
                  Türöffner über den Hub. App-Benutzer mit API-Berechtigung verwenden.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Name <span className="text-rose-500">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. Kamera Eingang"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>IP-Adresse / Host <span className="text-rose-500">*</span></Label>
                <Input
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="192.168.40.10"
                  className="font-mono"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Benutzername <span className="text-rose-500">*</span></Label>
                <Input value={form.username} onChange={(e) => set("username", e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Passwort {editing ? "" : <span className="text-rose-500">*</span>}</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={editing ? "unverändert lassen" : ""}
                  required={!editing}
                />
              </div>
              <div className="space-y-1.5">
                <Label>HTTP-Port</Label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.httpPort}
                  onChange={(e) => set("httpPort", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Kanal</Label>
                <Input
                  type="number"
                  min={0}
                  max={63}
                  value={form.channel}
                  onChange={(e) => set("channel", e.target.value)}
                />
                <p className="text-xs text-slate-400">0 bei Einzelkameras, 0-n am NVR.</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">HTTPS</p>
                <p className="text-xs text-slate-500">Kamera-API über HTTPS ansprechen (Standard: HTTP)</p>
              </div>
              <Switch checked={form.https} onCheckedChange={(v) => set("https", v)} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Aktiv</p>
                <p className="text-xs text-slate-500">Vom Hub überwachen (Events + Schnappschüsse)</p>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Fahrzeug-Erkennung</p>
                <p className="text-xs text-slate-500">
                  Fahrzeug-Events, Kennzeichen-OCR und Sichtungen auf dieser Kamera
                </p>
              </div>
              <Switch
                checked={form.vehicleDetection}
                onCheckedChange={(v) => set("vehicleDetection", v)}
              />
            </div>

            {form.vehicleDetection && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Fahrzeug ohne Kennzeichen</p>
                  <p className="text-xs text-muted-foreground">
                    Liest der Hub kein Kennzeichen, entscheidet der YOLO-Tracker, ob überhaupt ein
                    Auto an der Einfahrt steht. Geparkte Wagen und Straße im Hintergrund sollen
                    dabei nicht zählen.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Mindestgröße (% der Bildfläche)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    value={form.vehicleMinAreaPct}
                    onChange={(e) => set("vehicleMinAreaPct", e.target.value)}
                    placeholder="2 (Hub-Standard)"
                  />
                  <p className="text-xs text-muted-foreground/70">
                    Auto an der Einfahrt in 4K etwa 3 bis 30 %, Parkplatz im Hintergrund unter 0,1 %.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Einfahrtszone</Label>
                  <ZoneEditor
                    imageUrl={
                      editing?.snapshotAt
                        ? `/api/cameras/${editing.id}/snapshot?t=${encodeURIComponent(editing.snapshotAt)}`
                        : null
                    }
                    points={form.vehicleZone}
                    onChange={(pts) => set("vehicleZone", pts)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim() || !form.host.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Speichern" : "Erstellen")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
