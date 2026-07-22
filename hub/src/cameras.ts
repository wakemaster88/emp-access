/**
 * Kamera-Modul: spricht Reolink-Kameras ueber die lokale CGI-HTTP-API an
 * (POST /cgi-bin/api.cgi). Pollt Bewegungs-/KI-Zustaende (GetMdState/
 * GetAiState), meldet Start/Ende der Ereignisse an die Cloud und laedt
 * Schnappschuesse hoch (bei Ereignis-Beginn und auf Task-Anforderung).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { api, log } from "./config.js";
import { STATE } from "./state.js";
import { embedJpeg, matchEmbedding, refreshGallery } from "./face.js";
import { scorePlateFromJpeg, type PlateScore } from "./plate.js";
import { jpegContainsVehicle } from "./vision.js";
import { syncDoorbirds } from "./doorbird.js";

export interface CameraConfig {
  id: number;
  name: string;
  /** "REOLINK" (CGI-Polling, Default) | "DOORBIRD" (LAN-API, doorbird.ts). */
  kind?: string;
  host: string;
  httpPort: number;
  https: boolean;
  username: string;
  password: string;
  channel: number;
  /** Fahrzeug-Erkennung auf dieser Kamera (Events + Burst + OCR). */
  vehicleDetection?: boolean;
}

interface CameraRuntime {
  config: CameraConfig;
  token: string | null;
  tokenExpiresAt: number;
  /** Aktueller Alarm-Zustand pro Ereignistyp (fuer Flankenerkennung). */
  states: Record<string, boolean>;
  lastSnapshotAt: number;
  unreachableLogged: boolean;
}

const cameras = new Map<number, CameraRuntime>();
let configLoadedAt = 0;

const CONFIG_REFRESH_MS = 60_000;
const TOKEN_SAFETY_MS = 60_000;
/** Bei Ereignis-Beginn hoechstens alle 30 s ein Auto-Snapshot pro Kamera. */
const EVENT_SNAPSHOT_THROTTLE_MS = 30_000;
/** Personen: kurz warten, dann mehrere Versuche solange PERSON aktiv (Gesicht oft erst frontal). */
const PERSON_SNAP_DELAY_MS = 1_000;
const PERSON_SNAP_ATTEMPTS = 4;
const PERSON_SNAP_RETRY_MS = 1_200;
/**
 * Fahrzeuge: dichter Burst solange VEHICLE aktiv, lokal dumpen,
 * Plate-OCR wählt den besten Frame. Fallback: Vision „Fahrzeug?“.
 * Spam-Kameras: kürzer. Env: HUB_VEHICLE_BURST_*, HUB_VEHICLE_DUMP_DIR
 */
const VEHICLE_SNAP_DELAY_MS = 0;
/** Ab dieser OCR-Confidence früh abbrechen (späte Frames zuerst). */
const PLATE_EARLY_STOP_CONF = Number(process.env.HUB_PLATE_EARLY_STOP_CONF || 0.85);
/** Nach VEHICLE-Ende noch ein paar Frames – Alarm flackert, Auto oft noch näher. */
const VEHICLE_GRACE_FRAMES = Number(process.env.HUB_VEHICLE_GRACE_FRAMES || 3);
/** Dump-Rotation: max. Ordner und max. Alter. */
const DUMP_MAX_FOLDERS = Number(process.env.HUB_VEHICLE_DUMP_MAX || 150);
const DUMP_MAX_AGE_MS =
  Number(process.env.HUB_VEHICLE_DUMP_MAX_AGE_H || 48) * 3_600_000;

function vehicleBurstPlan(cam: CameraConfig): { count: number; gapMs: number } {
  const name = cam.name.toLowerCase();
  const gapEnv = Number(process.env.HUB_VEHICLE_BURST_GAP_MS);
  const countEnv = Number(process.env.HUB_VEHICLE_BURST_COUNT);
  // Weitwinkel-Spam: kurz.
  if (/seilbahn|aquapark/.test(name)) {
    return {
      count: Number.isFinite(countEnv) && countEnv > 0 ? Math.min(countEnv, 4) : 3,
      gapMs: Number.isFinite(gapEnv) && gapEnv >= 200 ? gapEnv : 400,
    };
  }
  // Zufahrt/Halle/Eingang: dichter Burst (~8s bei 20×400ms), stoppt wenn VEHICLE ende.
  return {
    count: Number.isFinite(countEnv) && countEnv > 0 ? countEnv : 20,
    gapMs: Number.isFinite(gapEnv) && gapEnv >= 200 ? gapEnv : 400,
  };
}

