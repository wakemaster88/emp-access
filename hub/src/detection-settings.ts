/**
 * Fahrzeug-Einstellungen im lokalen Dashboard: Erkennung pro Kamera
 * (Fahrzeuge, Mindestgröße, Einfahrtszone, Halteverbot) und freigegebene
 * Fahrzeuge. Gespeichert wird in der Cloud (Quelle der Wahrheit), der Hub
 * reicht nur durch und übernimmt die neuen Werte sofort lokal.
 *
 * Feineinstellungen aus der .env (HUB_ALPR_*, HUB_VEHICLE_*, HUB_NOPARK_*)
 * werden nur angezeigt.
 */
import type http from "node:http";
import { api, log } from "./config.js";
import { captureSnapshot, listCameraConfigs, type CameraConfig } from "./cameras.js";
import { refreshVehicleWhitelist } from "./plate.js";

type Json = (res: http.ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: http.IncomingMessage) => Promise<Record<string, unknown>>;

const DETECTION_KEYS = [
  "vehicleDetection",
  "vehicleMinArea",
  "vehicleZone",
  "noParkDetection",
  "noParkZone",
  "noParkMinutes",
  "deliveryMode",
  "deliveryFrom",
  "deliveryTo",
] as const;

/** .env-Feineinstellungen mit Standardwert (nur Anzeige). */
const ENV_SETTINGS: Array<{ key: string; label: string; fallback: string }> = [
  { key: "HUB_ALPR_MIN_CONF", label: "Kennzeichen: Mindest-Sicherheit", fallback: "0.88" },
  { key: "HUB_ALPR_TIMEOUT_MS", label: "Kennzeichen: Timeout je Bild (ms)", fallback: "20000" },
  { key: "HUB_VEHICLE_MIN_AREA", label: "Fahrzeug: Mindestgröße (Anteil)", fallback: "0.02" },
  { key: "HUB_VEHICLE_ZONE", label: "Fahrzeug: Zone für alle Kameras", fallback: "keine" },
  { key: "HUB_VEHICLE_VISION", label: "Fahrzeug-Prüfung (auto/always/never)", fallback: "auto" },
  { key: "HUB_VEHICLE_BURST_COUNT", label: "Burst: Bilder je Ereignis", fallback: "20 (Weitwinkel 3)" },
  { key: "HUB_VEHICLE_BURST_GAP_MS", label: "Burst: Abstand (ms)", fallback: "400" },
  { key: "HUB_VEHICLE_GRACE_FRAMES", label: "Burst: Nachlauf-Bilder", fallback: "3" },
  { key: "HUB_DELIVERY_MIN_FRAMES", label: "Lieferdienst: Bilder mit Aufschrift", fallback: "2" },
  { key: "HUB_DELIVERY_COOLDOWN_MIN", label: "Lieferdienst: Sperrzeit nach Öffnung (min)", fallback: "5" },
  { key: "HUB_DELIVERY_DAYS", label: "Lieferdienst: Öffnungstage (1=Mo … 7=So)", fallback: "1,2,3,4,5,6" },
  { key: "HUB_DELIVERY_DOORBIRD_ID", label: "Lieferdienst: DoorBird-Kamera-ID", fallback: "einziger DoorBird" },
  { key: "HUB_NOPARK_MINUTES", label: "Halteverbot: Standzeit (min)", fallback: "2" },
  { key: "HUB_NOPARK_INTERVAL", label: "Halteverbot: Prüftakt (s)", fallback: "20" },
  { key: "HUB_NOPARK_REPEAT_MINUTES", label: "Halteverbot: erneut melden nach (min)", fallback: "10" },
  { key: "HUB_NOPARK_SPEAK", label: "Halteverbot: Ansage", fallback: "an" },
  { key: "HUB_NOPARK_SPEAK_FROM", label: "Halteverbot: Ansage ab (Uhr)", fallback: "8" },
  { key: "HUB_NOPARK_SPEAK_TO", label: "Halteverbot: Ansage bis (Uhr)", fallback: "22" },
  { key: "HUB_NOPARK_TEXT", label: "Halteverbot: Ansagetext", fallback: "Standardtext" },
];

