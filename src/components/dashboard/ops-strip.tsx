"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Car,
  Droplets,
  Server,
  ServerOff,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
      quiet: boolean;
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
  if (z.quiet && !z.isPlaying) return "Ruhezeit";
  if (z.externalSender) return z.externalSender;
  if (z.isPlaying) {
    return z.currentTitle || z.streamName || (z.sourceKind === "STREAM" ? "Webradio" : "Spielt");
  }
  return "Stumm";
}

export function OpsStrip({ ops }: { ops: DashboardOps | null }) {
  if (!ops) return null;

  const playing = ops.audio.zones.filter((z) => z.isPlaying).length;
  const audioOffline = ops.audio.zones.filter((z) => !z.deviceOnline).length;
  const latestAlert = ops.alerts.latest[0];
  const watering = ops.irrigation.watering[0];
  const hubsMissing = ops.hubs.total === 0 || ops.hubs.online < ops.hubs.total;
  const hubsOutdated = ops.hubs.agents.some((h) => h.outdated);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Link href="/audio" className="block min-w-0">
        <Card className="py-3 px-4 gap-0 h-full hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Audio</span>
            {playing > 0 ? (
              <Volume2 className="h-3.5 w-3.5 text-success shrink-0" />
            ) : (
              <VolumeX className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
            )}
          </div>
          <p className="text-lg font-bold text-foreground mt-1 tabular-nums">
            {playing}/{ops.audio.zones.length || 0}
            <span className="text-xs font-medium text-muted-foreground ml-1">spielen</span>
          </p>
          {audioOffline > 0 ? (
            <p className="text-[10px] text-warning mt-0.5 truncate">
              {audioOffline} Zone{audioOffline === 1 ? "" : "n"} offline
            </p>
          ) : ops.audio.zones.length > 0 ? (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
              {ops.audio.zones
                .slice(0, 3)
                .map((z) => `${z.name}: ${zoneSubline(z)}`)
                .join(" · ")}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">Keine Zonen</p>
          )}
        </Card>
      </Link>

      <Link href="/bewaesserung" className="block min-w-0">
        <Card className="py-3 px-4 gap-0 h-full hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Bewässerung</span>
            <Droplets className={cn(
              "h-3.5 w-3.5 shrink-0",
              watering ? "text-info" : "text-muted-foreground/70",
            )} />
          </div>
          {watering ? (
            <>
              <p className="text-lg font-bold text-foreground mt-1 truncate">
                {watering.name}
              </p>
              <p className="text-[10px] text-info mt-0.5">
                läuft noch {watering.remainingMin} Min.
              </p>
            </>
          ) : ops.irrigation.next ? (
            <>
              <p className="text-lg font-bold text-foreground mt-1 tabular-nums">
                {ops.irrigation.next.startTime}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
                als nächstes {ops.irrigation.next.name}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-foreground mt-1">—</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">Kein Lauf heute</p>
            </>
          )}
        </Card>
      </Link>

      <Link href="/webcams" className="block min-w-0">
        <Card className={cn(
          "py-3 px-4 gap-0 h-full hover:shadow-md transition-shadow",
          ops.alerts.open> 0 && "border-destructive/30",
        )}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Drehkreuz</span>
            <AlertTriangle className={cn(
              "h-3.5 w-3.5 shrink-0",
              ops.alerts.open > 0 ? "text-destructive" : "text-muted-foreground/70",
            )} />
          </div>
          <p className="text-lg font-bold text-foreground mt-1 tabular-nums">
            {ops.alerts.open}
            <span className="text-xs font-medium text-muted-foreground ml-1">offen</span>
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
            {latestAlert
              ? latestAlert.source
                ? `${latestAlert.source}: ${latestAlert.message}`
                : latestAlert.message
              : "Keine Warnung"}
          </p>
        </Card>
      </Link>

      <Link href="/fahrzeuge" className="block min-w-0">
        <Card className={cn(
          "py-3 px-4 gap-0 h-full hover:shadow-md transition-shadow",
          ops.vehicles.unmatchedToday> 0 && "border-warning/30",
        )}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Fahrzeuge</span>
            <Car className={cn(
              "h-3.5 w-3.5 shrink-0",
              ops.vehicles.unmatchedToday > 0 ? "text-warning" : "text-muted-foreground/70",
            )} />
          </div>
          <p className="text-lg font-bold text-foreground mt-1 tabular-nums">
            {ops.vehicles.unmatchedToday}
            <span className="text-xs font-medium text-muted-foreground ml-1">offen</span>
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
            {ops.vehicles.latest[0]?.plate
              ? `zuletzt ${ops.vehicles.latest[0].plate}`
              : "Alle zugeordnet"}
          </p>
        </Card>
      </Link>

      <Link href="/network" className="block min-w-0 col-span-2 lg:col-span-1">
        <Card className={cn(
          "py-3 px-4 gap-0 h-full hover:shadow-md transition-shadow",
          hubsMissing && "border-destructive/30",
          !hubsMissing && hubsOutdated && "border-warning/30",
        )}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Hub</span>
            {hubsMissing ? (
              <ServerOff className="h-3.5 w-3.5 text-destructive shrink-0" />
            ) : (
              <Server className={cn(
                "h-3.5 w-3.5 shrink-0",
                hubsOutdated ? "text-warning" : "text-success",
              )} />
            )}
          </div>
          <p className="text-lg font-bold text-foreground mt-1 tabular-nums">
            {ops.hubs.online}/{ops.hubs.total}
            <span className="text-xs font-medium text-muted-foreground ml-1">verbunden</span>
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{hubSubline(ops.hubs)}</p>
        </Card>
      </Link>

      {ops.devices.offline.length > 0 && (
        <Link href="/devices" className="block min-w-0 col-span-2 lg:col-span-5">
          <Card className="py-2.5 px-4 gap-0 border-warning/30 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="h-3.5 w-3.5 text-warning shrink-0" />
              <span className="text-xs font-semibold text-warning">
                {ops.devices.offline.length} Abspieler/Pi offline
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {ops.devices.offline.map((d) => d.name).join(" · ")}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
                {ops.devices.heartbeatOnline}/{ops.devices.heartbeatTotal} online
              </span>
            </div>
          </Card>
        </Link>
      )}
    </div>
  );
}
