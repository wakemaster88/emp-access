"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Plus, Trash2, GripVertical, Power, PowerOff, Activity,
  ArrowUpFromLine, ArrowDownToLine, Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { coverActionLabels, isCoverCategory } from "@/lib/cover-constants";
import type { GroupWithMembers, ShellyDeviceOption, ShellyAction } from "./types";

/**
 * Auswaehlbare Aktionen je Geraet. Antriebe kennen nur Fahrbefehle, alle
 * anderen Shellys nur Schaltbefehle – eine Szene mit "Ein" auf einer Markise
 * waere nicht ausfuehrbar.
 */
function actionsForDevice(device: ShellyDeviceOption) {
  if (isCoverCategory(device.category)) {
    const labels = coverActionLabels(device.category);
    return [
      { value: "OPEN" as ShellyAction, label: labels.open, icon: ArrowUpFromLine },
      { value: "STOP" as ShellyAction, label: "Stopp", icon: Square },
      { value: "CLOSE" as ShellyAction, label: labels.close, icon: ArrowDownToLine },
    ];
  }
  return [
    { value: "ON" as ShellyAction, label: "Ein", icon: Power },
    { value: "OFF" as ShellyAction, label: "Aus", icon: PowerOff },
    { value: "TOGGLE" as ShellyAction, label: "Toggle", icon: Activity },
  ];
}

function defaultActionFor(device: ShellyDeviceOption): ShellyAction {
  return actionsForDevice(device)[0].value;
}

interface MemberDraft {
  deviceId: number;
  action: ShellyAction;
  timerSeconds: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  group: GroupWithMembers | null;
  shellyDevices: ShellyDeviceOption[];
}

export function GroupDialog({ open, onClose, onSaved, group, shellyDevices }: Props) {
  const isEdit = !!group;
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [members, setMembers] = useState<MemberDraft[]>(
    group?.members.map((m) => ({
      deviceId: m.deviceId,
      action: m.action,
      timerSeconds: m.timerSeconds,
    })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedIds = new Set(members.map((m) => m.deviceId));
  const availableDevices = shellyDevices.filter((d) => !usedIds.has(d.id));

  function addMember() {
    const next = availableDevices[0];
    if (!next) return;
    setMembers((prev) => [
      ...prev,
      { deviceId: next.id, action: defaultActionFor(next), timerSeconds: null },
    ]);
  }

  function updateMember(idx: number, patch: Partial<MemberDraft>) {
    setMembers((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        const merged = { ...m, ...patch };
        // Nach einem Gerätewechsel kann die bisherige Aktion unpassend sein
        // (z. B. "Ein" auf einer Markise) – dann auf die erste gültige setzen.
        const device = shellyDevices.find((d) => d.id === merged.deviceId);
        if (device && !actionsForDevice(device).some((a) => a.value === merged.action)) {
          merged.action = defaultActionFor(device);
        }
        return merged;
      }),
    );
  }

  function removeMember(idx: number) {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveMember(idx: number, dir: -1 | 1) {
    setMembers((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        members: members.map((m, idx) => ({
          deviceId: m.deviceId,
          action: m.action,
          timerSeconds: m.timerSeconds,
          sortOrder: idx,
        })),
      };
      const url = isEdit ? `/api/shelly-groups/${group!.id}` : "/api/shelly-groups";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
          <DialogTitle>{isEdit ? "Szene bearbeiten" : "Neue Szene"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="sg-name">Name</Label>
            <Input
              id="sg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Abendbeleuchtung"
            />
          </div>

          <div>
            <Label htmlFor="sg-desc">Beschreibung (optional)</Label>
            <Input
              id="sg-desc"
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="z.B. Eingang + Halle + Außen"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Aktionen</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addMember}
                disabled={availableDevices.length === 0}
                className="gap-1.5 h-8"
              >
                <Plus className="h-3.5 w-3.5" /> Gerät hinzufügen
              </Button>
            </div>

            {members.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-3 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
                Noch keine Aktionen · {availableDevices.length === 0 ? "Keine Shellies verfügbar" : "Klicke oben auf 'Gerät hinzufügen'"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {members.map((m, idx) => {
                  const device = shellyDevices.find((d) => d.id === m.deviceId);
                  if (!device) return null;
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
                    >
                      <div className="flex flex-col shrink-0">
                        <button
                          type="button"
                          onClick={() => moveMember(idx, -1)}
                          disabled={idx === 0}
                          className="text-slate-400 hover:text-slate-600 disabled:opacity-30 p-0.5"
                        >
                          <GripVertical className="h-3 w-3 rotate-180" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMember(idx, 1)}
                          disabled={idx === members.length - 1}
                          className="text-slate-400 hover:text-slate-600 disabled:opacity-30 p-0.5"
                        >
                          <GripVertical className="h-3 w-3" />
                        </button>
                      </div>

                      <Select
                        value={String(m.deviceId)}
                        onValueChange={(v) => updateMember(idx, { deviceId: Number(v) })}
                      >
                        <SelectTrigger className="h-8 flex-1 min-w-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[device, ...availableDevices].map((d) => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={m.action}
                        onValueChange={(v) => updateMember(idx, { action: v as ShellyAction })}
                      >
                        <SelectTrigger className="h-8 w-[120px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {actionsForDevice(device).map((a) => {
                            const Icon = a.icon;
                            return (
                              <SelectItem key={a.value} value={a.value}>
                                <span className="flex items-center gap-1.5">
                                  <Icon className="h-3 w-3" /> {a.label}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      {/* Antriebe stoppen selbst nach ihrer Fahrzeit – ein
                          zusätzlicher Auto-Off-Timer ergibt dort keinen Sinn. */}
                      {!isCoverCategory(device.category) && (
                        <Input
                          type="number"
                          min={0}
                          max={86400}
                          value={m.timerSeconds ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateMember(idx, { timerSeconds: v === "" ? null : Math.max(0, Number(v)) });
                          }}
                          placeholder="Timer s"
                          className="h-8 w-[90px] shrink-0"
                          title="Optionaler Auto-Off Timer in Sekunden"
                        />
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember(idx)}
                        className="h-8 px-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {shellyDevices.length === 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/40">
              Noch keine Shelly-Geräte angelegt. Bitte zuerst unter &quot;Geräte&quot; hinzufügen.
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Abbrechen</Button>
          <Button onClick={save} disabled={saving} className={cn("gap-1.5", saving && "opacity-80")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

