/**
 * Lokale Bild-Prüfung via YOLO-Tracker (POST /classify).
 * Filtert leere Fahrzeug-Snaps, wenn die Kamera-KI falsch auslöst.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { improve } from "./improve-log.js";

const TRACKER_DEFAULT = "http://127.0.0.1:8088";
const CLASSIFY_TIMEOUT_MS = Number(process.env.HUB_VISION_TIMEOUT_MS || 5_000);

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

/**
 * Prüft, ob im JPEG ein Fahrzeug ist.
 * `quick` bleibt aus Kompatibilität, der Tracker sieht immer das Vollbild.
 * `null` = Tracker down / Timeout.
 */
export async function jpegContainsVehicle(
  jpeg: Buffer,
  _opts: { quick?: boolean } = {}
): Promise<boolean | null> {
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
      log(`Vision-Check fehlgeschlagen: HTTP ${res.status}`);
      improve("vision", "fail", { http: res.status });
      return null;
    }
    const json = (await res.json()) as { vehicle?: boolean; conf?: number };
    const vehicle = json.vehicle === true;
    log(
      `Vision (yolo): ${vehicle ? "YES" : "NO"} conf=${Number(json.conf ?? 0).toFixed(2)}`
    );
    improve("vision", vehicle ? "yes" : "no", { conf: Number(json.conf ?? 0) });
    return vehicle;
  } catch (e) {
    log(`Vision-Check Fehler: ${e instanceof Error ? e.message : e}`);
    improve("vision", "fail", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
