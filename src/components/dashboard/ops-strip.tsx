"use client";

import {
  Cctv,
  Droplets,
  ScanLine,
  Server,
  ServerOff,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { cn } from "@/lib/utils";
import type { DashboardLive } from "@/components/dashboard/live-section";

export interface DashboardOps {
  audio: {
    zones: {
      id: number;
      name: string;
      isPlaying: boolean;
      currentTitle: string | null;
      sourceKind: string;
      streamName: string | null;
      externalSender: string | null;
      /** Musik-Automatik aktiv, und die Musikzeit ist gerade vorbei. */
      offHours: boolean;
      deviceOnline: boolean;
    }[];
  };
  irrigation: {
    watering: { name: string; remainingMin: number }[];
    next: { name: string; startTime: string } | null;
  };
  alerts: {
    open: number;
    latest: {
      id: number;
      kind: string;
      message: string;
      source: string | null;
      occurredAt: string;
    }[];
  };
  vehicles: {
    unmatchedToday: number;
    latest: {
      id: number;
      plate: string | null;
      seenAt: string;
      cameraName: string | null;
    }[];
  };
  devices: {
    heartbeatOnline: number;
    heartbeatTotal: number;
    offline: {
      id: number;
      name: string;
      type: string;
      lastUpdate: string | null;
    }[];
  };
  hubs: {
    online: number;
    total: number;
    /** Commit der laufenden Cloud – null ausserhalb von Vercel. */
    cloudCommit: string | null;
    agents: {
      id: number;
      name: string;
      hostname: string | null;
      version: string | null;
      lastSeenAt: string | null;
      online: boolean;
      /** Erreichbar, faehrt aber noch nicht den Cloud-Commit. */
      outdated: boolean;
    }[];
  };
}

/**
 * Zweite Zeile der Hub-Karte, nach Dringlichkeit: erst wer fehlt, dann wer
 * noch ein Update zieht, sonst der laufende Stand.
 */
function hubSubline(hubs: DashboardOps["hubs"]): string {
  if (hubs.total === 0) return "Kein Hub verbunden";
  const offline = hubs.agents.filter((h) => !h.online);
  if (offline.length > 0) return `offline: ${offline.map((h) => h.name).join(" · ")}`;
  const outdated = hubs.agents.filter((h) => h.outdated);
  if (outdated.length > 0) {
    return `Update offen: ${outdated.map((h) => h.name).join(" · ")}`;
  }
  const version = hubs.agents[0]?.version;
  return version ? `Stand ${version}` : "verbunden";
}

function zoneSubline(z: DashboardOps["audio"]["zones"][number]): string {
  if (!z.deviceOnline) return "Offline";
  if (z.offHours && !z.isPlaying) return "Betriebsruhe";
  if (z.externalSender) return z.externalSender;
  if (z.isPlaying) {
    return z.currentTitle || z.streamName || (z.sourceKind === "STREAM" ? "Webradio" : "Spielt");
  }
  return "Stumm";
}

interface OpsRow {
  href: string;
  label: string;
  icon: LucideIcon;
  tone: ChipTone;
  value: string;
  detail: string;
}

/**
 * Technik auf einen Blick: Leser, Kameras, Hub, Audio, Bewässerung als
 * Zeilen in einer Karte. Störungen stehen zusätzlich oben als Warnung; hier
 * reicht im Normalbetrieb ein ruhiger Blick (Ruhe bei Normalbetrieb).
 */
export function OpsCard({
  ops,
  status,
  className,
}: {
  ops: DashboardOps | null;
  /** Leser und Kameras aus der Live-Lage (`/api/dashboard/live`). */
  status?: DashboardLive["status"] | null;
  className?: string;
}) {
  if (!ops) return null;

  const playing = ops.audio.zones.filter((z) => z.isPlaying).length;
  const audioOffline = ops.audio.zones.filter((z) => !z.deviceOnline).length;
  const watering = ops.irrigation.watering[0];
  const hubsMissing = ops.hubs.total === 0 || ops.hubs.online < ops.hubs.total;
  const hubsOutdated = ops.hubs.agents.some((h) => h.outdated);

  // Nebenzeile Audio: erst Störungen, dann was gerade läuft.
  const audioHint =
    audioOffline > 0
      ? `${audioOffline} Zone${audioOffline === 1 ? "" : "n"} offline`
      : ops.audio.zones.length > 0
        ? ops.audio.zones
            .filter((z) => z.isPlaying)
            .slice(0, 2)
            .map((z) => `${z.name}: ${zoneSubline(z)}`)
            .join(" · ") || "alle Zonen still"
        : "Keine Zonen";

  const readers = status?.readers;
  const cameras = status?.cameras;
  const rows: OpsRow[] = [];

  if (readers) {
    rows.push({
      href: "/devices",
      label: "Leser",
      icon: readers.offline.length > 0 ? WifiOff : ScanLine,
      tone: readers.offline.length > 0 ? "warning" : readers.total > 0 ? "success" : "neutral",
      value: `${readers.online}/${readers.total}`,
      detail:
        readers.offline.length > 0
          ? `offline: ${readers.offline.join(" · ")}`
          : readers.total > 0
            ? "alle melden sich"
            : "Kein Leser eingerichtet",
    });
  }
  if (cameras) {
    rows.push({
      href: "/cameras",
      label: "Kameras",
      icon: Cctv,
      tone:
        cameras.total === 0 ? "neutral" : !cameras.hubOnline ? "danger" : cameras.offline.length > 0 ? "warning" : "success",
      value: `${cameras.online}/${cameras.total}`,
      detail:
        cameras.total === 0
          ? "Keine Kamera eingerichtet"
          : !cameras.hubOnline
            ? "Hub offline, Stand unbekannt"
            : cameras.offline.length > 0
              ? `fehlt: ${cameras.offline.join(" · ")}`
              : "alle erreichbar",
    });
  }
  rows.push({
    href: "/network",
    label: "Hub",
    icon: hubsMissing ? ServerOff : Server,
    tone: hubsMissing ? "danger" : hubsOutdated ? "warning" : "success",
    value: `${ops.hubs.online}/${ops.hubs.total}`,
    detail: hubSubline(ops.hubs),
  });
  rows.push({
    href: "/audio",
    label: "Audio",
    icon: playing > 0 ? Volume2 : VolumeX,
    tone: audioOffline > 0 ? "warning" : playing > 0 ? "music" : "neutral",
    value: `${playing}/${ops.audio.zones.length}`,
    detail: audioHint,
  });
  rows.push({
    href: "/bewaesserung",
    label: "Bewässerung",
    icon: Droplets,
    tone: watering ? "water" : "neutral",
    value: watering ? `${ops.irrigation.watering.length} aktiv` : ops.irrigation.next ? ops.irrigation.next.startTime : "—",
    detail: watering
      ? `${watering.name} läuft noch ${watering.remainingMin} Min.`
      : ops.irrigation.next
        ? `als nächstes ${ops.irrigation.next.name}`
        : "Kein Lauf heute",
  });

  const issues = rows.filter((r) => r.tone === "warning" || r.tone === "danger").length;

  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          Technik
        </CardTitle>
        <CardAction>
          <Badge variant={issues > 0 ? "warning" : "success"}>{issues > 0 ? `${issues} prüfen` : "alles ok"}</Badge>
        </CardAction>
      </CardHeader>
      <div className="divide-y divide-border/60 px-2 sm:px-2.5">
        {rows.map((r) => (
          <Link
            key={r.label}
            href={r.href}
            className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-2 py-2 outline-none transition-colors hover:bg-glass-tile focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <IconChip icon={r.icon} tone={r.tone} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground/90">{r.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">{r.detail}</p>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{r.value}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
