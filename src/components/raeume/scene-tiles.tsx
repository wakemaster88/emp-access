"use client";

/**
 * Szenen (W17, Empfehlung 1): ein Tipp schaltet mehrere Geräte – „Öffnen“,
 * „Feierabend“, „Veranstaltung“. Eine Szene ist eine Regel ohne Auslöser
 * (Trigger MANUAL); sie läuft nur, wenn jemand die Kachel antippt. Gepflegt
 * wird sie wie jede Regel unter „Regeln“, angelegt direkt hier.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { apiRequest, ErrorLine, shortDeviceName } from "@/components/raeume/shared";
import type { RoomDevice, RoomPanel, RoomRuleSummary, RoomZone } from "@/components/raeume/types";
import { deviceControls } from "@/lib/device-controls";
import { cn } from "@/lib/utils";

const SUGGESTED_NAMES = ["Öffnen", "Feierabend", "Veranstaltung", "Reinigung"];

export function SceneTiles({
  room,
  scenes,
  readonly,
}: {
  room: RoomPanel;
  scenes: RoomRuleSummary[];
  readonly: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"new" | RoomRuleSummary | null>(null);
  const [state, setState] = useState<Record<number, { kind: "busy" | "ok" | "err"; text?: string }>>({});

  useEffect(() => {
    const done = Object.entries(state).filter(([, s]) => s.kind !== "busy");
    if (done.length === 0) return;
    const t = setTimeout(() => setState((prev) => Object.fromEntries(Object.entries(prev).filter(([, s]) => s.kind === "busy"))), 4_000);
    return () => clearTimeout(t);
  }, [state]);

  async function run(scene: RoomRuleSummary) {
    if (readonly || state[scene.id]?.kind === "busy") return;
    setState((s) => ({ ...s, [scene.id]: { kind: "busy" } }));
    const res = await apiRequest<{ success: boolean; results?: { ok: boolean; error?: string | null; target?: string }[] }>(
      `/api/regeln/${scene.id}/run`,
      "POST",
      {},
    );
    if (!res.ok) {
      setState((s) => ({ ...s, [scene.id]: { kind: "err", text: res.message } }));
      return;
    }
    const failed = res.data.results?.filter((r) => !r.ok) ?? [];
    setState((s) => ({
      ...s,
      [scene.id]: res.data.success
        ? { kind: "ok", text: "ausgeführt" }
        : { kind: "err", text: failed[0]?.error ? `${failed[0].target ?? "Aktion"}: ${failed[0].error}` : "teilweise fehlgeschlagen" },
    }));
    // Kacheln und Zustände nachziehen, sobald die Geraete geschaltet haben.
    setTimeout(() => router.refresh(), 3_000);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {scenes.map((scene) => {
          const s = state[scene.id];
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => void run(scene)}
              onContextMenu={(e) => {
                if (readonly) return;
                e.preventDefault();
                setDialog(scene);
              }}
              disabled={readonly || s?.kind === "busy"}
              title={scene.actions.join(" · ")}
              className={cn(
                "group flex min-h-[84px] flex-col justify-between rounded-tile border p-3 text-left transition-all duration-300",
                "disabled:cursor-default enabled:hover:-translate-y-0.5 enabled:active:scale-[0.97]",
                s?.kind === "ok"
                  ? "border-emerald-400/40 bg-gradient-to-br from-emerald-500/15 to-transparent"
                  : s?.kind === "err"
                    ? "border-destructive/40 bg-destructive/5"
                    : "glass-tile enabled:hover:bg-foreground/5",
                !scene.isActive && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  s?.kind === "ok" ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary group-enabled:group-hover:bg-primary-fill group-enabled:group-hover:text-primary-foreground",
                )}
              >
                {s?.kind === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </span>
              <span className="mt-2 block">
                <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">{scene.name}</span>
                <span className={cn("block truncate text-[11px]", s?.kind === "err" ? "text-destructive" : s?.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                  {s?.kind === "busy"
                    ? "läuft …"
                    : s?.text ??
                      (scene.actions.length === 1 ? scene.actions[0] : `${scene.actions.length} Aktionen`)}
                </span>
              </span>
            </button>
          );
        })}
        {!readonly && (
          <button
            type="button"
            onClick={() => setDialog("new")}
            className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-tile border border-dashed border-border/80 p-3 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="h-4 w-4" />
            Neue Szene
          </button>
        )}
      </div>
      {dialog && <SceneDialog room={room} scene={dialog === "new" ? null : dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

type Choice = { action: string; label: string };
type Playlist = { id: number; name: string };

/** Wahl je Gerät/Zone: null = nicht anfassen, sonst die Aktion. */
type Picks = Record<string, string | null>;

/**
 * Szene anlegen: Name, je Gerät „–“ / Befehl, je Zone „–“ / Playlist / Stopp.
 * Bestehende Szenen führen zu „Regeln“, dort gibt es alle Aktionen; hier
 * lässt sich eine Szene nur löschen.
 */
