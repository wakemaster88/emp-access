/**
 * Halteverbot: Fahrzeuge finden, die in einer gesperrten Fläche stehen
 * bleiben – am Eingang der Schotterstreifen rechts neben der Straße.
 *
 * Kurzes Halten ist erlaubt, Stehenbleiben nicht. Der Unterschied ist allein
 * die Zeit, und genau die fehlt der übrigen Erkennung: `vision.ts` bewertet
 * Einzelbilder ohne Gedächtnis, und der Zonenzähler im Tracker weiß nur, wie
 * viele Fahrzeuge gerade in einer Fläche sind, nicht seit wann.
 *
 * Darum hier ein eigener Takt: alle paar Sekunden ein Schnappschuss, die
 * Fahrzeug-Boxen über die Zeit wiedererkennen und mitzählen, wie lange
 * dieselbe Box an derselben Stelle liegt. Ein stehendes Auto ist dafür der
 * einfachste Fall – es bewegt sich nicht, die Boxen sind fast deckungsgleich.
 * Deshalb genügt die Überdeckung zweier Boxen; ein dauerhafter RTSP-Stream mit
 * Objektverfolgung wäre für stehende Fahrzeuge unnötiger Aufwand.
 *
 * Geprüft wird der Radaufstandspunkt (Mitte der Box-Unterkante), nicht der
 * Mittelpunkt: Ein hoher Transporter neben der Fläche würde mit seinem
 * Mittelpunkt hineinragen, steht aber mit den Rädern daneben.
 */
import { api, log } from "./config.js";
import {
  announceOnCamera,
  captureSnapshot,
  findCameraByRef,
  listCameraConfigs,
  type CameraConfig,
} from "./cameras.js";
import { improve } from "./improve-log.js";
import { recordHubEvent } from "./state.js";
import { DISPLAY_SNAPSHOT_MAX_PX, shrinkJpeg } from "./image.js";
import { detectVehicles, inside, type VehicleBox } from "./vision.js";

/** COCO-Klassen: 2 Auto, 3 Motorrad, 5 Bus, 7 Lastwagen. */
const VEHICLE_CLASSES = new Set([2, 3, 5, 7]);

/**
 * Mindestgröße einer Box, Anteil an der Bildfläche. Deutlich kleiner als
 * HUB_VEHICLE_MIN_AREA (2 %, gedacht für Autos direkt an der Einfahrt): Auf
 * dem Schotter am Eingang belegt ein Pkw rund 1,4 %, die Autos auf dem
 * Parkplatz im Hintergrund nur 0,1–0,3 %. Dazwischen liegt diese Schwelle.
 */
const DEFAULT_MIN_AREA = 0.005;
const DEFAULT_MIN_CONF = 0.35;
/** Zwei Boxen gelten als dasselbe Fahrzeug ab dieser Überdeckung. */
const SAME_VEHICLE_IOU = 0.4;
/** Doppelerkennung: YOLO meldet denselben Transporter gern als Auto und Lastwagen. */
const DUPLICATE_IOU = 0.6;
/**
 * Aussetzer überbrücken: Ein Fahrzeug kann kurz verdeckt sein (Passant,
 * Lieferwagen davor) oder in einem Bild übersehen werden. Erst nach so vielen
 * Durchläufen ohne Treffer gilt es als weggefahren.
 */
const MAX_MISSES = 3;

