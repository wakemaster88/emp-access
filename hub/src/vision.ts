/**
 * Lokale Bild-Prüfung via YOLO-Tracker (POST /classify).
 * Filtert leere Fahrzeug-Snaps, wenn die Kamera-KI falsch auslöst.
 *
 * Der Tracker sieht jedes Auto im Bild – auch geparkte Wagen und den
 * Verkehr auf der Straße im Hintergrund. Damit daraus kein „Fahrzeug ohne
 * Kennzeichen“ wird, zählt eine Box nur, wenn sie groß genug ist
 * (HUB_VEHICLE_MIN_AREA, Anteil an der Bildfläche) und – falls konfiguriert –
 * ihr Mittelpunkt in der Einfahrtszone liegt (HUB_VEHICLE_ZONE bzw.
 * HUB_VEHICLE_ZONE_<kameraId>, normierte Polygonpunkte 0..1).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { improve } from "./improve-log.js";

const TRACKER_DEFAULT = "http://127.0.0.1:8088";
const CLASSIFY_TIMEOUT_MS = Number(process.env.HUB_VISION_TIMEOUT_MS || 5_000);
/** Mindestanteil der Bildfläche, den eine Fahrzeug-Box belegen muss (2 % = Auto an der Einfahrt, nicht auf dem Parkplatz dahinter). */
export const VEHICLE_MIN_AREA = (() => {
  const n = Number(process.env.HUB_VEHICLE_MIN_AREA);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : 0.02;
})();

type TrackerTarget = { url: string; pin: string };

let cachedTarget: { at: number; value: TrackerTarget } | null = null;
const TARGET_TTL_MS = 60_000;

async function trackerTarget(): Promise<TrackerTarget> {
  if (cachedTarget && Date.now() - cachedTarget.at < TARGET_TTL_MS) {
    return cachedTarget.value;
  }
  const envUrl = (process.env.HUB_TRACKER_URL || "").replace(/\/$/, "");
  let url = envUrl || TRACKER_DEFAULT;
  let pin = process.env.HUB_TRACKER_PIN || "";
  try {
    const raw = await fs.readFile(
      path.join(CONFIG.repoDir, "webcams", "config.json"),
      "utf8"
    );
    const cfg = JSON.parse(raw) as {
      settings?: { adminPin?: string; tracker?: { url?: string } };
    };
    if (!envUrl && cfg.settings?.tracker?.url) {
      url = String(cfg.settings.tracker.url).replace(/\/$/, "");
    }
    if (!pin && cfg.settings?.adminPin) pin = String(cfg.settings.adminPin);
  } catch {
    // Default reicht, wenn die Kiosk-Config fehlt.
  }
  const value = { url, pin };
  cachedTarget = { at: Date.now(), value };
  return value;
}

/** Basis-URL des Trackers (für Health-Checks nach einem Neustart). */
export async function trackerBaseUrl(): Promise<string> {
  return (await trackerTarget()).url;
}

/* ---------------------------------------------------------------------------
 * Einfahrtszone: Polygon aus der Umgebung, "x,y;x,y;x,y…" mit Werten 0..1.
 * ------------------------------------------------------------------------- */

type Point = { x: number; y: number };

function parseZone(raw: string | undefined): Point[] | null {
  if (!raw) return null;
  const pts: Point[] = [];
  for (const part of raw.split(";")) {
    const [xs, ys] = part.split(",").map((s) => s.trim());
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
  }
  return pts.length >= 3 ? pts : null;
}

/** Zone für eine Kamera: erst HUB_VEHICLE_ZONE_<id>, sonst HUB_VEHICLE_ZONE. */
export function vehicleZoneFor(cameraId: number | undefined): Point[] | null {
  const specific = cameraId != null ? parseZone(process.env[`HUB_VEHICLE_ZONE_${cameraId}`]) : null;
  return specific ?? parseZone(process.env.HUB_VEHICLE_ZONE);
}

/** Punkt-in-Polygon (Ray-Casting). */
function inside(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (crosses) hit = !hit;
  }
  return hit;
}

