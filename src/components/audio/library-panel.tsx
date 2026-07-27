"use client";

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Music, Trash2, Upload } from "lucide-react";
import type { AudioTrackKind, TrackRow } from "./types";

const KIND_LABELS: Record<AudioTrackKind, string> = {
  MUSIC: "Musik",
  JINGLE: "Jingle",
  CHIME: "Gong",
  ANNOUNCEMENT: "Ansage",
};

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

  async function remove(track: TrackRow) {
    await fetch(`/api/audio/tracks/${track.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <Label className="mb-1.5 block">Art</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as AudioTrackKind)}>
                <SelectTrigger className="h-9">
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
              className="gap-1.5"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
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
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
            {tracks.map((track) => (
              <div key={track.id} className="flex items-center gap-3 p-3">
                <Music className="h-4 w-4 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{track.title}</span>
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
                <audio src={track.url} controls preload="none" className="h-8 max-w-[200px]" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(track)}
                  className="h-8 px-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "–";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
