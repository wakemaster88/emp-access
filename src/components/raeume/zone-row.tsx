"use client";

import { useState } from "react";
import { Loader2, Play, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoomZone } from "@/components/raeume/types";
import { fmtAgo } from "@/components/raeume/shared";

export type ZoneAction = "PLAY" | "STOP";

/**
 * Eine Beschallungszone im Raum: Zustand links, Start/Stopp rechts. Was
 * "Start" abspielt, entscheidet die Zone selbst (Standard-Playlist oder
 * Webradio) – dieselbe Logik wie der Start-Knopf unter Audio.
 */
export function ZoneRow({
  zone,
  nowMs,
  readonly,
  onAction,
}: {
  zone: RoomZone;
  nowMs: number;
  readonly: boolean;
  onAction: (zone: RoomZone, action: ZoneAction) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<ZoneAction | null>(null);
  const [error, setError] = useState("");

  async function run(action: ZoneAction) {
    setBusy(action);
    setError("");
    const message = await onAction(zone, action);
    setBusy(null);
    if (message) setError(message);
  }

  const status = !zone.hasPlayer
    ? "ohne Abspieler"
    : zone.isPlaying
      ? `spielt${zone.currentTitle ? `: ${zone.currentTitle}` : ""}`
      : zone.lastStateAt
        ? `still · zuletzt ${fmtAgo(zone.lastStateAt, nowMs)}`
        : "still";

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded",
            zone.isPlaying
              ? "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
              : "bg-slate-100 text-slate-400 dark:bg-slate-800",
          )}
        >
          <Volume2 className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
            {zone.name}
            {!zone.isActive && (
              <span className="shrink-0 text-[10px] font-normal text-slate-400">
                außer Betrieb
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-slate-400">Beschallung · {status}</p>
        </div>

        {!readonly && zone.hasPlayer && zone.isActive && (
          <div className="flex shrink-0 items-center gap-1">
            {zone.isPlaying ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("STOP")}
                title="Wiedergabe stoppen"
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
              >
                {busy === "STOP" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Square className="h-3 w-3" />
                )}
                Stopp
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("PLAY")}
                title="Wiedergabe starten"
                className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy === "PLAY" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Start
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-1.5 pl-9 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