function numEnv(key: string, fallback: number, min = 0): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const CONF = {
  /**
   * Kameras als Cloud-ID oder Name, mehrere per Komma. Nur noch Notausgang:
   * Normalerweise kommt die Auswahl über `noParkDetection` aus der Cloud.
   */
  cameras: (process.env.HUB_NOPARK_CAMERAS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Ab dieser Standzeit gilt es als Falschparker. */
  minutes: numEnv("HUB_NOPARK_MINUTES", 2, 0.25),
  /** Takt der Schnappschüsse. */
  intervalSec: numEnv("HUB_NOPARK_INTERVAL", 20, 5),
  minArea: numEnv("HUB_NOPARK_MIN_AREA", DEFAULT_MIN_AREA),
  minConf: numEnv("HUB_NOPARK_MIN_CONF", DEFAULT_MIN_CONF),
  /** Erneut melden, wenn dasselbe Fahrzeug weiter steht (0 = nur einmal). */
  repeatMinutes: numEnv("HUB_NOPARK_REPEAT_MINUTES", 10),
  /** Ansage über den Kamera-Lautsprecher. */
  speak: process.env.HUB_NOPARK_SPEAK !== "0",
  text:
    process.env.HUB_NOPARK_TEXT ||
    "Achtung. Sie parken im Halteverbot. Bitte entfernen Sie Ihr Fahrzeug.",
  /** Nur in diesem Zeitfenster ansagen (Stunden, lokale Zeit) – nachts still. */
  speakFrom: numEnv("HUB_NOPARK_SPEAK_FROM", 8, 0),
  speakTo: numEnv("HUB_NOPARK_SPEAK_TO", 22, 0),
};

export const NOPARK_INTERVAL_MS = CONF.intervalSec * 1000;

/* ---------------------------------------------------------------------------
 * Zone
 * ------------------------------------------------------------------------- */

type Point = { x: number; y: number };

/** Polygon aus der Umgebung: "x,y;x,y;…" mit Werten 0..1. */
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

/**
 * Fläche der Kamera. Die Cloud-Einstellung gewinnt, damit sie im Dashboard
 * gezogen werden kann; die Umgebung bleibt als Notausgang.
 */
function zoneFor(cam: CameraConfig): Point[] | null {
  const fromCloud = cam.noParkZone;
  if (Array.isArray(fromCloud) && fromCloud.length >= 3) {
    return fromCloud.map(([x, y]) => ({ x, y }));
  }
  return (
    parseZone(process.env[`HUB_NOPARK_ZONE_${cam.id}`]) ??
    parseZone(process.env.HUB_NOPARK_ZONE)
  );
}

/** Standzeit bis zur Meldung: Cloud-Einstellung, sonst HUB_NOPARK_MINUTES. */
function minutesFor(cam: CameraConfig): number {
  const fromCloud = cam.noParkMinutes;
  return typeof fromCloud === "number" && fromCloud >= 0.25 ? fromCloud : CONF.minutes;
}

/**
 * Kameras für diesen Durchlauf: alle mit „Halteverbot“ aus der Cloud, dazu die
 * per Umgebung benannten. Die Cloud-Liste ist erst nach dem ersten Abgleich
 * gefüllt – deshalb wird sie in jedem Durchlauf neu gelesen.
 */
function camerasToCheck(): CameraConfig[] {
  const out = new Map<number, CameraConfig>();
  for (const cam of listCameraConfigs()) {
    if (cam.noParkDetection) out.set(cam.id, cam);
  }
  for (const ref of CONF.cameras) {
    const cam = findCameraByRef(ref);
    if (cam) out.set(cam.id, cam);
    else log(`Halteverbot: Kamera "${ref}" nicht gefunden (HUB_NOPARK_CAMERAS prüfen)`);
  }
  return [...out.values()];
}

/* ---------------------------------------------------------------------------
 * Boxen vergleichen
 * ------------------------------------------------------------------------- */

/** Überdeckung zweier Boxen (Schnittfläche durch Vereinigung). */
function overlap(a: VehicleBox, b: VehicleBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const shared = (x2 - x1) * (y2 - y1);
  const union = a.w * a.h + b.w * b.h - shared;
  return union > 0 ? shared / union : 0;
}

/** Radaufstandspunkt: Mitte der Unterkante. */
function footPoint(b: VehicleBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h };
}

/** Boxen in der Fläche, groß genug, ohne Doppelerkennungen. */
function relevantBoxes(boxes: VehicleBox[], zone: Point[]): VehicleBox[] {
  const candidates = boxes
    .filter(
      (b) =>
        VEHICLE_CLASSES.has(b.cls) &&
        b.conf >= CONF.minConf &&
        b.w * b.h >= CONF.minArea &&
        inside(footPoint(b), zone),
    )
    .sort((a, b) => b.conf - a.conf);

  const kept: VehicleBox[] = [];
  for (const box of candidates) {
    if (!kept.some((k) => overlap(k, box) >= DUPLICATE_IOU)) kept.push(box);
  }
  return kept;
}

/* ---------------------------------------------------------------------------
 * Was gerade steht
 * ------------------------------------------------------------------------- */

interface Standing {
  box: VehicleBox;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Durchläufe ohne Treffer – nach MAX_MISSES ist das Fahrzeug weg. */
  misses: number;
  /** Wann zuletzt gemeldet (0 = noch nie). */
  reportedAt: number;
}

