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
import { Chip, sliderFill } from "./ui";
import type {
  AnnouncementRow,
  AudioScheduleAction,
  PlaylistRow,
  ScheduleRow,
  ZoneRow,
} from "./types";

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
}

export function ScheduleDialog({
  open,
  onClose,
  onSaved,
  schedule,
  zones,
  playlists,
  announcements,
}: Props) {
  const isEdit = !!schedule;
  const templates = announcements.filter((a) => a.isTemplate);

  const [name, setName] = useState(schedule?.name ?? "");
  const [action, setAction] = useState<AudioScheduleAction>(schedule?.action ?? "ANNOUNCE");
  const [timeOfDay, setTimeOfDay] = useState(schedule?.timeOfDay ?? "09:00");
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

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        action,
        timeOfDay,
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
            <Label htmlFor="as-time">Uhrzeit</Label>
            <Input
              id="as-time"
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              className="w-32"
            />
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
