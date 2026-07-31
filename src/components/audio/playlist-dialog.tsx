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
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
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
      <DialogContent className="sm:max-w-xl">
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

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600 sm:min-h-0 dark:text-slate-300">
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
                className="w-20"
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
                      {/* Vorher zwei gedrehte Griff-Symbole mit 16 px
                          Trefferfläche – am Telefon Glückssache. Pfeile sagen
                          außerdem klarer, was der Knopf tut. */}
                      <div className="flex shrink-0 flex-col">
                        <MoveButton
                          icon={ChevronUp}
                          label={`${track.title} nach oben`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        />
                        <MoveButton
                          icon={ChevronDown}
                          label={`${track.title} nach unten`}
                          disabled={index === trackIds.length - 1}
                          onClick={() => move(index, 1)}
                        />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm">{track.title}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setTrackIds((prev) => prev.filter((t) => t !== id))}
                        aria-label={`${track.title} aus der Playlist entfernen`}
                        className="h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 sm:h-8 sm:w-8 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-4 w-4" />
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
              {/* overscroll-contain, damit ein Wischen in dieser Liste am Ende
                  nicht das ganze Blatt weiterschiebt – iOS zieht sonst den
                  Dialog mit. */}
              <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain pr-1">
                {available.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setTrackIds((prev) => [...prev, track.id])}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-slate-100 sm:min-h-0 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-slate-400" />
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

function MoveButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent sm:h-6 sm:w-8 dark:hover:bg-slate-800"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
