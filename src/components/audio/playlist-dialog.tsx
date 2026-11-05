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
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
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
            <Label htmlFor="ap-name" className="mb-1.5 block">Name</Label>
            <Input
              id="ap-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Tagesbetrieb"
            />
          </div>

          <div>
            <Label htmlFor="ap-desc" className="mb-1.5 block">Beschreibung (optional)</Label>
            <Input
              id="ap-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-0">
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
              <span className="text-sm text-muted-foreground">s</span>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Titel ({trackIds.length})</Label>
            {trackIds.length === 0 ? (
              <EmptyState
                compact
                title="Noch keine Titel · unten aus der Mediathek hinzufügen"
                className="rounded-tile border border-dashed border-border py-4"
              />
            ) : (
              <div className="space-y-1.5">
                {trackIds.map((id, index) => {
                  const track = tracks.find((t) => t.id === id);
                  if (!track) return null;
                  return (
                    // Zeilen als Kacheln: das Glas tönt sich im deckenden Dialog von selbst (Abschnitt 18).
                    <div
                      key={id}
                      className="glass-tile flex items-center gap-1.5 p-2"
                    >
                      {/* Vorher zwei gedrehte Griff-Symbole mit 16 px
                          Trefferfläche – am Telefon Glückssache. Pfeile sagen
                          außerdem klarer, was der Knopf tut. Am Telefon
                          nebeneinander, damit jeder Pfeil 44 px bekommt. */}
                      <div className="flex shrink-0 sm:flex-col">
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
                        className="h-11 w-11 shrink-0 text-destructive hover:bg-destructive/10 sm:h-8 sm:w-8"
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
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl p-2 text-left text-sm transition-colors hover:bg-glass-tile sm:min-h-0"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{track.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <Notice tone="danger" compact title={error} />}
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
      className="press flex size-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-glass-tile hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent sm:h-6 sm:w-8"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