function vehicleVisionMode(): "always" | "never" | "auto" {
  const mode = (process.env.HUB_VEHICLE_VISION || "auto").toLowerCase();
  if (mode === "always" || mode === "never") return mode;
  return "auto";
}

/** Lokaler Burst-Dump; Default /tmp/veh-burst, aus mit HUB_VEHICLE_DUMP=0. */
function vehicleDumpDir(): string | null {
  if (process.env.HUB_VEHICLE_DUMP === "0" || process.env.HUB_VEHICLE_DUMP === "never") {
    return null;
  }
  return process.env.HUB_VEHICLE_DUMP_DIR || "/tmp/veh-burst";
}

function burstFolderName(camName: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = camName.replace(/[^\w\-]+/g, "_").slice(0, 40);
  return `${ts}_${safe}`;
}

/** Alte Burst-Ordner löschen (Alter + Anzahl), damit /tmp nicht vollläuft. */
async function pruneVehicleDumps(root: string): Promise<void> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs: Array<{ name: string; mtime: number }> = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const st = await fs.stat(path.join(root, e.name)).catch(() => null);
      if (st) dirs.push({ name: e.name, mtime: st.mtimeMs });
    }
    dirs.sort((a, b) => b.mtime - a.mtime);
    const now = Date.now();
    const doomed = dirs.filter(
      (d, i) => i >= DUMP_MAX_FOLDERS || now - d.mtime > DUMP_MAX_AGE_MS
    );
    for (const d of doomed) {
      await fs.rm(path.join(root, d.name), { recursive: true, force: true });
    }
    if (doomed.length > 0) {
      log(`Fahrzeug-Burst Dump: ${doomed.length} alte Ordner aufgeräumt`);
    }
  } catch {
    // Aufräumen darf nie den Snapshot-Pfad stören.
  }
}

async function dumpVehicleBurst(
  dir: string,
  snaps: Buffer[],
  scores: Array<{ index: number; score: PlateScore }>,
  chosen: number | null,
  camName: string
): Promise<void> {
  await pruneVehicleDumps(path.dirname(dir));
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < snaps.length; i++) {
    const tag = chosen === i ? "BEST" : String(i).padStart(2, "0");
    await fs.writeFile(path.join(dir, `${tag}.jpg`), snaps[i]);
  }
  const meta = {
    camera: camName,
    savedAt: new Date().toISOString(),
    frameCount: snaps.length,
    chosen,
    frames: scores.map(({ index, score }) => ({
      index,
      plate: score.plate,
      confidence: score.confidence,
      viaWhitelist: score.viaWhitelist,
      topCandidates: score.candidates.slice(0, 5).map((c) => ({
        plate: c.plate,
        confidence: c.confidence,
      })),
    })),
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  log(`Fahrzeug-Burst Dump: ${dir} (${snaps.length} Frames, chosen=${chosen ?? "—"})`);
}

function baseUrl(c: CameraConfig): string {
  return `${c.https ? "https" : "http"}://${c.host}:${c.httpPort}`;
}

