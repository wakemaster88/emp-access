"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Trash2, Save,   GitMerge, DoorOpen, Activity, ToggleRight, Lightbulb,
  LogIn, LogOut, ArrowLeftRight, AlertCircle, Cctv, Umbrella, Blinds, CircleDot, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isCoverCategory, DEFAULT_COVER_RUNTIME_SEC } from "@/lib/cover-constants";
import { isPulseCategory, DEFAULT_PULSE_SECONDS } from "@/lib/pulse-constants";
import {
  CoverFields, coverPayload, validateCoverValues, type CoverFormValues,
} from "./cover-fields";
import {
  PulseFields, pulsePayload, validatePulseValues, type PulseFormValues,
} from "./pulse-fields";

export interface AreaOption {
  id: number;
  name: string;
}

export interface CameraOption {
  id: number;
  name: string;
}

export interface DeviceData {
  id: number;
  name: string;
  type: string;
  category: string | null;
  ipAddress: string | null;
  shellyId: string | null;
  shellyAuthKey: string | null;
  coverUpChannel?: number | null;
  coverDownChannel?: number | null;
  coverRuntimeSec?: number | null;
  pulseSeconds?: number | null;
  gardenaServiceId?: string | null;
  isActive: boolean;
  accessIn: number | null;
  accessOut: number | null;
  cameraId: number | null;
  allowReentry: boolean;
  scanLockSeconds?: number | null;
  offlineAlertsEnabled: boolean;
  firmware: string | null;
  schedule: unknown | null;
}

const CAT_HAS_ACCESS  = new Set(["DREHKREUZ", "TUER"]);
const CAT_HAS_REENTRY = new Set(["DREHKREUZ", "TUER"]);

const DEVICE_CATEGORIES = [
  { value: "DREHKREUZ",   label: "Drehkreuz",   icon: GitMerge },
  { value: "TUER",        label: "Tür",          icon: DoorOpen },
  { value: "SENSOR",      label: "Sensor",       icon: Activity },
  { value: "SCHALTER",    label: "Schalter",     icon: ToggleRight },
  { value: "BELEUCHTUNG", label: "Beleuchtung",  icon: Lightbulb },
  { value: "MARKISE",     label: "Markise",      icon: Umbrella },
  { value: "ROLLTOR",     label: "Rolltor",      icon: Blinds },
  { value: "TASTER",      label: "Taster",       icon: CircleDot },
];

type Direction = "in" | "out" | "bidir";

const DIRECTIONS: { value: Direction; label: string; hint: string; icon: typeof LogIn }[] = [
  { value: "in",    label: "Nur Eingang",   hint: "Drehkreuz lässt nur rein",                       icon: LogIn },
  { value: "out",   label: "Nur Ausgang",   hint: "Drehkreuz lässt nur raus",                       icon: LogOut },
  { value: "bidir", label: "Bidirektional", hint: "Beide Richtungen – ohne klare Richtungslogik", icon: ArrowLeftRight },
];

function inferDirection(accessIn: number | null, accessOut: number | null): Direction {
  if (accessIn != null && accessOut == null) return "in";
  if (accessIn == null && accessOut != null) return "out";
  if (accessIn != null && accessOut != null) return "bidir";
  return "in";
}

interface EditDeviceDialogProps {
  device: DeviceData | null;
  areas?: AreaOption[];
  cameras?: CameraOption[];
  onClose: () => void;
}

