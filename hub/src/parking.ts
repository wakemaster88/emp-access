/**
 * Parkplatz-Belegung aus der lokalen Kiosk-Config (webcams/config.json)
 * und dem YOLO-Tracker (nur Cams mit vehicleGate). Meldung an die Cloud alle
 * 30 s (reportParking, Takt in index.ts); die Regeln dazu stehen in
 * parking-rules.ts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { cameraAtHome, cameraIdByHost, ensureCameraConfigs, markCameraConfigStale } from "./cameras.js";
import { ChangeLog } from "./change-log.js";
import { improve, improveCount } from "./improve-log.js";
import {
  ensureDue,
  parkingCamsHash,
  parkingFrameIdleMs,
  parkingIdleReportMs,
  parkingReportDue,
  parkingReportKey,
  staleMarkDue,
  trackerFrameDue,
  type ParkingReported,
} from "./parking-rules.js";
import { STATE, recordHubEvent } from "./state.js";

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
  return null;
}

let parkingHostsCache: { at: number; hosts: Set<string> } | null = null;

/** IPs der Kameras mit Parkflaeche (Kiosk-Konfiguration) – fester Bildausschnitt. */
export async function parkingCameraHosts(): Promise<Set<string>> {
  if (parkingHostsCache && Date.now() - parkingHostsCache.at < 60_000) return parkingHostsCache.hosts;
  const cfg = await loadKioskConfig();
  const cams = cfg && Array.isArray(cfg.cams) ? cfg.cams : [];
  const hosts = new Set(cams.filter((c) => parkingSetup(c)).map((c) => String(c.ip ?? "").trim()).filter(Boolean));
  parkingHostsCache = { at: Date.now(), hosts };
  return hosts;
}

let lastSnapshot: ParkingSnapshot = emptySnapshot();

/** Zuletzt eingesammelte Belegung – fuer das Dashboard, ohne neuen Tracker-Call. */
export function lastParkingSnapshot(): ParkingSnapshot {
  return lastSnapshot;
}

export async function collectParkingSnapshot(): Promise<ParkingSnapshot> {
  const cfg = await loadKioskConfig();
  if (!cfg) return (lastSnapshot = emptySnapshot());

  const cams = Array.isArray(cfg.cams) ? cfg.cams : [];
  const lotsCfg = cams
    .map((c) => ({ cam: c, setup: parkingSetup(c) }))
    .filter((x): x is { cam: KioskCam; setup: NonNullable<ReturnType<typeof parkingSetup>> } => x.setup != null);
  if (lotsCfg.length === 0) return (lastSnapshot = emptySnapshot());

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

  const prevLots = new Map(lastSnapshot.lots.map((l) => [l.kioskId, l]));
  return (lastSnapshot = {
    at: new Date().toISOString(),
    trackerOnline,
    lots: lotsCfg.map(({ cam, setup }) => {
      const id = String(cam.id ?? "");
      const live = counters[id] ?? {};
      // Kamera zoomt gerade auf eine Person: letzte Zaehlung halten.
      const camId = cameraIdByHost(String(cam.ip ?? "").trim());
      const held = camId != null && !cameraAtHome(camId) ? prevLots.get(id) : undefined;
      return {
        kioskId: id,
        name: String(cam.name ?? id),
        ip: String(cam.ip ?? ""),
        mode: setup.mode,
        count: held ? held.count : Number(live.count ?? 0) || 0,
        lastUpdate: Number(live.lastUpdate ?? 0) || 0,
        lastError: typeof live.lastError === "string" ? live.lastError : null,
        fps: Number(live.fps ?? 0) || 0,
        zone: setup.zone,
      };
    }),
  });
}

/**
 * Belegung ohne Aenderung hoechstens so oft melden (HUB_PARKING_IDLE_REPORT_S,
 * Standard 30 s = jeder Lauf), siehe parkingReportDue.
 */
const IDLE_REPORT_MS = parkingIdleReportMs(process.env.HUB_PARKING_IDLE_REPORT_S);
/**
 * Tracker-Bild ohne geaenderte Zaehlung hoechstens so oft hochladen
 * (HUB_PARKING_FRAME_IDLE_S, Standard 0 = jeder Lauf), siehe trackerFrameDue.
 */