/** CGI-Kommando ausfuehren; Reolink erwartet ein Array von Kommandos. */
async function cgi(
  cam: CameraRuntime,
  cmd: string,
  param: Record<string, unknown>,
  { withToken = true }: { withToken?: boolean } = {}
): Promise<Record<string, unknown>> {
  const qs = withToken && cam.token ? `&token=${encodeURIComponent(cam.token)}` : "";
  const res = await fetch(`${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=${cmd}${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ cmd, action: 0, param }]),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as Array<{
    code: number;
    value?: Record<string, unknown>;
    error?: { rspCode?: number; detail?: string };
  }>;
  const first = json?.[0];
  if (!first || first.code !== 0) {
    const rsp = first?.error?.rspCode;
    // Token abgelaufen/ungueltig -> beim naechsten Versuch neu einloggen.
    if (rsp === -6 || rsp === -1) {
      cam.token = null;
      cam.tokenExpiresAt = 0;
    }
    throw new Error(`${cmd} fehlgeschlagen: ${first?.error?.detail ?? "unbekannt"} (rspCode ${rsp})`);
  }
  return first.value ?? {};
}

async function ensureLogin(cam: CameraRuntime): Promise<void> {
  if (cam.token && Date.now() < cam.tokenExpiresAt) return;
  const value = await cgi(
    cam,
    "Login",
    { User: { userName: cam.config.username, password: cam.config.password } },
    { withToken: false }
  );
  const token = (value.Token as { name?: string; leaseTime?: number } | undefined);
  if (!token?.name) throw new Error("Login ohne Token beantwortet");
  cam.token = token.name;
  cam.tokenExpiresAt = Date.now() + ((token.leaseTime ?? 3600) * 1000 - TOKEN_SAFETY_MS);
}

/**
 * Alarm-Zustaende abfragen. GetAiState liefert je nach Modell people/vehicle/
 * dog_cat; GetMdState die klassische Bewegungserkennung.
 */
/**
 * Versucht ein Kennzeichen aus der Reolink-AI zu lesen. Viele Modelle liefern
 * nur die Klasse "vehicle" ohne Plate – dann bleibt der Rueckgabewert null.
 */
async function tryReadPlate(cam: CameraRuntime): Promise<string | null> {
  try {
    await ensureLogin(cam);
    const ai = await cgi(cam, "GetAiState", { channel: cam.config.channel });
    const candidates: unknown[] = [
      ai.plate_num,
      ai.plate,
      ai.license_plate,
      (ai.vehicle as { plate?: string } | undefined)?.plate,
      (ai.vehicle as { plate_num?: string } | undefined)?.plate_num,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length >= 2) return c.trim().toUpperCase();
    }
  } catch {
    // Kein LPR / aelteres Modell.
  }
  return null;
}

async function pollStates(cam: CameraRuntime): Promise<Record<string, boolean>> {
  await ensureLogin(cam);
  const channel = cam.config.channel;
  const states: Record<string, boolean> = {};

  const md = await cgi(cam, "GetMdState", { channel });
  states.MOTION = Number(md.state) === 1;

  try {
    const ai = await cgi(cam, "GetAiState", { channel });
    const map: Record<string, string> = { people: "PERSON", vehicle: "VEHICLE", dog_cat: "ANIMAL" };
    for (const [key, type] of Object.entries(map)) {
      // Fahrzeug-Erkennung pro Kamera abschaltbar (Spam-Weitwinkel).
      if (type === "VEHICLE" && cam.config.vehicleDetection === false) continue;
      const entry = ai[key] as { alarm_state?: number; support?: number } | undefined;
      if (entry?.support === 1) states[type] = entry.alarm_state === 1;
    }
    // Klare Gesichtserkennung (falls Modell face liefert) ueberschreibt PERSON.
    const face = ai.face as { alarm_state?: number; support?: number } | undefined;
    if (face?.support === 1) {
      states.PERSON = face.alarm_state === 1;
    }
  } catch {
    // Aeltere Modelle ohne KI-Erkennung - nur Bewegung melden.
  }
  return states;
}

/** JPEG von der Kamera holen (ohne Upload). */
async function captureSnap(cam: CameraRuntime): Promise<Buffer> {
  await ensureLogin(cam);
  const rs = Math.random().toString(36).slice(2, 10);
  const res = await fetch(
    `${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=Snap&channel=${cam.config.channel}&rs=${rs}&token=${encodeURIComponent(cam.token!)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Snap fehlgeschlagen: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("Snap lieferte kein JPEG (falsche Zugangsdaten?)");
  }
  return buf;
}

/** Schnappschuss von der Kamera holen und in die Cloud laden. */
export async function uploadSnapshot(cameraId: number): Promise<{ bytes: number }> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);

  const buf = await captureSnap(cam);
  const upload = await api(`/api/hub/cameras/${cameraId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
  });
  if (!upload.ok) throw new Error(`Snapshot-Upload fehlgeschlagen: HTTP ${upload.status}`);
  cam.lastSnapshotAt = Date.now();
  return { bytes: buf.length };
}

/**
 * Bei Personen-Erkennung: Delay, dann bis zu N Snap-/Face-Versuche solange
 * PERSON noch aktiv – Gallery-Match, Upload (ohne Gesicht: kein Upload).
 */
async function uploadPersonSnapshot(cameraId: number): Promise<{ bytes: number } | null> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);

  await new Promise((r) => setTimeout(r, PERSON_SNAP_DELAY_MS));

  let buf: Buffer | null = null;
  let face: Awaited<ReturnType<typeof embedJpeg>> = null;

  for (let attempt = 1; attempt <= PERSON_SNAP_ATTEMPTS; attempt++) {
    try {
      const states = await pollStates(cam);
      cam.states.PERSON = states.PERSON ?? false;
      if (!states.PERSON) {
        log(
          `Personen-Snapshot ${cam.config.name}: übersprungen (nicht mehr aktiv` +
            (attempt > 1 ? `, nach Versuch ${attempt - 1}` : "") +
            `)`
        );
        return null;
      }
    } catch (e) {
      log(
        `Personen-Snapshot ${cam.config.name}: Re-Check fehlgeschlagen: ${
          e instanceof Error ? e.message : e
        }`
      );
      return null;
    }

    buf = await captureSnap(cam);
    face = await embedJpeg(buf);
    if (face) {
      if (attempt > 1) {
        log(`Personen-Snapshot ${cam.config.name}: Gesicht erst bei Versuch ${attempt}`);
      }
      break;
    }
    log(
      `Personen-Snapshot ${cam.config.name}: Versuch ${attempt}/${PERSON_SNAP_ATTEMPTS} ohne Gesicht`
    );
    if (attempt < PERSON_SNAP_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, PERSON_SNAP_RETRY_MS));
    }
  }

  if (!buf || !face) {
    log(
      `Personen-Snapshot ${cam.config.name}: übersprungen (kein Gesicht nach ${PERSON_SNAP_ATTEMPTS} Versuchen)`
    );
    return null;
  }

  await refreshGallery();
  const match = matchEmbedding(face.embedding);
  const qs = new URLSearchParams({ cameraId: String(cameraId) });
  if (match) {
    qs.set("listedPersonId", String(match.listedPersonId));
    qs.set("matchScore", match.score.toFixed(4));
    qs.set("matchMethod", "FACE_EMBEDDING");
    log(
      `Personen-Snapshot ${cam.config.name}: Match „${match.name}“ score=${match.score.toFixed(3)}`
    );
  } else {
    log(
      `Personen-Snapshot ${cam.config.name}: klares Gesicht (det=${face.detScore.toFixed(2)}), kein Gallery-Match`
    );
  }

  const upload = await api(`/api/hub/person-sightings?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) {
    const errText = await upload.text().catch(() => "");
    throw new Error(
      `Personen-Snapshot fehlgeschlagen: HTTP ${upload.status} ${errText.slice(0, 120)}`
    );
  }
  log(`Personen-Snapshot ${cam.config.name}: Upload OK (${buf.length} bytes)`);
  cam.lastSnapshotAt = Date.now();
  return { bytes: buf.length };
}

