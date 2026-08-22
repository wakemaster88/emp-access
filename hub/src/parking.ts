/**
 * Parkplatz-Belegung aus der lokalen Kiosk-Config (webcams/config.json)
 * und dem YOLO-Tracker (vehicleGate-Zonen, aktuell Kamera Halle).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

export interface ParkingLotReport {
  kioskId: string;
  name: string;
  ip: string;
  mode: "vehicle-zone" | "zone";
  count: number;
  lastUpdate: number;
  lastError: string | null;
  fps: number;
  zone: [number, number][] | null;
}

export interface ParkingSnapshot {
  at: string;
  trackerOnline: boolean;
  lots: ParkingLotReport[];
}

const TRACKER_DEFAULT = "http://127.0.0.1:8088";

interface KioskCam {
  id?: unknown;
  name?: unknown;
  ip?: unknown;
  enabled?: unknown;
  vehicleGate?: { enabled?: boolean; zone?: [number, number][] | null };
  peopleCounter?: { enabled?: boolean; mode?: string; zone?: [number, number][] | null };
}

function emptySnapshot(): ParkingSnapshot {
  return { at: new Date().toISOString(), trackerOnline: false, lots: [] };
}

function parkingSetup(
  c: KioskCam,
): { mode: "vehicle-zone" | "zone"; zone: [number, number][] | null } | null {
  if (c.enabled === false) return null;
  if (c.vehicleGate?.enabled) {
    return {
      mode: "vehicle-zone",
      zone: Array.isArray(c.vehicleGate.zone) ? c.vehicleGate.zone : null,
    };
  }
  const name = String(c.name ?? "");
  const pc = c.peopleCounter;
  if (/halle/i.test(name) && pc?.enabled && pc.mode === "zone") {
    return {
      mode: "zone",
      zone: Array.isArray(pc.zone) ? pc.zone : null,
    };
  }
  return null;
}

export async function collectParkingSnapshot(): Promise<ParkingSnapshot> {
  const configPath = path.join(CONFIG.repoDir, "webcams", "config.json");
  let cfg: {
    cams?: KioskCam[];
    settings?: { adminPin?: string; tracker?: { url?: string } };
  };
  try {
    cfg = JSON.parse(await fs.readFile(configPath, "utf8")) as typeof cfg;
  } catch {
    return emptySnapshot();
  }

  const cams = Array.isArray(cfg.cams) ? cfg.cams : [];
  const lotsCfg = cams
    .map((c) => ({ cam: c, setup: parkingSetup(c) }))
    .filter((x): x is { cam: KioskCam; setup: NonNullable<ReturnType<typeof parkingSetup>> } => x.setup != null);
  if (lotsCfg.length === 0) return emptySnapshot();

  const trackerUrl = (cfg.settings?.tracker?.url || TRACKER_DEFAULT).replace(/\/$/, "");
  const pin = cfg.settings?.adminPin || "";
  let counters: Record<
    string,
    { count?: number; lastUpdate?: number; lastError?: string | null; fps?: number }
  > = {};
  let trackerOnline = false;
  try {
    const res = await fetch(`${trackerUrl}/counters`, {
      headers: pin ? { "x-admin-token": pin } : {},
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const json = (await res.json()) as { counters?: typeof counters };
      counters = json.counters ?? {};
      trackerOnline = true;
    }
  } catch {
    // Tracker nicht erreichbar – Zonen trotzdem melden.
  }

  return {
    at: new Date().toISOString(),
    trackerOnline,
    lots: lotsCfg.map(({ cam, setup }) => {
      const id = String(cam.id ?? "");
      const live = counters[id] ?? {};
      return {
        kioskId: id,
        name: String(cam.name ?? id),
        ip: String(cam.ip ?? ""),
        mode: setup.mode,
        count: Number(live.count ?? 0) || 0,
        lastUpdate: Number(live.lastUpdate ?? 0) || 0,
        lastError: typeof live.lastError === "string" ? live.lastError : null,
        fps: Number(live.fps ?? 0) || 0,
        zone: setup.zone,
      };
    }),
  };
}
