/**
 * Parkplatz-Belegung aus der lokalen Kiosk-Config (webcams/config.json)
 * und dem YOLO-Tracker (vehicleGate-Zonen, aktuell Kamera Halle).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { markCameraConfigStale } from "./cameras.js";

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
  port?: unknown;
  username?: unknown;
  password?: unknown;
  channel?: unknown;
  enabled?: unknown;
  vehicleGate?: { enabled?: boolean; zone?: [number, number][] | null };
  peopleCounter?: { enabled?: boolean; mode?: string; zone?: [number, number][] | null };
}

function emptySnapshot(): ParkingSnapshot {
  return { at: new Date().toISOString(), trackerOnline: false, lots: [] };
}

type KioskFile = {
  cams?: KioskCam[];
  settings?: { adminPin?: string; tracker?: { url?: string } };
};

async function loadKioskConfig(): Promise<KioskFile | null> {
  const configPath = path.join(CONFIG.repoDir, "webcams", "config.json");
  try {
    return JSON.parse(await fs.readFile(configPath, "utf8")) as KioskFile;
  } catch {
    return null;
  }
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
  const cfg = await loadKioskConfig();
  if (!cfg) return emptySnapshot();

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

const lastSnapAt = new Map<string, number>();

/** Legt fehlende Parkkameras in der Cloud an (neue Halle-IP nicht mit alter verwechseln). */
export async function ensureParkingCameras(): Promise<void> {
  const cfg = await loadKioskConfig();
  if (!cfg) return;
  const cams = Array.isArray(cfg.cams) ? cfg.cams : [];
  let created = false;
  for (const cam of cams) {
    if (!parkingSetup(cam)) continue;
    const host = String(cam.ip ?? "").trim();
    const username = String(cam.username ?? "").trim();
    const password = String(cam.password ?? "");
    if (!host || !username || !password) continue;
    try {
      const res = await api("/api/hub/cameras/ensure", {
        method: "POST",
        body: JSON.stringify({
          name: String(cam.name ?? "Halle"),
          host,
          httpPort: Number(cam.port) || 80,
          username,
          password,
          channel: Number(cam.channel) || 0,
          kind: "REOLINK",
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { created?: boolean };
        if (json.created) created = true;
      }
    } catch (e) {
      log(`Parkkamera ${host}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (created) markCameraConfigStale();
}

/** Tracker-Bild der Parkfläche hochladen, damit nicht die alte Halle-Kamera angezeigt wird. */
export async function uploadParkingTrackerFrames(): Promise<void> {
  const cfg = await loadKioskConfig();
  if (!cfg) return;
  const trackerUrl = (cfg.settings?.tracker?.url || TRACKER_DEFAULT).replace(/\/$/, "");
  const pin = cfg.settings?.adminPin || "";
  const cams = Array.isArray(cfg.cams) ? cfg.cams : [];
  const now = Date.now();
  const due = cams.filter((cam) => {
    if (!parkingSetup(cam)) return false;
    const host = String(cam.ip ?? "").trim();
    const kioskId = String(cam.id ?? "");
    return !!host && !!kioskId && now - (lastSnapAt.get(kioskId) ?? 0) >= 15_000;
  });
  if (due.length === 0) return;

  let cameras: Array<{ id: number; host: string }> = [];
  try {
    const list = await api("/api/hub/cameras");
    if (!list.ok) return;
    cameras = (await list.json()) as Array<{ id: number; host: string }>;
  } catch {
    return;
  }

  for (const cam of due) {
    const host = String(cam.ip ?? "").trim();
    const kioskId = String(cam.id ?? "");
    const cloud = cameras.find((c) => c.host === host);
    if (!cloud) continue;
    try {
      const img = await fetch(`${trackerUrl}/debug/${encodeURIComponent(kioskId)}/snapshot.jpg`, {
        headers: pin ? { "x-admin-token": pin } : {},
        signal: AbortSignal.timeout(4000),
      });
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) continue;

      const up = await api(`/api/hub/cameras/${cloud.id}/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array(buf),
      });
      if (up.ok) lastSnapAt.set(kioskId, now);
    } catch {
      // Best-effort – Belegungszahl ist wichtiger als das Bild.
    }
  }
}
