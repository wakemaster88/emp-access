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
import { AUDIO_OPERATING_LABELS, AUDIO_TRIGGER_LABELS } from "@/lib/audio-constants";
import { Chip, sliderFill } from "./ui";
import type {
  AnnouncementRow,
  AudioScheduleAction,
  AudioScheduleTrigger,
  OperatingScheduleOption,
  PlaylistRow,
  RuleOperatingCondition,
  ScheduleRow,
  ZoneRow,
} from "./types";

const ROOM_SCHEDULE = "__room__";

const TRIGGER_HINTS: Record<AudioScheduleTrigger, string> = {
  TIME: "Feste Uhrzeit an den gewählten Wochentagen.",
  OPENING: "Wenn die Betriebszeit der Zone öffnet – wahlweise vorher oder nachher.",
  CLOSING: "Wenn die Betriebszeit der Zone schließt – wahlweise vorher oder nachher.",
};

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const ACTION_LABELS: Record<AudioScheduleAction, string> = {
  ANNOUNCE: "Durchsage abspielen",
  PLAY: "Playlist starten",
  STOP: "Wiedergabe stoppen",
  VOLUME: "Lautstärke setzen",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  schedule: ScheduleRow | null;
  zones: ZoneRow[];
  playlists: PlaylistRow[];
  announcements: AnnouncementRow[];
  operatingSchedules: OperatingScheduleOption[];
}

