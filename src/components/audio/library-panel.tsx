"use client";

import { useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Music, Pause, Play, Search, Trash2, Upload } from "lucide-react";
import { TRACK_KIND_LABELS as KIND_LABELS, formatDuration } from "./labels";
import { Chip } from "./ui";
import type { AudioTrackKind, TrackRow } from "./types";

/** Ab dieser Anzahl lohnt sich die Suche – darunter nur unnötiges Bedienelement. */
const SEARCH_THRESHOLD = 8;

interface Props {
  tracks: TrackRow[];
  onChanged: () => void;
}

export function LibraryPanel({ tracks, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AudioTrackKind>("MUSIC");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<AudioTrackKind | "ALL">("ALL");
  const [playingId, setPlayingId] = useState<number | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tracks.filter((track) => {
      if (filterKind !== "ALL" && track.kind !== filterKind) return false;
      if (!needle) return true;
      return (
        track.title.toLowerCase().includes(needle) ||
        (track.artist?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [tracks, search, filterKind]);

  const totalSec = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

  /** Dauer aus der Datei lesen, damit Playlists eine Gesamtlänge anzeigen können. */
  async function readDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      audio.src = url;
    });
  }

  async function handleFiles(files: FileList) {
    setError(null);
    setUploading(true);
    setProgress({ done: 0, total: files.length });

    try {
      const { upload } = await import("@vercel/blob/client");

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const durationSec = await readDuration(file);

        const uploaded = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/audio/upload",
          contentType: file.type || "audio/mpeg",
        });

        const res = await fetch("/api/audio/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: file.name.replace(/\.[^.]+$/, ""),
            kind,
            url: uploaded.url,
            blobPathname: uploaded.pathname,
            contentType: file.type || null,
            sizeBytes: file.size,
            durationSec,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        }

        setProgress({ done: i + 1, total: files.length });
      }

      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /**
   * Vorschau umschalten.
   *
   * `play()` muss direkt im Klick laufen – aus einem Effekt heraus werten
   * Browser es nicht mehr als Nutzeraktion und blockieren die Wiedergabe still.
   * Ein einziges Audio-Element für die ganze Liste sorgt außerdem dafür, dass
   * nie zwei Titel gleichzeitig laufen.
   */
  function togglePreview(track: TrackRow) {
    const audio = previewRef.current;
    if (!audio) return;

    if (playingId === track.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }

    audio.src = track.url;
    setPlayingId(track.id);
    void audio.play().catch(() => setPlayingId(null));
  }

  async function remove(track: TrackRow) {
    if (playingId === track.id) {
      previewRef.current?.pause();
      setPlayingId(null);
    }
    await fetch(`/api/audio/tracks/${track.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:min-w-[160px]">
              <Label className="mb-1.5 block">Art</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as AudioTrackKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as AudioTrackKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="h-11 gap-1.5 sm:h-9"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {progress ? `Lädt ${progress.done}/${progress.total}` : "Dateien hochladen"}
            </Button>

            <input
              ref={inputRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          <p className="text-xs text-slate-500 mt-2">
            MP3, WAV, OGG oder FLAC bis 50 MB. Die Dateien gehen direkt in den Blob-Storage;
            die Zonen-Pis laden sie einmalig und spielen danach lokal ab.
          </p>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40 mt-3">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {tracks.length === 0 ? (
        <Card className="border-dashed border-slate-300 dark:border-slate-700">
          <CardContent className="py-10 text-center">
            <Music className="h-10 w-10 mx-auto text-slate-400 mb-3" />
            <h3 className="font-semibold text-slate-700 dark:text-slate-300">
              Mediathek ist leer
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Lade Musik, Jingles und Gongs hoch, um Playlists zusammenzustellen.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {tracks.length >= SEARCH_THRESHOLD && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative sm:min-w-[200px] sm:flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Titel oder Interpret suchen"
                  aria-label="Mediathek durchsuchen"
                  className="pl-8"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={filterKind === "ALL"} onClick={() => setFilterKind("ALL")}>
                  Alle
                </Chip>
                {(Object.keys(KIND_LABELS) as AudioTrackKind[]).map((k) => (
                  <Chip
                    key={k}
                    active={filterKind === k}
                    onClick={() => setFilterKind(k)}
                  >
                    {KIND_LABELS[k]}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <Card className="border-dashed border-slate-300 dark:border-slate-700">
              <CardContent className="py-8 text-center">
                <p className="text-sm text-slate-500">
                  Kein Titel passt zur Suche.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((track) => (
                  <TrackItem
                    key={track.id}
                    track={track}
                    playing={playingId === track.id}
                    onTogglePlay={() => togglePreview(track)}
                    onRemove={() => remove(track)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-slate-500">
            {visible.length === tracks.length
              ? `${tracks.length} Titel`
              : `${visible.length} von ${tracks.length} Titeln`}
            {totalSec > 0 && ` · Gesamtlänge ${formatDuration(totalSec)}`}
          </p>

          <audio ref={previewRef} onEnded={() => setPlayingId(null)} className="hidden" />
        </>
      )}
    </div>
  );
}

/**
 * Ein Titel in der Liste.
 *
 * Statt eines nativen `<audio controls>` pro Zeile – das jede Zeile 200 px
 * breiter und optisch unruhig macht – gibt es einen kompakten Abspielknopf.
 * Abgespielt wird über das gemeinsame Audio-Element der Mediathek.
 */
function TrackItem({
  track,
  playing,
  onTogglePlay,
  onRemove,
}: {
  track: TrackRow;
  playing: boolean;
  onTogglePlay: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 p-3 sm:gap-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={onTogglePlay}
        aria-label={playing ? `${track.title} anhalten` : `${track.title} anhören`}
        aria-pressed={playing}
        className="h-10 w-10 shrink-0 sm:h-8 sm:w-8"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{track.title}</span>
          <Badge variant="outline" className="text-[10px]">
            {KIND_LABELS[track.kind]}
          </Badge>
        </div>
        <p className="text-xs text-slate-500">
          {track.artist ? `${track.artist} · ` : ""}
          {formatDuration(track.durationSec)}
          {track.sizeBytes ? ` · ${(track.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={`${track.title} löschen`}
        title="Löschen"
        className="h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 sm:h-8 sm:w-8 dark:hover:bg-red-950"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