interface CameraState {
  standing: Standing[];
  lastRunAt: number;
  lastError: string | null;
}

const states = new Map<number, CameraState>();

/** Stand des Moduls für das lokale Dashboard. */
export interface NoParkingStatus {
  cameraId: number;
  cameraName: string;
  /** Fahrzeuge in der Fläche mit ihrer Standzeit in Sekunden. */
  standing: { seconds: number; reported: boolean }[];
  lastRunAt: string | null;
  lastError: string | null;
}

export function listNoParkingStatus(): NoParkingStatus[] {
  const out: NoParkingStatus[] = [];
  const now = Date.now();
  for (const [cameraId, state] of states) {
    const cam = findCameraByRef(String(cameraId));
    out.push({
      cameraId,
      cameraName: cam?.name ?? `Kamera ${cameraId}`,
      standing: state.standing
        .filter((s) => s.misses === 0)
        .map((s) => ({
          seconds: Math.round((now - s.firstSeenAt) / 1000),
          reported: s.reportedAt > 0,
        })),
      lastRunAt: state.lastRunAt ? new Date(state.lastRunAt).toISOString() : null,
      lastError: state.lastError,
    });
  }
  return out;
}

/**
 * Aktuelle Boxen den bekannten Fahrzeugen zuordnen.
 * Rückgabe: die Fahrzeuge, deren Standzeit gerade die Schwelle reißt.
 */
