"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Headphones, Loader2, Music, PartyPopper, Pencil, Save, Square } from "lucide-react";
import { BIRTHDAY_BUILTIN_MUSIC_PATH, BIRTHDAY_BUILTIN_MUSIC_TITLE, isBuiltinBirthdayMusic } from "@/lib/birthday";
import { Chip } from "./ui";
import type { TrackRow, ZoneRow } from "./types";

export interface BirthdaySongSetting {
  monitorSongActive: boolean;
  monitorSongZoneIds: number[];
  /** Der Song (Mediathek); null = keiner. */
  monitorSongTrackId: number | null;
}

const DEFAULTS: BirthdaySongSetting = {
  monitorSongActive: false,
  monitorSongZoneIds: [],
  monitorSongTrackId: null,
};

/** Auswahl im Dialog: „none“, „builtin“ (mitgeliefertes Happy Birthday) oder die Titel-ID. */
type SongChoice = string;

/**
 * Geburtstagssong (Audio › Zeitpläne): Wird ein Geburtstagskind am
 * Shop-Monitor gescannt, läuft einmal der Song in den gewählten Zonen – wie
 * eine Durchsage, die Musik wird solange leiser. Einmal je Person und Jahr.
 */
export function BirthdaySongCard({
  setting,
  zones,
  tracks = [],
  appEnabled,
}: {
  setting: BirthdaySongSetting | null;
  zones: ZoneRow[];
  tracks?: TrackRow[];
  appEnabled: boolean;
}) {
  const router = useRouter();
  const current = setting ?? DEFAULTS;
  const [form, setForm] = useState<{ active: boolean; zoneIds: number[]; song: SongChoice } | null>(null);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const musicTracks = tracks.filter((t) => t.kind === "MUSIC");
  const builtin = musicTracks.find((t) => isBuiltinBirthdayMusic(t.url)) ?? null;
  const currentSong = tracks.find((t) => t.id === current.monitorSongTrackId) ?? null;
  const zoneNames = zones.filter((z) => current.monitorSongZoneIds.includes(z.id)).map((z) => z.name);
  const valid = !!form && (!form.active || (form.zoneIds.length > 0 && form.song !== "none"));

  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));

  function stopPreview() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  }

  function open() {
    // Ab Werk das mitgelieferte Happy Birthday und die Zone, die am Shop-Monitor spielt.
    const monitorZones = zones.filter((z) => z.monitorId !== null).map((z) => z.id);
    setForm({
      active: setting ? current.monitorSongActive : true,
      zoneIds: setting && current.monitorSongZoneIds.length > 0 ? current.monitorSongZoneIds : monitorZones,
      song:
        current.monitorSongTrackId != null && currentSong
          ? String(current.monitorSongTrackId)
          : builtin
            ? String(builtin.id)
            : "builtin",
    });
    setError("");
  }

  function toggleZone(id: number) {
    if (!form) return;
    set({ zoneIds: form.zoneIds.includes(id) ? form.zoneIds.filter((z) => z !== id) : [...form.zoneIds, id] });
  }

  function songUrl(choice: SongChoice): string | null {
    if (choice === "none") return null;
    if (choice === "builtin") return BIRTHDAY_BUILTIN_MUSIC_PATH;
    return tracks.find((t) => String(t.id) === choice)?.url ?? null;
  }

  async function preview() {
    if (!form) return;
    if (playing) {
      stopPreview();
      return;
    }
    const url = songUrl(form.song);
    if (!url) return;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    setPlaying(true);
    await audio.play().catch(() => {
      setPlaying(false);
      setError("Abspielen im Browser nicht möglich");
    });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/audio/birthday/song", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monitorSongActive: form.active,
          monitorSongZoneIds: form.zoneIds,
          monitorSong: form.song === "none" ? null : form.song === "builtin" ? "builtin" : Number(form.song),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      stopPreview();
      setForm(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PartyPopper className="h-4 w-4 text-primary shrink-0" />
            Geburtstagssong im Shop
          </CardTitle>
          <CardDescription>
            Wird ein Geburtstagskind am Shop-Monitor gescannt, läuft einmal der Song.
          </CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={open} className="max-sm:h-11">
              <Pencil className="h-4 w-4" />
              Bearbeiten
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={current.monitorSongActive ? "success" : "neutral"} className="font-normal">
              {current.monitorSongActive ? "an" : "aus"}
            </Badge>
            {current.monitorSongActive && (
              <span className="text-sm text-foreground">{zoneNames.length > 0 ? zoneNames.join(", ") : "keine Zone"}</span>
            )}
            {currentSong && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <Music className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{currentSong.title}</span>
              </span>
            )}
          </div>
          {!appEnabled && current.monitorSongActive && (
            <Notice tone="warning" compact title="Die Kunden-App ist aus. Geburtsdaten kommen aus dem Profil der App." />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => {
        if (o || saving) return;
        stopPreview();
        setForm(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Geburtstagssong im Shop</DialogTitle>
            <DialogDescription>
              Beim ersten Scan des Geburtstagskinds am Shop-Monitor. Danach in dem Jahr nicht noch einmal.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                Song beim Scan am Shop-Monitor
                <Switch checked={form.active} onCheckedChange={(v) => set({ active: v })} />
              </label>

              <div>
                <Label className="mb-1.5 block">Song</Label>
                <Select value={form.song} onValueChange={(v) => { stopPreview(); set({ song: v }); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Song</SelectItem>
                    {!builtin && <SelectItem value="builtin">{BIRTHDAY_BUILTIN_MUSIC_TITLE}</SelectItem>}
                    {musicTracks.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.artist ? `${t.title} · ${t.artist}` : t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Läuft wie eine Durchsage: die Musik wird leiser und spielt danach weiter.
                  Eigene Songs kommen über die Mediathek dazu.
                </p>
              </div>

              <div>
                <Label className="mb-2 block">
                  Zonen · {form.zoneIds.length === 0 ? "keine gewählt" : `${form.zoneIds.length} ausgewählt`}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {zones.map((zone) => (
                    <Chip key={zone.id} active={form.zoneIds.includes(zone.id)} onClick={() => toggleZone(zone.id)}>
                      {zone.name}
                    </Chip>
                  ))}
                </div>
              </div>

              <Notice
                tone="info"
                compact
                title="Wer die Geburtstags-Durchsage in der App für sich abschaltet, bekommt auch keinen Song."
              />

              <Button
                type="button"
                variant="outline"
                onClick={preview}
                disabled={form.song === "none"}
                className="w-full max-sm:h-11"
              >
                {playing ? <Square className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
                {playing ? "Probe anhalten" : "Probe hier anhören"}
              </Button>

              {error && <Notice tone="danger" compact title={error} />}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { stopPreview(); setForm(null); }} disabled={saving} className="max-sm:h-11">
                  Abbrechen
                </Button>
                <Button type="button" onClick={save} disabled={saving || !valid} className="min-w-24 max-sm:h-11">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Speichern</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
