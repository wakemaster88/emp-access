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
import { Cake, Headphones, Loader2, Music, Pencil, Save } from "lucide-react";
import { normalizeTtsVoice, TTS_FALLBACK_VOICES, type TtsVoice } from "@/lib/audio-constants";
import {
  BIRTHDAY_ANNOUNCE_MAX,
  BIRTHDAY_BUILTIN_MUSIC_TITLE,
  BIRTHDAY_DEFAULT_ANNOUNCE,
  birthdayAnnounceText,
  isBuiltinBirthdayMusic,
} from "@/lib/birthday";
import { Chip, TEXTAREA_CLASS } from "./ui";
import type { TrackRow, ZoneRow } from "./types";

export interface BirthdayAnnounceSetting {
  announceActive: boolean;
  announceText: string | null;
  announceName: boolean;
  announceZoneIds: number[];
  announceVoice: string | null;
  announceChime: boolean;
  /** Musik unter der Ansage (Mediathek); null = ohne. */
  announceMusicTrackId: number | null;
}

/** Auswahl im Dialog: „none“, „builtin“ (mitgeliefertes Happy Birthday) oder die Titel-ID. */
type MusicChoice = string;

type PreviewBed = { url: string; untilSec: number; delaySec: number; level: number };

const DEFAULTS: BirthdayAnnounceSetting = {
  announceActive: false,
  announceText: null,
  announceName: true,
  announceZoneIds: [],
  announceVoice: null,
  announceChime: true,
  announceMusicTrackId: null,
};

/**
 * Geburtstags-Ansage (Audio › Zeitpläne): Scannt ein Geburtstagskind am
 * Start-Drehkreuz, kommt einmal am Tag eine Durchsage in den gewählten Zonen.
 * Das Geburtsdatum kommt aus dem Profil der Kunden-App.
 */
