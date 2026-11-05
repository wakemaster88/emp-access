"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Loader2, Cpu, Wifi, AlertCircle, Building2,
  GitMerge, DoorOpen, Activity, ToggleRight, Lightbulb,
  LogIn, LogOut, ArrowLeftRight, Umbrella, Blinds, CircleDot, Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isCoverCategory } from "@/lib/cover-constants";
import { isPulseCategory } from "@/lib/pulse-constants";
import {
  CoverFields, EMPTY_COVER_VALUES, coverPayload, validateCoverValues,
  type CoverFormValues,
} from "@/components/devices/cover-fields";
import {
  PulseFields, EMPTY_PULSE_VALUES, pulsePayload, validatePulseValues,
  type PulseFormValues,
} from "@/components/devices/pulse-fields";
import { ScanLockField } from "@/components/devices/edit-device-dialog";

interface Area {
  id: number;
  name: string;
}

interface Room {
  id: number;
  name: string;
}

interface AddDeviceDialogProps {
  areas: Area[];
  rooms?: Room[];
}

// Auswahlkacheln: Auswahl in der Akzentfarbe (primary), sonst ruhig – keine Farbe je Typ.
const DEVICE_TYPES = [
  {
    value: "RASPBERRY_PI",
    label: "Raspberry Pi",
    description: "Drehkreuz, Tür, Sensor …",
    icon: Cpu,
  },
  {
    value: "SHELLY",
    label: "Shelly",
    description: "Relais, Schalter, Licht …",
    icon: Wifi,
  },
  {
    value: "AUDIO_PLAYER",
    label: "Audio-Player",
    description: "Beschallungszone",
    icon: Volume2,
  },
];

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

// Per-category feature flags
const CAT_HAS_ACCESS   = new Set(["DREHKREUZ", "TUER"]);
const CAT_HAS_REENTRY  = new Set(["DREHKREUZ", "TUER"]);
// Antriebe brauchen zwei schaltbare Relais, ein Taster den Auto-Off-Timer –
// beides bietet nur der Shelly-Pfad.
const CAT_SHELLY_ONLY  = new Set(["MARKISE", "ROLLTOR", "TASTER"]);

type Direction = "in" | "out" | "bidir";

const EMPTY = {
  name: "",
  type: "",
  category: "",
  ipAddress: "",
  shellyId: "",
  shellyAuthKey: "",
  direction: "in" as Direction,
  accessIn: "none",
  accessOut: "none",
  keyRoomId: "none",
  allowReentry: false,
  scanLockSeconds: "0",
  isActive: true,
};

const DIRECTIONS: { value: Direction; label: string; hint: string; icon: typeof LogIn }[] = [
  { value: "in",    label: "Nur Eingang",   hint: "Drehkreuz lässt nur rein",                       icon: LogIn },
  { value: "out",   label: "Nur Ausgang",   hint: "Drehkreuz lässt nur raus",                       icon: LogOut },
  { value: "bidir", label: "Bidirektional", hint: "Beide Richtungen – ohne klare Richtungslogik", icon: ArrowLeftRight },
];