export function EditDeviceDialog({ device, areas = [], cameras = [], onClose }: EditDeviceDialogProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    category: "",
    ipAddress: "",
    shellyId: "",
    shellyAuthKey: "",
    isActive: true,
    direction: "in" as Direction,
    accessIn: "none",
    accessOut: "none",
    cameraId: "none",
    allowReentry: false,
    scanLockSeconds: "0",
    offlineAlertsEnabled: false,
    firmware: "",
  });
  const [cover, setCover] = useState<CoverFormValues>({
    coverUpChannel: "0",
    coverDownChannel: "1",
    coverRuntimeSec: String(DEFAULT_COVER_RUNTIME_SEC),
  });
  const [pulse, setPulse] = useState<PulseFormValues>({
    pulseSeconds: String(DEFAULT_PULSE_SECONDS),
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (device) {
      setForm({
        name: device.name,
        category: device.category ?? "",
        ipAddress: device.ipAddress ?? "",
        shellyId: device.shellyId ?? "",
        shellyAuthKey: device.shellyAuthKey ?? "",
        isActive: device.isActive,
        direction: inferDirection(device.accessIn, device.accessOut),
        accessIn: device.accessIn != null ? String(device.accessIn) : "none",
        accessOut: device.accessOut != null ? String(device.accessOut) : "none",
        cameraId: device.cameraId != null ? String(device.cameraId) : "none",
        allowReentry: device.allowReentry,
        scanLockSeconds: String(device.scanLockSeconds ?? 0),
        offlineAlertsEnabled: device.offlineAlertsEnabled,
        firmware: device.firmware ?? "",
      });
      setCover({
        coverUpChannel: String(device.coverUpChannel ?? 0),
        coverDownChannel: String(device.coverDownChannel ?? 1),
        coverRuntimeSec: String(device.coverRuntimeSec ?? DEFAULT_COVER_RUNTIME_SEC),
      });
      setPulse({ pulseSeconds: String(device.pulseSeconds ?? DEFAULT_PULSE_SECONDS) });
      setError("");
    }
  }, [device]);

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!device) return;
    const isCover = isCoverCategory(form.category);
    if (isCover) {
      const coverError = validateCoverValues(cover);
      if (coverError) {
        setError(coverError);
        return;
      }
    }
    const isPulse = isPulseCategory(form.category);
    if (isPulse) {
      const pulseError = validatePulseValues(pulse);
      if (pulseError) {
        setError(pulseError);
        return;
      }
    }

    setSaving(true);
    setError("");

    const hasAccess = CAT_HAS_ACCESS.has(form.category);
    let accessIn: number | null = null;
    let accessOut: number | null = null;
    if (hasAccess) {
      if (form.direction === "in") {
        accessIn = form.accessIn && form.accessIn !== "none" ? Number(form.accessIn) : null;
      } else if (form.direction === "out") {
        accessOut = form.accessOut && form.accessOut !== "none" ? Number(form.accessOut) : null;
      } else {
        accessIn  = form.accessIn  && form.accessIn  !== "none" ? Number(form.accessIn)  : null;
        accessOut = form.accessOut && form.accessOut !== "none" ? Number(form.accessOut) : null;
      }
    }

    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          category: form.category || null,
          ipAddress: form.ipAddress || null,
          shellyId: form.shellyId || null,
          shellyAuthKey: form.shellyAuthKey || null,
          isActive: form.isActive,
          accessIn,
          accessOut,
          cameraId: form.cameraId !== "none" ? Number(form.cameraId) : null,
          allowReentry: form.allowReentry,
          scanLockSeconds: CAT_HAS_ACCESS.has(form.category) ? Number(form.scanLockSeconds) || 0 : 0,
          offlineAlertsEnabled: form.offlineAlertsEnabled,
          firmware: form.firmware || null,
          // Kanalzuordnung nur bei Antrieben senden; wechselt das Gerät die
          // Funktion, wird sie bewusst zurückgesetzt.
          ...(isCover
            ? coverPayload(cover)
            : { coverUpChannel: null, coverDownChannel: null, coverRuntimeSec: null }),
          ...(isPulse ? pulsePayload(pulse) : { pulseSeconds: null }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Fehler beim Speichern");
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
    if (!device || !confirm(`Gerät "${device.name}" wirklich löschen?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/devices/${device.id}`, { method: "DELETE" });
      onClose();
      router.push("/devices");
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const isShelly = device?.type === "SHELLY";
  const isGardena = device?.type === "GARDENA_VALVE";
  const isAudio = device?.type === "AUDIO_PLAYER";

  return (
    <Dialog open={!!device} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerät bearbeiten</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-name">Name <span className="text-rose-500">*</span></Label>
            <Input id="d-name" value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
          </div>

          {/* Ein Abspieler bedient immer eine Beschallungszone – nichts zu wählen. */}
          {!isAudio && (
          <div className="space-y-2">
            <Label>Funktion</Label>
            <div className="grid grid-cols-4 gap-2">
              {DEVICE_CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const selected = form.category === cat.value;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => set("category", selected ? "" : cat.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border-2 px-1 py-2.5 text-center transition-all",
                      selected
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <p className="text-xs font-medium leading-tight">{cat.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="d-ip">IP-Adresse</Label>
            <Input id="d-ip" value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)} placeholder="192.168.1.100" className="font-mono" />
          </div>

          {/* Shelly Cloud */}
          {isShelly && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="d-shelly-id">Shelly ID</Label>
                <Input id="d-shelly-id" value={form.shellyId} onChange={(e) => set("shellyId", e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-shelly-key">Shelly Auth Key</Label>
                <Input id="d-shelly-key" type="password" value={form.shellyAuthKey} onChange={(e) => set("shellyAuthKey", e.target.value)} className="font-mono" />
              </div>
            </>
          )}

          {/* Antrieb – Kanalzuordnung fuer Markise/Rolltor */}
          {isShelly && isCoverCategory(form.category) && (
            <CoverFields
              category={form.category}
              values={cover}
              onChange={(patch) => setCover((p) => ({ ...p, ...patch }))}
            />
          )}

          {/* Taster – Einschaltdauer */}
          {isShelly && isPulseCategory(form.category) && (
            <PulseFields
              values={pulse}
              onChange={(patch) => setPulse((p) => ({ ...p, ...patch }))}
            />
          )}

          {/* GARDENA – Service-ID (Info) */}
          {isGardena && device?.gardenaServiceId && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/30 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 space-y-1">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">GARDENA Service-ID</p>
              <p className="text-xs font-mono text-slate-500 break-all">{device.gardenaServiceId}</p>
            </div>
          )}

          {/* Zugangsbereiche – nur Drehkreuz & Tür */}
          {CAT_HAS_ACCESS.has(form.category) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Resource &amp; Richtung</p>

              <div className="grid grid-cols-3 gap-2">
                {DIRECTIONS.map((d) => {
                  const Icon = d.icon;
                  const selected = form.direction === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => set("direction", d.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-2.5 text-center transition-all",
                        selected
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
                          : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600"
                      )}
                      title={d.hint}
                    >
                      <Icon className="h-4 w-4" />
                      <p className="text-xs font-medium leading-tight">{d.label}</p>
                    </button>
                  );
                })}
              </div>

              {form.direction === "in" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Eingang in Resource</Label>
                  <Select value={form.accessIn} onValueChange={(v) => set("accessIn", v)}>
                    <SelectTrigger><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Resource</SelectItem>
                      {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.direction === "out" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Ausgang aus Resource</Label>
                  <Select value={form.accessOut} onValueChange={(v) => set("accessOut", v)}>
                    <SelectTrigger><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Resource</SelectItem>
                      {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.direction === "bidir" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Eingang in Resource</Label>
                      <Select value={form.accessIn} onValueChange={(v) => set("accessIn", v)}>
                        <SelectTrigger><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Resource</SelectItem>
                          {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ausgang aus Resource</Label>
                      <Select value={form.accessOut} onValueChange={(v) => set("accessOut", v)}>
                        <SelectTrigger><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Resource</SelectItem>
                          {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Bidirektionale Geräte können nicht eindeutig zwischen Eintritt und Austritt unterscheiden. Wenn möglich, lieber separate Geräte für Eingang und Ausgang anlegen.</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Kamera-Zuordnung – nur Drehkreuz & Tür (Zugangsgeräte mit Scans) */}
          {CAT_HAS_ACCESS.has(form.category) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Cctv className="h-3.5 w-3.5" /> Kamera
              </p>
              <Select value={form.cameraId} onValueChange={(v) => set("cameraId", v)}>
                <SelectTrigger><SelectValue placeholder="Keine Kamera" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine Kamera</SelectItem>
                  {cameras.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                Kamera, die diesen Zugang im Blick hat. Scans dieses Geräts werden mit dem Kamerabild verknüpft.
              </p>
            </div>
          )}

          {/* Sensor-Hinweis */}
          {form.category === "SENSOR" && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
              <Activity className="h-3.5 w-3.5 shrink-0" />
              Sensor – zeigt Werte an, keine Steuerung oder Zugangsverwaltung.
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div>
              <p className="text-sm font-medium">Aktiv</p>
              <p className="text-xs text-slate-500">Gerät ist in Betrieb</p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
          </div>

          {/* Offline-Push – nur für überwachbare Typen (Pi, Shelly, GARDENA) */}
          {device?.type !== "NUKI_SMARTLOCK" && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Offline-Benachrichtigung</p>
                <p className="text-xs text-slate-500">Push senden, wenn das Gerät offline geht</p>
              </div>
              <Switch checked={form.offlineAlertsEnabled} onCheckedChange={(v) => set("offlineAlertsEnabled", v)} />
            </div>
          )}

          {CAT_HAS_REENTRY.has(form.category) && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Mehrfachzugang</p>
                <p className="text-xs text-slate-500">Ticket mehrfach verwendbar</p>
              </div>
              <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
            </div>
          )}

          {CAT_HAS_ACCESS.has(form.category) && (
            <ScanLockField
              value={form.scanLockSeconds}
              onChange={(v) => set("scanLockSeconds", v)}
            />
          )}

          {error && (
            <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
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
      </DialogContent>
    </Dialog>
  );
}

const SCAN_LOCK_PRESETS = [0, 15, 30, 60, 120];

function formatScanLockPreset(seconds: number): string {
  if (seconds <= 0) return "Aus";
  if (seconds < 60) return `${seconds} Sek.`;
  return seconds === 60 ? "1 Min." : `${seconds / 60} Min.`;
}

export function ScanLockField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const seconds = Number(value);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <div>
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Timer className="h-4 w-4" /> Sperrzeit nach gültigem Scan
        </p>
        <p className="text-xs text-slate-500">
          Nächster Scan desselben Tickets erst nach dieser Zeit. Andere Tickets können sofort danach durch.
        </p>
      </div>
      <Input
        type="number"
        min={0}
        max={3600}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
      <div className="flex flex-wrap gap-1.5">
        {SCAN_LOCK_PRESETS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(String(s))}
            className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            {formatScanLockPreset(s)}
          </button>
        ))}
      </div>
      {Number.isFinite(seconds) && seconds > 0 && (
        <p className="text-xs text-slate-400">Sperre {formatScanLockPreset(seconds)} für dasselbe Ticket.</p>
      )}
    </div>
  );
}