function track(
  state: CameraState,
  boxes: VehicleBox[],
  now: number,
  minutes: number,
): Standing[] {
  const unmatched = [...boxes];
  for (const known of state.standing) {
    let bestIdx = -1;
    let bestScore = SAME_VEHICLE_IOU;
    for (let i = 0; i < unmatched.length; i++) {
      const score = overlap(known.box, unmatched[i]);
      if (score >= bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      // Box nachziehen: Perspektive und Licht lassen sie leicht wandern.
      known.box = unmatched[bestIdx];
      known.lastSeenAt = now;
      known.misses = 0;
      unmatched.splice(bestIdx, 1);
    } else {
      known.misses++;
    }
  }

  // Wer zu lange fehlt, ist weggefahren.
  state.standing = state.standing.filter((s) => s.misses <= MAX_MISSES);

  for (const box of unmatched) {
    state.standing.push({ box, firstSeenAt: now, lastSeenAt: now, misses: 0, reportedAt: 0 });
  }

  const thresholdMs = minutes * 60_000;
  const repeatMs = CONF.repeatMinutes * 60_000;
  return state.standing.filter((s) => {
    if (s.misses > 0) return false;
    if (now - s.firstSeenAt < thresholdMs) return false;
    if (s.reportedAt === 0) return true;
    return CONF.repeatMinutes > 0 && now - s.reportedAt >= repeatMs;
  });
}

/* ---------------------------------------------------------------------------
 * Melden
 * ------------------------------------------------------------------------- */

function withinSpeakWindow(now: Date): boolean {
  const { speakFrom, speakTo } = CONF;
  if (speakFrom === speakTo) return true;
  const hour = now.getHours() + now.getMinutes() / 60;
  // Über Mitternacht hinweg (z. B. 22–6) ist das Fenster umgedreht.
  return speakFrom < speakTo
    ? hour >= speakFrom && hour < speakTo
    : hour >= speakFrom || hour < speakTo;
}

function standingLabel(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

async function report(
  cameraId: number,
  cameraName: string,
  jpeg: Buffer,
  hits: Standing[],
  now: number,
): Promise<void> {
  const longest = hits.reduce((max, s) => Math.max(max, now - s.firstSeenAt), 0) / 1000;
  const detail = `${hits.length === 1 ? "Ein Fahrzeug" : `${hits.length} Fahrzeuge`} seit ${standingLabel(longest)}`;

  log(`Halteverbot ${cameraName}: ${detail}`);
  improve("noparking", "alert", {
    cam: cameraName,
    vehicles: hits.length,
    seconds: Math.round(longest),
  });
  recordHubEvent({
    kind: "vehicle",
    severity: "alert",
    where: cameraName,
    title: "Falschparker im Halteverbot",
    detail,
  });

  // Ansage und Cloud-Meldung laufen unabhängig: Fällt das Internet aus, soll
  // der Lautsprecher trotzdem sprechen – und umgekehrt.
  const tasks: Promise<unknown>[] = [];

  if (CONF.speak && withinSpeakWindow(new Date(now))) {
    tasks.push(
      announceOnCamera(cameraId, CONF.text).catch(() => {
        // Fehlermeldung kommt bereits aus camera-talk.ts.
      }),
    );
  }

  const small = await shrinkJpeg(jpeg, DISPLAY_SNAPSHOT_MAX_PX);
  const query = `cameraId=${cameraId}&vehicles=${hits.length}&seconds=${Math.round(longest)}`;
  tasks.push(
    api(`/api/hub/parking-violations?${query}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(small),
    })
      .then((res) => {
        if (!res.ok) log(`Halteverbot-Meldung fehlgeschlagen: HTTP ${res.status}`);
      })
      .catch((err) =>
        log(`Halteverbot-Meldung fehlgeschlagen: ${err instanceof Error ? err.message : err}`),
      ),
  );

  await Promise.all(tasks);
  for (const hit of hits) hit.reportedAt = now;
}

/* ---------------------------------------------------------------------------
 * Takt
 * ------------------------------------------------------------------------- */

async function checkCamera(cam: CameraConfig): Promise<void> {
  const zone = zoneFor(cam);
  if (!zone) {
    // Ohne Fläche gibt es nichts zu prüfen. Nur einmal melden, sonst füllt das
    // im 20-Sekunden-Takt das Protokoll.
    if (!missingZoneWarned.has(cam.id)) {
      missingZoneWarned.add(cam.id);
      log(`Halteverbot ${cam.name}: keine Fläche gesetzt – im Dashboard einzeichnen`);
    }
    return;
  }
  missingZoneWarned.delete(cam.id);

  let state = states.get(cam.id);
  if (!state) {
    state = { standing: [], lastRunAt: 0, lastError: null };
    states.set(cam.id, state);
  }

  try {
    const jpeg = await captureSnapshot(cam.id);
    const boxes = await detectVehicles(jpeg, { label: cam.name });
    state.lastRunAt = Date.now();
    if (boxes === null) {
      // Tracker weg: Zustand behalten, sonst beginnt jede Standzeit von neuem.
      state.lastError = "Tracker nicht erreichbar";
      improve("noparking", "skip_tracker", { cam: cam.name });
      return;
    }
    state.lastError = null;

    const relevant = relevantBoxes(boxes, zone);
    const now = state.lastRunAt;
    const hits = track(state, relevant, now, minutesFor(cam));
    if (hits.length > 0) {
      await report(cam.id, cam.name, jpeg, hits, now);
    } else {
      improve("noparking", relevant.length > 0 ? "waiting" : "clear", {
        cam: cam.name,
        inZone: relevant.length,
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    state.lastError = detail;
    log(`Halteverbot ${cam.name}: ${detail}`);
    improve("noparking", "fail", { cam: cam.name, error: detail });
  }
}

let running = false;
/** Kameras ohne Fläche: einmal warnen, nicht in jedem Durchlauf. */
const missingZoneWarned = new Set<number>();
/** Zuletzt geprüfte Kameras – für die Meldung, wenn sich die Auswahl ändert. */
let lastActive = "";

/** Ein Durchlauf über alle Kameras mit Halteverbot. */
export async function checkNoParking(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cams = camerasToCheck();
    const active = cams.map((c) => c.name).join(", ");
    if (active !== lastActive) {
      lastActive = active;
      log(active ? `Halteverbot prüft: ${active}` : "Halteverbot: keine Kamera ausgewählt");
    }
    for (const cam of cams) {
      await checkCamera(cam);
    }
    // Zustände von Kameras aufräumen, für die das Halteverbot abgeschaltet wurde.
    const ids = new Set(cams.map((c) => c.id));
    for (const id of states.keys()) {
      if (!ids.has(id)) states.delete(id);
    }
  } finally {
    running = false;
  }
}

/** Einstellungen in einer Zeile – fürs Startprotokoll. */
export function noParkingConfigSummary(): string {
  return (
    `Takt=${CONF.intervalSec} s Schwelle=${CONF.minutes} min (sofern nicht je Kamera gesetzt) ` +
    `Ansage=${CONF.speak ? `${CONF.speakFrom}–${CONF.speakTo} Uhr` : "aus"}`
  );
}