export function AddDeviceDialog({ areas, rooms = [] }: AddDeviceDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [cover, setCover] = useState<CoverFormValues>(EMPTY_COVER_VALUES);
  const [pulse, setPulse] = useState<PulseFormValues>(EMPTY_PULSE_VALUES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function reset() {
    setForm(EMPTY);
    setCover(EMPTY_COVER_VALUES);
    setPulse(EMPTY_PULSE_VALUES);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.type || !form.category) return;

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

    const hasAccess  = CAT_HAS_ACCESS.has(form.category);

    // Resourcen je nach Richtung mappen. Damit kann ein Bedienfehler
    // (z.B. accessIn UND accessOut auf den gleichen Bereich, ohne dass
    // das Gerät wirklich bidirektional ist) nicht mehr auftreten.
    let accessIn: number | null = null;
    let accessOut: number | null = null;
    if (hasAccess) {
      if (form.direction === "in") {
        accessIn = form.accessIn !== "none" ? Number(form.accessIn) : null;
      } else if (form.direction === "out") {
        accessOut = form.accessOut !== "none" ? Number(form.accessOut) : null;
      } else {
        accessIn  = form.accessIn  !== "none" ? Number(form.accessIn)  : null;
        accessOut = form.accessOut !== "none" ? Number(form.accessOut) : null;
      }
    }

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
          accessIn,
          accessOut,
          allowReentry: hasAccess ? form.allowReentry : false,
          scanLockSeconds: hasAccess ? Number(form.scanLockSeconds) || 0 : 0,
          isActive: form.isActive,
          keyRoomId: form.keyRoomId !== "none" ? Number(form.keyRoomId) : null,
          ...(isCover ? coverPayload(cover) : {}),
          ...(isPulse ? pulsePayload(pulse) : {}),
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
  const isAudio = form.type === "AUDIO_PLAYER";
  const cat = form.category;
  const availableCategories = DEVICE_CATEGORIES.filter(
    (c) => isShelly || !CAT_SHELLY_ONLY.has(c.value),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2 max-sm:h-11">
          <Plus className="h-4 w-4" />
          Gerät hinzufügen
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neues Gerät hinzufügen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* 1. Hardware-Typ */}
          <div className="space-y-2">
            <Label>Hardware <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {DEVICE_TYPES.map((t) => {
                const Icon = t.icon;
                const selected = form.type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setForm((p) => {
                        // Antriebe gibt es nur bei Shelly, AUDIO nur beim
                        // Abspieler – beim Wechsel darf keine unpassende
                        // Auswahl stehen bleiben.
                        const keepsCategory =
                          p.category !== "AUDIO"
                          && (t.value === "SHELLY" || !CAT_SHELLY_ONLY.has(p.category));
                        return {
                          ...p,
                          type: t.value,
                          category: t.value === "AUDIO_PLAYER"
                            ? "AUDIO"
                            : keepsCategory ? p.category : "",
                        };
                      });
                    }}
                    className={cn(
                      // Auswahl als Kachel: gewählt in Akzentfarbe, sonst Glas-Kachel (in der Ebene getönt).
                      "press flex flex-col items-center gap-2 rounded-tile border p-4 text-center",
                      selected ? "border-primary bg-primary/10" : "glass-tile hover:border-foreground/20"
                    )}
                    aria-pressed={selected}
                  >
                    <IconChip icon={Icon} size="lg" tone={selected ? "primary" : "neutral"} active={selected} />
                    <div>
                      <p className="font-medium text-sm text-foreground/90">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    </div>
                    {selected && (
                      <Badge variant="secondary">
                        Ausgewählt
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Funktion/Kategorie – ein Abspieler bedient immer eine Zone */}
          {form.type && !isAudio && (
            <div className="space-y-2">
              <Label>Funktion <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {availableCategories.map((c) => {
                  const Icon = c.icon;
                  const selected = form.category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => set("category", c.value)}
                      className={cn(
                        "press flex flex-col items-center gap-1.5 rounded-tile border px-2 py-3 text-center",
                        selected ? "border-primary bg-primary/10" : "glass-tile hover:border-foreground/20"
                      )}
                      aria-pressed={selected}
                    >
                      <Icon className={cn("h-5 w-5", selected ? "text-primary" : "text-muted-foreground")} />
                      <p className={cn("text-xs font-medium leading-tight", selected ? "text-primary" : "text-muted-foreground")}>{c.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Konfiguration */}
          {form.type && cat && (
            <>
              <Separator />

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="d-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="d-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={
                    cat === "DREHKREUZ" ? "z.B. Drehkreuz Haupteingang" :
                    cat === "TUER"      ? "z.B. Tür VIP-Resource" :
                    cat === "SENSOR"    ? "z.B. Temperatur Eingang" :
                    cat === "SCHALTER"  ? "z.B. Pumpe Becken A" :
                    cat === "MARKISE"   ? "z.B. Markise Terrasse" :
                    cat === "ROLLTOR"   ? "z.B. Rolltor Verleih" :
                    cat === "TASTER"    ? "z.B. Außendusche" :
                    cat === "AUDIO"     ? "z.B. Abspieler Liegewiese" :
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
                  {isShelly && <span className="text-muted-foreground font-normal ml-1">(lokale Steuerung)</span>}
                </Label>
                <Input
                  id="d-ip"
                  value={form.ipAddress}
                  onChange={(e) => set("ipAddress", e.target.value)}
                  placeholder="192.168.1.100"
                  className="font-mono"
                />
              </div>

              {/* Abspieler: der Rest der Einrichtung passiert am Pi */}
              {isAudio && (
                <Notice tone="info" compact icon={Volume2} title="Nächste Schritte">
                  <p>
                    In den Gerätedetails steht danach das Konfigurations-JSON für{" "}
                    <span className="font-mono">install-audio.sh</span> auf dem Raspberry Pi.
                    Die Zone selbst wird unter <span className="font-medium">Audio → Zonen</span> zugewiesen.
                  </p>
                </Notice>
              )}

              {/* Shelly Cloud */}
              {isShelly && (
                // Gruppe im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18). Optional ist kein Warnzustand.
                <div className="glass-tile p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Shelly Cloud (optional)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-shelly-id" className="text-sm">Shelly ID</Label>
                    <Input id="d-shelly-id" value={form.shellyId} onChange={(e) => set("shellyId", e.target.value)}
                      placeholder="shellyplus1-abc123" className="font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-shelly-key" className="text-sm">Auth Key</Label>
                    <Input id="d-shelly-key" type="password" value={form.shellyAuthKey}
                      onChange={(e) => set("shellyAuthKey", e.target.value)}
                      placeholder="••••••••" className="font-mono" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Shelly ID und Auth Key in der Shelly Cloud unter Geräteeinstellungen.
                  </div>
                </div>
              )}

              {/* Antrieb – Kanalzuordnung fuer Markise/Rolltor */}
              {isShelly && isCoverCategory(cat) && (
                <CoverFields
                  category={cat}
                  values={cover}
                  onChange={(patch) => setCover((p) => ({ ...p, ...patch }))}
                />
              )}

              {/* Taster – Einschaltdauer */}
              {isShelly && isPulseCategory(cat) && (
                <PulseFields
                  values={pulse}
                  onChange={(patch) => setPulse((p) => ({ ...p, ...patch }))}
                />
              )}

              {/* Zugangsbereiche – nur für Drehkreuz & Tür */}
              {CAT_HAS_ACCESS.has(cat) && (
                <div className="glass-tile p-3 space-y-3">
                  <p className="text-label">Resource &amp; Richtung</p>

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
                            "press flex flex-col items-center gap-1.5 rounded-tile border px-2 py-2.5 text-center",
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "glass-tile text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                          )}
                          title={d.hint}
                          aria-pressed={selected}
                        >
                          <Icon className="h-4 w-4" />
                          <p className="text-xs font-medium leading-tight">{d.label}</p>
                        </button>
                      );
                    })}
                  </div>

                  {form.direction === "in" && (
                    <div className="space-y-1.5">
                      <Label>Eingang in Resource</Label>
                      <Select value={form.accessIn} onValueChange={(v) => set("accessIn", v)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Resource</SelectItem>
                          {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {form.direction === "out" && (
                    <div className="space-y-1.5">
                      <Label>Ausgang aus Resource</Label>
                      <Select value={form.accessOut} onValueChange={(v) => set("accessOut", v)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Resource</SelectItem>
                          {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {form.direction === "bidir" && (
                    <>
                      {/* Handy: untereinander, damit lange Resource-Namen nicht über den Rand laufen. */}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Eingang in Resource</Label>
                          <Select value={form.accessIn} onValueChange={(v) => set("accessIn", v)}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Keine Resource</SelectItem>
                              {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Ausgang aus Resource</Label>
                          <Select value={form.accessOut} onValueChange={(v) => set("accessOut", v)}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Keine Resource" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Keine Resource</SelectItem>
                              {areas.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Notice tone="warning" compact icon={AlertCircle}>
                        <span>Bidirektionale Geräte können nicht eindeutig zwischen Eintritt und Austritt unterscheiden. Wenn möglich, lieber separate Geräte für Eingang und Ausgang anlegen.</span>
                      </Notice>
                    </>
                  )}
                </div>
              )}

              {/* Raum – darueber bekommt das Geraet seine Betriebszeit */}
              {rooms.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Raum</Label>
                  <Select value={form.keyRoomId} onValueChange={(v) => set("keyRoomId", v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Kein Raum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Raum</SelectItem>
                      {rooms.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Schaltzeiten laufen über Regeln: „Einschalten bei Betriebsbeginn“ richtet sich nach der Betriebszeit dieses Raums.
                  </p>
                </div>
              )}

              {/* Sensor-Hinweis */}
              {cat === "SENSOR" && (
                <Notice
                  tone="info"
                  compact
                  icon={Activity}
                  title="Sensoren zeigen nur Werte an – keine Steuerung oder Zugangsverwaltung."
                />
              )}

              {/* Toggles */}
              <div className="space-y-2">
                {/* Schalter als gruppierte Zeilen in einer Glas-Kachel, durch Haarlinien getrennt. */}
                <div className="glass-tile divide-y divide-border">
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <p className="text-sm font-medium">Sofort aktivieren</p>
                      <p className="text-xs text-muted-foreground">Gerät ist ab sofort in Betrieb</p>
                    </div>
                    <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
                  </div>

                  {CAT_HAS_REENTRY.has(cat) && (
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div>
                        <p className="text-sm font-medium">Mehrfachzugang</p>
                        <p className="text-xs text-muted-foreground">Ticket kann mehrfach gescannt werden</p>
                      </div>
                      <Switch checked={form.allowReentry} onCheckedChange={(v) => set("allowReentry", v)} />
                    </div>
                  )}
                </div>

                {CAT_HAS_ACCESS.has(cat) && (
                  <ScanLockField
                    value={form.scanLockSeconds}
                    onChange={(v) => set("scanLockSeconds", v)}
                  />
                )}
              </div>

              {error && (
                <Notice tone="danger" compact title={error} />
              )}

              {/* Handy: Tasten volle Breite, Primärtaste oben (docs/design-regeln.md, Abschnitt 16). */}
              <DialogFooter className="pt-1">
                <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={saving}>
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  disabled={saving || !form.name.trim() || !form.type || !form.category}
                  className="min-w-32"
                >
                  {saving
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <><Plus className="h-4 w-4" />Gerät erstellen</>}
                </Button>
              </DialogFooter>
            </>
          )}

          {!form.type && (
            <p className="text-center text-sm text-muted-foreground pb-2">Bitte zuerst einen Gerätetyp wählen</p>
          )}
          {form.type && !form.category && (
            <p className="text-center text-sm text-muted-foreground pb-2">Bitte eine Funktion wählen</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