/**
 * Fahrzeug-Erkennung: dichter Burst → lokal dumpen → Plate-OCR wählt Frame.
 * Ohne Plate: Fallback Vision (Fahrzeug?). Ohne beides → kein Upload.
 */
async function uploadVehicleSnapshot(cameraId: number): Promise<{ bytes: number } | null> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);
  if (cam.config.vehicleDetection === false) {
    log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (Fahrzeug-Erkennung aus)`);
    return null;
  }

  await new Promise((r) => setTimeout(r, VEHICLE_SNAP_DELAY_MS));

  const plan = vehicleBurstPlan(cam.config);
  const snaps: Buffer[] = [];
  let graceLeft = VEHICLE_GRACE_FRAMES;
  log(
    `Fahrzeug-Burst ${cam.config.name}: max ${plan.count}×${plan.gapMs}ms solange VEHICLE (+${VEHICLE_GRACE_FRAMES} Grace) …`
  );
  for (let i = 0; i < plan.count; i++) {
    try {
      const states = await pollStates(cam);
      cam.states.VEHICLE = states.VEHICLE ?? false;
      if (!states.VEHICLE) {
        if (snaps.length === 0) {
          log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (nicht mehr aktiv)`);
          return null;
        }
        // Alarm flackert oft, Auto noch im Bild: ein paar Frames weiter.
        if (graceLeft <= 0) {
          log(
            `Fahrzeug-Burst ${cam.config.name}: VEHICLE ende nach ${snaps.length} Frames`
          );
          break;
        }
        graceLeft--;
      } else {
        graceLeft = VEHICLE_GRACE_FRAMES;
      }
    } catch (e) {
      if (snaps.length === 0) {
        log(
          `Fahrzeug-Snapshot ${cam.config.name}: Re-Check fehlgeschlagen: ${
            e instanceof Error ? e.message : e
          }`
        );
        return null;
      }
      break;
    }

    snaps.push(await captureSnap(cam));
    if (i < plan.count - 1) {
      await new Promise((r) => setTimeout(r, plan.gapMs));
    }
  }

  if (snaps.length === 0) {
    log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (kein Snap)`);
    return null;
  }

  // Plate-OCR spät→früh: Auto oft näher. Mit Dump alle Frames; sonst Early-Stop.
  const dumpRoot = vehicleDumpDir();
  const scores: Array<{ index: number; score: PlateScore }> = [];
  let bestIdx: number | null = null;
  let bestScore: PlateScore | null = null;

  log(
    `Fahrzeug-Burst ${cam.config.name}: Plate-OCR auf ${snaps.length} Frames (spät→früh${dumpRoot ? ", voller Dump" : ""}) …`
  );
  for (let i = snaps.length - 1; i >= 0; i--) {
    const score = await scorePlateFromJpeg(snaps[i]);
    scores.push({ index: i, score });
    const rank =
      (score.plate ? score.confidence : 0) + (score.viaWhitelist ? 0.25 : 0);
    const bestRank = bestScore
      ? (bestScore.plate ? bestScore.confidence : 0) + (bestScore.viaWhitelist ? 0.25 : 0)
      : -1;
    if (score.plate && rank > bestRank) {
      bestIdx = i;
      bestScore = score;
      log(
        `Fahrzeug-Burst ${cam.config.name}: Frame ${i + 1}/${snaps.length} → ${score.plate} conf=${score.confidence.toFixed(2)}${score.viaWhitelist ? " WL" : ""}`
      );
      if (
        !dumpRoot &&
        (score.confidence >= PLATE_EARLY_STOP_CONF || score.viaWhitelist)
      ) {
        break;
      }
    } else {
      log(
        `Fahrzeug-Burst ${cam.config.name}: Frame ${i + 1}/${snaps.length} → ${score.candidates[0]?.plate ?? "—"} (${score.confidence.toFixed(2)})`
      );
    }
  }

  scores.sort((a, b) => a.index - b.index);

  let buf: Buffer | null = bestIdx != null ? snaps[bestIdx] : null;
  let plate = bestScore?.plate ?? null;

  // Fallback ohne Plate: Vision „Fahrzeug?“ (spät→früh) oder letzter Frame.
  if (!buf) {
    const mode = vehicleVisionMode();
    if (mode === "never") {
      buf = snaps[snaps.length - 1];
      bestIdx = snaps.length - 1;
      log(
        `Fahrzeug-Burst ${cam.config.name}: kein Plate – letzter Frame ${snaps.length}/${snaps.length}`
      );
    } else {
      for (let i = snaps.length - 1; i >= 0; i--) {
        const ok = await jpegContainsVehicle(snaps[i], { quick: true });
        if (ok === true) {
          buf = snaps[i];
          bestIdx = i;
          log(
            `Fahrzeug-Burst ${cam.config.name}: kein Plate – Vision YES Frame ${i + 1}/${snaps.length}`
          );
          break;
        }
      }
      if (!buf) {
        if (dumpRoot) {
          const dir = path.join(dumpRoot, burstFolderName(cam.config.name));
          await dumpVehicleBurst(dir, snaps, scores, null, cam.config.name);
        }
        log(
          `Fahrzeug-Snapshot ${cam.config.name}: übersprungen (kein Plate/Fahrzeug in ${snaps.length} Frames)`
        );
        // Auch Skips throtteln – sonst Dauerschleife bei statischen Fehlalarmen.
        cam.lastSnapshotAt = Date.now();
        return null;
      }
    }
  }

  // Reolink-LPR nur wenn OCR nichts fand.
  if (!plate) {
    plate = await tryReadPlate(cam);
  }

  if (dumpRoot) {
    const dir = path.join(dumpRoot, burstFolderName(cam.config.name));
    await dumpVehicleBurst(dir, snaps, scores, bestIdx, cam.config.name);
  }

  const qs = new URLSearchParams({ cameraId: String(cameraId) });
  if (plate) {
    qs.set("plate", plate);
    log(`Fahrzeug-Snapshot ${cam.config.name}: Kennzeichen ${plate} (Frame ${(bestIdx ?? 0) + 1})`);
  } else {
    log(`Fahrzeug-Snapshot ${cam.config.name}: kein Kennzeichen – manuelles Mapping`);
  }

  const upload = await api(`/api/hub/vehicle-sightings?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) {
    const errText = await upload.text().catch(() => "");
    throw new Error(
      `Fahrzeug-Snapshot fehlgeschlagen: HTTP ${upload.status} ${errText.slice(0, 120)}`
    );
  }
  log(`Fahrzeug-Snapshot ${cam.config.name}: Upload OK (${buf.length} bytes)`);
  cam.lastSnapshotAt = Date.now();
  return { bytes: buf.length };
}

