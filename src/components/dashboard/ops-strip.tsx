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
import { StatCard } from "@/components/ui/stat-card";
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

export function OpsStrip({
  ops,
  status,
}: {
  ops: DashboardOps | null;
  /** Leser und Kameras aus der Live-Lage (`/api/dashboard/live`). */
  status?: DashboardLive["status"] | null;
}) {
  if (!ops) return null;

  const playing = ops.audio.zones.filter((z) => z.isPlaying).length;
  const audioOffline = ops.audio.zones.filter((z) => !z.deviceOnline).length;
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

  const readers = status?.readers;
  const cameras = status?.cameras;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {readers && (
        <StatCard
          href="/devices"
          label="Leser"
          icon={readers.offline.length > 0 ? WifiOff : ScanLine}
          tone={readers.offline.length > 0 ? "warning" : readers.total > 0 ? "success" : "neutral"}
          value={`${readers.online}/${readers.total}`}
          suffix="online"
          hint={
            readers.offline.length > 0
              ? `offline: ${readers.offline.join(" · ")}`
              : readers.total > 0
                ? "alle melden sich"
                : "Kein Leser eingerichtet"
          }
          progress={readers.total > 0 ? readers.online / readers.total : undefined}
        />
      )}

      {cameras && (
        <StatCard
          href="/cameras"
          label="Kameras"
          icon={Cctv}
          tone={
            cameras.total === 0
              ? "neutral"
              : !cameras.hubOnline
                ? "danger"
                : cameras.offline.length > 0
                  ? "warning"
                  : "success"
          }
          value={`${cameras.online}/${cameras.total}`}
          suffix="erreichbar"
          hint={
            cameras.total === 0
              ? "Keine Kamera eingerichtet"
              : !cameras.hubOnline
                ? "Hub offline, Stand unbekannt"
                : cameras.offline.length > 0
                  ? `fehlt: ${cameras.offline.join(" · ")}`
                  : "alle erreichbar"
          }
          progress={cameras.total > 0 ? cameras.online / cameras.total : undefined}
        />
      )}

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

      <StatCard
        href="/audio"
        label="Audio"
        icon={playing > 0 ? Volume2 : VolumeX}
        tone={audioOffline > 0 ? "warning" : playing > 0 ? "music" : "neutral"}
        value={`${playing}/${ops.audio.zones.length || 0}`}
        suffix="spielen"
        hint={audioHint}
        progress={ops.audio.zones.length > 0 ? playing / ops.audio.zones.length : undefined}
      />

      {/* Rasterspalte direkt am Link der Kachel (StatCard mit href): die letzte
          Kachel füllt auf dem Handy die Zeile, wenn fünf Kacheln stehen. */}
      <StatCard
        href="/bewaesserung"
        label="Bewässerung"
        icon={Droplets}
        tone={watering ? "water" : "neutral"}
        value={watering ? ops.irrigation.watering.length : ops.irrigation.next ? ops.irrigation.next.startTime : "—"}
        suffix={watering ? "aktiv" : undefined}
        hint={wateringHint}
        className={readers && cameras ? "col-span-2 lg:col-span-1" : undefined}
      />
    </div>
  );
}
