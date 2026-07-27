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
import { Switch } from "@/components/ui/switch";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlaylistRow, TrackRow } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  playlist: PlaylistRow | null;
  tracks: TrackRow[];
}

export function PlaylistDialog({ open, onClose, onSaved, playlist, tracks }: Props) {
  const isEdit = !!playlist;
  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");
  const [shuffle, setShuffle] = useState(playlist?.shuffle ?? true);
  const [crossfadeSec, setCrossfadeSec] = useState(playlist?.crossfadeSec ?? 3);
  const [trackIds, setTrackIds] = useState<number[]>(playlist?.trackIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = new Set(trackIds);
  const available = tracks.filter((t) => t.kind === "MUSIC" && !selected.has(t.id));

  function move(index: number, direction: -1 | 1) {
    setTrackIds((prev) => {
      const next = [...prev];
      const swap = index + direction;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap], next[index]];
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
        shuffle,
        crossfadeSec,
        trackIds,
      };
      const res = await fetch(
        isEdit ? `/api/audio/playlists/${playlist!.id}` : "/api/audio/playlists",
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
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Playlist bearbeiten" : "Neue Playlist"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="ap-name">Name</Label>
            <Input
              id="ap-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Tagesbetrieb"
            />
          </div>

          <div>
            <Label htmlFor="ap-desc">Beschreibung (optional)</Label>
            <Input
              id="ap-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Switch checked={shuffle} onCheckedChange={setShuffle} />
              Zufällige Reihenfolge
            </label>
            <div className="flex items-center gap-2">
              <Label htmlFor="ap-cross" className="whitespace-nowrap">
                Überblendung
              </Label>
              <Input
                id="ap-cross"
                type="number"
                min={0}
                max={12}
                value={crossfadeSec}
                onChange={(e) => setCrossfadeSec(Math.min(12, Math.max(0, Number(e.target.value))))}
                className="h-8 w-20"
              />
              <span className="text-sm text-slate-500">s</span>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Titel ({trackIds.length})</Label>
            {trackIds.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-3 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
                Noch keine Titel · unten aus der Mediathek hinzufügen
              </p>
            ) : (
              <div className="space-y-1.5">
                {trackIds.map((id, index) => {
                  const track = tracks.find((t) => t.id === id);
                  if (!track) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-1.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
                    >
                      <div className="flex flex-col shrink-0">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          className="text-slate-400 hover:text-slate-600 disabled:opacity-30 p-0.5"
                        >
                          <GripVertical className="h-3 w-3 rotate-180" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === trackIds.length - 1}
                          className="text-slate-400 hover:text-slate-600 disabled:opacity-30 p-0.5"
                        >
                          <GripVertical className="h-3 w-3" />
                        </button>
                      </div>
                      <span className="text-sm truncate flex-1 min-w-0">{track.title}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setTrackIds((prev) => prev.filter((t) => t !== id))}
                        className="h-7 px-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {available.length > 0 && (
            <div>
              <Label className="mb-2 block">Aus der Mediathek hinzufügen</Label>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {available.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setTrackIds((prev) => [...prev, track.id])}
                    className="w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{track.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