/** Fahrzeug-Box vom Tracker, Koordinaten normiert 0..1. */
export interface VehicleBox {
  cls: number;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ClassifyResponse {
  vehicle?: boolean;
  conf?: number;
  vehicles?: VehicleBox[];
}

export interface VehicleCheck {
  /** true = brauchbares Fahrzeug im Bild, false = keins, null = Tracker down. */
  vehicle: boolean | null;
  conf: number;
  /** Fläche der gewählten Box (Anteil am Bild), 0 wenn keine. */
  area: number;
  /** Warum abgelehnt: zu klein, außerhalb der Zone, nichts erkannt. */
  reason?: "small" | "zone" | "none";
}

/**
 * Prüft, ob im JPEG ein Fahrzeug ist, das die Größen-/Zonenregel erfüllt.
 * `minArea` überschreibt HUB_VEHICLE_MIN_AREA (0 = jede Box zählt),
 * `cameraId` wählt die Zone. `null` = Tracker down / Timeout.
 */
export async function checkVehicle(
  jpeg: Buffer,
  opts: { minArea?: number; cameraId?: number; label?: string; zone?: [number, number][] | null } = {}
): Promise<VehicleCheck> {
  const minArea = opts.minArea ?? VEHICLE_MIN_AREA;
  // Zone aus der Cloud-Kamera hat Vorrang; sonst HUB_VEHICLE_ZONE(_<id>).
  const zone =
    Array.isArray(opts.zone) && opts.zone.length >= 3
      ? opts.zone.map(([x, y]) => ({ x, y }))
      : vehicleZoneFor(opts.cameraId);
  const tag = opts.label ? ` ${opts.label}` : "";
  try {
    const { url, pin } = await trackerTarget();
    const res = await fetch(`${url}/classify`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        ...(pin ? { "x-admin-token": pin } : {}),
      },
      body: new Uint8Array(jpeg),
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`Vision-Check${tag} fehlgeschlagen: HTTP ${res.status}`);
      improve("vision", "fail", { http: res.status });
      return { vehicle: null, conf: 0, area: 0 };
    }
    const json = (await res.json()) as ClassifyResponse;

    // Alter Tracker ohne Box-Liste: nur das Ja/Nein übernehmen.
    if (!Array.isArray(json.vehicles)) {
      const vehicle = json.vehicle === true;
      const conf = Number(json.conf ?? 0);
      log(`Vision (yolo)${tag}: ${vehicle ? "YES" : "NO"} conf=${conf.toFixed(2)} (Tracker ohne Boxen)`);
      improve("vision", vehicle ? "yes" : "no", { conf });
      return { vehicle, conf, area: 0 };
    }

    let best: VehicleBox | null = null;
    let largest = 0;
    let rejectedZone = 0;
    for (const b of json.vehicles) {
      const area = Math.max(0, b.w) * Math.max(0, b.h);
      largest = Math.max(largest, area);
      if (area < minArea) continue;
      if (zone && !inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, zone)) {
        rejectedZone++;
        continue;
      }
      if (!best || b.conf > best.conf) best = b;
    }

    if (best) {
      const area = best.w * best.h;
      log(
        `Vision (yolo)${tag}: YES conf=${best.conf.toFixed(2)} Fläche=${(area * 100).toFixed(1)}%`
      );
      improve("vision", "yes", { conf: best.conf, area });
      return { vehicle: true, conf: best.conf, area };
    }

    const reason: VehicleCheck["reason"] =
      json.vehicles.length === 0 ? "none" : rejectedZone > 0 && largest >= minArea ? "zone" : "small";
    const detail =
      reason === "none"
        ? "kein Fahrzeug"
        : reason === "zone"
          ? `${rejectedZone} Box(en) außerhalb der Einfahrtszone`
          : `größte Box ${(largest * 100).toFixed(2)}% < ${(minArea * 100).toFixed(1)}% (Hintergrund)`;
    log(`Vision (yolo)${tag}: NO – ${detail}`);
    improve("vision", reason === "none" ? "no" : `no_${reason}`, {
      boxes: json.vehicles.length,
      largest,
    });
    return { vehicle: false, conf: 0, area: largest, reason };
  } catch (e) {
    log(`Vision-Check${tag} Fehler: ${e instanceof Error ? e.message : e}`);
    improve("vision", "fail", { error: e instanceof Error ? e.message : String(e) });
    return { vehicle: null, conf: 0, area: 0 };
  }
}

/**
 * Kompatible Kurzform: true/false/null wie bisher.
 * `quick` bleibt aus Kompatibilität, der Tracker sieht immer das Vollbild.
 */
export async function jpegContainsVehicle(
  jpeg: Buffer,
  opts: {
    quick?: boolean;
    minArea?: number;
    cameraId?: number;
    label?: string;
    zone?: [number, number][] | null;
  } = {}
): Promise<boolean | null> {
  const r = await checkVehicle(jpeg, opts);
  return r.vehicle;
}