export function BirthdayAnnounceCard({
  setting,
  zones,
  voices = TTS_FALLBACK_VOICES,
  tracks = [],
  appEnabled,
}: {
  setting: BirthdayAnnounceSetting | null;
  zones: ZoneRow[];
  voices?: TtsVoice[];
  /** Mediathek; Musiktitel stehen als Musik unter der Ansage zur Wahl. */
  tracks?: TrackRow[];
  /** Kunden-App eingeschaltet (ohne sie gibt es keine Geburtsdaten aus dem Profil). */
  appEnabled: boolean;
}) {
  const router = useRouter();
  const current = setting ?? DEFAULTS;
  const [form, setForm] = useState<(BirthdayAnnounceSetting & { text: string; voice: string; music: MusicChoice }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bedRef = useRef<HTMLAudioElement | null>(null);
  const timersRef = useRef<number[]>([]);

  const musicTracks = tracks.filter((t) => t.kind === "MUSIC");
  const hasBuiltin = musicTracks.some((t) => isBuiltinBirthdayMusic(t.url));
  const currentMusic = tracks.find((t) => t.id === current.announceMusicTrackId) ?? null;

  function stopPreview() {
    audioRef.current?.pause();
    bedRef.current?.pause();
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }

  function musicPayload(choice: MusicChoice): number | "builtin" | null {
    if (choice === "none") return null;
    if (choice === "builtin") return "builtin";
    return Number(choice);
  }

  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const zoneNames = zones.filter((z) => current.announceZoneIds.includes(z.id)).map((z) => z.name);
  const valid = !!form && (!form.announceActive || form.announceZoneIds.length > 0);

  function open() {
    setForm({
      ...current,
      text: current.announceText ?? "",
      voice: normalizeTtsVoice(current.announceVoice),
      music: current.announceMusicTrackId != null && currentMusic ? String(current.announceMusicTrackId) : "none",
    });
    setError("");
  }

  function toggleZone(id: number) {
    if (!form) return;
    set({
      announceZoneIds: form.announceZoneIds.includes(id)
        ? form.announceZoneIds.filter((z) => z !== id)
        : [...form.announceZoneIds, id],
    });
  }

  async function preview() {
    if (!form) return;
    setPreviewing(true);
    setError("");
    try {
      const res = await fetch("/api/audio/birthday/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announceText: form.text.trim() || null,
          announceName: form.announceName,
          announceVoice: form.voice,
          announceMusic: musicPayload(form.music),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; bed?: PreviewBed | null; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "Probe fehlgeschlagen");
        return;
      }
      stopPreview();
      audioRef.current = new Audio(json.url);
      if (!json.bed) {
        await audioRef.current.play().catch(() => setError("Abspielen im Browser nicht möglich"));
        return;
      }
      // Grob wie am Audio-Pi: Musik, dann Sprache mit leiser Musik, danach
      // Musik wieder lauter und zum Ende ausblenden.
      const { url, untilSec, delaySec, level } = json.bed;
      const bed = new Audio(url);
      bed.volume = level;
      bedRef.current = bed;
      const speech = audioRef.current;
      speech.onended = () => {
        bed.volume = level;
      };
      await bed.play().catch(() => setError("Abspielen im Browser nicht möglich"));
      timersRef.current.push(
        window.setTimeout(() => {
          bed.volume = level * 0.2;
          void speech.play().catch(() => {});
        }, delaySec * 1000),
        window.setTimeout(() => {
          const steps = 10;
          for (let i = 1; i <= steps; i++) {
            timersRef.current.push(window.setTimeout(() => { bed.volume = Math.max(0, level * (1 - i / steps)); }, i * 250));
          }
        }, Math.max(0, untilSec - 2.5) * 1000),
        window.setTimeout(() => bed.pause(), untilSec * 1000),
      );
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/audio/birthday", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announceActive: form.announceActive,
          announceText: form.text.trim() || null,
          announceName: form.announceName,
          announceZoneIds: form.announceZoneIds,
          announceVoice: form.voice,
          announceChime: form.announceChime,
          announceMusic: musicPayload(form.music),
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
            <Cake className="h-4 w-4 text-primary shrink-0" />
            Geburtstags-Ansage
          </CardTitle>
          <CardDescription>
            Scannt ein Geburtstagskind am Start-Drehkreuz, gratuliert eine Durchsage, einmal am Tag.
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
            <Badge variant={current.announceActive ? "success" : "neutral"} className="font-normal">
              {current.announceActive ? "an" : "aus"}
            </Badge>
            {current.announceActive && (
              <span className="text-sm text-foreground">{zoneNames.length > 0 ? zoneNames.join(", ") : "keine Zone"}</span>
            )}
            {currentMusic && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <Music className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{currentMusic.title}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground break-words">
            „{birthdayAnnounceText(current, "Mia")}“
          </p>
          {!appEnabled && current.announceActive && (
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
            <DialogTitle>Geburtstags-Ansage</DialogTitle>
            <DialogDescription>Beim ersten Scan am Start-Drehkreuz am Geburtstag. Danach an dem Tag nicht noch einmal.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                Durchsage am Geburtstag
                <Switch checked={form.announceActive} onCheckedChange={(v) => set({ announceActive: v })} />
              </label>

              <div>
                <Label htmlFor="bd-ann-text" className="mb-1.5 block">Ansagetext</Label>
                <textarea
                  id="bd-ann-text"
                  className={TEXTAREA_CLASS}
                  rows={3}
                  maxLength={BIRTHDAY_ANNOUNCE_MAX}
                  value={form.text}
                  placeholder={BIRTHDAY_DEFAULT_ANNOUNCE}
                  onChange={(e) => set({ text: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {"{vorname}"} wird durch den Vornamen ersetzt. Ohne Namen fällt er samt Komma weg.
                </p>
              </div>

              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                <span>
                  Vorname nennen
                  <span className="block text-xs text-muted-foreground">Nie der Nachname. Aus: Glückwunsch ohne Namen.</span>
                </span>
                <Switch checked={form.announceName} onCheckedChange={(v) => set({ announceName: v })} />
              </label>

              <div>
                <Label className="mb-1.5 block">Stimme</Label>
                <Select value={form.voice} onValueChange={(v) => set({ voice: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block">Musik unter der Ansage</Label>
                <Select value={form.music} onValueChange={(v) => set({ music: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ohne Musik</SelectItem>
                    {!hasBuiltin && <SelectItem value="builtin">{BIRTHDAY_BUILTIN_MUSIC_TITLE}</SelectItem>}
                    {musicTracks.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.artist ? `${t.title} · ${t.artist}` : t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Die Musik beginnt, wird unter der Sprache leise und blendet etwa 10 Sekunden nach der Ansage aus.
                </p>
              </div>

              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground">
                Gong voranstellen
                <Switch checked={form.announceChime} onCheckedChange={(v) => set({ announceChime: v })} />
              </label>

              <div>
                <Label className="mb-2 block">
                  Zonen · {form.announceZoneIds.length === 0 ? "keine gewählt" : `${form.announceZoneIds.length} ausgewählt`}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {zones.map((zone) => (
                    <Chip key={zone.id} active={form.announceZoneIds.includes(zone.id)} onClick={() => toggleZone(zone.id)}>
                      {zone.name}
                    </Chip>
                  ))}
                </div>
              </div>

              <Notice
                tone="info"
                compact
                title="Jede Person kann die Durchsage in der App auf ihrer Geburtstagskarte für sich abschalten."
              />

              <Button type="button" variant="outline" onClick={preview} disabled={previewing} className="w-full max-sm:h-11">
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
                Probe hier anhören (mit „Mia“)
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
