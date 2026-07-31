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
import {
  MAX_ANNOUNCEMENT_CHARS,
  TTS_FALLBACK_VOICES,
  normalizeTtsVoice,
  type TtsVoice,
} from "@/lib/audio-constants";
import { Chip, TEXTAREA_CLASS } from "./ui";
import type { AnnouncementRow, TrackRow, ZoneRow } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  announcement: AnnouncementRow | null;
  zones: ZoneRow[];
  tracks: TrackRow[];
  /** Von der API gemeldete Stimmen; leer nur, wenn die Abfrage nicht durchkam. */
  voices?: TtsVoice[];
}

export function AnnouncementDialog({
  open,
  onClose,
  onSaved,
  announcement,
  zones,
  tracks,
  voices = TTS_FALLBACK_VOICES,
}: Props) {
  const isEdit = !!announcement;
  const fileTracks = tracks.filter((t) => t.kind !== "MUSIC");

  const [name, setName] = useState(announcement?.name ?? "");
  const [source, setSource] = useState<"TTS" | "FILE">(
    announcement?.source === "FILE" ? "FILE" : "TTS"
  );
  const [text, setText] = useState(announcement?.text ?? "");
  // Alte Durchsagen tragen noch Stimmen des früheren Anbieters – die stehen in
  // der Auswahl nicht mehr und würden das Feld leer zeigen.
  const [voice, setVoice] = useState(() => normalizeTtsVoice(announcement?.voice));
  const [trackId, setTrackId] = useState<string>(
    announcement?.trackId ? String(announcement.trackId) : String(fileTracks[0]?.id ?? "")
  );
  const [chime, setChime] = useState(announcement?.chime ?? true);
  const [repeatCount, setRepeatCount] = useState(announcement?.repeatCount ?? 1);
  const [emergency, setEmergency] = useState((announcement?.priority ?? 0) >= 100);
  const [zoneIds, setZoneIds] = useState<number[]>(announcement?.zoneIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleZone(id: number) {
    setZoneIds((prev) => (prev.includes(id) ? prev.filter((z) => z !== id) : [...prev, id]));
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich");
      return;
    }
    if (source === "TTS" && !text.trim()) {
      setError("Ansagetext ist erforderlich");
      return;
    }
    if (source === "FILE" && !trackId) {
      setError("Bitte eine Audiodatei auswählen");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        source,
        text: source === "TTS" ? text.trim() : null,
        voice: source === "TTS" ? voice : null,
        trackId: source === "FILE" ? Number(trackId) : null,
        chime,
        repeatCount,
        priority: emergency ? 100 : 0,
        zoneIds,
        isTemplate: true,
      };
      const res = await fetch(
        isEdit ? `/api/audio/announcements/${announcement!.id}` : "/api/audio/announcements",
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
          <DialogTitle>{isEdit ? "Durchsage bearbeiten" : "Neue Durchsage"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="aa-name">Name</Label>
            <Input
              id="aa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Betriebsschluss"
            />
          </div>

          <div>
            <Label>Quelle</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as "TTS" | "FILE")}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TTS">Text (wird gesprochen)</SelectItem>
                <SelectItem value="FILE">Audiodatei aus der Mediathek</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {source === "TTS" ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label htmlFor="aa-text">Ansagetext</Label>
                  <span className="text-xs text-slate-500">
                    {text.length}/{MAX_ANNOUNCEMENT_CHARS}
                  </span>
                </div>
                <textarea
                  id="aa-text"
                  value={text}
                  maxLength={MAX_ANNOUNCEMENT_CHARS}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder="Liebe Gäste, der Badebetrieb endet in fünfzehn Minuten."
                  className={TEXTAREA_CLASS}
                />
              </div>

              <div>
                <Label>Stimme</Label>
                <Select value={voice} onValueChange={setVoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div>
              <Label>Audiodatei</Label>
              <Select value={trackId} onValueChange={setTrackId}>
                <SelectTrigger>
                  <SelectValue placeholder="Auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {fileTracks.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fileTracks.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Noch keine Jingles oder Ansagen in der Mediathek.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600 sm:min-h-0 dark:text-slate-300">
              <Switch checked={chime} onCheckedChange={setChime} />
              Gong voranstellen
            </label>
            <div className="flex items-center gap-2">
              <Label htmlFor="aa-repeat" className="whitespace-nowrap">
                Wiederholungen
              </Label>
              <Input
                id="aa-repeat"
                type="number"
                min={1}
                max={5}
                value={repeatCount}
                onChange={(e) => setRepeatCount(Math.min(5, Math.max(1, Number(e.target.value))))}
                className="w-16"
              />
            </div>
          </div>

          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600 sm:min-h-0 dark:text-slate-300">
            <Switch checked={emergency} onCheckedChange={setEmergency} />
            Notfall – unterbricht laufende Durchsagen
          </label>

          <div>
            <Label className="mb-2 block">
              Standard-Zonen ·{" "}
              {zoneIds.length === 0 ? "alle aktiven" : `${zoneIds.length} ausgewählt`}
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
