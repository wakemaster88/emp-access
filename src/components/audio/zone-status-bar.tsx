"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
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
    <Card>
      <CardContent>
        <div className="mb-2 flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <Speaker className="h-3.5 w-3.5" />
          <span>
            {playing} von {zones.length} Zonen spielen
          </span>
          {offline > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {offline} offline
            </span>
          )}
        </div>

        {/* `grid-cols-1` (minmax(0, 1fr)): ohne feste Spalte kann ein langer Titel
            (`truncate`) die Spalte breiter als das Handy machen, dann scrollt die Seite seitlich. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
        "glass-tile press flex min-h-11 items-center gap-2.5 p-2.5 text-left hover:bg-glass-strong",
        // Musik läuft = Violett (Zustandsvokabular): aktive Kachel mit Verlauf.
        status.isPlaying &&
          "border-violet-400/45 bg-gradient-to-br from-violet-400/25 to-violet-400/5"
      )}
    >
      <StatusDot
        size="md"
        tone={status.isPlaying ? "music" : offline ? "danger" : "neutral"}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {zone.name}
          </span>
          {/* Inaktiv: Text bleibt lesbar, den Zustand sagt das Badge (docs/design-regeln.md, Abschnitt 17). */}
          {!status.isActive && <Badge variant="neutral">Deaktiviert</Badge>}
          {status.pendingJobs > 0 && (
            <span
              className="flex items-center gap-0.5 text-[10px] tabular-nums text-warning"
              title={`${status.pendingJobs} Befehl(e) noch nicht bestätigt`}
            >
              <Clock className="h-3 w-3" />
              {status.pendingJobs}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{subline}</span>
      </span>

      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
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
