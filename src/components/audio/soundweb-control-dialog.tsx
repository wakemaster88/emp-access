"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOUNDWEB_KIND_LABELS, formatHiqnetAddress } from "@/lib/soundweb";
import { TEXTAREA_CLASS } from "./ui";
import type { SoundwebControlKind, SoundwebControlRow, SoundwebDeviceRow } from "./types";

const KINDS: { value: SoundwebControlKind; hint: string }[] = [
  { value: "GAIN", hint: "Fader eines Gain-Objekts, in dB. State Variable 0 = Gain." },
  { value: "MUTE", hint: "Stummschalter. Bei einem Gain-Objekt State Variable 1." },
  { value: "PERCENT", hint: "Beliebiger Regler als Prozent des Reglerwegs – ohne dB-Anzeige." },
  { value: "SELECT", hint: "Ganzzahlige Auswahl, etwa der Eingang eines Source Selectors." },
  { value: "PRESET", hint: "Ruft ein Parameter-Preset auf allen Geräten ab." },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  device: SoundwebDeviceRow;
  control: SoundwebControlRow | null;
  /** Bereits vergebene Abschnitte – zum Auswählen statt Abtippen. */
  groups: string[];
}

/** Adresse so vorbelegen, wie sie gespeichert ist: ohne Node nur das Objekt. */
function initialAddress(control: SoundwebControlRow | null): string {
  if (!control || control.kind === "PRESET") return "";
  if (control.node === null) return `0x${control.objectId.toString(16).padStart(6, "0")}`;
  return formatHiqnetAddress(control.node, control.virtualDevice, control.objectId);
}

export function SoundwebControlDialog({ open, onClose, onSaved, device, control, groups }: Props) {
  const isEdit = !!control;
  const [name, setName] = useState(control?.name ?? "");
  const [group, setGroup] = useState(control?.group ?? "");
  const [kind, setKind] = useState<SoundwebControlKind>(control?.kind ?? "GAIN");
  const [address, setAddress] = useState(initialAddress(control));
  const [stateVariable, setStateVariable] = useState(
    control && control.kind !== "PRESET" ? String(control.stateVariable) : ""
  );
  const [minDb, setMinDb] = useState(String(control?.minDb ?? -80));
  const [maxDb, setMaxDb] = useState(String(control?.maxDb ?? 10));
  const [options, setOptions] = useState(
    control?.options.map((o) => `${o.value}=${o.label}`).join("\n") ?? ""
  );
  const [presetId, setPresetId] = useState(control?.presetId != null ? String(control.presetId) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = KINDS.find((k) => k.value === kind)?.hint;

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Name ist erforderlich");
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), group: group.trim(), kind };
      if (kind === "PRESET") {
        body.presetId = presetId.trim();
      } else {
        body.address = address.trim();
        body.stateVariable = stateVariable.trim() === "" ? undefined : stateVariable.trim();
      }
      if (kind === "GAIN") {
        body.minDb = minDb.trim();
        body.maxDb = maxDb.trim();
      }
      if (kind === "SELECT") body.options = options;

      const res = await fetch(
        isEdit ? `/api/audio/soundweb/controls/${control!.id}` : `/api/audio/soundweb/${device.id}/controls`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Regler bearbeiten" : "Regler hinzufügen"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{device.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="swc-name">Name</Label>
              <Input
                id="swc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Musik Halle"
              />
            </div>
            <div>
              <Label htmlFor="swc-group">Abschnitt</Label>
              <Input
                id="swc-group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="optional, z. B. Halle"
                list="swc-groups"
              />
              {groups.length > 0 && (
                <datalist id="swc-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div>
            <Label>Art</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as SoundwebControlKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {SOUNDWEB_KIND_LABELS[k.value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>

          {kind === "PRESET" ? (
            <div>
              <Label htmlFor="swc-preset">Preset-ID</Label>
              <Input
                id="swc-preset"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                placeholder="z. B. 3"
                inputMode="numeric"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Die Zahl in eckigen Klammern hinter dem Preset im Design-Baum von Audio
                Architect. Sie bleibt auch dann gleich, wenn andere Presets gelöscht werden.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div>
                  <Label htmlFor="swc-address">HiQnet-Adresse</Label>
                  <Input
                    id="swc-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x000103000100"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="swc-sv">State Variable</Label>
                  <Input
                    id="swc-sv"
                    value={stateVariable}
                    onChange={(e) => setStateVariable(e.target.value)}
                    placeholder="0"
                    className="font-mono"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Adresse des Objekts aus den Eigenschaften in Audio Architect: Node (4
                Stellen), Virtual Device (03) und Objekt (6 Stellen). Nur die sechs
                Objektstellen (z. B. <span className="font-mono">0x000100</span>) heißen:
                Node dieses Geräts. Die State Variable zählt die Parameter im Objekt – bei
                einem Gain-Objekt 0 = Gain, 1 = Mute; bei mehrkanaligen Objekten steht die
                Nummer in der Objektbeschreibung.
              </p>
            </>
          )}

          {kind === "GAIN" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="swc-min">Regler von (dB)</Label>
                <Input id="swc-min" value={minDb} onChange={(e) => setMinDb(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <Label htmlFor="swc-max">bis (dB)</Label>
                <Input id="swc-max" value={maxDb} onChange={(e) => setMaxDb(e.target.value)} inputMode="decimal" />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Der untere Anschlag zeigt „−∞“. Enger als der Fader im Design (meist −80 bis
                +10) darf der Bereich sein – etwa bis 0 dB, damit niemand versehentlich
                anhebt.
              </p>
            </div>
          )}

          {kind === "SELECT" && (
            <div>
              <Label htmlFor="swc-options">Auswahlwerte</Label>
              <textarea
                id="swc-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                rows={4}
                placeholder={"0=CD-Spieler\n1=Mikrofon\n2=Zuspieler"}
                className={cn(TEXTAREA_CLASS, "font-mono")}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Eine Zeile je Eintrag, <span className="font-mono">Wert=Bezeichnung</span>.
                Der Wert ist die Zahl, die die State Variable annimmt (Eingänge zählen ab 0).
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving} className={cn("gap-1.5", saving && "opacity-80")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