/* ---------------------------------------------------------------------------
 * Kamera-Steuerung (Kontrollzentrum): PTZ, Scheinwerfer, IR, Sirene, Presets.
 * Wird ueber Hub-Tasks aus der Cloud angestossen (tasks.ts).
 * ------------------------------------------------------------------------- */

const PTZ_OPS = new Set([
  "Left", "Right", "Up", "Down",
  "LeftUp", "LeftDown", "RightUp", "RightDown",
  "ZoomInc", "ZoomDec", "FocusInc", "FocusDec",
  "Stop", "Auto", "ToPos", "SetPos",
]);

/** Richtungs-/Zoom-Ops, die ohne Stop endlos weiterlaufen wuerden. */
const PTZ_CONTINUOUS_OPS = new Set([
  "Left", "Right", "Up", "Down",
  "LeftUp", "LeftDown", "RightUp", "RightDown",
  "ZoomInc", "ZoomDec", "FocusInc", "FocusDec",
]);

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function getControlCam(cameraId: number): Promise<CameraRuntime> {
  if (!cameras.has(cameraId)) {
    // Task kann vor dem ersten Kamera-Poll eintreffen.
    await refreshConfigs();
  }
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);
  return cam;
}

/**
 * PTZ-Steuerung. Bei Richtungs-/Zoom-Ops wird nach `durationMs`
 * (Default 800 ms, max 5 s) automatisch gestoppt, damit die Kamera bei
 * Task-Latenz nicht endlos weiterfaehrt.
 */
