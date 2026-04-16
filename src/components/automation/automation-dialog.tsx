"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Clock, Sunrise, Sunset, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSunTimesForAccount } from "@/lib/sun";
import type { GroupWithMembers, AutomationWithGroup, AccountInfo, AutomationTrigger } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  automation: AutomationWithGroup | null;
  groups: GroupWithMembers[];
  account: AccountInfo;
}

const DAYS = [
  { bit: 0, short: "Mo" },
  { bit: 1, short: "Di" },
  { bit: 2, short: "Mi" },
  { bit: 3, short: "Do" },
  { bit: 4, short: "Fr" },
  { bit: 5, short: "Sa" },
  { bit: 6, short: "So" },
];

export function AutomationDialog({ open, onClose, onSaved, automation, groups, account }: Props) {
  const isEdit = !!automation;
  const [name, setName] = useState(automation?.name ?? "");
  const [groupId, setGroupId] = useState<number>(automation?.groupId ?? groups[0]?.id ?? 0);
  const [trigger, setTrigger] = useState<AutomationTrigger>(automation?.trigger ?? "SCHEDULE");
  const [timeOfDay, setTimeOfDay] = useState(automation?.timeOfDay ?? "18:00");
  const [offsetMinutes, setOffsetMinutes] = useState<number>(automation?.offsetMinutes ?? 0);
  const [daysOfWeek, setDaysOfWeek] = useState<number>(automation?.daysOfWeek ?? 127);
  const [isActive, setIsActive] = useState<boolean>(automation?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sun = useMemo(
    () => getSunTimesForAccount(account.latitude, account.longitude, new Date()),
    [account.latitude, account.longitude]
  );
  const tz = account.timezone ?? "Europe/Berlin";

  function toggleDay(bit: number) {
    setDaysOfWeek((prev) => prev ^ (1 << bit));
  }

  function presetDays(mask: number) {
    setDaysOfWeek(mask);
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Name erforderlich");
    if (!groupId) return setError("Szene wählen");
    if (trigger === "SCHEDULE" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
      return setError("Zeit im Format HH:mm (z.B. 18:00)");
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        groupId,
        trigger,
        isActive,
        daysOfWeek,
        timeOfDay: trigger === "SCHEDULE" ? timeOfDay : null,
        offsetMinutes: trigger === "SCHEDULE" ? 0 : offsetMinutes,
      };
      const url = isEdit ? `/api/shelly-automations/${automation!.id}` : "/api/shelly-automations";
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

  const previewTime = useMemo(() => {
    if (trigger === "SCHEDULE") return null;
    const base = trigger === "SUNRISE" ? sun.sunrise : sun.sunset;
    if (!base) return null;
    const shifted = new Date(base.getTime() + offsetMinutes * 60_000);
    return new Intl.DateTimeFormat("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(shifted);
  }, [trigger, offsetMinutes, sun, tz]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Automation bearbeiten" : "Neue Automation"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="au-name">Name</Label>
            <Input
              id="au-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Abendlicht automatisch"
            />
          </div>

          <div>
            <Label htmlFor="au-group">Szene</Label>
            <Select value={String(groupId)} onValueChange={(v) => setGroupId(Number(v))}>
              <SelectTrigger id="au-group">
                <SelectValue placeholder="Szene wählen" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name} · {g.members.length} Gerät{g.members.length !== 1 ? "e" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Auslöser</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <TriggerTile
                active={trigger === "SCHEDULE"}
                icon={Clock}
                label="Zeitplan"
                onClick={() => setTrigger("SCHEDULE")}
              />
              <TriggerTile
                active={trigger === "SUNRISE"}
                icon={Sunrise}
                label="Sonnenaufgang"
                onClick={() => setTrigger("SUNRISE")}
              />
              <TriggerTile
                active={trigger === "SUNSET"}
                icon={Sunset}
                label="Sonnenuntergang"
                onClick={() => setTrigger("SUNSET")}
              />
            </div>
          </div>

          {trigger === "SCHEDULE" ? (
            <div>
              <Label htmlFor="au-time">Uhrzeit ({tz})</Label>
              <Input
                id="au-time"
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="au-offset">Offset zum Sonnenereignis (Minuten)</Label>
              <Input
                id="au-offset"
                type="number"
                min={-720}
                max={720}
                step={5}
                value={offsetMinutes}
                onChange={(e) => setOffsetMinutes(Number(e.target.value) || 0)}
                placeholder="z.B. -30 für 30 Min. vorher, +15 für 15 Min. nachher"
              />
              <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">
                <MapPin className="h-3 w-3" />
                {account.latitude == null || account.longitude == null ? (
                  <>Standort nicht gesetzt – Fallback Berlin. Heute: {previewTime ?? "—"}</>
                ) : (
                  <>Heute ca. {previewTime ?? "—"} ({account.latitude.toFixed(2)}, {account.longitude.toFixed(2)})</>
                )}
              </p>
            </div>
          )}

          <div>
            <Label>Wochentage</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {DAYS.map((d) => {
                const selected = ((daysOfWeek >> d.bit) & 1) === 1;
                return (
                  <button
                    type="button"
                    key={d.bit}
                    onClick={() => toggleDay(d.bit)}
                    className={cn(
                      "h-8 min-w-[40px] px-2 rounded-lg text-xs font-semibold transition-colors",
                      selected
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    )}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1 text-xs">
              <button type="button" onClick={() => presetDays(127)} className="text-indigo-600 hover:underline">Alle</button>
              <span className="text-slate-400">·</span>
              <button type="button" onClick={() => presetDays(31)} className="text-indigo-600 hover:underline">Mo–Fr</button>
              <span className="text-slate-400">·</span>
              <button type="button" onClick={() => presetDays(96)} className="text-indigo-600 hover:underline">Wochenende</button>
              <span className="text-slate-400">·</span>
              <button type="button" onClick={() => presetDays(0)} className="text-indigo-600 hover:underline">Keine</button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <Label htmlFor="au-active" className="cursor-pointer">
              Aktiv
              <p className="text-xs text-slate-500 font-normal">Pausierte Automationen werden vom Cron ignoriert.</p>
            </Label>
            <Switch id="au-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Abbrechen</Button>
          <Button onClick={save} disabled={saving || groups.length === 0} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriggerTile({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-colors",
        active
          ? "bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-700 dark:text-indigo-300"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900/30 dark:border-slate-700 dark:text-slate-400"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
