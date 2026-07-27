"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Clock, Speaker, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "./labels";
import type { ZoneRow, ZoneStatus } from "./types";

interface Props {
  zones: ZoneRow[];
  status: Map<number, ZoneStatus>;
  onSelect: (zoneId: number) => void;
}

/**
 * Überblick über alle Zonen, dauerhaft über den Tabs.
 *
 * Die wichtigste Frage im Betrieb ist „spielt überall das Richtige?" – dafür
 * soll niemand erst einen Tab wechseln müssen.
 */
export function ZoneStatusBar({ zones, status, onSelect }: Props) {
  if (zones.length === 0) return null;

  const playing = zones.filter((zone) => merge(zone, status).isPlaying).length;
  const offline = zones.filter(
    (zone) => zone.deviceId && !merge(zone, status).deviceOnline
  ).length;

  return (
    <Card className="mb-4 border-slate-200 dark:border-slate-800">
      <CardContent className="p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <Speaker className="h-3.5 w-3.5" />
          <span>
            {playing} von {zones.length} Zonen spielen
          </span>
          {offline > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
              <AlertCircle className="h-3.5 w-3.5" />
              {offline} offline
            </span>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {zones.map((zone) => (
            <ZoneTile
              key={zone.id}
              zone={zone}
              status={merge(zone, status)}
              onSelect={() => onSelect(zone.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Live-Werte haben Vorrang, solange sie schon geladen sind. */
function merge(zone: ZoneRow, status: Map<number, ZoneStatus>) {
  const live = status.get(zone.id);
  return {
    isActive: live?.isActive ?? zone.isActive,
    isPlaying: live?.isPlaying ?? zone.isPlaying,
    currentTitle: live?.currentTitle ?? zone.currentTitle,
    volume: live?.reportedVolume ?? live?.volume ?? zone.volume,
    deviceOnline: live?.deviceOnline ?? zone.deviceOnline,
    lastStateAt: live?.lastStateAt ?? zone.lastStateAt,
    pendingJobs: live?.pendingJobs ?? 0,
  };
}

function ZoneTile({
  zone,
  status,
  onSelect,
}: {
  zone: ZoneRow;
  status: ReturnType<typeof merge>;
  onSelect: () => void;
}) {
  const noPlayer = !zone.deviceId;
  const offline = !noPlayer && !status.deviceOnline;

  const subline = noPlayer
    ? "Kein Abspieler zugeordnet"
    : offline
      ? (formatRelativeTime(status.lastStateAt) ?? "Noch nie gemeldet")
      : (status.currentTitle ??
        (zone.sourceKind === "PLAYLIST"
          ? (zone.playlistName ?? "Playlist")
          : zone.sourceKind === "STREAM"
            ? "Webradio"
            : "Keine Wiedergabe"));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Zone ${zone.name} anzeigen`}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
        "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50",
        !status.isActive && "opacity-60"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          status.isPlaying
            ? "bg-emerald-500"
            : offline || noPlayer
              ? "bg-slate-300 dark:bg-slate-600"
              : "bg-amber-400"
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {zone.name}
          </span>
          {status.pendingJobs > 0 && (
            <span
              className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-500"
              title={`${status.pendingJobs} Befehl(e) noch nicht bestätigt`}
            >
              <Clock className="h-3 w-3" />
              {status.pendingJobs}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-slate-500">{subline}</span>
      </span>

      <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
        {status.isPlaying ? (
          <Volume2 className="h-3.5 w-3.5" />
        ) : (
          <VolumeX className="h-3.5 w-3.5" />
        )}
        {status.volume}%
      </span>
    </button>
  );
}