function cameraSettings(c: CameraConfig) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind ?? "REOLINK",
    vehicleDetection: c.vehicleDetection !== false,
    vehicleMinArea: c.vehicleMinArea ?? null,
    vehicleZone: c.vehicleZone ?? null,
    noParkDetection: c.noParkDetection === true,
    noParkZone: c.noParkZone ?? null,
    noParkMinutes: c.noParkMinutes ?? null,
    deliveryMode: c.deliveryMode ?? null,
    deliveryFrom: c.deliveryFrom ?? null,
    deliveryTo: c.deliveryTo ?? null,
  };
}

/** Antwort der Cloud 1:1 weitergeben (Status + JSON). */
async function relay(res: http.ServerResponse, json: Json, r: Response): Promise<unknown> {
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  json(res, r.status, body);
  return r.ok ? body : null;
}

/** Fehlermeldung der Cloud lesbar machen (zod liefert ein Objekt). */
function offline(res: http.ServerResponse, json: Json, e: unknown) {
  log(`Fahrzeug-Einstellungen: Cloud nicht erreichbar: ${e instanceof Error ? e.message : e}`);
  json(res, 502, { error: "Cloud nicht erreichbar – Einstellungen können gerade nicht gespeichert werden" });
}

/**
 * Bearbeitet /api/detection/*. Liefert false, wenn der Pfad nicht passt.
 */
export async function handleDetectionApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  json: Json,
  readBody: ReadBody
): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith("/api/detection")) return false;

  if (req.method === "GET" && p === "/api/detection") {
    json(res, 200, {
      cameras: listCameraConfigs()
        .filter((c) => c.kind !== "DOORBIRD")
        .map(cameraSettings)
        .sort((a, b) => a.name.localeCompare(b.name, "de")),
      env: ENV_SETTINGS.map((s) => ({
        ...s,
        value: process.env[s.key] ?? null,
      })),
    });
    return true;
  }

  let m = p.match(/^\/api\/detection\/cameras\/(\d+)\/snapshot\.jpg$/);
  if (req.method === "GET" && m) {
    try {
      const jpeg = await captureSnapshot(Number(m[1]));
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      res.end(jpeg);
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  m = p.match(/^\/api\/detection\/cameras\/(\d+)$/);
  if (req.method === "PATCH" && m) {
    const id = Number(m[1]);
    const input = await readBody(req);
    const body: Record<string, unknown> = {};
    for (const k of DETECTION_KEYS) if (k in input) body[k] = input[k];
    try {
      const r = await api(`/api/hub/cameras/${id}/detection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const saved = (await relay(res, json, r)) as Partial<CameraConfig> | null;
      if (saved) {
        // Sofort lokal übernehmen – nicht erst beim nächsten Cloud-Abgleich.
        const cfg = listCameraConfigs().find((c) => c.id === id);
        if (cfg) {
          for (const k of DETECTION_KEYS) {
            if (k in saved) (cfg as unknown as Record<string, unknown>)[k] = saved[k as keyof CameraConfig];
          }
          log(`Kamera ${cfg.name}: Fahrzeug-Einstellungen im Dashboard geändert`);
        }
      }
    } catch (e) {
      offline(res, json, e);
    }
    return true;
  }

  if (p === "/api/detection/vehicles" && (req.method === "GET" || req.method === "POST")) {
    try {
      const r =
        req.method === "GET"
          ? await api("/api/hub/vehicles")
          : await api("/api/hub/vehicles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(await readBody(req)),
            });
      const ok = await relay(res, json, r);
      if (ok && req.method === "POST") void refreshVehicleWhitelist();
    } catch (e) {
      offline(res, json, e);
    }
    return true;
  }

  m = p.match(/^\/api\/detection\/vehicles\/(\d+)$/);
  if (m && (req.method === "PUT" || req.method === "DELETE")) {
    try {
      const r = await api(`/api/hub/vehicles/${m[1]}`, {
        method: req.method,
        ...(req.method === "PUT"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(await readBody(req)),
            }
          : {}),
      });
      const ok = await relay(res, json, r);
      if (ok) void refreshVehicleWhitelist();
    } catch (e) {
      offline(res, json, e);
    }
    return true;
  }

  json(res, 404, { error: "Nicht gefunden" });
  return true;
}