function SceneDialog({ room, scene, onClose }: { room: RoomPanel; scene: RoomRuleSummary | null; onClose: () => void }) {
  const router = useRouter();
  const devices = room.devices.filter((d) => d.isActive && d.type !== "MAMMOTION_MOWER" && d.category !== "SENSOR");
  const zones = room.zones.filter((z) => z.isActive && z.hasPlayer);
  const [name, setName] = useState(scene?.name ?? "");
  const [picks, setPicks] = useState<Picks>({});
  const [playlistByZone, setPlaylistByZone] = useState<Record<number, number>>({});
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (zones.length === 0) return;
    let cancelled = false;
    fetch("/api/audio/playlists")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: number; name: string }[]) => {
        if (!cancelled) setPlaylists(list.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [zones.length]);

  const choicesFor = (d: RoomDevice): Choice[] =>
    deviceControls(d)
      .filter((c) => c.role === "primary" || c.role === "secondary")
      .slice(0, 2)
      .map((c) => ({ action: c.action, label: c.label }));

  const pickCount = Object.values(picks).filter((v) => v != null).length;

  async function save() {
    if (busy) return;
    if (!name.trim()) return setError("Name fehlt");
    if (pickCount === 0) return setError("Mindestens ein Gerät oder eine Zone wählen");
    setBusy(true);
    setError("");
    const actions: Record<string, unknown>[] = [];
    for (const d of devices) {
      const a = picks[`d${d.id}`];
      if (a) actions.push({ kind: "DEVICE", deviceId: d.id, deviceAction: a, sortOrder: actions.length });
    }
    for (const z of zones) {
      const a = picks[`z${z.id}`];
      if (a === "STOP") actions.push({ kind: "AUDIO", audioZoneId: z.id, sortOrder: actions.length });
      else if (a === "PLAY") {
        const playlistId = playlistByZone[z.id] ?? playlists[0]?.id;
        if (!playlistId) {
          setBusy(false);
          return setError(`Keine Playlist für ${z.name}`);
        }
        actions.push({ kind: "AUDIO", audioZoneId: z.id, audioPlaylistId: playlistId, sortOrder: actions.length });
      }
    }
    const res = await apiRequest("/api/regeln", "POST", {
      name: name.trim(),
      roomId: room.id,
      trigger: "MANUAL",
      isActive: true,
      cooldownSeconds: 0,
      actions,
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    router.refresh();
    onClose();
  }

  async function remove() {
    if (!scene || busy) return;
    setBusy(true);
    const res = await apiRequest(`/api/regeln/${scene.id}`, "DELETE");
    setBusy(false);
    if (!res.ok) return setError(res.message);
    router.refresh();
    onClose();
  }

  const seg = (key: string, choices: Choice[]) => (
    <div className="flex shrink-0 overflow-hidden rounded-full border border-border bg-background/60 text-[11px]">
      {[{ action: null, label: "–" }, ...choices].map((c) => (
        <button
          key={c.action ?? "none"}
          type="button"
          onClick={() => setPicks((p) => ({ ...p, [key]: c.action }))}
          className={cn(
            "px-2.5 py-1 font-medium transition-colors",
            (picks[key] ?? null) === c.action ? "bg-primary-fill text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] min-w-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{scene ? `Szene „${scene.name}“` : `Neue Szene · ${room.name}`}</DialogTitle>
          <DialogDescription className="text-xs">
            {scene
              ? "Aktionen und Name änderst du unter „Regeln“. Hier lässt sich die Szene nur löschen."
              : "Ein Tipp schaltet alles auf einmal. Geräte mit „–“ bleiben, wie sie sind."}
          </DialogDescription>
        </DialogHeader>

        {scene ? (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm">
              {scene.actions.map((a, i) => (
                <li key={i} className="rounded-control bg-foreground/5 px-3 py-1.5 text-[12px]">
                  {a}
                </li>
              ))}
            </ul>
            <ErrorLine message={error} />
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void remove()} disabled={busy} className="text-destructive">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Löschen
              </Button>
              <Button asChild size="sm">
                <Link href="/regeln">Unter „Regeln“ bearbeiten</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Szene" maxLength={120} aria-label="Name der Szene" />
              <div className="flex flex-wrap gap-1">
                {SUGGESTED_NAMES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setName(n)}
                    className={cn("rounded-full border px-2 py-0.5 text-[11px]", name === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {devices.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Geräte</p>
                {devices.map((d) => {
                  const choices = choicesFor(d);
                  if (choices.length === 0) return null;
                  return (
                    <div key={d.id} className="flex items-center gap-2 rounded-control bg-foreground/5 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{shortDeviceName(d.name, room.name)}</span>
                      {seg(`d${d.id}`, choices)}
                    </div>
                  );
                })}
              </div>
            )}

            {zones.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Beschallung</p>
                {zones.map((z: RoomZone) => (
                  <div key={z.id} className="space-y-1 rounded-control bg-foreground/5 px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{z.name}</span>
                      {seg(`z${z.id}`, [
                        ...(playlists.length > 0 ? [{ action: "PLAY", label: "Musik" }] : []),
                        { action: "STOP", label: "Stopp" },
                      ])}
                    </div>
                    {picks[`z${z.id}`] === "PLAY" && (
                      <NativeSelect
                        value={playlistByZone[z.id] ?? playlists[0]?.id ?? ""}
                        onChange={(e) => setPlaylistByZone((p) => ({ ...p, [z.id]: Number(e.target.value) }))}
                        aria-label={`Playlist für ${z.name}`}
                      >
                        {playlists.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </div>
                ))}
              </div>
            )}

            {devices.length === 0 && zones.length === 0 && (
              <p className="text-xs text-muted-foreground">Im Raum gibt es nichts zu schalten.</p>
            )}

            <ErrorLine message={error} />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                Abbrechen
              </Button>
              <Button type="button" size="sm" onClick={() => void save()} disabled={busy || pickCount === 0}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Szene anlegen
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
