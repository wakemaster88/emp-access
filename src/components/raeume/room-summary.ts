"use client";

/**
 * Lagebild: ein Raum, verdichtet auf das, was die Übersicht zeigt.
 *
 * Die Raumkarte (room-panel.tsx) rechnet dieselben Dinge für ihre Pillen und
 * Schnellkacheln; hier steht die Verdichtung für Kacheln, Kennzahlen und die
 * Spuren "Demnächst" und "Braucht Aufmerksamkeit". Jede Zahl wird genau
 * einmal berechnet und von allen drei Stellen benutzt.
 */

import { groupRoomDevices } from "@/components/raeume/room-panel";
import { fmtWhen } from "@/components/raeume/schedule-widget";
import type { DeviceStatus } from "@/components/raeume/status";
import type { MowerLive } from "@/components/raeume/mower-card";
import type { RoomDevice, RoomPanel, RoomZone } from "@/components/raeume/types";
import { operatingSpanState } from "@/lib/operating-hours";
import { isLatchingSwitchDevice } from "@/lib/device-controls";
import { fmtNextRun, runProgress } from "@/lib/room-irrigation";

/** Ein Grund, warum ein Raum Aufmerksamkeit braucht. */
export interface RoomAlert {
  roomId: number;
  roomName: string;
  text: string;
  /** Führt in den passenden Reiter der Raumkarte. */
  tab: "control" | "time" | "security" | "tech";
}

export interface RoomSummary {
  room: RoomPanel;
  /** null = keine Betriebszeit ("immer verfügbar"). */
  open: boolean | null;
  /** "Geöffnet bis 20:00", "öffnet morgen 13:00", "Immer verfügbar". */
  openLabel: string;
  present: boolean;
  lightsOn: number;
  lightsTotal: number;
  /** Lampen, die sich gerade schalten lassen (aktiv, erreichbar). */
  switchableLights: RoomDevice[];
  playableZones: RoomZone[];
  musicOn: boolean;
  musicTitle: string | null;
  tempC: number | null;
  /** "heizt auf 21 °C", "lüftet", "Ziel 21 °C", null ohne Klima. */
  climateLabel: string | null;
  climateTone: "heat" | "air" | "danger" | "idle" | null;
  mowersTotal: number;
  mowersMowing: number;
  /** "läuft · Liegewiese 2 von 3", "morgen 05:30", "heute ausgesetzt"; null ohne Ventile. */
  irrigationLabel: string | null;
  irrigationRunning: boolean;
  camerasTotal: number;
  /** Kameras ohne Bild in den letzten 5 Minuten. */
  camerasStale: number;
  alerts: RoomAlert[];
  /** Für die Suche: alles, was zum Raum gehört, in Kleinbuchstaben. */
  haystack: string;
}

const SNAPSHOT_FRESH_MS = 5 * 60_000;