export async function ptzControl(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<unknown> {
  const cam = await getControlCam(cameraId);
  const op = String(payload?.op ?? "");
  if (!PTZ_OPS.has(op)) throw new Error(`Ungültige PTZ-Operation: ${op || "—"}`);

  const speed = clamp(Number(payload?.speed) || 32, 1, 64);
  const param: Record<string, unknown> = { channel: cam.config.channel, op, speed };
  if (op === "ToPos" || op === "SetPos") {
    const presetId = Number(payload?.presetId);
    if (!Number.isInteger(presetId)) throw new Error("presetId fehlt für ToPos/SetPos");
    param.id = presetId;
  }

  await ensureLogin(cam);
  await cgi(cam, "PtzCtrl", param);

  if (PTZ_CONTINUOUS_OPS.has(op)) {
    const durationMs = clamp(Number(payload?.durationMs) || 800, 100, 5000);
    await new Promise((r) => setTimeout(r, durationMs));
    await cgi(cam, "PtzCtrl", { channel: cam.config.channel, op: "Stop", speed });
    return { op, speed, durationMs, stopped: true };
  }
  return { op, speed };
}

/** Weisslicht-Scheinwerfer an/aus (manueller Modus). */
export async function setSpotlight(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<unknown> {
  const cam = await getControlCam(cameraId);
  const on = payload?.on === true;
  const brightness = clamp(Number(payload?.brightness) || 100, 1, 100);
  await ensureLogin(cam);
  await cgi(cam, "SetWhiteLed", {
    WhiteLed: { channel: cam.config.channel, state: on ? 1 : 0, mode: 1, bright: brightness },
  });
  return { on, brightness };
}

/** Infrarot-LEDs: Auto | On | Off. */
export async function setIrLights(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<unknown> {
  const cam = await getControlCam(cameraId);
  const state = String(payload?.state ?? "");
  if (!["Auto", "On", "Off"].includes(state)) {
    throw new Error(`Ungültiger IR-Zustand: ${state || "—"} (Auto|On|Off)`);
  }
  await ensureLogin(cam);
  await cgi(cam, "SetIrLights", { IrLights: { channel: cam.config.channel, state } });
  return { state };
}

/** Sirene manuell ausloesen/stoppen (AudioAlarmPlay). */
export async function setSiren(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<unknown> {
  const cam = await getControlCam(cameraId);
  const on = payload?.on === true;
  await ensureLogin(cam);
  await cgi(cam, "AudioAlarmPlay", {
    alarm_mode: "manul",
    manual_switch: on ? 1 : 0,
    times: 1,
    channel: cam.config.channel,
  });
  return { on };
}

/** Gespeicherte PTZ-Presets der Kamera auslesen. */
export async function getPtzPresets(cameraId: number): Promise<unknown> {
  const cam = await getControlCam(cameraId);
  await ensureLogin(cam);
  const value = await cgi(cam, "GetPtzPreset", { channel: cam.config.channel });
  const presets = (value.PtzPreset as Array<{ id: number; name: string; enable?: number }> | undefined) ?? [];
  return {
    presets: presets
      .filter((p) => p.enable !== 0 && typeof p.name === "string" && p.name.trim() !== "")
      .map((p) => ({ id: p.id, name: p.name })),
  };
}

async function refreshConfigs(): Promise<void> {
  const res = await api("/api/hub/cameras");
  if (!res.ok) throw new Error(`Kamera-Konfig-Abruf fehlgeschlagen: HTTP ${res.status}`);
  const all = (await res.json()) as CameraConfig[];

  // DoorBirds laufen über ihr eigenes Modul (Event-Push statt Polling).
  syncDoorbirds(all.filter((c) => c.kind === "DOORBIRD"));
  const configs = all.filter((c) => c.kind !== "DOORBIRD");

  const ids = new Set(configs.map((c) => c.id));
  for (const id of cameras.keys()) {
    if (!ids.has(id)) cameras.delete(id);
  }
  for (const config of configs) {
    const existing = cameras.get(config.id);
    if (existing) {
      // Bei geaenderten Zugangsdaten/Adresse Token verwerfen.
      const changed = JSON.stringify(existing.config) !== JSON.stringify(config);
      existing.config = config;
      if (changed) {
        existing.token = null;
        existing.tokenExpiresAt = 0;
      }
    } else {
      cameras.set(config.id, {
        config,
        token: null,
        tokenExpiresAt: 0,
        states: {},
        lastSnapshotAt: 0,
        unreachableLogged: false,
      });
    }
  }
  configLoadedAt = Date.now();
}

let pollBusy = false;

/** Haupt-Loop: Konfiguration aktuell halten, Zustaende pollen, Events melden. */
export async function pollCameras(): Promise<void> {
  if (pollBusy) return;
  pollBusy = true;
  try {
    if (Date.now() - configLoadedAt > CONFIG_REFRESH_MS) {
      await refreshConfigs();
    }
    if (cameras.size === 0) {
      STATE.cameras = { lastPollAt: new Date().toISOString(), configured: 0, reachable: 0, openEvents: 0, error: null };
      return;
    }

    const events: {
      cameraId: number;
      type: string;
      phase: "start" | "end";
      at: string;
      plate?: string;
    }[] = [];
    const seen: number[] = [];
    const now = new Date().toISOString();
    const snapshotJobs: number[] = [];
    const personSnapshotJobs: number[] = [];
    const vehicleSnapshotJobs: number[] = [];

    for (const cam of cameras.values()) {
      try {
        const states = await pollStates(cam);
        seen.push(cam.config.id);
        cam.unreachableLogged = false;

        for (const [type, active] of Object.entries(states)) {
          const was = cam.states[type] ?? false;
          if (active && !was) {
            events.push({
              cameraId: cam.config.id,
              type,
              phase: "start",
              at: now,
            });
            if (Date.now() - cam.lastSnapshotAt > EVENT_SNAPSHOT_THROTTLE_MS) {
              if (type === "PERSON") personSnapshotJobs.push(cam.config.id);
              else if (type === "VEHICLE") vehicleSnapshotJobs.push(cam.config.id);
              else snapshotJobs.push(cam.config.id);
            }
          } else if (!active && was) {
            events.push({ cameraId: cam.config.id, type, phase: "end", at: now });
          }
          cam.states[type] = active;
        }
      } catch (e) {
        if (!cam.unreachableLogged) {
          log(`Kamera ${cam.config.name}: ${e instanceof Error ? e.message : e}`);
          cam.unreachableLogged = true;
        }
      }
    }

    if (events.length > 0 || seen.length > 0) {
      const res = await api("/api/hub/camera-events", {
        method: "POST",
        body: JSON.stringify({ events, seen }),
      });
      if (!res.ok) log(`Kamera-Event-Upload fehlgeschlagen: HTTP ${res.status}`);
      for (const e of events) {
        const cam = cameras.get(e.cameraId);
        log(`Kamera ${cam?.config.name ?? e.cameraId}: ${e.type} ${e.phase === "start" ? "erkannt" : "beendet"}`);
      }
    }

    for (const cameraId of [...new Set(personSnapshotJobs)]) {
      uploadPersonSnapshot(cameraId).catch((e) =>
        log(`Personen-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }

    for (const cameraId of [...new Set(vehicleSnapshotJobs)]) {
      uploadVehicleSnapshot(cameraId).catch((e) =>
        log(`Fahrzeug-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }

    for (const cameraId of [...new Set(snapshotJobs)]) {
      if (personSnapshotJobs.includes(cameraId) || vehicleSnapshotJobs.includes(cameraId)) continue;
      uploadSnapshot(cameraId).catch((e) =>
        log(`Auto-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }

    const openEvents = [...cameras.values()].reduce(
      (sum, c) => sum + Object.values(c.states).filter(Boolean).length,
      0
    );
    STATE.cameras = {
      lastPollAt: new Date().toISOString(),
      configured: cameras.size,
      reachable: seen.length,
      openEvents,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    STATE.cameras = {
      lastPollAt: new Date().toISOString(),
      configured: cameras.size,
      reachable: 0,
      openEvents: 0,
      error: msg,
    };
    log(`Kamera-Poll-Fehler: ${msg}`);
  } finally {
    pollBusy = false;
  }
}

export const CAMERA_POLL_INTERVAL_MS = (() => {
  const n = Number(process.env.HUB_CAMERA_POLL_INTERVAL);
  return (Number.isFinite(n) && n >= 2 ? n : 5) * 1000;
})();