const FRAME_IDLE_MS = parkingFrameIdleMs(process.env.HUB_PARKING_FRAME_IDLE_S);

/** Letztes hochgeladenes Tracker-Bild je Flaeche (Kiosk-ID): wann und bei welcher Zaehlung. */
const lastFrame = new Map<string, { at: number; count: number | null }>();
/** Zuletzt markiert, dass die Kamera-Liste des Hubs die Park-Kamera nicht kennt. */
let lastStaleMarkAt = 0;
/** Letztes Sicherstellen, bei dem alle Aufrufe angekommen sind (ensureDue). */
let ensured: { hash: string | null; at: number } = { hash: null, at: 0 };

/**
 * Legt fehlende Parkkameras in der Cloud an (neue Halle-IP nicht mit alter
 * verwechseln). Laeuft beim Start, bei geaenderten Park-Kameras der
 * Kiosk-Konfiguration und sonst einmal je Stunde (ensureDue); bis alle
 * Aufrufe angekommen sind, bei jedem Lauf.
 */
export async function ensureParkingCameras(now = Date.now()): Promise<void> {
  const cfg = await loadKioskConfig();
  if (!cfg) return;
  const cams = (Array.isArray(cfg.cams) ? cfg.cams : []).filter((cam) => parkingSetup(cam));
  const hash = parkingCamsHash(
    cams.map((cam) => ({
      id: String(cam.id ?? ""),
      ip: String(cam.ip ?? "").trim(),
      port: Number(cam.port) || 80,
      channel: Number(cam.channel) || 0,
      username: String(cam.username ?? "").trim(),
      hasPassword: String(cam.password ?? "") !== "",
    })),
  );
  if (!ensureDue(ensured.hash, hash, ensured.at, now)) return;
  let created = false;
  let complete = true;
  for (const cam of cams) {
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
      } else {
        complete = false;
      }
    } catch (e) {
      complete = false;
      log(`Parkkamera ${host}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (created) markCameraConfigStale();
  if (complete) ensured = { hash, at: now };
}

/**
 * Tracker-Bild der Parkfläche hochladen, damit nicht die alte Halle-Kamera
 * angezeigt wird. Die Kamera-Nummer der Cloud kommt aus der Kamera-Liste des
 * Hubs (cameraIdByHost). Fehlt die Kamera dort (Hub gerade gestartet,
 * Kamera gerade angelegt), wird die Liste als veraltet markiert und gleich
 * geladen, hoechstens alle 5 min (staleMarkDue); jeder weitere Lauf schaut
 * wieder in die Liste. Ist die Kamera in der Cloud deaktiviert, kennt sie
 * auch die Liste nicht: Dann geht kein Bild hoch. `snapshot`: die eben
 * gemeldete Belegung (Zaehlung fuer trackerFrameDue).
 */
export async function uploadParkingTrackerFrames(snapshot?: ParkingSnapshot): Promise<void> {
  const cfg = await loadKioskConfig();
  if (!cfg) return;
  const trackerUrl = (cfg.settings?.tracker?.url || TRACKER_DEFAULT).replace(/\/$/, "");
  const pin = cfg.settings?.adminPin || "";
  const cams = Array.isArray(cfg.cams) ? cfg.cams : [];
  const counts = new Map((snapshot?.lots ?? []).map((l) => [l.kioskId, l.count]));
  const now = Date.now();
  const due = cams.filter((cam) => {
    if (!parkingSetup(cam)) return false;
    const host = String(cam.ip ?? "").trim();
    const kioskId = String(cam.id ?? "");
    if (!host || !kioskId) return false;
    const prev = lastFrame.get(kioskId);
    // Zwei Laeufe kurz hintereinander laden nicht zweimal hoch.
    if (now - (prev?.at ?? 0) < 15_000) return false;
    return trackerFrameDue({
      prevCount: prev ? prev.count : null,
      count: counts.get(kioskId) ?? null,
      lastUploadAt: prev?.at ?? 0,
      now,
      idleMs: FRAME_IDLE_MS,
    });
  });
  if (due.length === 0) return;

  for (const cam of due) {
    const host = String(cam.ip ?? "").trim();
    const kioskId = String(cam.id ?? "");
    let cameraId = cameraIdByHost(host);
    if (cameraId == null && staleMarkDue(lastStaleMarkAt, now)) {
      lastStaleMarkAt = now;
      markCameraConfigStale();
      // Dieselbe Ladung wie die der Kamera-Abfrage (keine zweite daneben).
      // Scheitert sie, steht das schon im Log (loadConfigs in cameras.ts).
      await ensureCameraConfigs().catch(() => undefined);
      cameraId = cameraIdByHost(host);
    }
    if (cameraId == null) {
      improveCount("parking", "frame_nocam");
      continue;
    }
    try {
      const img = await fetch(`${trackerUrl}/debug/${encodeURIComponent(kioskId)}/snapshot.jpg`, {
        headers: pin ? { "x-admin-token": pin } : {},
        signal: AbortSignal.timeout(4000),
      });
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) continue;

      const up = await api(`/api/hub/cameras/${cameraId}/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array(buf),
      });
      if (up.ok) {
        lastFrame.set(kioskId, { at: now, count: counts.get(kioskId) ?? null });
        improveCount("parking", "frame");
      }
    } catch {
      // Best-effort – Belegungszahl ist wichtiger als das Bild.
    }
  }
}

