"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Loader2, Cpu, Wifi, AlertCircle,
  GitMerge, DoorOpen, Activity, ToggleRight, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WeekScheduleEditor, emptySchedule } from "@/components/devices/week-schedule-editor";
import type { WeekSchedule } from "@/lib/schedule";

interface Area {
  id: number;
  name: string;
}

interface AddDeviceDialogProps {
  areas: Area[];
}

const DEVICE_TYPES = [
  {
    value: "RASPBERRY_PI",
    label: "Raspberry Pi",
    description: "Drehkreuz, Tür, Sensor …",
    icon: Cpu,
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
    activeColor: "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40",
  },
  {
    value: "SHELLY",
    label: "Shelly",
    description: "Relais, Schalter, Licht …",
    icon: Wifi,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    activeColor: "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
  },
];

const DEVICE_CATEGORIES = [
  { value: "DREHKREUZ",   label: "Drehkreuz",   icon: GitMerge,    color: "text-indigo-600 dark:text-indigo-400",   bg: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800" },
  { value: "TUER",        label: "Tür",          icon: DoorOpen,    color: "text-sky-600 dark:text-sky-400",         bg: "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800" },
  { value: "SENSOR",      label: "Sensor",       icon: Activity,    color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" },
  { value: "SCHALTER",    label: "Schalter",     icon: ToggleRight, color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
  { value: "BELEUCHTUNG", label: "Beleuchtung",  icon: Lightbulb,   color: "text-yellow-600 dark:text-yellow-400",  bg: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800" },
];

// Per-category feature flags
const CAT_HAS_ACCESS   = new Set(["DREHKREUZ", "TUER"]);
const CAT_HAS_REENTRY  = new Set(["DREHKREUZ", "TUER"]);
const CAT_HAS_SCHEDULE = new Set(["BELEUCHTUNG", "SCHALTER"]);

const EMPTY = {
  name: "",
  type: "",
  category: "",
  ipAddress: "",
  shellyId: "",
  shellyAuthKey: "",
  accessIn: "none",
  accessOut: "none",
  allowReentry: false,
  isActive: true,
};

export function AddDeviceDialog({ areas }: AddDeviceDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [schedule, setSchedule] = useState<WeekSchedule>(emptySchedule());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function reset() {
    setForm(EMPTY);
    setSchedule(emptySchedule());
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.type || !form.category) return;
    setSaving(true);
    setError("");

    const hasAccess  = CAT_HAS_ACCESS.has(form.category);
    const hasSchedule = CAT_HAS_SCHEDULE.has(form.category);

    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          category: form.category || null,
          ipAddress: form.ipAddress || null,
          shellyId: form.shellyId || null,
          shellyAuthKey: form.shellyAuthKey || null,
          accessIn:  hasAccess && form.accessIn  !== "none" ? Number(form.accessIn)  : null,
          accessOut: hasAccess && form.accessOut !== "none" ? Number(form.accessOut) : null,
          allowReentry: hasAccess ? form.allowReentry : false,
          isActive: form.isActive,
          schedule: hasSchedule ? schedule : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Fehler beim Erstellen");
      } else {
        setOpen(false);
        reset();
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  const isShelly = form.type === "SHELLY";
  const cat = form.category;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <Plus className="h-4 w-4" />
          Gerät hinzufügen
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neues Gerät hinzufügen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* 1. Hardware-Typ */}
          <div className="space-y-2">
            <Label>Hardware <span className="text-rose-500">*</span></Label>
            <div className="grid grid-cols-2 gap-3">
              {DEVICE_TYPES.map((t) => {
                const Icon = t.icon;
                const selected = form.type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set("type", t.value)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all",
                      selected ? t.activeColor : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    )}
                  >
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center", t.color)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-800 dark:text-slate-200">{t.label}</p>
                      <p className="text-xs text-slate-500">{t.description}</p>
                    </div>
                    {selected && (
                      <Badge className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                        Ausgewählt
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Funktion/Kategorie */}
          {form.type && (
            <div className="space-y-2">
              <Label>Funktion <span className="text-rose-500">*</span></Label>
              <div className="grid grid-cols-5 gap-2">
                {DEVICE_CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  const selected = form.category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => set("category", c.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center transition-all",
                        selected ? c.bg + " border-current" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                      )}
                    >
                      <Icon className={cn("h-5 w-5", selected ? c.color : "text-slate-400")} />
                      <p className={cn("text-xs font-medium leading-tight", selected ? c.color : "text-slate-500")}>{c.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Konfiguration */}
          {form.type && cat && (
            <>
              <Separator className="dark:bg-slate-800" />

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="d-name">Name <span className="text-rose-500">*</span></Label>
                <Input
                  id="d-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={
                    cat === "DREHKREUZ" ? "z.B. Drehkreuz Haupteingang" :
                    cat === "TUER"      ? "z.B. Tür VIP-Resource" :
                    cat === "SENSOR"    ? "z.B. Temperatur Eingang" :
                    cat === "SCHALTER"  ? "z.B. Pumpe Becken A" :
                                          "z.B. Flutlicht Feld 1"
                  }
                  required
                  autoFocus
                />
              </div>

              {/* IP */}
              <div className="space-y-1.5">
                <Label htmlFor="d-ip">
                  IP-Adresse
                  {isShelly && <span className="text-slate-400 font-normal ml-1">(lokale Steuerung)</span>}
                </Label>
                <Input
                  id="d-ip"
                  value={form.ipAddress}
                  onChange={(e) => set("ipAddress", e.target.value)}
                  placeholder="192.168.1.100"
                  className="font-mono"
                />
              </div>

              {/* Shelly Cloud */}
              {isShelly && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Shelly Cloud (optional)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-shelly-id" className="text-sm">Shelly ID</Label>
                    <Input id="d-shelly-id" value={form.shellyId} onChange={(e) => set("shellyId", e.target.value)}
                      placeholder="shellyplus1-abc123" className="font-mono text-sm bg-white dark:bg-slate-900" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-shelly-key" className="text-sm">Auth Key</Label>
                    <Input id="d-shelly-key" type="password" value={form.shellyAuthKey}
                      onChange={(e) => set("shellyAuthKey", e.target.value)}
                      placeholder="••••••••" className="font-mono text-sm bg-white dark:bg-slate-900" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Shelly ID und Auth Key in der Shelly Cloud unter Geräteeinstellungen.
                  </div>
                </div>
              )}

              {/* Zugangsbereiche – nur für Drehkreuz & Tür */}
              {CAT_HAS_ACCESS.has(cat) && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Resourcen</p>
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

              {/* Zeitsteuerung – Schalter & Beleuchtung */}
              {CAT_HAS_SCHEDULE.has(cat) && (
                <WeekScheduleEditor value={schedule} onChange={setSchedule} />
              )}

              {/* Sensor-Hinweis */}
              {cat === "SENSOR" && (
                <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2.5">
                  <Activity className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Sensoren zeigen nur Werte an – keine Steuerung oder Zugangsverwaltung.</span>
                </div>
              )}

              {/* Toggles */}
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <div>
                    <p className="text-sm font-medium">Sofort aktivieren</p>
                    <p className="text-xs text-slate-500">Gerät ist ab sofort in Betrieb</p>
                  </div>
                  <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
                </div>

                {CAT_HAS_REENTRY.has(cat) && (
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <div>
                      <p className="text-sm font-medium">Mehrfachzugang</p>
                      <p className="text-xs text-slate-500">Ticket kann mehrfach gescannt werden</p>
                    </div>
                    <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={saving}>
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  disabled={saving || !form.name.trim() || !form.type || !form.category}
                  className="bg-indigo-600 hover:bg-indigo-700 min-w-32"
                >
                  {saving
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <><Plus className="h-4 w-4 mr-1.5" />Gerät erstellen</>}
                </Button>
              </div>
            </>
          )}

          {!form.type && (
            <p className="text-center text-sm text-slate-400 pb-2">Bitte zuerst einen Gerätetyp wählen</p>
          )}
          {form.type && !form.category && (
            <p className="text-center text-sm text-slate-400 pb-2">Bitte eine Funktion wählen</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
