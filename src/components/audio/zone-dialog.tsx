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
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sliderFill } from "./ui";
import type { AudioDeviceOption, AudioSourceKind, PlaylistRow, ZoneRow } from "./types";

const NONE = "__none__";

/** Was „Start“ in dieser Zone abspielt. */
const SOURCES: { value: AudioSourceKind; label: string; hint: string }[] = [
  { value: "PLAYLIST", label: "Playlist", hint: "Spielt die Standard-Playlist der Zone." },
  { value: "STREAM", label: "Webradio", hint: "Spielt den hinterlegten Stream." },
  { value: "SILENCE", label: "Keine Musik", hint: "Zone macht nur Durchsagen." },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  zone: ZoneRow | null;
  devices: AudioDeviceOption[];
  playlists: PlaylistRow[];
}

export function ZoneDialog({ open, onClose, onSaved, zone, devices, playlists }: Props) {
  const isEdit = !!zone;
  const [name, setName] = useState(zone?.name ?? "");
  const [deviceId, setDeviceId] = useState<string>(zone?.deviceId ? String(zone.deviceId) : NONE);
  const [playlistId, setPlaylistId] = useState<string>(
    zone?.playlistId ? String(zone.playlistId) : NONE
  );
  const [streamUrl, setStreamUrl] = useState(zone?.streamUrl ?? "");
  // Eine neue Zone ohne Playlist-Auswahl startet als reine Durchsagen-Zone,
  // sonst müsste man erst eine Quelle bestücken, um speichern zu können.
  const [defaultSource, setDefaultSource] = useState<AudioSourceKind>(
    zone?.defaultSource ?? (playlists.length > 0 ? "PLAYLIST" : "SILENCE")
  );
  const [syncGroup, setSyncGroup] = useState(zone?.syncGroup ?? "");
  const [volume, setVolume] = useState(zone?.volume ?? 50);
  const [announcementVolume, setAnnouncementVolume] = useState(zone?.announcementVolume ?? 85);
  const [duckVolume, setDuckVolume] = useState(zone?.duckVolume ?? 15);
  const [quietFrom, setQuietFrom] = useState(zone?.quietFrom ?? "");
  const [quietTo, setQuietTo] = useState(zone?.quietTo ?? "");
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bereits belegte Abspieler ausblenden – außer dem eigenen.
  const availableDevices = devices.filter((d) => !d.taken || d.id === zone?.deviceId);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich");
      return;
    }
    // Eine Quelle ohne Inhalt liesse sich später nicht starten.
    if (defaultSource === "PLAYLIST" && playlistId === NONE) {
      setError("Für die Quelle „Playlist“ eine Standard-Playlist auswählen");
      return;
    }
    if (defaultSource === "STREAM" && !streamUrl.trim()) {
      setError("Für die Quelle „Webradio“ eine Stream-URL eintragen");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        deviceId: deviceId === NONE ? null : Number(deviceId),
        playlistId: playlistId === NONE ? null : Number(playlistId),
        defaultSource,
        streamUrl: streamUrl.trim() || null,
        syncGroup: syncGroup.trim() || null,
        volume,
        announcementVolume,
        duckVolume,
        quietFrom: quietFrom || null,
        quietTo: quietTo || null,
        isActive,
      };
      const res = await fetch(isEdit ? `/api/audio/zones/${zone!.id}` : "/api/audio/zones", {
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
          <DialogTitle>{isEdit ? "Zone bearbeiten" : "Neue Zone"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="az-name">Name</Label>
            <Input
              id="az-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Außengelände Seilbahn"
            />
          </div>

          <div>
            <Label>Abspieler</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger>
                <SelectValue placeholder="Kein Gerät" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Kein Gerät (nur geplant)</SelectItem>
                {availableDevices.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableDevices.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Noch kein freies Audio-Gerät. Unter „Geräte&quot; einen Abspieler vom Typ
                AUDIO_PLAYER anlegen.
              </p>
            )}
          </div>

          <div>
            <Label>Quelle</Label>
            <Select
              value={defaultSource}
              onValueChange={(v) => setDefaultSource(v as AudioSourceKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500 mt-1">
              {SOURCES.find((s) => s.value === defaultSource)?.hint}
            </p>
          </div>

          <div>
            <Label>Standard-Playlist</Label>
            <Select value={playlistId} onValueChange={setPlaylistId}>
              <SelectTrigger>
                <SelectValue placeholder="Keine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Keine</SelectItem>
                {playlists.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="az-stream">Webradio-Stream (optional)</Label>
            <Input
              id="az-stream"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://stream.example.com/live.mp3"
            />
          </div>

          <div>
            <Label htmlFor="az-sync">Sync-Gruppe (optional)</Label>
            <Input
              id="az-sync"
              value={syncGroup}
              onChange={(e) => setSyncGroup(e.target.value)}
              placeholder="z. B. aussen"
            />
            <p className="text-xs text-slate-500 mt-1">
              Zonen mit gleicher Sync-Gruppe spielen synchron – nötig, wenn man sie
              gleichzeitig hört.
            </p>
          </div>

          {/* Am Telefon untereinander: nebeneinander blieben je 90 px, in denen
              die Beschriftung „Durchsage · 85 %" umbrach. */}
          <div className="grid gap-1 sm:grid-cols-3 sm:gap-3">
            <VolumeField label="Musik" value={volume} onChange={setVolume} />
            <VolumeField
              label="Durchsage"
              value={announcementVolume}
              onChange={setAnnouncementVolume}
            />
            <VolumeField label="Ducking" value={duckVolume} onChange={setDuckVolume} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="az-quiet-from">Ruhezeit ab</Label>
              <Input
                id="az-quiet-from"
                type="time"
                value={quietFrom}
                onChange={(e) => setQuietFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="az-quiet-to">Ruhezeit bis</Label>
              <Input
                id="az-quiet-to"
                type="time"
                value={quietTo}
                onChange={(e) => setQuietTo(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 -mt-1">
            In der Ruhezeit läuft keine Musik. Durchsagen werden trotzdem abgespielt.
          </p>

          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600 sm:min-h-0 dark:text-slate-300">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            Zone aktiv
          </label>

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

function VolumeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label>
        {label} · {value}%
      </Label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${value} Prozent`}
        style={sliderFill(value)}
        className="touch-slider w-full"
      />
    </div>
  );
}