const fmtC = (c: number) => `${c.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

/** "17,5 °C" → 17.5 */
function parseC(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function summarizeRoom(
  room: RoomPanel,
  statuses: Map<number, DeviceStatus>,
  mowers: Map<number, MowerLive> | undefined,
  nowMs: number,
  timezone: string,
): RoomSummary {
  const groups = groupRoomDevices(room);
  const now = new Date(nowMs);
  const spec = room.schedule
    ? { name: room.schedule.name, seasons: room.schedule.seasons, exceptions: room.schedule.exceptions }
    : null;
  const span = spec ? operatingSpanState(spec, now, timezone) : null;
  const open = span ? span.inside : null;
  const openLabel = !span
    ? "Immer verfügbar"
    : span.inside
      ? `Geöffnet${span.until ? ` bis ${fmtWhen(span.until, now, timezone)}` : ""}`
      : span.until
        ? `Geschlossen · öffnet ${fmtWhen(span.until, now, timezone)}`
        : "Geschlossen";

  const isOn = (d: RoomDevice) =>
    statuses.has(d.id) ? statuses.get(d.id)?.output === true : d.type === "HUE_LIGHT" && d.task === 1;
  const lightsOn = groups.light.filter(isOn).length;
  const switchableLights = groups.light.filter(
    (d) => isLatchingSwitchDevice(d) && d.isActive && statuses.get(d.id)?.online !== false,
  );
  const playableZones = room.zones.filter((z) => z.isActive && z.hasPlayer);
  const playing = room.zones.filter((z) => z.isPlaying);

  const motionDetected = room.devices.some(
    (d) => statuses.get(d.id)?.readings?.some((r) => r.kind === "motion" && r.value === "erkannt"),
  );
  const present = !!room.activity?.present || motionDetected;

  const sensorIds = new Set(
    groups.climate.filter((d) => d.category === "SENSOR" || d.id === room.climate?.sensorDeviceId).map((d) => d.id),
  );
  let liveTemp: number | null = null;
  for (const id of sensorIds) {
    liveTemp = parseC(statuses.get(id)?.readings?.find((r) => r.kind === "temperature")?.value);
    if (liveTemp != null) break;
  }
  const tempC = liveTemp ?? room.climate?.lastTempC ?? null;
  const climate = room.climate;
  let climateLabel: string | null = null;
  let climateTone: RoomSummary["climateTone"] = null;
  if (climate || groups.climate.length > 0) {
    if (climate?.lastError) {
      climateLabel = "Fehler";
      climateTone = "danger";
    } else if (!climate || !climate.isActive) {
      climateLabel = tempC != null ? fmtC(tempC) : "Klima";
      climateTone = "idle";
    } else if (climate.heating) {
      climateLabel = `${tempC != null ? fmtC(tempC) + " · " : ""}heizt auf ${(climate.currentTargetC ?? climate.targetC).toLocaleString("de-DE")} °C`;
      climateTone = "heat";
    } else if (climate.fanOn) {
      climateLabel = `${tempC != null ? fmtC(tempC) + " · " : ""}lüftet`;
      climateTone = "air";
    } else {
      climateLabel = tempC != null ? fmtC(tempC) : "Absenkung";
      climateTone = "idle";
    }
  }

  const mowerState = (d: RoomDevice) => mowers?.get(d.id)?.state ?? d.mower?.state ?? null;
  const mowersMowing = groups.mower.filter((d) => {
    const s = mowerState(d);
    return !!s?.online && s.status === "MODE_WORKING";
  }).length;

  // Bewaesserung: laufender Plan vor dem naechsten Start.
  let irrigationLabel: string | null = null;
  let irrigationRunning = false;
  const irrigation = room.irrigation;
  if (irrigation) {
    const running = irrigation.schedules.find((s) => s.run && !runProgress(s.run, irrigation.valves, nowMs).finished);
    if (running) {
      const p = runProgress(running.run!, irrigation.valves, nowMs);
      const step = p.current != null ? running.run!.steps[p.current] : null;
      irrigationLabel = step ? `läuft · ${step.name} ${p.done + 1} von ${p.total}` : "läuft";
      irrigationRunning = true;
    } else {
      const next = irrigation.schedules
        .filter((s) => s.nextRunAt)
        .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))[0];
      const skipped = next && next.skipOnRain && irrigation.recommendation?.level === "skip";
      irrigationLabel = skipped
        ? "heute ausgesetzt"
        : next
          ? fmtNextRun(new Date(next.nextRunAt!), now, timezone)
          : irrigation.schedules.length > 0
            ? "pausiert"
            : `${irrigation.valves.length} ${irrigation.valves.length === 1 ? "Ventil" : "Ventile"}`;
    }
  }

  const camerasStale = room.cameras.filter(
    (c) => c.enabled && !(c.snapshotAt && nowMs - new Date(c.snapshotAt).getTime() < SNAPSHOT_FRESH_MS),
  ).length;

  const alerts: RoomAlert[] = [];
  const offline = room.devices.filter((d) => statuses.get(d.id)?.online === false);
  if (offline.length === 1) {
    alerts.push({ roomId: room.id, roomName: room.name, text: `${offline[0].name} antwortet nicht`, tab: "control" });
  } else if (offline.length > 1) {
    alerts.push({ roomId: room.id, roomName: room.name, text: `${offline.length} Geräte antworten nicht`, tab: "control" });
  }
  if (climate?.lastError) {
    alerts.push({ roomId: room.id, roomName: room.name, text: `Klima: ${climate.lastError}`, tab: "control" });
  }
  if (camerasStale > 0) {
    alerts.push({
      roomId: room.id,
      roomName: room.name,
      text: camerasStale === 1 ? "Eine Kamera ohne Bild" : `${camerasStale} Kameras ohne Bild`,
      tab: "security",
    });
  }
  for (const d of groups.mower) {
    const s = mowerState(d);
    if (s && s.online === false) {
      alerts.push({ roomId: room.id, roomName: room.name, text: `${s.label || d.name} nicht erreichbar`, tab: "control" });
    }
  }

  const haystack = [
    room.name,
    room.number,
    room.building,
    room.floor,
    ...room.devices.map((d) => d.name),
    ...room.cameras.map((c) => c.name),
    ...room.zones.map((z) => z.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    room,
    open,
    openLabel,
    present,
    lightsOn,
    lightsTotal: groups.light.length,
    switchableLights,
    playableZones,
    musicOn: playing.length > 0,
    musicTitle: playing[0]?.currentTitle ?? null,
    tempC,
    climateLabel,
    climateTone,
    mowersTotal: groups.mower.length,
    mowersMowing,
    irrigationLabel,
    irrigationRunning,
    camerasTotal: room.cameras.length,
    camerasStale,
    alerts,
    haystack,
  };
}

/** Nächste Abläufe über alle Räume, nach Zeitpunkt. */
export interface UpcomingItem {
  key: string;
  roomId: number;
  roomName: string;
  name: string;
  action: string;
  nextAt: string;
  kind: "rule" | "audio";
}

export function upcomingAcrossRooms(rooms: RoomPanel[], nowMs: number, limit: number): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  for (const room of rooms) {
    for (const a of room.automations) {
      if (!a.isActive || !a.nextAt) continue;
      const at = Date.parse(a.nextAt);
      if (!Number.isFinite(at) || at < nowMs - 60_000) continue;
      items.push({
        key: `${room.id}:${a.key}`,
        roomId: room.id,
        roomName: room.name,
        name: a.name,
        action: a.actions[0] ?? "",
        nextAt: a.nextAt,
        kind: a.kind,
      });
    }
  }
  return items.sort((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt)).slice(0, limit);
}