export function ScheduleDialog({
  open,
  onClose,
  onSaved,
  schedule,
  zones,
  playlists,
  announcements,
  operatingSchedules,
}: Props) {
  const isEdit = !!schedule;
  const templates = announcements.filter((a) => a.isTemplate);

  const [name, setName] = useState(schedule?.name ?? "");
  const [action, setAction] = useState<AudioScheduleAction>(schedule?.action ?? "ANNOUNCE");
  const [trigger, setTrigger] = useState<AudioScheduleTrigger>(schedule?.trigger ?? "TIME");
  const [timeOfDay, setTimeOfDay] = useState(schedule?.timeOfDay ?? "09:00");
  const [offsetMinutes, setOffsetMinutes] = useState(schedule?.offsetMinutes ?? 0);
  const [operatingScheduleId, setOperatingScheduleId] = useState<string>(
    schedule?.operatingScheduleId ? String(schedule.operatingScheduleId) : ROOM_SCHEDULE
  );
  const [operating, setOperating] = useState<RuleOperatingCondition>(
    schedule?.operating ?? "ANY"
  );
  const [daysOfWeek, setDaysOfWeek] = useState(schedule?.daysOfWeek ?? 127);
  const [zoneIds, setZoneIds] = useState<number[]>(schedule?.zoneIds ?? []);
  const [announcementId, setAnnouncementId] = useState<string>(
    schedule?.announcementId ? String(schedule.announcementId) : String(templates[0]?.id ?? "")
  );
  const [playlistId, setPlaylistId] = useState<string>(
    schedule?.playlistId ? String(schedule.playlistId) : String(playlists[0]?.id ?? "")
  );
  const [volume, setVolume] = useState(schedule?.volume ?? 50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(index: number) {
    setDaysOfWeek((prev) => prev ^ (1 << index));
  }

  function toggleZone(id: number) {
    setZoneIds((prev) => (prev.includes(id) ? prev.filter((z) => z !== id) : [...prev, id]));
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich");
      return;
    }
    if (action === "ANNOUNCE" && !announcementId) {
      setError("Bitte eine gespeicherte Durchsage auswählen");
      return;
    }
    if (action === "PLAY" && !playlistId) {
      setError("Bitte eine Playlist auswählen");
      return;
    }
    if (trigger === "TIME" && !timeOfDay) {
      setError("Bitte eine Uhrzeit angeben");
      return;
    }
    // Ohne Betriebszeit gibt es weder Betriebsbeginn noch -ende. Zonen ohne
    // Raum bleiben still – das soll nicht erst am Tag selbst auffallen.
    if (trigger !== "TIME" && operatingScheduleId === ROOM_SCHEDULE) {
      const targets = zoneIds.length === 0 ? zones.filter((z) => z.isActive) : zones.filter((z) => zoneIds.includes(z.id));
      if (targets.length > 0 && targets.every((z) => z.operatingScheduleId == null)) {
        setError(
          operatingSchedules.length === 0
            ? "Noch keine Betriebszeit angelegt – zuerst unter „Betriebszeiten“ anlegen und dem Raum der Zone zuordnen."
            : "Keine der Zonen hat einen Raum mit Betriebszeit. Entweder die Zone einem Raum zuordnen oder hier eine Betriebszeit wählen."
        );
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        action,
        trigger,
        timeOfDay: trigger === "TIME" ? timeOfDay : null,
        offsetMinutes: trigger === "TIME" ? 0 : offsetMinutes,
        operatingScheduleId:
          operatingScheduleId === ROOM_SCHEDULE ? null : Number(operatingScheduleId),
        operating,
        daysOfWeek,
        zoneIds,
        announcementId: action === "ANNOUNCE" ? Number(announcementId) : null,
        playlistId: action === "PLAY" ? Number(playlistId) : null,
        volume: action === "VOLUME" ? volume : null,
      };
      const res = await fetch(
        isEdit ? `/api/audio/schedules/${schedule!.id}` : "/api/audio/schedules",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
          <DialogTitle>{isEdit ? "Zeitplan bearbeiten" : "Neuer Zeitplan"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="as-name">Name</Label>
            <Input
              id="as-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Betriebsschluss-Durchsage"
            />
          </div>

          <div>
            <Label>Aktion</Label>
            <Select
              value={action}
              onValueChange={(v) => setAction(v as AudioScheduleAction)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACTION_LABELS) as AudioScheduleAction[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-slate-500 mt-1">
                Die Aktion lässt sich nachträglich nicht ändern – dafür einen neuen Zeitplan
                anlegen.
              </p>
            )}
          </div>

          {action === "ANNOUNCE" && (
            <div>
              <Label>Durchsage</Label>
              <Select value={announcementId} onValueChange={setAnnouncementId} disabled={isEdit}>
                <SelectTrigger>
                  <SelectValue placeholder="Auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templates.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Noch keine gespeicherte Durchsage vorhanden.
                </p>
              )}
            </div>
          )}

          {action === "PLAY" && (
            <div>
              <Label>Playlist</Label>
              <Select value={playlistId} onValueChange={setPlaylistId} disabled={isEdit}>
                <SelectTrigger>
                  <SelectValue placeholder="Auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {playlists.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "VOLUME" && (
            <div>
              <Label>Lautstärke · {volume}%</Label>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Lautstärke"
                aria-valuetext={`${volume} Prozent`}
                style={sliderFill(volume)}
                className="touch-slider w-full"
              />
            </div>
          )}

          <div>
            <Label>Wann</Label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as AudioScheduleTrigger)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIO_TRIGGER_LABELS) as AudioScheduleTrigger[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {AUDIO_TRIGGER_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500 mt-1">{TRIGGER_HINTS[trigger]}</p>
          </div>

          {trigger === "TIME" ? (
            <div>
              <Label htmlFor="as-time">Uhrzeit</Label>
              <Input
                id="as-time"
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-32"
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="as-offset">Verschiebung (Min.)</Label>
                <Input
                  id="as-offset"
                  type="number"
                  min={-720}
                  max={720}
                  value={offsetMinutes}
                  onChange={(e) => setOffsetMinutes(Number(e.target.value) || 0)}
                  className="w-32"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Negativ = vorher, positiv = nachher. „−15“ heißt eine Viertelstunde vor{" "}
                  {trigger === "OPENING" ? "Betriebsbeginn" : "Betriebsende"}.
                </p>
              </div>
              <div>
                <Label>Betriebszeit</Label>
                <Select value={operatingScheduleId} onValueChange={setOperatingScheduleId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOM_SCHEDULE}>die des Raums der Zone</SelectItem>
                    {operatingSchedules.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {operatingSchedules.length === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    Noch keine Betriebszeit angelegt – unter „Betriebszeiten“ anlegen.
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <Label>Bedingung</Label>
            <Select
              value={operating}
              onValueChange={(v) => setOperating(v as RuleOperatingCondition)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIO_OPERATING_LABELS) as RuleOperatingCondition[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {AUDIO_OPERATING_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500 mt-1">
              Gilt je Zone nach der Betriebszeit ihres Raums. Eine Zone ohne Betriebszeit gilt als
              dauerhaft geöffnet.
            </p>
          </div>

          <div>
            <Label className="mb-2 block">Wochentage</Label>
            {/* Sieben feste Breiten liefen auf schmalen Geräten aus dem Dialog
                heraus; als Raster teilen sie sich die vorhandene Breite. */}
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_NAMES.map((day, index) => {
                const active = ((daysOfWeek >> index) & 1) === 1;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(index)}
                    aria-pressed={active}
                    className={cn(
                      "h-11 rounded-lg border text-xs font-medium transition-colors sm:h-9",
                      active
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">
              Zonen · {zoneIds.length === 0 ? "alle aktiven" : `${zoneIds.length} ausgewählt`}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {zones.map((zone) => (
                <Chip
                  key={zone.id}
                  active={zoneIds.includes(zone.id)}
                  onClick={() => toggleZone(zone.id)}
                >
                  {zone.name}
                </Chip>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40">
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

export { ACTION_LABELS };
