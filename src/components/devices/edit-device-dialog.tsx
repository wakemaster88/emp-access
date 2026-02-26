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
import { Loader2, Trash2, Save, GitMerge, DoorOpen, Activity, ToggleRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AreaOption {
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
  isActive: boolean;
  accessIn: number | null;
  accessOut: number | null;
  allowReentry: boolean;
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
];

interface EditDeviceDialogProps {
  device: DeviceData | null;
  areas?: AreaOption[];
  onClose: () => void;
}

export function EditDeviceDialog({ device, areas = [], onClose }: EditDeviceDialogProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    category: "",
    ipAddress: "",
    shellyId: "",
    shellyAuthKey: "",
    isActive: true,
    accessIn: "none",
    accessOut: "none",
    allowReentry: false,
    firmware: "",
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
        accessIn: device.accessIn != null ? String(device.accessIn) : "none",
        accessOut: device.accessOut != null ? String(device.accessOut) : "none",
        allowReentry: device.allowReentry,
        firmware: device.firmware ?? "",
      });
      setError("");
    }
  }, [device]);

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!device) return;
    setSaving(true);
    setError("");
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
          accessIn: form.accessIn && form.accessIn !== "none" ? Number(form.accessIn) : null,
          accessOut: form.accessOut && form.accessOut !== "none" ? Number(form.accessOut) : null,
          allowReentry: form.allowReentry,
          firmware: form.firmware || null,
        }),
      });
      if (!res.ok) {
        setError("Fehler beim Speichern");
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

          <div className="space-y-2">
            <Label>Funktion</Label>
            <div className="grid grid-cols-5 gap-2">
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

          {/* Zugangsbereiche – nur Drehkreuz & Tür */}
          {CAT_HAS_ACCESS.has(form.category) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Resourcen</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Eingang</Label>
                  <Select value={form.accessIn} onValueChange={(v) => set("accessIn", v)}>
                    <SelectTrigger><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Resource</SelectItem>
                      {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ausgang</Label>
                  <Select value={form.accessOut} onValueChange={(v) => set("accessOut", v)}>
                    <SelectTrigger><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Resource</SelectItem>
                      {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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

          {CAT_HAS_REENTRY.has(form.category) && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Mehrfachzugang</p>
                <p className="text-xs text-slate-500">Ticket mehrfach verwendbar</p>
              </div>
              <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
            </div>
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
