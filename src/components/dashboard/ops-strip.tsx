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
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";

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

export function OpsStrip({ ops }: { ops: DashboardOps | null }) {
  if (!ops) return null;

  const playing = ops.audio.zones.filter((z) => z.isPlaying).length;
  const audioOffline = ops.audio.zones.filter((z) => !z.deviceOnline).length;
  const latestAlert = ops.alerts.latest[0];
  const watering = ops.irrigation.watering[0];
  const hubsMissing = ops.hubs.total === 0 || ops.hubs.online < ops.hubs.total;
  const hubsOutdated = ops.hubs.agents.some((h) => h.outdated);

  // Zweite Zeile der Audio-Kachel: erst Störungen, dann was gerade läuft.
  const audioHint =
    audioOffline > 0
      ? `${audioOffline} Zone${audioOffline === 1 ? "" : "n"} offline`
      : ops.audio.zones.length > 0
        ? ops.audio.zones
            .slice(0, 3)
            .map((z) => `${z.name}: ${zoneSubline(z)}`)
            .join(" · ")
        : "Keine Zonen";

  // Kennzahl ist eine Zahl (laufende Zonen) oder die nächste Startzeit; der
  // Zonenname steht im Hinweis.
  const wateringHint = watering
    ? `${watering.name} läuft noch ${watering.remainingMin} Min.`
    : ops.irrigation.next
      ? `als nächstes ${ops.irrigation.next.name}`
      : "Kein Lauf heute";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      <StatCard
        href="/audio"
        label="Audio"
        icon={playing > 0 ? Volume2 : VolumeX}
        tone={audioOffline > 0 ? "warning" : playing > 0 ? "violet" : "neutral"}
        value={`${playing}/${ops.audio.zones.length || 0}`}
        suffix="spielen"
        hint={audioHint}
        progress={ops.audio.zones.length > 0 ? playing / ops.audio.zones.length : undefined}
      />

      <StatCard
        href="/bewaesserung"
        label="Bewässerung"
        icon={Droplets}
        tone={watering ? "info" : "neutral"}
        value={watering ? ops.irrigation.watering.length : ops.irrigation.next ? ops.irrigation.next.startTime : "—"}
        suffix={watering ? "aktiv" : undefined}
        hint={wateringHint}
      />

      <StatCard
        href="/webcams"
        label="Drehkreuz"
        icon={AlertTriangle}
        tone={ops.alerts.open > 0 ? "danger" : "neutral"}
        value={ops.alerts.open}
        suffix="offen"
        hint={
          latestAlert
            ? latestAlert.source
              ? `${latestAlert.source}: ${latestAlert.message}`
              : latestAlert.message
            : "Keine Warnung"
        }
      />

      <StatCard
        href="/fahrzeuge"
        label="Fahrzeuge"
        icon={Car}
        tone={ops.vehicles.unmatchedToday > 0 ? "warning" : "neutral"}
        value={ops.vehicles.unmatchedToday}
        suffix="offen"
        hint={
          ops.vehicles.latest[0]?.plate
            ? `zuletzt ${ops.vehicles.latest[0].plate}`
            : "Alle zugeordnet"
        }
      />

      <div className="min-w-0 col-span-2 lg:col-span-1">
        <StatCard
          href="/network"
          label="Hub"
          icon={hubsMissing ? ServerOff : Server}
          tone={hubsMissing ? "danger" : hubsOutdated ? "warning" : "success"}
          value={`${ops.hubs.online}/${ops.hubs.total}`}
          suffix="verbunden"
          hint={hubSubline(ops.hubs)}
          progress={ops.hubs.total > 0 ? ops.hubs.online / ops.hubs.total : undefined}
        />
      </div>

      {ops.devices.offline.length > 0 && (
        <Link
          href="/devices"
          className="block min-w-0 col-span-2 lg:col-span-5 rounded-tile outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Notice
            tone="warning"
            compact
            icon={WifiOff}
            title={`${ops.devices.offline.length} Abspieler/Pi offline`}
            action={
              <span className="text-xs text-muted-foreground tabular-nums">
                {ops.devices.heartbeatOnline}/{ops.devices.heartbeatTotal} online
              </span>
            }
            className="transition-colors hover:border-warning/70"
          >
            <span className="block truncate">
              {ops.devices.offline.map((d) => d.name).join(" · ")}
            </span>
          </Notice>
        </Link>
      )}
    </div>
  );
}