/** Ein Lauf der Parkmeldung ist unterwegs: kein zweiter daneben. */
let reportBusy = false;
/** Zuletzt von der Cloud angenommene Meldung (parkingReportDue). */
let reported: ParkingReported | null = null;
/** Fehler und Erholung der Meldung stehen je einmal im Log. */
const reportLog = new ChangeLog();
let reportFailing = false;

function noteReport(error: string | null): void {
  const now = Date.now();
  if (error) {
    improveCount("parking", "report_fail");
    if (reportLog.shouldLog("report", error, now)) log(`Parkplatz-Report fehlgeschlagen: ${error}`);
    reportFailing = true;
  } else if (reportFailing) {
    reportFailing = false;
    reportLog.shouldLog("report", "", now);
    log("Parkplatz-Report: Cloud nimmt die Meldung wieder an");
  }
}

/**
 * Belegung der Parkflaechen an die Cloud melden, dazu das Tracker-Bild.
 * Laeuft im Takt (index.ts); ein Lauf, der noch nicht fertig ist (Cloud
 * haengt, jeder Aufruf hat 30 s Zeit), verhindert den naechsten. Wirft nie.
 */
export async function reportParking(): Promise<void> {
  if (reportBusy) {
    improveCount("parking", "busy");
    return;
  }
  reportBusy = true;
  try {
    await ensureParkingCameras();
    const parking = await collectParkingSnapshot();
    if (STATE.parking.lastAt && parking.trackerOnline !== STATE.parking.trackerOnline) {
      recordHubEvent({
        kind: "system",
        severity: parking.trackerOnline ? "info" : "warn",
        where: "Park-Tracker",
        title: parking.trackerOnline ? "Tracker wieder online" : "Tracker offline",
      });
    }
    STATE.parking = {
      lastAt: parking.at,
      trackerOnline: parking.trackerOnline,
      lots: parking.lots.length,
    };
    const now = Date.now();
    if (parkingReportDue(reported, parking, now, IDLE_REPORT_MS)) {
      const res = await api("/api/hub/parking", {
        method: "POST",
        body: JSON.stringify({ name: CONFIG.name, parking }),
      });
      if (res.ok) {
        reported = { at: now, key: parkingReportKey(parking) };
        noteReport(null);
        // Der Normalfall alle 30 s wird nur gezaehlt (keine Zeile in improve.jsonl).
        if (parking.trackerOnline) improveCount("parking", "report");
      } else {
        noteReport(`HTTP ${res.status}`);
      }
    } else {
      improveCount("parking", "report_skip");
    }
    if (!parking.trackerOnline) improve("parking", "tracker_down", { lots: parking.lots.length });
    await uploadParkingTrackerFrames(parking);
  } catch (e) {
    noteReport(e instanceof Error ? e.message : String(e));
  } finally {
    reportBusy = false;
  }
}
