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
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
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
  /** Halteverbot: Fahrzeuge mit zu langer Standzeit melden. */
  noParkDetection: boolean;
  /** Gesperrte Fläche, normierte Punkte; null = keine Fläche. */
  noParkZone: ZonePoint[] | null;
  /** Standzeit in Minuten bis zur Meldung; null = Hub-Standard (2 min). */
  noParkMinutes: number | null;
  /** Lieferdienste: null = aus, "NOTIFY" = melden, "OPEN" = Tor öffnen. */
  deliveryMode: string | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
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

// Kamera-Erkennungen in Himmelblau (Zustandsvokabular), Klingel = jemand da (Violett),
// Sonstiges gedämpft. Art und Symbol unterscheiden die Erkennungen, nicht die Farbe.
const DETECTION = "bg-sky-500/15 text-sky-700 dark:text-sky-300";

const EVENT_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  MOTION:  { label: "Bewegung", icon: Activity, color: DETECTION },
  PERSON:  { label: "Person",   icon: User,     color: DETECTION },
  VEHICLE: { label: "Fahrzeug", icon: Car,      color: DETECTION },
  ANIMAL:  { label: "Tier",     icon: PawPrint, color: DETECTION },
  DOORBELL:{ label: "Klingel",  icon: Bell,     color: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  OTHER:   { label: "Sonstiges", icon: Activity, color: "bg-foreground/[0.06] text-muted-foreground" },
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
  noParkDetection: false,
  noParkZone: [] as ZonePoint[],
  /** Standzeit in Minuten als Text; leer = Hub-Standard. */
  noParkMinutes: "",
  /** "" = aus, "NOTIFY", "OPEN". */
  deliveryMode: "",
  deliveryFrom: "",
  deliveryTo: "",
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
  // Rückfragen als AlertDialog statt Browser-confirm() (docs/design-regeln.md, Abschnitt 18).
  // Das Ziel bleibt gesetzt, solange der Dialog ausblendet – sonst flackert der Titel.
  const [confirmTarget, setConfirmTarget] = useState<{ kind: "delete" | "door"; camera: CameraRow } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function ask(kind: "delete" | "door", camera: CameraRow) {
    setConfirmTarget({ kind, camera });
    setConfirmOpen(true);
  }

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
      noParkDetection: c.noParkDetection,
      noParkZone: c.noParkZone ?? [],
      noParkMinutes: c.noParkMinutes != null ? String(c.noParkMinutes) : "",
      deliveryMode: c.deliveryMode ?? "",
      deliveryFrom: c.deliveryFrom ?? "",
      deliveryTo: c.deliveryTo ?? "",
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
          // Ohne Fläche bleibt das Halteverbot aus – sonst lehnt die API ab.
          noParkZone: form.noParkZone.length >= 3 ? form.noParkZone : null,
          noParkDetection: form.noParkDetection && form.noParkZone.length >= 3,
          noParkMinutes: form.noParkMinutes.trim() === "" ? null : Number(form.noParkMinutes),
          deliveryMode: form.vehicleDetection && form.deliveryMode ? form.deliveryMode : null,
          deliveryFrom: form.deliveryFrom || null,
          deliveryTo: form.deliveryTo || null,
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
    <div className="space-y-4 sm:space-y-5">
      {!hubOnline && (
        <Notice
          tone="warning"
          icon={AlertTriangle}
          title="Der lokale Hub ist offline - Ereignisse und Schnappschüsse werden erst wieder geliefert, wenn er läuft."
        />
      )}
      {holdError && (
        <Notice
          tone="danger"
          icon={AlertTriangle}
          title={<>Tor offen halten: {holdError}</>}
          action={
            <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setHoldError("")}>OK</Button>
          }
        />
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="tabular-nums">Kameras ({cameras.length})</CardTitle>
          <Button onClick={openAdd} className="h-11 gap-2 sm:h-9">
            <Plus className="h-4 w-4" />
            Kamera hinzufügen
          </Button>
        </CardHeader>
        <CardContent>
          {cameras.length === 0 ? (
            <EmptyState
              icon={Cctv}
              title="Keine Kameras erfasst"
              description="Lege deine Reolink-Kameras mit IP-Adresse und Zugangsdaten an - der lokale Hub überwacht sie dann automatisch auf Bewegung und KI-Erkennungen."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {cameras.map((c) => {
                const online = c.lastSeenAt ? new Date(c.lastSeenAt).getTime() > fiveMinAgo : null;
                return (
                  <div
                    key={c.id}
                    className="glass-tile overflow-hidden"
                  >
                    <div className="relative aspect-video bg-black flex items-center justify-center">
                      {c.snapshotAt ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/cameras/${c.id}/snapshot?t=${encodeURIComponent(c.snapshotAt)}`}
                          alt={`Schnappschuss ${c.name}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Cctv className="h-10 w-10 text-white/25" />
                      )}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        {online === true && (
                          <Badge className="bg-success/90 text-success-foreground gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-current" /> Online
                          </Badge>
                        )}
                        {/* Rot nur, wenn eine aktive Kamera nicht antwortet; eine deaktivierte
                            meldet sich gewollt nicht mehr (Aus = gedämpft). */}
                        {online === false && (
                          <Badge
                            className={cn(
                              "gap-1 text-xs h-5",
                              c.enabled ? "bg-destructive/90 text-white" : "bg-black/60 text-white/85"
                            )}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" /> Offline
                          </Badge>
                        )}
                        {!c.enabled && (
                          <Badge className="bg-black/60 text-white/85 text-xs h-5">
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
                        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white font-mono tabular-nums">
                          {fmtTime(c.snapshotAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-sm text-foreground truncate">{c.name}</p>
                          {c.kind === "DOORBIRD" && (
                            <Bell
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-label="DoorBird Türstation"
                            />
                          )}
                          {c.vehicleDetection && (
                            <Car
                              className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
                              aria-label="Fahrzeug-Erkennung aktiv"
                            />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {c.host}{c.channel > 0 ? ` · Kanal ${c.channel}` : ""}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-1 shrink-0">
                        {c.kind === "DOORBIRD" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 text-muted-foreground hover:text-success sm:size-8"
                            title="Tür öffnen"
                            onClick={() => ask("door", c)}
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
                            className="size-11 text-muted-foreground hover:text-success sm:size-8"
                            activeClassName="text-success hover:text-destructive"
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 text-muted-foreground hover:text-primary sm:size-8"
                          title="Neuen Schnappschuss anfordern"
                          onClick={() => requestSnapshot(c)}
                          disabled={snappingId === c.id || !hubOnline}
                        >
                          <RefreshCw className={cn("h-4 w-4", snappingId === c.id && "animate-spin")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 text-muted-foreground hover:text-primary sm:size-8"
                          aria-label={`${c.name} bearbeiten`}
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 text-muted-foreground hover:text-destructive sm:size-8"
                          aria-label={`${c.name} löschen`}
                          onClick={() => ask("delete", c)}
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

      <Card className="overflow-hidden pb-0 sm:pb-0">
        <CardHeader>
          <CardTitle>Letzte Ereignisse</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 sm:pl-[18px]">Zeitpunkt</TableHead>
                  <TableHead>Kamera</TableHead>
                  <TableHead className="pr-4 sm:pr-2">Ereignis</TableHead>
                  <TableHead className="hidden sm:table-cell sm:pr-[18px]">Dauer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="p-0 whitespace-normal">
                      <EmptyState
                        compact
                        icon={Activity}
                        title="Noch keine Ereignisse"
                        description="Sobald eine Kamera Bewegung oder eine Person erkennt, erscheint sie hier."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {events.map((e) => {
                  const meta = EVENT_META[e.type] ?? EVENT_META.OTHER;
                  const Icon = meta.icon;
                  return (
                    <TableRow key={e.id} className="max-sm:h-11">
                      <TableCell className="pl-4 font-mono text-xs tabular-nums text-muted-foreground sm:pl-[18px]">
                        {fmtTime(e.startedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">
                        {e.camera.name}
                      </TableCell>
                      <TableCell className="pr-4 sm:pr-2">
                        <Badge className={cn("gap-1 text-xs", meta.color)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell sm:pr-[18px] text-xs tabular-nums text-muted-foreground">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Kamera bearbeiten" : "Neue Kamera"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editing && suggestions.length > 0 && (
              <div className="space-y-1.5 rounded-tile border border-primary/30 bg-primary/10 p-3">
                <Label>Aus dem Netzwerk übernehmen</Label>
                <Select onValueChange={applySuggestion}>
                  <SelectTrigger className="w-full">
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
                <p className="text-xs text-muted-foreground">
                  Füllt Name und IP-Adresse automatisch aus - nur noch Zugangsdaten ergänzen.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Gerätetyp</Label>
              <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REOLINK">Reolink-Kamera</SelectItem>
                  <SelectItem value="DOORBIRD">DoorBird Türstation</SelectItem>
                </SelectContent>
              </Select>
              {form.kind === "DOORBIRD" && (
                <p className="text-xs text-muted-foreground">
                  Klingel- und Bewegungs-Events, Schnappschüsse mit Gesichtserkennung und
                  Türöffner über den Hub. App-Benutzer mit API-Berechtigung verwenden.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. Kamera Eingang"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>IP-Adresse / Host <span className="text-destructive">*</span></Label>
                <Input
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="192.168.40.10"
                  className="font-mono"
                  required
                />
              </div>
              {/* Zugangsdaten am Handy in voller Breite: halb breit schnitt „unverändert lassen“ ab. */}
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Benutzername <span className="text-destructive">*</span></Label>
                <Input value={form.username} onChange={(e) => set("username", e.target.value)} required />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Passwort {editing ? "" : <span className="text-destructive">*</span>}</Label>
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
                <p className="text-xs text-muted-foreground">0 bei Einzelkameras, 0-n am NVR.</p>
              </div>
            </div>

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">HTTPS</p>
                <p className="text-xs text-muted-foreground">Kamera-API über HTTPS ansprechen (Standard: HTTP)</p>
              </div>
              <Switch aria-label="HTTPS" checked={form.https} onCheckedChange={(v) => set("https", v)} />
            </div>

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Aktiv</p>
                <p className="text-xs text-muted-foreground">Vom Hub überwachen (Events + Schnappschüsse)</p>
              </div>
              <Switch aria-label="Aktiv" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Fahrzeug-Erkennung</p>
                <p className="text-xs text-muted-foreground">
                  Fahrzeug-Events, Kennzeichen-OCR und Sichtungen auf dieser Kamera
                </p>
              </div>
              <Switch
                aria-label="Fahrzeug-Erkennung"
                checked={form.vehicleDetection}
                onCheckedChange={(v) => set("vehicleDetection", v)}
              />
            </div>

            {form.vehicleDetection && (
              <div className="glass-tile space-y-3 p-3">
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
                  <p className="text-xs text-muted-foreground">
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

            {form.vehicleDetection && form.kind === "REOLINK" && (
              <div className="glass-tile space-y-3 p-3">
                <div className="space-y-1.5">
                  <Label className="leading-snug">Lieferdienste (DHL, UPS, GLS, Amazon, DPD, Hermes)</Label>
                  <select
                    className="glass-field h-11 w-full px-2 text-base outline-none hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 sm:h-9 md:text-sm"
                    value={form.deliveryMode}
                    onChange={(e) => set("deliveryMode", e.target.value)}
                  >
                    <option value="">Aus</option>
                    <option value="NOTIFY">Erkennen und melden</option>
                    <option value="OPEN">Erkennen und Tor öffnen</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Der Hub liest die Aufschrift am Fahrzeug. Sie muss auf zwei Bildern stehen. Jeder
                    Treffer kommt als Push mit Foto.
                  </p>
                </div>
                {form.deliveryMode === "OPEN" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Tor öffnen ab</Label>
                      <Input
                        type="time"
                        value={form.deliveryFrom}
                        onChange={(e) => set("deliveryFrom", e.target.value)}
                        placeholder="07:00"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>bis</Label>
                      <Input
                        type="time"
                        value={form.deliveryTo}
                        onChange={(e) => set("deliveryTo", e.target.value)}
                        placeholder="20:00"
                      />
                    </div>
                    <p className="col-span-2 text-xs text-muted-foreground">
                      Leer = 07:00 bis 20:00. Außerhalb meldet der Hub nur.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div className="pr-3">
                <p className="text-sm font-medium">Halteverbot</p>
                <p className="text-xs text-muted-foreground">
                  Fahrzeuge melden, die zu lange in einer gesperrten Fläche stehen – mit Push und
                  Ansage über den Kamera-Lautsprecher
                </p>
              </div>
              <Switch
                aria-label="Halteverbot"
                checked={form.noParkDetection}
                onCheckedChange={(v) => set("noParkDetection", v)}
              />
            </div>

            {form.noParkDetection && (
              <div className="glass-tile space-y-3 p-3">
                <div className="space-y-1.5">
                  <Label>Standzeit bis zur Meldung (Minuten)</Label>
                  <Input
                    type="number"
                    min={0.25}
                    max={240}
                    step={0.5}
                    value={form.noParkMinutes}
                    onChange={(e) => set("noParkMinutes", e.target.value)}
                    placeholder="2 (Hub-Standard)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Der Hub schaut alle 20 Sekunden nach. Kurz zum Ausladen halten soll noch nicht
                    zählen, dauerhaftes Abstellen schon.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Gesperrte Fläche</Label>
                  <ZoneEditor
                    imageUrl={
                      editing?.snapshotAt
                        ? `/api/cameras/${editing.id}/snapshot?t=${encodeURIComponent(editing.snapshotAt)}`
                        : null
                    }
                    points={form.noParkZone}
                    onChange={(pts) => set("noParkZone", pts)}
                    texts={{
                      purpose: "gesperrten Fläche",
                      empty: "Klicken, um die gesperrte Fläche einzurahmen. Ohne Fläche prüft der Hub nichts.",
                      ready: "ein Fahrzeug zählt, wenn seine Räder in der Fläche stehen.",
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Nur die Fläche selbst einrahmen, keine Durchfahrt: Wer dort wartet, würde sonst
                    nach Ablauf der Standzeit gemeldet.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
            </div>

            {error && <Notice tone="danger" compact title={error} />}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim() || !form.host.trim()}
                className="min-w-28"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Speichern" : "Erstellen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget?.kind === "door"
                ? `Tür an "${confirmTarget.camera.name}" wirklich öffnen?`
                : `Kamera "${confirmTarget?.camera.name ?? ""}" inklusive aller Ereignisse löschen?`}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            {confirmTarget?.kind === "door" ? (
              <AlertDialogAction onClick={() => void openDoor(confirmTarget.camera)}>
                Tür öffnen
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (confirmTarget) void handleDelete(confirmTarget.camera);
                }}
              >
                Löschen
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
