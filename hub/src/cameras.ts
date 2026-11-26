/**
 * Kamera-Modul: spricht Reolink-Kameras ueber die lokale CGI-HTTP-API an
 * (POST /cgi-bin/api.cgi). Pollt Bewegungs-/KI-Zustaende (GetMdState/
 * GetAiState), meldet Start/Ende der Ereignisse an die Cloud und laedt
 * Schnappschuesse hoch (bei Ereignis-Beginn und auf Task-Anforderung).
 */
import { noteLink } from "./health-trends.js";
import { zoomStep } from "./zoom-step.js";
import { clockOffsetSeconds, type ReolinkTime } from "./camera-clock.js";
import { noteCameraActivity, noteTriggeredRules, onCameraEvent } from "./rules.js";
import { kickTaskPoll } from "./task-kick.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { writeFileAtomic } from "./atomic-file.js";
import {
  SCENE_RETURN_RETRY_MS,
  dueSceneReturns,
  parseSceneReturns,
  sceneReturnCamera,
  sceneReturnsToSave,
  type SavedSceneReturn,
} from "./scene-return-rules.js";
import { STATE, recordHubEvent } from "./state.js";
import { appliedScore, embedJpeg, embeddingHeader, noteOtherWay, scoreGallery, refreshGallery, type FaceEmbedResult } from "./face.js";
import {
  bestShot,
  faceLabel,
  faceQuality,
  fuseEmbeddings,
  fuseOther,
  galleryMargin,
  rememberSighting,
  shouldStoreSighting,
  sightingQualityNote,
  sightingQualityParams,
  type FaceShot,
  type SightingCandidate,
  type SightingUpload,
} from "./face-rules.js";
import { detectPersons, faceViaZoom } from "./person-crop.js";
import { CameraMotion, type CloseUp, type MotionDriver, type PersistedMove } from "./camera-motion.js";
import { HAND_HANDOVER_MAX_MS, RULE_HOLD_MS, followAlwaysOn, isZoneCamera, readTrackingCfg } from "./camera-motion-rules.js";
import { cameraRoomClosed, sentinelNightWindow } from "./camera-room.js";
import { berlinHour } from "./agent/quiet.js";
import { findAllowedVehicle, plateAutoMinConf, scorePlateFromJpeg, type PlateScore } from "./plate.js";
import { checkVehicle } from "./vision.js";
import { KNOWN_CITY, normalizePlate } from "./plate-match.js";
import { UMLAUT_CITY_BY_PLAIN } from "./plate-cities.js";
import {
  burstConsensus,
  burstDoneReason,
  burstEndText,
  burstStep,
  consensusChange,
  firstFound,
  frameShowsPlate,
  pickFallbackFrame,
  sightingImageTooLarge,
  singleReadWeak,
  type BurstEnd,
  type FrameRead,
} from "./vehicle-burst-rules.js";
import { speakOnCamera } from "./camera-talk.js";
import { syncDoorbirds } from "./doorbird.js";
import { actuateIfAllowed } from "./vehicle-actuate.js";
import { checkDelivery, type DeliveryResult } from "./delivery.js";
import { findIpByMac, macForIp, normalizeMac } from "./netmap.js";
import { lastScanResult } from "./scanner.js";
import { syncLocalStreamsFromCloud, updateLocalStreams } from "./streams.js";
import { improve, improveCount } from "./improve-log.js";
import { sentinelVouch } from "./sentinel-vouch.js";
import { cloudQuietOn, vouchParam } from "./agent/sentinel-cover-rules.js";
import { getForecast, lastForecast } from "./weather.js";
import {
  isDark,
  lightDecision,
  lightMarkStep,
  lightMinFrames,
  lightMuteDue,
  lightSkipLogged,
  lightSkipText,
  type LightFacts,
  type LightSkipReason,
} from "./vehicle-light-rules.js";
import { ledModeNote, spotlightCommand, spotlightLegacy, type SpotlightCommand } from "./spotlight-rules.js";
import { debounceEvents, endAll, newDebounceState, runningOf, type DebounceState } from "./event-debounce.js";
import { previousAliveAt } from "./alive-mark.js";
import {
  CameraLease,
  EventGates,
  RunningReport,
  START_MAX_AGE_MS,
  UnconfirmedStarts,
  aiAlarmState,
  clockDriftKey,
  configRefreshPlan,
  endHoldFor,
  endsToRetry,
  failStreakAfter,
  motionSnapshotMinMs,
  personOrVehicleActive,
  pollDue,
  pollOrder,
  relocateAtStart,
  relocateByLoginAllowed,
  relocateIntervalMs,
  snapshotPlan,
  tidyOutbox,
  type SnapshotPlan,
} from "./camera-poll-rules.js";
import {
  nextLastActiveAt,
  pipelineShouldStop,
  sightingAction,
  sightingRepeatMode,
  sightingSurveillance,
  takeOpticalFace,
} from "./person-pipeline-rules.js";
import { ChangeLog } from "./change-log.js";
import { isExiting, onShutdown } from "./shutdown.js";
import { CameraMarks } from "./camera-marks.js";
import { BurstLights } from "./vehicle-light.js";
import { DISPLAY_SNAPSHOT, DISPLAY_SNAPSHOT_MAX_PX, MOTION_PREVIEW, PERSON_SNAPSHOT, shrinkJpeg } from "./image.js";

export interface CameraConfig {
  id: number;
  name: string;
  /** "REOLINK" (CGI-Polling, Default) | "DOORBIRD" (LAN-API, doorbird.ts). */
  kind?: string;
  host: string;
  /** MAC-Adresse (automatisch gelernt) fuer IP-Re-Mapping bei DHCP-Wechsel. */
  macAddress?: string | null;
  httpPort: number;
  https: boolean;
  username: string;
  password: string;
  channel: number;
  /** Fahrzeug-Erkennung auf dieser Kamera (Events + Burst + OCR). */
  vehicleDetection?: boolean;
  /** Mindestanteil der Bildfläche für eine Fahrzeug-Box (Cloud-Einstellung, null = HUB_VEHICLE_MIN_AREA). */
  vehicleMinArea?: number | null;
  /** Einfahrtszone [[x,y],…] normiert (Cloud-Einstellung, null = HUB_VEHICLE_ZONE_<id>). */
  vehicleZone?: [number, number][] | null;
  /** Halteverbot auf dieser Kamera prüfen (Cloud-Einstellung, noparking.ts). */
  noParkDetection?: boolean;
  /** Gesperrte Fläche [[x,y],…] normiert (Cloud-Einstellung, null = HUB_NOPARK_ZONE_<id>). */
  noParkZone?: [number, number][] | null;
  /** Standzeit in Minuten bis zur Meldung (Cloud-Einstellung, null = HUB_NOPARK_MINUTES). */
  noParkMinutes?: number | null;
  /** Lieferdienste: null = aus, "NOTIFY" = melden, "OPEN" = Tor öffnen (delivery.ts). */
  deliveryMode?: string | null;
  /** Öffnungsfenster "HH:mm" (null = 07:00–20:00). */
  deliveryFrom?: string | null;
  deliveryTo?: string | null;
  /** DoorBird: Tor offen halten bis (ISO), null = aus – Wiederaufnahme nach Neustart. */
  doorHoldUntil?: string | null;
  /**
   * Einstellung „Wächter“ (Cloud): null = wie der Raum, "NIGHT" = nur nachts,
   * "OFF" = aus. Fehlt bei einer älteren Cloud (sentinel-mode-rules.ts).
   */
  sentinelMode?: string | null;
}

/** Letzte Personen-Sichtung an einer Kamera (Dashboard „wer war wo“). */
export interface LastPerson {
  at: string;
  name: string | null;
  score: number | null;
  threshold: number;
  matched: boolean;
}

/** Letztes Kennzeichen an einer Kamera (Dashboard „was fuhr wo“). */
export interface LastPlate {
  at: string;
  plate: string | null;
  confidence: number | null;
  listed: boolean;
}

interface CameraRuntime {
  config: CameraConfig;
  token: string | null;
  tokenExpiresAt: number;
  /** Aktueller Alarm-Zustand pro Ereignistyp (fuer Flankenerkennung). */
  states: Record<string, boolean>;
  /** Letztes Bild einer Erkennungs-Pipeline (Person, Fahrzeug) – drosselt die naechste. */
  lastSnapshotAt: number;
  /** Letztes reines Anzeige-Bild (Bewegung, Tier, Abruf) – drosselt nur weitere Anzeige-Bilder. */
  lastAutoSnapshotAt: number;
  /** Seit dem Start ist ein Anzeige-Bild dieser Kamera in der Cloud angekommen (autoSnapshotDue). */
  autoSnapshotSent: boolean;
  /** Personen-/Fahrzeug-Pipeline läuft – keine zweite starten. */
  snapshotInFlight: boolean;
  /**
   * VEHICLE kam während einer Pipeline. Die Personen-Pipeline gibt die Kamera
   * dann nach dem laufenden Bild ab (CameraLease), ein laufender Burst zieht
   * den nächsten direkt nach.
   */
  pendingVehicle: boolean;
  /** Bis dahin kein Weißlicht beim Fahrzeug-Burst (Licht löst selbst Alarme aus). */
  spotlightMuteUntil?: number;
  unreachableLogged: boolean;
  /** Kamera beantwortet keine Batch-Requests – Einzelabfragen. */
  noBatch?: boolean;
  /** Entprellte Ereignisse (Cloud/Regeln/Lagebild), siehe event-debounce.ts. */
  debounce: DebounceState;
  /** Letzter MAC-Lernversuch (Throttle, erfolgreich erreichte Kamera). */
  lastMacLearnAt: number;
  /** Letzter IP-Re-Mapping-Versuch per MAC (Throttle bei Unerreichbarkeit). */
  lastRelocateAt: number;
  /** Suche nach neuer Adresse laeuft (kann laenger dauern als ihr Abstand). */
  relocating: boolean;
  /** Abfrage laeuft oder wartet auf einen Platz – keine zweite starten. */
  pollInFlight: boolean;
  /** Beginn der letzten Abfrage (0 = noch keine). */
  pollStartedAt: number;
  /** Lange Fehlversuche in Folge (0 = letzte Abfrage hat geantwortet oder scheiterte sofort); bestimmt die Reihenfolge im Takt. */
  failStreak: number;
  /** Seit wann nicht erreichbar (null = erreichbar oder noch nie gefragt); ueberlebt den Neustart (downMarks). */
  downSince: number | null;
  /* Nur fuer das lokale Dashboard – nicht Teil der Kamera-Logik. */
  reachable: boolean;
  lastError: string | null;
  lastEventAt: string | null;
  lastPerson: LastPerson | null;
  lastPlate: LastPlate | null;
}

export interface CameraStatus {
  id: number;
  name: string;
  host: string;
  kind: string;
  vehicleDetection: boolean;
  reachable: boolean;
  lastError: string | null;
  activeStates: string[];
  busy: boolean;
  pendingVehicle: boolean;
  lastSnapshotAt: string | null;
  lastEventAt: string | null;
  lastPerson: LastPerson | null;
  lastPlate: LastPlate | null;
  /** Faehigkeiten (null = noch nicht abgefragt). */
  caps: CameraCaps | null;
  /** Uhr der Kamera gegen den Hub (null = noch nicht gelesen). */
  clock: CameraClock | null;
}

export interface CameraClock {
  /** Sekunden, positiv = Kamera geht vor. */
  offsetS: number;
  /** NTP an der Kamera eingeschaltet; null = nicht lesbar. */
  ntp: boolean | null;
  ntpServer: string | null;
  checkedAt: string;
}

const cameras = new Map<number, CameraRuntime>();
let configLoadedAt = 0;

const CONFIG_REFRESH_MS = 60_000;
/** Nach einem gescheiterten Abruf der Kamera-Liste: naechster Versuch. */
const CONFIG_RETRY_MS = 15_000;
const CONFIG_FETCH_TIMEOUT_MS = 15_000;
let configFailedAt = 0;
let configRefresh: Promise<void> | null = null;
const configFailLog = new ChangeLog(10 * 60_000);
const TOKEN_SAFETY_MS = 60_000;
/** Bei Ereignis-Beginn hoechstens alle 30 s ein Auto-Snapshot pro Kamera. */
const EVENT_SNAPSHOT_THROTTLE_MS = 30_000;
/**
 * Reine Bewegung (MOTION, ANIMAL): Vorschaubild hoechstens alle 300 s je
 * Kamera (HUB_MOTION_SNAPSHOT_MIN_S, 0 = alle 30 s wie die uebrigen
 * Anzeige-Bilder), siehe autoSnapshotDue in camera-poll-rules.ts.
 */
const MOTION_SNAPSHOT_MIN_MS = motionSnapshotMinMs(process.env.HUB_MOTION_SNAPSHOT_MIN_S);
/** Ein gescheiterter Auto-Snapshot steht je Kamera und Grund hoechstens alle 5 min im Log. */
const autoSnapshotFailLog = new ChangeLog(5 * 60_000);
/** Ereignis endet erst nach so langer Ruhe (KI flackert), siehe event-debounce.ts. */
/** Zeit fuers Anfahren eines Presets, bevor „folgen“ eingeschaltet wird. */
const SCENE_SETTLE_MS = Number(process.env.HUB_CAMERA_SCENE_SETTLE_MS || 2_500);
const EVENT_END_HOLD_MS = Number(process.env.HUB_EVENT_END_HOLD_MS || 6_000);
/** Reine Bewegung (ohne KI) laeuft laenger nach, siehe endHoldFor(). */
const MOTION_END_HOLD_MS = Number(process.env.HUB_MOTION_END_HOLD_MS || 60_000);
const eventEndHold = (type: string) => endHoldFor(type, EVENT_END_HOLD_MS, MOTION_END_HOLD_MS);
/**
 * Personen: erstes Bild sofort, dann weitere Versuche im Abstand von
 * PERSON_SNAP_RETRY_MS, solange die Kamera die Person meldet (Gesicht oft
 * erst frontal). Wann das Signal als beendet gilt: pipelineShouldStop.
 */
const PERSON_SNAP_ATTEMPTS = 4;
const PERSON_SNAP_RETRY_MS = 1_200;
/**
 * Bestes Bild statt erstem Bild: Nach dem ersten Gesicht noch so viele
 * Bilder im Abstand von HUB_FACE_BEST_GAP_MS holen, das beste (gross,
 * frontal, scharf) behalten und die Merkmale aller Bilder derselben Person
 * mitteln. 0 = aus (wie bisher).
 */
const PERSON_BEST_EXTRA = Math.max(0, Math.min(5, Number(process.env.HUB_FACE_BEST_EXTRA ?? 2)));
const PERSON_BEST_GAP_MS = Number(process.env.HUB_FACE_BEST_GAP_MS || 400);
/**
 * Zeitlimit je Zusatzbild: Das erste Gesicht liegt dann schon vor, und die
 * Sichtung soll nicht auf ein Bild warten, das die Kamera nicht liefert.
 */
const PERSON_BEST_SNAP_TIMEOUT_MS = 5_000;
/**
 * Wiederholungen derselben Person an einer Kamera (shouldStoreSighting):
 * count (Standard) zaehlt nur, skip laedt sie nicht hoch, off wertet nicht aus.
 */
const SIGHTING_REPEAT = sightingRepeatMode(process.env.HUB_SIGHTING_REPEAT);
/** Uploads je Kamera der letzten 10 Minuten, nur im Arbeitsspeicher (nach einem Neustart leer). */
const recentSightings = new Map<number, SightingUpload[]>();
/**
 * Fahrzeuge: dichter Burst solange VEHICLE aktiv, lokal dumpen,
 * Plate-OCR wählt den besten Frame. Fallback: Vision „Fahrzeug?“.
 * Spam-Kameras: kürzer. Env: HUB_VEHICLE_BURST_*, HUB_VEHICLE_DUMP_DIR
 */
const VEHICLE_SNAP_DELAY_MS = 0;
/** Ab dieser OCR-Confidence gilt ein Frame als gut genug fürs Bild. Die Tür wartet darauf nicht. */
const PLATE_EARLY_STOP_CONF = Number(process.env.HUB_PLATE_EARLY_STOP_CONF || 0.85);
/** Nach VEHICLE-Ende noch ein paar Frames – Alarm flackert, Auto oft noch näher. */
const VEHICLE_GRACE_FRAMES = Number(process.env.HUB_VEHICLE_GRACE_FRAMES || 3);
/** Gleiches Kennzeichen an derselben Kamera innerhalb dieser Zeit nur einmal melden. */
const PLATE_REPEAT_MS = Number(process.env.HUB_PLATE_REPEAT_MS || 60_000);
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

function plateRank(score: PlateScore | null | undefined): number {
  if (!score?.plate) return -1;
  return score.confidence + (score.viaWhitelist ? 0.25 : 0);
}

/**
 * macOS Vision als zweite Kennzeichen-OCR im Burst. Standard aus: In 24 h
 * (19./20.11.2026) 16 Aufrufe, 0 Treffer, je 2–7,5 s Wartezeit vor dem
 * Upload. HUB_VEHICLE_PLATE_VISION=1 schaltet sie wieder ein.
 */
const VEHICLE_PLATE_VISION = process.env.HUB_VEHICLE_PLATE_VISION === "1";
/** Burst endet, wenn ein Kennzeichen auf so vielen Bildern übereinstimmt … */
const VEHICLE_CONFIRM_FRAMES = Number(process.env.HUB_VEHICLE_CONFIRM_FRAMES || 3);
/** … plus so viele Bilder danach (mit Lieferdienst-Prüfung ein paar mehr für die Seitenaufschrift). */
const VEHICLE_AFTER_PLATE_FRAMES = Number(process.env.HUB_VEHICLE_AFTER_PLATE_FRAMES || 2);
const VEHICLE_AFTER_PLATE_FRAMES_DELIVERY = Number(process.env.HUB_VEHICLE_AFTER_PLATE_FRAMES_DELIVERY || 4);
/** Nach einem Licht-Burst ohne Fahrzeug so lange kein Weißlicht (Licht-Schleife in der Dämmerung). */
const VEHICLE_LIGHT_MUTE_MS = Number(process.env.HUB_VEHICLE_SPOTLIGHT_MUTE_MS || 5 * 60_000);

function vehicleVisionMode(): "always" | "never" | "auto" {
  const mode = (process.env.HUB_VEHICLE_VISION || "auto").toLowerCase();
  if (mode === "always" || mode === "never") return mode;
  return "auto";
}

/** Lokaler Burst-Dump unter hub/.cache – nicht /tmp (fremder Owner → EACCES). */
function vehicleDumpDir(): string | null {
  if (process.env.HUB_VEHICLE_DUMP === "0" || process.env.HUB_VEHICLE_DUMP === "never") {
    return null;
  }
  return process.env.HUB_VEHICLE_DUMP_DIR || path.join(CONFIG.hubDir, ".cache", "veh-burst");
}

function burstFolderName(camName: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = camName.replace(/[^\w\-]+/g, "_").slice(0, 40);
  return `${ts}_${safe}`;
}

/** Alte Burst-Ordner löschen (Alter + Anzahl). */
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
  try {
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
  } catch (e) {
    log(
      `Fahrzeug-Burst Dump fehlgeschlagen (ignoriert): ${e instanceof Error ? e.message : e}`
    );
  }
}

function baseUrl(c: CameraConfig): string {
  return `${c.https ? "https" : "http"}://${c.host}:${c.httpPort}`;
}

/** CGI-Kommando ausfuehren; Reolink erwartet ein Array von Kommandos. */
async function cgi(
  cam: CameraRuntime,
  cmd: string,
  param: Record<string, unknown>,
  { withToken = true, retried = false }: { withToken?: boolean; retried?: boolean } = {}
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
    // Token abgelaufen oder Poll vor Login (Neustart) → einmal neu einloggen.
    if ((rsp === -6 || rsp === -1) && withToken && !retried && cmd !== "Login") {
      cam.token = null;
      cam.tokenExpiresAt = 0;
      await ensureLogin(cam);
      return cgi(cam, cmd, param, { withToken, retried: true });
    }
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

type CgiResult = {
  code: number;
  value?: Record<string, unknown>;
  error?: { rspCode?: number; detail?: string };
};

/**
 * Mehrere CGI-Kommandos in einem HTTP-Request (Reolink nimmt ein Array).
 * Liefert die Einzelergebnisse in derselben Reihenfolge; Token-Fehler
 * loesen wie bei cgi() genau einen Re-Login aus.
 */
async function cgiBatch(
  cam: CameraRuntime,
  cmds: Array<{ cmd: string; param: Record<string, unknown> }>,
  retried = false
): Promise<CgiResult[] | null> {
  const qs = cam.token ? `&token=${encodeURIComponent(cam.token)}` : "";
  const res = await fetch(`${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=${cmds[0].cmd}${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map(({ cmd, param }) => ({ cmd, action: 0, param }))),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json().catch(() => null)) as CgiResult[] | null;
  if (!Array.isArray(json)) return null;
  const tokenErr = json.some((r) => r?.code !== 0 && (r?.error?.rspCode === -6 || r?.error?.rspCode === -1));
  if (tokenErr) {
    cam.token = null;
    cam.tokenExpiresAt = 0;
    if (!retried) {
      await ensureLogin(cam);
      return cgiBatch(cam, cmds, true);
    }
  }
  return json;
}

function readStates(
  cam: CameraRuntime,
  md: Record<string, unknown>,
  ai: Record<string, unknown> | null
): Record<string, boolean> {
  const states: Record<string, boolean> = { MOTION: Number(md.state) === 1 };
  if (!ai) return states;
  const map: Record<string, string> = { people: "PERSON", vehicle: "VEHICLE", dog_cat: "ANIMAL" };
  for (const [key, type] of Object.entries(map)) {
    const entry = ai[key] as { alarm_state?: number; support?: number } | undefined;
    // Fahrzeug-Erkennung pro Kamera abschaltbar (Spam-Weitwinkel).
    const state = aiAlarmState(type, entry, cam.config.vehicleDetection !== false);
    if (state !== null) states[type] = state;
  }
  // Klare Gesichtserkennung (falls Modell face liefert) ueberschreibt PERSON.
  const face = ai.face as { alarm_state?: number; support?: number } | undefined;
  if (face?.support === 1) {
    states.PERSON = face.alarm_state === 1;
  }
  return states;
}

/**
 * Bewegung und KI-Zustand in einem Request (vorher zwei pro Kamera und Poll).
 * Kameras, die kein Batch koennen, fallen dauerhaft auf Einzelabfragen zurueck.
 */
async function pollStates(cam: CameraRuntime): Promise<Record<string, boolean>> {
  await ensureLogin(cam);
  const channel = cam.config.channel;
  if (!cam.noBatch) {
    // Netzwerk-/Login-Fehler gehen normal nach oben (Kamera unerreichbar).
    const results = await cgiBatch(cam, [
      { cmd: "GetMdState", param: { channel } },
      { cmd: "GetAiState", param: { channel } },
    ]);
    const [md, ai] = results ?? [];
    if (md?.code === 0) {
      return readStates(cam, md.value ?? {}, ai?.code === 0 ? ai.value ?? {} : null);
    }
    const rsp = md?.error?.rspCode;
    if (rsp === -6 || rsp === -1) {
      throw new Error(`GetMdState fehlgeschlagen: ${md?.error?.detail ?? "Login"} (rspCode ${rsp})`);
    }
    // Unpassende Antwort: diese Kamera kann kein Batch.
    cam.noBatch = true;
    log(`Kamera ${cam.config.name}: Batch-Abfrage nicht unterstuetzt – Einzelabfragen`);
  }
  return pollStatesSingle(cam);
}

async function pollStatesSingle(cam: CameraRuntime): Promise<Record<string, boolean>> {
  const channel = cam.config.channel;
  const md = await cgi(cam, "GetMdState", { channel });
  // Aeltere Modelle ohne KI-Erkennung - nur Bewegung melden.
  const ai = await cgi(cam, "GetAiState", { channel }).catch(() => null);
  return readStates(cam, md, ai);
}

/** JPEG von der Kamera holen (ohne Upload). */
async function captureSnap(cam: CameraRuntime, timeoutMs = 15_000): Promise<Buffer> {
  await ensureLogin(cam);
  const rs = Math.random().toString(36).slice(2, 10);
  const res = await fetch(
    `${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=Snap&channel=${cam.config.channel}&rs=${rs}&token=${encodeURIComponent(cam.token!)}`,
    { signal: AbortSignal.timeout(timeoutMs) }
  );
  if (!res.ok) throw new Error(`Snap fehlgeschlagen: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("Snap lieferte kein JPEG (falsche Zugangsdaten?)");
  }
  return buf;
}

/** JPEG von einer konfigurierten Kamera holen (ohne Upload) – z. B. fuer Scan-Schnappschuesse. */
export async function captureSnapshot(cameraId: number): Promise<Buffer> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);
  return captureSnap(cam);
}

/**
 * Schnappschuss von der Kamera holen und in die Cloud laden. `maxPx` und
 * `quality`: verkleinert hochladen (ohne `quality` die Qualitaet aller
 * Anzeige-Bilder, 82). `minBytes`: kleinere Bilder unverkleinert (ohne
 * Angabe 200 KB wie alle Bildwege; das Vorschaubild bei reiner Bewegung
 * hat 0).
 */
export async function uploadSnapshot(
  cameraId: number,
  opts: { maxPx?: number; quality?: number; minBytes?: number } = {}
): Promise<{ bytes: number }> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);

  const raw = await captureSnap(cam);
  // Nur Anzeige: drosselt weitere Anzeige-Bilder, nicht die Gesichtserkennung.
  // Die Drossel gilt ab dem Bild, nicht erst ab dem Upload: Ist die Cloud
  // nicht erreichbar, soll nicht jede Bewegung ein neues Vollbild holen.
  cam.lastAutoSnapshotAt = Date.now();
  // Auto-Snapshots bei Bewegung nur fuer die Anzeige: verkleinert hochladen.
  const buf = opts.maxPx ? await shrinkJpeg(raw, opts.maxPx, opts.quality, opts.minBytes) : raw;
  const upload = await api(`/api/hub/cameras/${cameraId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
  });
  if (!upload.ok) throw new Error(`Snapshot-Upload fehlgeschlagen: HTTP ${upload.status}`);
  cam.autoSnapshotSent = true;
  return { bytes: buf.length };
}

/** So oft prueft die Personen-Pipeline, ob hinter ihr ein Fahrzeug wartet. */
const PERSON_YIELD_CHECK_MS = 100;

/** Ein Lauf der Personen-Pipeline aus Sicht ihres Ablaufs. */
interface PersonRun {
  /** Die Kamera: nur waehrend eines Bildes oder des Zooms belegt (CameraLease). */
  lease: CameraLease;
  /**
   * Ohne Gesicht einem Fahrzeug gewichen. true = die Pipeline laeuft nach dem
   * Burst noch einmal.
   */
  yielded(): boolean;
}

/**
 * Bei Personen-Erkennung: sofort bis zu N Snap-/Face-Versuche, solange die
 * Kamera die Person meldet (einzelne Aussetzer des Signals zaehlen nicht) –
 * Gallery-Match, Upload (ohne Gesicht: kein Upload).
 *
 * Meldet die Kamera waehrenddessen ein Fahrzeug, geht das Kennzeichen vor
 * (Tor): Die Pipeline gibt die Kamera nach dem laufenden Bild ab und der
 * Burst startet. Hat sie schon ein Gesicht, wertet sie es daneben aus und
 * laedt es hoch. Hat sie noch keins, endet sie und laeuft nach dem Burst
 * einmal neu (wie bei gleichzeitigem Beginn: erst Kennzeichen, dann Gesicht).
 */
async function uploadPersonSnapshot(cameraId: number, afterVehicle = false): Promise<{ bytes: number } | null> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);
  if (cam.snapshotInFlight) {
    log(`Personen-Snapshot ${cam.config.name}: übersprungen (Pipeline läuft)`);
    improve("face", "skip_inflight", { cam: cam.config.name });
    return null;
  }
  cam.snapshotInFlight = true;
  let watch: ReturnType<typeof setInterval> | null = null;
  /** Der Burst, dem dieser Lauf die Kamera ueberlassen hat. */
  let vehicleRun: Promise<void> | null = null;
  const lease = new CameraLease(
    () => cam.pendingVehicle,
    () => {
      if (watch) clearInterval(watch);
      cam.snapshotInFlight = false;
      if (!cam.pendingVehicle) return;
      cam.pendingVehicle = false;
      log(`Fahrzeug-Snapshot ${cam.config.name}: nachgezogen (war hinter Person)`);
      vehicleRun = uploadVehicleSnapshot(cameraId).then(
        () => undefined,
        (e) => log(`Fahrzeug-Snapshot ${cam.config.name} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }
  );
  const run: PersonRun = {
    lease,
    yielded: () => {
      // Einmal nachholen, nicht im Kreis: Weicht auch der zweite Lauf einem
      // Fahrzeug, wartet die Gesichtserkennung auf die naechste Person.
      if (afterVehicle || !vehicleRun) return false;
      void vehicleRun
        .then(() => uploadPersonSnapshot(cameraId, true))
        .catch((e) => log(`Personen-Snapshot ${cam.config.name} fehlgeschlagen: ${e instanceof Error ? e.message : e}`));
      return true;
    },
  };
  watch = setInterval(() => lease.check(), PERSON_YIELD_CHECK_MS);
  try {
    return await uploadPersonSnapshotBody(cam, cameraId, run);
  } finally {
    lease.release();
  }
}

/** Gesichtsmitte normiert (0..1), null ohne Bildgroesse. */
function facePosition(f: FaceEmbedResult): { x: number; y: number } | null {
  const [x1, y1, x2, y2] = f.bbox ?? [];
  if (!f.imageW || !f.imageH || ![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const x = (x1 + x2) / 2 / f.imageW;
  const y = (y1 + y2) / 2 / f.imageH;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

const asShot = (f: FaceEmbedResult): FaceShot => ({
  embedding: f.embedding,
  detScore: f.detScore,
  size: f.size,
  sizeScaled: f.sizeScaled,
  frontal: f.frontal,
  sharp: f.sharp,
  upscaled: f.upscaled,
  region: f.region,
  other: f.other,
});

/**
 * Nach dem ersten Gesicht ein paar weitere Bilder holen und das beste
 * behalten; die Merkmale aller Bilder derselben Person werden gemittelt
 * (stabiler als ein Einzelbild, hebt knappe Treffer ueber die Schwelle).
 */
async function pickBestFace(
  cam: CameraRuntime,
  firstBuf: Buffer,
  firstFace: FaceEmbedResult,
  lease: CameraLease
): Promise<{ buf: Buffer; face: FaceEmbedResult }> {
  const shots: Array<{ buf: Buffer; face: FaceEmbedResult }> = [{ buf: firstBuf, face: firstFace }];
  for (let i = 0; i < PERSON_BEST_EXTRA; i++) {
    // Wartet ein Fahrzeug, reicht das Bild, das schon da ist.
    if (lease.lost()) break;
    await new Promise((r) => setTimeout(r, PERSON_BEST_GAP_MS));
    const b = await lease.use(() => captureSnap(cam, PERSON_BEST_SNAP_TIMEOUT_MS).catch(() => null));
    if (!b) break;
    const f = await embedJpeg(b);
    if (f) shots.push({ buf: b, face: f });
  }
  const list = shots.map((s) => asShot(s.face));
  const i = Math.max(0, bestShot(list));
  const fused = fuseEmbeddings(list);
  const best = shots[i];
  log(
    `Personen-Snapshot ${cam.config.name}: bestes von ${shots.length} Gesichtern ist Bild ${i + 1}` +
      (best.face.region ? ` (${best.face.region})` : "") +
      (fused ? `, Merkmale aus ${fused.used} gemittelt` : "")
  );
  improve("face", "bestshot", {
    cam: cam.config.name,
    shots: shots.length,
    pick: i + 1,
    fused: fused?.used ?? 1,
    region: best.face.region,
  });
  // Das zweite Merkmal (FACE_NATIVE) wird ueber dieselbe Serie gemittelt, damit
  // der Vergleich am Ende dieselbe Grundlage hat wie die Sichtung. `series`
  // haelt fest, was ins gemittelte Merkmal einging (Guete an die Cloud).
  return {
    buf: best.buf,
    face: fused ? { ...best.face, embedding: fused.embedding, other: fuseOther(list), series: fused.series } : best.face,
  };
}

async function uploadPersonSnapshotBody(
  cam: CameraRuntime,
  cameraId: number,
  run: PersonRun
): Promise<{ bytes: number } | null> {
  let buf: Buffer | null = null;
  let face: Awaited<ReturnType<typeof embedJpeg>> = null;
  // Roh-Zustand der Pipeline in einer eigenen Variable, nicht in cam.states:
  // Dort erkennt die Abfrage (pollOne) die Flanken, und die gehoeren ihr
  // allein. Was die Abfrage zuletzt gesehen hat, zaehlt mit (nur lesen): Bei
  // der rohen Flanke ist das jetzt, nach einem Fahrzeug-Burst die letzte
  // Abfrage mit Person.
  const seenByPoll = () => cam.debounce.lastActiveAt.PERSON;
  let lastActiveAt = seenByPoll() ?? Date.now();

  /** Ein Fahrzeug hat die Kamera und es gibt noch kein Gesicht. */
  const vehicleFirst = (attempt: number): null => {
    const again = run.yielded();
    log(
      `Personen-Snapshot ${cam.config.name}: unterbrochen (Fahrzeug geht vor` +
        (attempt > 1 ? `, nach Versuch ${attempt - 1}` : "") +
        `)` +
        (again ? ", danach noch einmal" : "")
    );
    improve("face", "yield_vehicle", { cam: cam.config.name, again });
    return null;
  };

  for (let attempt = 1; attempt <= PERSON_SNAP_ATTEMPTS; attempt++) {
    if (run.lease.lost()) return vehicleFirst(attempt);
    try {
      const states = await pollStates(cam);
      const now = Date.now();
      const rawActive = states.PERSON ?? false;
      lastActiveAt = nextLastActiveAt({ rawActive, now, prev: lastActiveAt, seenByPoll: seenByPoll() });
      if (pipelineShouldStop({ rawActive, lastActiveAt, now })) {
        log(
          `Personen-Snapshot ${cam.config.name}: übersprungen (nicht mehr aktiv` +
            (attempt > 1 ? `, nach Versuch ${attempt - 1}` : "") +
            `)`
        );
        improve("face", "skip_inactive", { cam: cam.config.name, after: attempt - 1 });
        return null;
      }
      // Aussetzer des Signals: der Versuch laeuft trotzdem.
      if (!rawActive) improveCount("face", "signal_gap");
    } catch (e) {
      log(
        `Personen-Snapshot ${cam.config.name}: Re-Check fehlgeschlagen: ${
          e instanceof Error ? e.message : e
        }`
      );
      return null;
    }

    buf = await run.lease.use(() => captureSnap(cam));
    if (!buf) return vehicleFirst(attempt);
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
    if (attempt < PERSON_SNAP_ATTEMPTS && !run.lease.lost()) {
      await new Promise((r) => setTimeout(r, PERSON_SNAP_RETRY_MS));
    }
  }

  if (buf && face && PERSON_BEST_EXTRA > 0) {
    const picked = await pickBestFace(cam, buf, face, run.lease);
    buf = picked.buf;
    face = picked.face;
  }

  // Lage des Gesichts im Vollbild (fuer den Namen an der richtigen Box in
  // der Zentrale). Nach optischem Zoom unbekannt: anderer Bildausschnitt.
  let facePos = face ? facePosition(face) : null;

  // Gesicht zu klein oder ohne Treffer: erst optisch heranzoomen (Kamera mit
  // Zoom-Objektiv), sonst Kopf-Ausschnitte digital vergroessern.
  let optical = false;
  if (buf) {
    await refreshGallery();
    const direct = face ? appliedScore(face).scored.match : null;
    if (!direct) {
      // Der optische Zoom braucht die Kamera: nicht, wenn ein Fahrzeug wartet.
      // Er faehrt nur, wenn das Gesicht danach voraussichtlich gross genug ist
      // (opticalWorth in camera-motion-rules.ts).
      const need = { size: face?.size ?? null, upscaled: face?.upscaled ?? true };
      const close = await run.lease.use(() => motion.closeUp(cameraId, need).catch(() => null));
      if (close) {
        improve("face", "optical", { cam: cam.config.name, gain: Number(close.gain.toFixed(2)), persons: close.persons });
        const got = (await embedJpeg(close.jpeg)) ?? (await faceViaZoom(close.jpeg, close.boxes).catch(() => null))?.face ?? null;
        // Das neue Gesicht ersetzt das bisherige nur mit Treffer oder hoeherer Guete.
        const hit = got ? appliedScore(got).scored.match != null : false;
        if (got && takeOpticalFace({ matched: hit, before: face ? asShot(face) : null, after: asShot(got) })) {
          log(`Personen-Snapshot ${cam.config.name}: Gesicht über optischen Zoom ×${close.gain.toFixed(1)}`);
          improve("face", "optical_face", { cam: cam.config.name, upscaled: got.upscaled });
          face = got;
          buf = close.jpeg;
          optical = true;
          facePos = null;
        } else if (got) {
          log(`Personen-Snapshot ${cam.config.name}: Gesicht über optischen Zoom ×${close.gain.toFixed(1)} ohne Treffer und nicht besser – das bisherige bleibt`);
          improve("face", "optical_kept", { cam: cam.config.name, upscaled: got.upscaled });
        }
      }
      if (!optical) {
        const z = await faceViaZoom(buf).catch(() => null);
        if (z && (z.matched || !face)) {
          log(`Personen-Snapshot ${cam.config.name}: Gesicht über digitalen Zoom${z.matched ? " (Treffer)" : ""}, ${z.persons} Person(en) im Bild`);
          improve("face", z.matched ? "zoom_match" : "zoom_face", { cam: cam.config.name, persons: z.persons });
          face = z.face;
          facePos = { x: z.box.x + z.box.w / 2, y: z.box.y + z.box.h * 0.15 };
        }
      }
    }
  }

  if (!buf || !face) {
    log(
      `Personen-Snapshot ${cam.config.name}: übersprungen (kein Gesicht nach ${PERSON_SNAP_ATTEMPTS} Versuchen)`
    );
    improve("face", "skip_no_face", { cam: cam.config.name });
    return null;
  }

  await refreshGallery();
  // Es gilt das Ergebnis des verwendeten Merkmals; in Stufe on bleibt ein
  // Sperrlisten-Treffer, den nur das bisherige Merkmal liefert (noteOtherWay).
  // Dann geht auch dessen Merkmal hoch.
  const applied = noteOtherWay(
    `Personen-Snapshot ${cam.config.name}`,
    face,
    scoreGallery(face.embedding, { upscaled: face.upscaled })
  );
  const scored = applied.scored;
  if (applied.embedding !== face.embedding) face = { ...face, embedding: applied.embedding };
  const match = scored.match;
  if (match && optical) improve("face", "optical_match", { cam: cam.config.name, score: match.score });
  const qs = new URLSearchParams({ cameraId: String(cameraId) });
  if (match) {
    qs.set("listedPersonId", String(match.listedPersonId));
    qs.set("matchScore", match.score.toFixed(4));
    qs.set("matchMethod", "FACE_EMBEDDING");
    log(
      `Personen-Snapshot ${cam.config.name}: Match „${match.name}“ score=${match.score.toFixed(3)}`
    );
  } else {
    const near = scored.nearest;
    log(
      `Personen-Snapshot ${cam.config.name}: ${faceLabel(face)}, kein Gallery-Match` +
        (scored.ambiguous && scored.second
          ? ` – zu knapp: „${scored.nearest?.name}“ ${scored.nearest?.score.toFixed(3)} gegen „${scored.second.name}“ ${scored.second.score.toFixed(3)}`
          : "") +
        (near
          ? ` (best ${near.score.toFixed(3)} „${near.name}“, n=${scored.gallery}, ≥${scored.threshold.toFixed(2)})`
          : ` (Gallery leer)`)
    );
  }
  const nearMiss = !match && (scored.nearest?.score ?? 0) >= scored.threshold - 0.10;
  cam.lastPerson = {
    at: new Date().toISOString(),
    name: match?.name ?? scored.nearest?.name ?? null,
    score: match?.score ?? scored.nearest?.score ?? null,
    threshold: scored.threshold,
    matched: !!match,
  };
  recordHubEvent({
    kind: "person",
    severity: match ? "alert" : "info",
    where: cam.config.name,
    title: match
      ? `Person erkannt: ${match.name}`
      : scored.ambiguous
        ? "Person unsicher (zwei Kandidaten)"
        : nearMiss
          ? "Person knapp unter Schwelle"
          : "Person unbekannt",
    detail: match
      ? undefined
      : scored.nearest
        ? `best ${scored.nearest.score.toFixed(3)} „${scored.nearest.name}“ (n=${scored.gallery}, ≥${scored.threshold.toFixed(2)})`
        : "Gallery leer",
    score: match?.score ?? scored.nearest?.score,
    list: match?.listType,
    // Steckt ein hochgerechnetes Bild im gemittelten Merkmal, gilt die Sichtung
    // fuer den Waechter als hochgerechnet (strengere Entwarnung).
    upscaled: face.upscaled || face.series?.upscaled === true,
    pos: facePos ?? undefined,
  });
  improve("face", match ? "person_match" : scored.ambiguous ? "ambiguous" : nearMiss ? "near_miss" : "person_nomatch", {
    cam: cam.config.name,
    score: match?.score ?? scored.nearest?.score,
    threshold: scored.threshold,
    gallery: scored.gallery,
    upscaled: face.upscaled || face.series?.upscaled === true,
  });

  // Wiederholung eines Uploads dieser Kamera (shouldStoreSighting)? Erst hier,
  // nach Hub-Ereignis und Zaehler: Waechter und Lagebild sehen jede Sichtung.
  // Mit dem Standard count wird nur gezaehlt, hochgeladen wird jede. Gemerkt
  // wird, was auch mit skip hochgeladen wuerde: So zaehlt count genau die
  // Sichtungen, die skip weglaesst.
  let remember = false;
  const sighting: SightingCandidate | null =
    SIGHTING_REPEAT === "off"
      ? null
      : {
          at: Date.now(),
          personId: match?.listedPersonId ?? null,
          listType: match?.listType ?? null,
          embedding: face.embedding,
          quality: faceQuality(asShot(face)),
        };
  if (sighting) {
    const decision = shouldStoreSighting(recentSightings.get(cameraId) ?? [], sighting, {
      now: sighting.at,
      surveillance: sightingSurveillance(localHourOrNaN()),
    });
    remember = decision.store;
    if (decision.repeat) {
      const { known, gapS, sim } = decision.repeat;
      improve("face", decision.exempt ? "repeat_exempt" : known ? "repeat_known" : "repeat_unknown", {
        cam: cam.config.name,
        known,
        gapS,
        sim: sim ?? undefined,
        why: decision.exempt ?? undefined,
        mode: SIGHTING_REPEAT,
      });
      if (sightingAction(SIGHTING_REPEAT, decision) === "skip") {
        log(
          `Personen-Snapshot ${cam.config.name}: Wiederholung (${known && match ? `„${match.name}“` : "ähnliches Gesicht"} vor ${gapS} s) – nicht hochgeladen`
        );
        // Die Drossel gilt wie nach einem Upload: Die naechste Flanke startet
        // nicht sofort eine neue Pipeline.
        cam.lastSnapshotAt = Date.now();
        return null;
      }
    }
  }

  // Verkleinert hochladen (PERSON_SNAPSHOT in image.ts): Das Merkmal geht im
  // Header mit, die Cloud zeigt das Bild an und behaelt es als Beleg. Das
  // Original bleibt hier fuer die Pipeline.
  const uploadBuf = await shrinkJpeg(buf, PERSON_SNAPSHOT.maxPx, PERSON_SNAPSHOT.quality);
  // Beleg je Sichtung (sentinel-vouch.ts), mit dem Stand direkt vor dem
  // Upload: Nur wenn der Waechter genau diese Person gerade bewertet oder
  // gemeldet hat, steht sentinel=1 dabei. Nur dann darf die Cloud zu einer
  // unbekannten Person schweigen; ohne Beleg meldet sie selbst.
  // Ab Werk aus (HUB_SENTINEL_CLOUD_QUIET): Dann meldet die Cloud wie frueher selbst.
  const vouch = vouchParam(sentinelVouch(cameraId), {
    quietOn: cloudQuietOn(process.env.HUB_SENTINEL_CLOUD_QUIET),
    galleryMatch: match != null,
  });
  if (vouch.send) qs.set("sentinel", "1");
  improveCount("face", vouch.counter);
  const vouchNote = vouch.note;
  // Guete des Gesichts mit jeder Sichtung (face-rules.ts sightingQualityParams):
  // Die Cloud lernt nur aus klaren, nicht hochgerechneten Treffern dazu. Der
  // Abstand zur zweitbesten Person stammt aus demselben Abgleich wie matchScore.
  const quality = sightingQualityParams(face, galleryMargin(scored));
  for (const [k, v] of Object.entries(quality)) qs.set(k, v);
  try {
    const upload = await api(`/api/hub/person-sightings?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Face-Embedding": embeddingHeader(face.embedding) },
      body: new Uint8Array(uploadBuf),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) {
      const errText = await upload.text().catch(() => "");
      throw new Error(
        `Personen-Snapshot fehlgeschlagen: HTTP ${upload.status} ${errText.slice(0, 120)}`
      );
    }
    log(
      `Personen-Snapshot ${cam.config.name}: Upload OK (${uploadBuf.length} bytes` +
        (uploadBuf.length !== buf.length ? `, Original ${buf.length}` : "") +
        `, Gesicht ${sightingQualityNote(quality)}` +
        `${vouchNote})`
    );
    if (sighting && remember) recentSightings.set(cameraId, rememberSighting(recentSightings.get(cameraId) ?? [], sighting, Date.now()));
  } finally {
    // Die Drossel gilt, sobald ein Gesicht ausgewertet ist, auch wenn der
    // Upload scheitert: Ohne Cloud soll die Pipeline nicht bei jedem neuen
    // Personen-Alarm sofort wieder anlaufen (Bilder, Gesichts-Dienst).
    cam.lastSnapshotAt = Date.now();
  }
  return { bytes: uploadBuf.length };
}

/** Ein Fahrzeug-Burst aus Sicht des Weißlichts: was der Body für Licht und Sperre meldet. */
interface VehicleRun {
  /**
   * Der Hub hat für diesen Burst das Weißlicht eingeschaltet: schaltet es
   * aus (vehicle-light.ts, mehrfach aufrufbar). null = kein Licht vom Hub.
   */
  lightOff: (() => Promise<void>) | null;
  /** So viele Bilder hat die Kennzeichen-Suche ausgewertet. */
  evaluated: number;
  /** Ausgewertet und weder Kennzeichen noch Fahrzeug (ab Mindestfläche, in der Zone) gesehen. */
  empty: boolean;
  /** Mindestzahl der Bilder dieses Licht-Bursts (HUB_VEHICLE_LIGHT_MIN_FRAMES), 0 = keine. */
  minFrames: number;
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
  if (cam.snapshotInFlight) {
    cam.pendingVehicle = true;
    log(`Fahrzeug-Snapshot ${cam.config.name}: wartet (Pipeline läuft)`);
    improve("alpr", "deferred", { cam: cam.config.name });
    return null;
  }
  cam.snapshotInFlight = true;
  try {
    const lightOff = await vehicleLightOn(cam, cameraId);
    const run: VehicleRun = { lightOff, evaluated: 0, empty: false, minFrames: 0 };
    try {
      return await uploadVehicleSnapshotBody(cam, cameraId, run);
    } finally {
      if (lightOff) {
        // Meist schon direkt nach dem letzten Bild aus (der Body schaltet es
        // dort ab); hier für jeden anderen Ausgang. Mehrfach aufrufbar.
        await lightOff();
        // Licht an, aber kein Fahrzeug: Das Ein-/Ausschalten selbst löst an der
        // Kamera den nächsten Fahrzeug-Alarm aus (19.11. 15:28–15:33 Uhr alle ~8 s,
        // 16 von 19 Licht-Bursts leer). Eine Weile ohne Licht weiter.
        // Mit Mindestzahl erst, wenn so viele Bilder ausgewertet sind (lightMuteDue).
        if (
          VEHICLE_LIGHT_MUTE_MS > 0 &&
          lightMuteDue({ evaluated: run.evaluated, shown: !run.empty, minFrames: run.minFrames })
        ) {
          cam.spotlightMuteUntil = Date.now() + VEHICLE_LIGHT_MUTE_MS;
          log(
            `Fahrzeug-Burst ${cam.config.name}: Licht-Burst ohne Fahrzeug (${run.evaluated} Frames ausgewertet) – ${Math.round(VEHICLE_LIGHT_MUTE_MS / 60_000)} min kein Weißlicht`
          );
          improve("alpr", "spotlight_mute", { cam: cam.config.name, frames: run.evaluated });
        }
      }
    }
  } finally {
    cam.snapshotInFlight = false;
    // Kam während des Bursts eine neue VEHICLE-Flanke (zweiter Wagen direkt
    // dahinter), jetzt nachziehen. Der Body prüft zuerst, ob der Alarm noch
    // steht; ist er aus, entscheidet das erste Bild, und ohne Kennzeichen und
    // Fahrzeug darauf ist sofort Schluss – keine Endlosschleife.
    // Abwarten statt entkoppeln: Wer auf diesen Burst wartet (der Nachhol-Lauf
    // der Gesichtserkennung, die Person bei gleichzeitigem Beginn), soll die
    // Kamera danach frei vorfinden. Sonst belegte der nachgezogene Burst sie
    // im selben Atemzug wieder und der Nachhol-Lauf entfiel ersatzlos.
    if (cam.pendingVehicle) {
      cam.pendingVehicle = false;
      log(`Fahrzeug-Snapshot ${cam.config.name}: nachgezogen (kam während Burst)`);
      await uploadVehicleSnapshot(cameraId).catch((e) =>
        log(`Fahrzeug-Snapshot ${cam.config.name} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }
  }
}

/** Wartezeit nach dem Einschalten, bis die Belichtung nachgezogen hat. */
const VEHICLE_LIGHT_SETTLE_MS = Number(process.env.HUB_VEHICLE_SPOTLIGHT_SETTLE_MS || 800);
/** Sicherheitsnetz: Licht spätestens nach dieser Zeit wieder aus. */
const VEHICLE_LIGHT_MAX_MS = 60_000;
/** Auf den Merker auf der Platte wartet das Einschalten höchstens so lange. */
const VEHICLE_LIGHT_MARK_WAIT_MS = 250;
/**
 * Wo der Hub das Weißlicht eingeschaltet hat (Kamera-ID und Zeitpunkt), auf
 * der Platte: Endet der Prozess, bevor er ausschalten konnte, weiß der
 * nächste, welche Lichter seine sind. Ein brennendes Licht ohne Merker gilt
 * als von Hand eingeschaltet und bleibt unberührt.
 */
const lightMarks = new CameraMarks(path.join(CONFIG.hubDir, ".cache", "lights-on.json"));
/** Lichter, die für einen Burst brennen, samt allem, was sie wieder ausschaltet (vehicle-light.ts). */
const burstLights = new BurstLights(
  {
    mark: (cameraId, at) => lightMarks.set(cameraId, at),
    unmark: (cameraId, at) => lightMarks.delete(cameraId, at),
    onShutdown,
    isExiting,
    log,
  },
  { maxMs: VEHICLE_LIGHT_MAX_MS, markWaitMs: VEHICLE_LIGHT_MARK_WAIT_MS }
);
/** Gemerkte Lichter, die gerade ausgeschaltet werden, und der letzte Versuch je Kamera. */
const lateLightOffRunning = new Set<number>();
const lateLightOffTriedAt = new Map<number, number>();
const lateLightOffFailLog = new ChangeLog(10 * 60_000);
/**
 * Kameras, an die der Ausschalt-Befehl für ein gemerktes Licht gerade
 * unterwegs ist. Bis er wirkt, meldet die Kamera das Licht noch als brennend;
 * ein Burst, der jetzt beginnt, schaltet es deshalb selbst (burstSwitchesLight).
 */
const lateLightOffSending = new Set<number>();

/** Weißlicht mit dem früheren Befehl, weil der Stand fehlte: höchstens stündlich je Kamera im Log. */
const spotlightFallbackLog = new ChangeLog(60 * 60_000);

/**
 * Weißlicht einer Kamera an oder aus. Lichtmodus und Helligkeit bleiben, wie
 * die Kamera sie meldet (spotlight-rules.ts, Entscheidung vom 25.11.2026).
 * `current` ist das Feld WhiteLed der Antwort auf GetWhiteLed, wenn der
 * Aufrufer sie schon hat (null: seine Abfrage ist gescheitert); fehlt es,
 * fragt switchSpotlight die Kamera selbst. `brightness` nur bei
 * ausdrücklichem Wunsch, sie gilt nur beim Einschalten. Ohne brauchbaren
 * Stand und mit HUB_SPOTLIGHT_LEGACY geht der frühere Befehl hinaus
 * (Lichtmodus 1, Helligkeit 100 oder die angegebene).
 */
async function switchSpotlight(
  cam: CameraRuntime,
  on: boolean,
  opts: { current?: unknown; brightness?: number } = {}
): Promise<SpotlightCommand> {
  await ensureLogin(cam);
  const legacy = spotlightLegacy(process.env.HUB_SPOTLIGHT_LEGACY);
  let current = opts.current;
  let readError: string | null = null;
  if (!legacy && current === undefined) {
    current = await cgi(cam, "GetWhiteLed", { channel: cam.config.channel })
      .then((v) => v.WhiteLed ?? null)
      .catch((e) => {
        readError = e instanceof Error ? e.message : String(e);
        return null;
      });
  }
  const cmd = spotlightCommand({ legacy, current, on, brightness: opts.brightness });
  if (cmd.how === "fallback") {
    improveCount("camera", "spotlight_fallback");
    if (spotlightFallbackLog.shouldLog(String(cam.config.id), "fallback", Date.now())) {
      const why = readError ?? (current == null ? "keine Antwort auf GetWhiteLed" : "GetWhiteLed ohne state/mode");
      log(
        `Kamera ${cam.config.name}: Weißlicht-Stand nicht lesbar (${why}) – ` +
          `schaltet mit dem früheren Befehl (mode=${cmd.param.mode}, bright=${cmd.param.bright})`
      );
    }
  }
  await cgi(cam, "SetWhiteLed", { WhiteLed: { channel: cam.config.channel, ...cmd.param } });
  return cmd;
}

/**
 * Kein Weißlicht für diesen Burst: Im Dunkeln steht der Grund im Log (eine
 * Zeile je Burst) und im Zähler alpr.spotlight_skip_<Grund>, bei Tag nichts.
 */
function noteNoLight(cam: CameraRuntime, reason: LightSkipReason, facts: LightFacts): void {
  const dark = lightSkipLogged({
    dark: facts.dark,
    darkWithoutFetch: () => isDark(new Date(facts.now), lastForecast()?.days ?? []),
  });
  if (!dark) return;
  // Den Lichtmodus nennt die Zeile, wenn die Kamera schon gefragt wurde
  // („schon an“ nennt ihn selbst); dafür keine eigene Abfrage.
  const mode = reason === "already_on" ? "" : ledModeNote(facts.led);
  log(
    `Fahrzeug-Burst ${cam.config.name}: dunkel – kein Weißlicht (${lightSkipText(reason, facts)}${mode ? `; ${mode}` : ""})`
  );
  improveCount("alpr", `spotlight_skip_${reason}`);
}

/**
 * Nachts an der Zufahrt: Weißlicht der Kamera für die Dauer des Bursts
 * einschalten, damit das Kennzeichen lesbar wird (Entscheidung vom
 * 14.11.2026). War das Licht schon an (manuell), bleibt es unberührt – außer
 * der Hub schaltet es gerade selbst aus (lateLightOff). Liefert die
 * Ausschalt-Funktion oder null, wenn nichts geschaltet wurde. Fehler
 * blockieren den Burst nie.
 *
 * Ob und warum nicht entscheidet lightDecision (vehicle-light-rules.ts); sie
 * fragt die Angaben in der Reihenfolge der Kosten ab, die Kamera erst, wenn es
 * dunkel ist und die Kamera gemeint ist. Im Dunkeln steht jeder Burst mit
 * genau einer Zeile im Log: „Weißlicht an“, „kein Weißlicht (Grund)“ oder
 * „Weißlicht nicht schaltbar“.
 */
async function vehicleLightOn(cam: CameraRuntime, cameraId: number): Promise<(() => Promise<void>) | null> {
  const facts: LightFacts = {
    env: process.env.HUB_VEHICLE_SPOTLIGHT,
    cam: { id: cameraId, name: cam.config.name },
    now: Date.now(),
    mutedUntil: cam.spotlightMuteUntil ?? null,
  };
  try {
    // Jede Runde ergänzt genau die Angabe, nach der lightDecision fragt (höchstens vier).
    for (let round = 0; ; round++) {
      const d = lightDecision(facts);
      if (d.light === "on") break;
      if (d.light === "off") {
        noteNoLight(cam, d.reason, facts);
        return null;
      }
      if (round >= 4) throw new Error(`Angabe ${d.fact} fehlt`);
      if (d.fact === "dark") {
        const forecast = await getForecast().catch(() => null);
        facts.dark = isDark(new Date(), forecast?.days ?? []);
      } else if (d.fact === "hasLight") {
        const caps = capsCache.get(cameraId)?.caps ?? (await getCameraCaps(cameraId).catch(() => null));
        facts.hasLight = caps ? caps.spotlight : null;
      } else if (d.fact === "led") {
        await ensureLogin(cam);
        // Vor der Abfrage festhalten: Ein Ausschalt-Befehl, der jetzt unterwegs
        // ist, kann wirken, nachdem die Kamera das Licht noch als brennend meldet.
        facts.goingOff = lateLightOffSending.has(cameraId);
        const cur = (await cgi(cam, "GetWhiteLed", { channel: cam.config.channel }).catch(() => null)) as {
          WhiteLed?: { state?: number; mode?: number };
        } | null;
        facts.led = cur?.WhiteLed ?? null;
      } else {
        // Alarm schon vorbei (Flackern): kein Licht für einen Burst, der gleich abbricht.
        const still = await pollStates(cam).catch(() => null);
        facts.alarm = still ? still.VEHICLE === true : null;
      }
    }
    // Ein- und Ausschalten mit dem Stand von eben (facts.led): Lichtmodus und
    // Helligkeit bleiben, wie die Kamera sie gemeldet hat, ohne weitere Abfrage.
    const led = facts.led ?? null;
    const off = await burstLights.switchOn({
      cameraId,
      name: cam.config.name,
      switchLight: async (on) => {
        await switchSpotlight(cam, on, { current: led });
      },
    });
    if (!off) {
      noteNoLight(cam, "exiting", facts);
      return null;
    }
    const mode = ledModeNote(led);
    log(`Fahrzeug-Burst ${cam.config.name}: dunkel – Weißlicht an${mode ? ` (${mode})` : ""}`);
    improve("alpr", "spotlight", { cam: cam.config.name, mode: led?.mode ?? null });
    await new Promise((r) => setTimeout(r, VEHICLE_LIGHT_SETTLE_MS));
    return off;
  } catch (e) {
    const mode = ledModeNote(facts.led);
    log(
      `Fahrzeug-Burst ${cam.config.name}: Weißlicht nicht schaltbar: ${e instanceof Error ? e.message : e}${mode ? ` (${mode})` : ""}`
    );
    improveCount("alpr", "spotlight_skip_error");
    return null;
  }
}

/**
 * Gemerkte Lichter ausschalten, die zu keinem laufenden Burst mehr gehören:
 * nach einem Neustart die des vorigen Prozesses, sonst eines, dessen
 * Ausschalten an der Kamera scheiterte. Die Entscheidung steht in
 * lightMarkStep (vehicle-light-rules.ts).
 */
function settleLightMarks(now: number): void {
  for (const [cameraId, markedAt] of lightMarks.entries()) {
    if (lateLightOffRunning.has(cameraId)) continue;
    const cam = cameras.get(cameraId);
    const step = lightMarkStep({
      now,
      markedAt,
      known: cam !== undefined,
      reachable: cam?.reachable === true,
      inUse: burstLights.isOn(cameraId) || cam?.snapshotInFlight === true,
      lastTryAt: lateLightOffTriedAt.get(cameraId) ?? 0,
    });
    if (step === "drop") {
      void lightMarks.delete(cameraId, markedAt);
      lateLightOffTriedAt.delete(cameraId);
      log(`Kamera ${cam?.config.name ?? cameraId}: Weißlicht-Merker verworfen (älter als 24 h)`);
    } else if (step === "off" && cam) {
      lateLightOffTriedAt.set(cameraId, now);
      lateLightOffRunning.add(cameraId);
      void lateLightOff(cam, markedAt).finally(() => lateLightOffRunning.delete(cameraId));
    }
  }
}

/** Ein gemerktes Licht ausschalten, falls es noch brennt; der Merker entfällt erst danach. */
async function lateLightOff(cam: CameraRuntime, markedAt: number): Promise<void> {
  const cameraId = cam.config.id;
  try {
    await ensureLogin(cam);
    const cur = (await cgi(cam, "GetWhiteLed", { channel: cam.config.channel })) as {
      WhiteLed?: { state?: number };
    };
    if (cur.WhiteLed?.state !== 0) {
      // Inzwischen läuft dort ein Burst und braucht das Licht: gleich danach wieder.
      if (burstLights.isOn(cameraId) || cam.snapshotInFlight) {
        lateLightOffTriedAt.delete(cameraId);
        return;
      }
      lateLightOffSending.add(cameraId);
      try {
        // Der eben gelesene Stand: Lichtmodus und Helligkeit bleiben, wie die Kamera sie meldet.
        await switchSpotlight(cam, false, { current: cur.WhiteLed ?? null });
      } finally {
        lateLightOffSending.delete(cameraId);
      }
      log(`Kamera ${cam.config.name}: Weißlicht aus (nachgeholt)`);
      improve("alpr", "spotlight_late_off", { cam: cam.config.name });
    } else {
      // Auch das steht im Log: Wer nach „Aufräumen unvollständig: weisslicht:…“
      // nachsieht, findet so zu jedem Merker, was aus ihm wurde.
      log(`Kamera ${cam.config.name}: Weißlicht war schon aus – Merker gelöscht`);
    }
    lateLightOffTriedAt.delete(cameraId);
    await lightMarks.delete(cameraId, markedAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (lateLightOffFailLog.shouldLog(String(cameraId), msg, Date.now())) {
      log(`Kamera ${cam.config.name}: Weißlicht aus fehlgeschlagen: ${msg} – wird weiter versucht`);
    }
  }
}

async function uploadVehicleSnapshotBody(
  cam: CameraRuntime,
  cameraId: number,
  run: VehicleRun
): Promise<{ bytes: number } | null> {
  // Laeuft noch eine Nahaufnahme (Waechter), passen Zone und Mindestgroesse
  // nicht. Auf eine ausstehende Rueckfahrt des Zooms wartet der Burst nicht:
  // Bis zu ihrem naechsten Versuch faehrt das Objektiv nicht (settled).
  if (!motion.settled(cameraId)) await motion.waitSettled(cameraId, 3_000);

  await new Promise((r) => setTimeout(r, VEHICLE_SNAP_DELAY_MS));

  const plan = vehicleBurstPlan(cam.config);
  // Hat der Hub das Licht eingeschaltet, nimmt der Burst so viele erste Bilder
  // unabhängig vom Alarm (Entscheidung vom 25.11.2026: nachts rund 7 s Licht).
  const minFrames = run.lightOff ? lightMinFrames(process.env.HUB_VEHICLE_LIGHT_MIN_FRAMES, plan.count) : 0;
  run.minFrames = minFrames;
  const snaps: Buffer[] = [];
  const scoreJobs: Promise<unknown>[] = [];
  const scored: Array<{ index: number; score: PlateScore } | undefined> = [];
  let localPromise: ReturnType<typeof actuateIfAllowed> | null = null;
  let actedPlate: string | null = null;
  /** Bild, dessen Listen-Treffer Tor oder Shelly geschaltet hat (null = keins). */
  const acted: { at: number | null } = { at: null };
  let graceLeft = VEHICLE_GRACE_FRAMES;

  const isRepeatPlate = (plate: string): boolean => {
    if (cam.lastPlate?.plate !== plate) return false;
    const ago = Date.now() - Date.parse(cam.lastPlate.at);
    return ago >= 0 && ago < PLATE_REPEAT_MS;
  };

  const considerPlate = (index: number, score: PlateScore): void => {
    scored[index] = { index, score };
    // Unscharfer Whitelist-Treffer: nur Hinweis im Log, schaltet nie.
    const hint = score.probable ? ` · vermutlich ${score.probable} (unscharf, schaltet nicht)` : "";
    if (score.plate) {
      log(
        `Fahrzeug-Burst ${cam.config.name}: Frame ${index + 1} → ${score.plate} conf=${score.confidence.toFixed(2)}${score.viaWhitelist ? " WL" : ""}${hint}`
      );
    } else {
      log(
        `Fahrzeug-Burst ${cam.config.name}: Frame ${index + 1} → ${score.candidates[0]?.plate ?? "—"} (${score.confidence.toFixed(2)})${hint}`
      );
    }
    // Sofort schalten nur bei exaktem Treffer mit genug Confidence (score.actuate).
    // Ein unsicheres Bild darf ein spaeteres, sicheres nicht blockieren.
    if (localPromise || !score.plate || !score.actuate) return;
    if (isRepeatPlate(score.plate)) return;
    actedPlate = score.plate;
    log(`Fahrzeug-Burst ${cam.config.name}: ${score.plate} – DoorBird sofort (Frame ${index + 1})`);
    localPromise = actuateIfAllowed({
      cameraId,
      plate: score.plate,
      exact: score.matchKind === "exact",
      confidence: score.matchConfidence,
    });
    // Hat es wirklich geschaltet, stehen Kennzeichen und Bild fest: Der Burst
    // endet zwei Bilder später (burstDone). Ein Fehler kommt beim Warten auf
    // localPromise vor dem Upload an.
    localPromise.then(
      (r) => {
        if (r?.doorOpened || r?.shellyOk) acted.at ??= index;
      },
      () => undefined
    );
  };

  const burstOpts = {
    minConf: plateAutoMinConf(),
    knownCity: KNOWN_CITY,
    // Kreise mit Umlaut, ohne Umlaut gelesen (LUD → LÜD): bekannter Kreis, Anzeige mit Umlaut.
    umlautCity: UMLAUT_CITY_BY_PLAIN,
    confirmFrames: VEHICLE_CONFIRM_FRAMES,
    afterFrames: cam.config.deliveryMode ? VEHICLE_AFTER_PLATE_FRAMES_DELIVERY : VEHICLE_AFTER_PLATE_FRAMES,
  };
  const frameReads = (): FrameRead[] =>
    scored.flatMap((r) => (r ? [{ index: r.index, candidates: r.score.candidates }] : []));

  log(
    `Fahrzeug-Burst ${cam.config.name}: max ${plan.count}×${plan.gapMs}ms solange VEHICLE (+${VEHICLE_GRACE_FRAMES} Grace${
      minFrames > 0 ? `, mit Licht mindestens ${minFrames}` : ""
    }), OCR parallel ohne Vision …`
  );
  /** Warum die Aufnahme endet; ohne anderen Grund war es die Höchstzahl. */
  let end: BurstEnd = { why: "max" };
  for (let i = 0; i < plan.count; i++) {
    const frameStart = Date.now();
    let states: Record<string, boolean>;
    let jpeg: Buffer;
    try {
      // Nur lesen, nicht in cam.states schreiben: sonst sieht der parallele
      // Poll beim Flackern eine neue Flanke, meldet Phantom-Ereignisse und
      // stößt mitten im Burst den nächsten an.
      // Alarm-Abfrage und Bild gleichzeitig: nacheinander plus feste Pause
      // waren ~1,15 s je Bild statt der geplanten 400 ms (Log 19./20.11.).
      await ensureLogin(cam); // einmal vorweg, nicht zweimal parallel
      [states, jpeg] = await Promise.all([pollStates(cam), captureSnap(cam)]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (snaps.length === 0) {
        log(`Fahrzeug-Snapshot ${cam.config.name}: Re-Check fehlgeschlagen: ${msg}`);
        return null;
      }
      end = { why: "error", detail: msg };
      break;
    }
    // Alarm flackert oft, Auto noch im Bild: ein paar Frames weiter (Grace);
    // im Licht-Burst die ersten Bilder ohnehin (burstStep).
    const step = burstStep({
      framesTaken: snaps.length,
      alarm: states.VEHICLE === true,
      graceLeft,
      graceFrames: VEHICLE_GRACE_FRAMES,
      lightMinFrames: minFrames,
    });
    if (step.next === "end") {
      end = { why: "alarm" };
      break;
    }
    graceLeft = step.graceLeft;

    snaps.push(jpeg);
    const index = snaps.length - 1;
    const job = scorePlateFromJpeg(jpeg, { vision: false }).then((score) => {
      considerPlate(index, score);
      return score;
    });
    scoreJobs.push(job);
    if (step.next === "check") {
      // Alarm schon beim ersten Bild aus: Das Bild ist geholt (nachts
      // beleuchtet) und wird gelesen, bevor der Burst aufgibt. Was zuerst
      // etwas findet, entscheidet; die Fahrzeug-Prüfung braucht Millisekunden.
      const seen = await firstFound<string>([
        job.then((score) => (frameShowsPlate(score) ? "Kennzeichen" : null)),
        checkVehicle(jpeg, {
          cameraId,
          label: cam.config.name,
          minArea: cam.config.vehicleMinArea ?? undefined,
          zone: cam.config.vehicleZone ?? undefined,
        }).then((r) => (r.vehicle === true ? "Fahrzeug" : null)),
      ]);
      if (!seen) {
        await Promise.all(scoreJobs);
        run.evaluated = snaps.length;
        run.empty = true;
        log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (nicht mehr aktiv, Frame 1 ohne Kennzeichen und Fahrzeug)`);
        improveCount("alpr", "first_frame_empty");
        return null;
      }
      log(`Fahrzeug-Burst ${cam.config.name}: Alarm schon vorbei, Frame 1 zeigt ${seen} – weiter (+${graceLeft} Grace)`);
      improveCount("alpr", "first_frame_seen");
    }
    // Kennzeichen steht sicher fest oder hat schon geschaltet: nicht noch
    // 10–15 s weiter knipsen. Vor der Mindestzahl im Licht-Burst endet er nur
    // nach einer Schaltung (burstDoneReason mit minFrames).
    const done = burstDoneReason(frameReads(), snaps.length, { ...burstOpts, actedAtIndex: acted.at, minFrames });
    if (done === "acted" && acted.at != null) {
      end = { why: "acted", actedAt: acted.at };
      improve("alpr", "acted_stop", { cam: cam.config.name, frames: snaps.length, actedFrame: acted.at + 1 });
      break;
    }
    if (done === "confirmed") {
      end = { why: "confirmed" };
      improve("alpr", "early_stop", { cam: cam.config.name, frames: snaps.length });
      break;
    }
    const wait = plan.gapMs - (Date.now() - frameStart);
    if (i < plan.count - 1 && wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // Letztes Bild ist aufgenommen: Licht sofort aus, nicht erst nach
  // Lieferdienst-Prüfung und Upload. Die Zusagen von vehicle-light.ts bleiben
  // (Merker, Aufräumer beim Beenden); uploadVehicleSnapshot wartet am Ende
  // auf genau diesen Ausschalt-Vorgang.
  if (run.lightOff) void run.lightOff().catch(() => undefined);
  if (snaps.length > 0) {
    log(`Fahrzeug-Burst ${cam.config.name}: ${burstEndText(end, snaps.length)}`);
    if (end.why === "error" || end.why === "max") improveCount("alpr", `burst_end_${end.why}`);
  }

  if (snaps.length === 0) {
    log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (kein Snap)`);
    return null;
  }

  // OCR lief schon während der Aufnahme (nur fast-alpr). Vision nicht pro Frame:
  // auf leeren Bildern ~1,6 s, und genau die späteren Frames sind oft schon leer.
  const dumpRoot = vehicleDumpDir();
  await Promise.all(scoreJobs);
  run.evaluated = snaps.length;

  const scores: Array<{ index: number; score: PlateScore }> = [];
  let bestIdx: number | null = null;
  let bestScore: PlateScore | null = null;
  for (let i = 0; i < snaps.length; i++) {
    const row = scored[i];
    if (!row) continue;
    scores.push(row);
    if (actedPlate && row.score.plate !== actedPlate) continue;
    if (plateRank(row.score) > plateRank(bestScore)) {
      bestIdx = row.index;
      bestScore = row.score;
    }
  }

  // Ob das Weißlicht die Kennzeichen lesbar macht, steht so je Licht-Burst im
  // Log: Bilder mit Kennzeichen oder Schild-artiger Lesung (ab 0,5).
  if (run.lightOff) {
    const read = scores.filter((r) => frameShowsPlate(r.score)).length;
    log(`Fahrzeug-Burst ${cam.config.name}: mit Weißlicht ${read} von ${snaps.length} Bildern mit Lesung`);
    improve("alpr", "light_frames", { cam: cam.config.name, frames: snaps.length, read });
  }

  // Mehrheit über den Burst statt bestem Einzelbild: Einzelbilder lesen gern
  // ein Zeichen falsch (ST-K 3434E einmal, GT-K 3434E viermal). Hat schon ein
  // freigegebenes Kennzeichen geschaltet, bleibt es dabei.
  const consensus = actedPlate ? null : burstConsensus(frameReads(), burstOpts);
  // Seit dem 25.11.2026 sammelt eine längere Lesung auf nur einem Bild die
  // kürzeren nicht mehr ein. Wo das das Ergebnis ändert, steht es im Log.
  const change = actedPlate ? null : consensusChange(frameReads(), burstOpts, consensus);
  if (change) {
    log(
      `Fahrzeug-Burst ${cam.config.name}: Mehrheit ${change.now ?? "keine"} (frühere Regel: ${change.before ?? "keine"}, längere Lesung nur auf 1 Bild)`
    );
    improveCount("alpr", "consensus_longer_single");
  }
  if (consensus) {
    const own = scored[consensus.bestIndex]?.score;
    const sameAsOwn = !!own?.plate && normalizePlate(own.plate) === normalizePlate(consensus.plate);
    if (!bestScore?.plate || bestScore.plate !== consensus.plate || bestIdx !== consensus.bestIndex) {
      log(
        `Fahrzeug-Burst ${cam.config.name}: ${consensus.plate} auf ${consensus.frames} Bildern (conf ${consensus.confidence.toFixed(2)}) → Frame ${consensus.bestIndex + 1}`
      );
    }
    bestIdx = consensus.bestIndex;
    bestScore =
      sameAsOwn && own
        ? own
        : {
            // Nur Anzeige/Cloud: schaltet nie (actuate false → localActed=1).
            plate: consensus.plate,
            confidence: consensus.confidence,
            candidates: own?.candidates ?? [],
            raw: own?.raw ?? [],
            viaWhitelist: false,
            matchKind: "auto",
            matchConfidence: consensus.confidence,
            probable: own?.probable ?? null,
            actuate: false,
          };
    improve("alpr", "consensus", { cam: cam.config.name, frames: consensus.frames });
  }

  let buf: Buffer | null = bestIdx != null && bestScore?.plate ? snaps[bestIdx] : null;
  let plate = actedPlate ?? bestScore?.plate ?? null;

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
      // Bild mit Schild-artiger Lesung, sonst größte Fahrzeug-Box (Auto am
      // nächsten). Früher: letztes Bild mit Fahrzeug, oft schon das Heck.
      let pick = pickFallbackFrame(frameReads(), [], 0);
      if (!pick) {
        const areas: Array<number | null> = [];
        for (let i = 0; i < snaps.length; i++) {
          // Größen-/Zonenregel: geparkte Autos und Straße im Hintergrund zählen nicht.
          // Cloud-Einstellung der Kamera geht vor, sonst Umgebung (HUB_VEHICLE_*).
          const r = await checkVehicle(snaps[i], {
            cameraId,
            label: cam.config.name,
            minArea: cam.config.vehicleMinArea ?? undefined,
            zone: cam.config.vehicleZone ?? undefined,
          });
          // Alter Tracker ohne Boxen meldet Fläche 0: zählt trotzdem als Fahrzeug.
          areas.push(r.vehicle === true ? Math.max(r.area, 1e-6) : r.vehicle === false ? 0 : null);
        }
        pick = pickFallbackFrame([], areas, 0);
      }
      if (pick) {
        buf = snaps[pick.index];
        bestIdx = pick.index;
        log(
          `Fahrzeug-Burst ${cam.config.name}: kein Plate – Frame ${pick.index + 1}/${snaps.length} (${pick.why === "ocr" ? "Schild sichtbar" : "Fahrzeug am größten"})`
        );
      }
      if (!buf) {
        if (dumpRoot) {
          const dir = path.join(dumpRoot, burstFolderName(cam.config.name));
          await dumpVehicleBurst(dir, snaps, scores, null, cam.config.name);
        }
        log(
          `Fahrzeug-Snapshot ${cam.config.name}: übersprungen (kein Plate/Fahrzeug in ${snaps.length} Frames)`
        );
        run.empty = true;
        improve("alpr", "skip", { cam: cam.config.name, frames: snaps.length });
        // Auch Skips throtteln – sonst Dauerschleife bei statischen Fehlalarmen.
        cam.lastSnapshotAt = Date.now();
        return null;
      }
    }
  }

  // Vision nur einmal, und nur wenn fast-alpr kein brauchbares Kennzeichen hat.
  // Pro Frame wären das die ~1,6 s, die das DoorBird heute 16 s haben warten lassen.
  const alprSure =
    !!plate &&
    !!bestScore?.viaWhitelist &&
    bestScore.confidence >= PLATE_EARLY_STOP_CONF;
  if (VEHICLE_PLATE_VISION && buf && !alprSure && !localPromise) {
    log(
      `Fahrzeug-Burst ${cam.config.name}: Vision einmal auf Frame ${(bestIdx ?? 0) + 1}/${snaps.length}`
    );
    const visionScore = await scorePlateFromJpeg(buf);
    if (visionScore.plate && plateRank(visionScore) > plateRank(bestScore)) {
      plate = visionScore.plate;
      bestScore = visionScore;
      log(
        `Fahrzeug-Burst ${cam.config.name}: Vision → ${visionScore.plate} conf=${visionScore.confidence.toFixed(2)}${visionScore.viaWhitelist ? " WL" : ""}`
      );
    }
  }

  // Reolink-LPR nur wenn OCR nichts fand.
  if (!plate) {
    plate = await tryReadPlate(cam);
  }

  // Lieferdienst (DHL, UPS, …) an der Aufschrift oder am gemerkten Kennzeichen –
  // nur wenn kein freigegebenes Kennzeichen schon gehandelt hat. Öffnet je
  // nach Einstellung das Tor (am Kennzeichen allein nie).
  let delivery: DeliveryResult | null = null;
  if (!localPromise && cam.config.deliveryMode) {
    const seen = { plate: bestScore?.plate ?? null, confidence: bestScore?.confidence ?? 0, frameIndex: bestIdx ?? snaps.length - 1 };
    delivery = await checkDelivery(cam.config, snaps, seen).catch((e) => {
      log(`Lieferdienst ${cam.config.name}: Prüfung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    if (delivery) {
      buf = snaps[delivery.frameIndex];
      bestIdx = delivery.frameIndex;
    }
  }

  // Gleiches Kennzeichen kurz hintereinander (Alarm flackert, Nachzieh-Burst):
  // ein Eintrag reicht. Aktoren haben ihren eigenen Cooldown.
  if (plate && cam.lastPlate && isRepeatPlate(plate) && !localPromise && !delivery) {
    const ago = Date.now() - Date.parse(cam.lastPlate.at);
    log(
      `Fahrzeug-Snapshot ${cam.config.name}: ${plate} schon vor ${Math.round(ago / 1000)} s gemeldet – kein zweiter Upload`
    );
    improve("alpr", "repeat", { cam: cam.config.name, plate, agoMs: ago });
    cam.lastPlate = { ...cam.lastPlate, at: new Date().toISOString() };
    cam.lastSnapshotAt = Date.now();
    return null;
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
  improve("alpr", plate ? "plate" : "upload_noplate", {
    cam: cam.config.name,
    frames: snaps.length,
    conf: bestScore?.confidence,
    wl: bestScore?.viaWhitelist,
  });
  const listed = plate ? findAllowedVehicle(plate) : null;
  // Nur zählen: Kennzeichen aus einem einzigen Bild unter 0,95, ohne Mehrheit
  // und ohne Listen-Treffer. Grundlage für die Entscheidung, ob eine solche
  // Lesung künftig nur noch als Hinweis gilt; die Sichtung bleibt, wie sie ist.
  if (
    bestScore?.plate === plate &&
    singleReadWeak({
      acted: actedPlate != null,
      consensus: consensus != null,
      plate,
      listed: listed != null,
      confidence: bestScore?.confidence ?? 0,
    })
  ) {
    improveCount("alpr", "single_weak");
  }
  // Unscharfer Whitelist-Treffer irgendwo im Burst: nur als Hinweis anzeigen.
  const probable = bestScore?.probable ?? scores.find((r) => r.score.probable)?.score.probable ?? null;
  cam.lastPlate = {
    at: new Date().toISOString(),
    plate,
    confidence: bestScore?.confidence ?? null,
    listed: !!listed,
  };
  recordHubEvent({
    kind: "vehicle",
    severity: listed ? "alert" : "info",
    where: cam.config.name,
    title: plate
      ? `Kennzeichen ${plate}${listed ? ` – ${listed.name}` : ""}`
      : "Fahrzeug ohne Kennzeichen",
    detail: `${snaps.length} Frames${bestScore ? ` · conf ${bestScore.confidence.toFixed(2)}` : ""}${
      !listed && probable ? ` · vermutlich ${probable} (unscharf, nicht geschaltet)` : ""
    }`,
    plate: plate ?? undefined,
    listed: !!listed,
  });

  // Lesung hinter `plate`. Kommt das Kennzeichen nicht aus der eigenen OCR,
  // sondern von der Kamera-eigenen Erkennung (Reolink-LPR), gibt es keine
  // Confidence und keinen unscharfen Abgleich: `actuateIfAllowed` findet das
  // Fahrzeug dann nur ueber den exakten normalisierten Vergleich.
  const plateScore = plate && bestScore?.plate === plate ? bestScore : null;
  const mayActuate = plateScore ? plateScore.actuate : true;
  if (plate && !localPromise && !isRepeatPlate(plate)) {
    localPromise = actuateIfAllowed({
      cameraId,
      plate,
      exact: plateScore ? plateScore.matchKind === "exact" : true,
      confidence: plateScore?.matchConfidence ?? null,
    });
  }
  if (delivery) {
    qs.set("delivery", delivery.brand);
    if (delivery.opened) qs.set("deliveryOpened", "1");
  }
  const local = localPromise ? await localPromise : null;
  if (local?.skipCloud) {
    qs.set("localActed", "1");
    if (local.doorOpened) qs.set("localDoor", "1");
    if (local.shellyTriggered) qs.set("localShelly", local.shellyOk ? "1" : "0");
  } else if (plate && !mayActuate) {
    // Kein exakter, sicherer Treffer: Auch die Cloud darf nicht ersatzweise
    // schalten (sie legt sonst bei Whitelist-Treffer einen DOORBIRD_OPEN-Task an).
    qs.set("localActed", "1");
  }

  try {
    const uploadBuf = await shrinkJpeg(buf, DISPLAY_SNAPSHOT_MAX_PX);
    // Über 4 MB lehnt die Cloud die Sichtung ab (HTTP 413); eine Sichtung
    // ohne Bild nimmt die Route nicht an. Das steht dann vorher im Log.
    if (sightingImageTooLarge(uploadBuf.length)) {
      log(
        `Fahrzeug-Snapshot ${cam.config.name}: Bild mit ${uploadBuf.length} bytes über 4 MB (Original ${buf.length} bytes) – die Cloud lehnt die Sichtung ab`
      );
      improveCount("alpr", "upload_too_large");
    }
    const upload = await api(`/api/hub/vehicle-sightings?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(uploadBuf),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) {
      const errText = await upload.text().catch(() => "");
      throw new Error(
        `Fahrzeug-Snapshot fehlgeschlagen: HTTP ${upload.status} ${errText.slice(0, 120)}`
      );
    }
    log(`Fahrzeug-Snapshot ${cam.config.name}: Upload OK (${uploadBuf.length} bytes, Original ${buf.length} bytes)`);
  } catch (e) {
    if (local?.doorOpened || local?.shellyOk) {
      log(
        `Fahrzeug-Snapshot ${cam.config.name}: Upload fehlgeschlagen, Aktoren bereits lokal: ${
          e instanceof Error ? e.message : e
        }`
      );
    } else {
      throw e;
    }
  }
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
    await loadConfigs();
  }
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);
  return cam;
}

/*
 * Befehle an dieselbe Kamera laufen nacheinander. Reolink antwortet auf zwei
 * gleichzeitige PtzCtrl (Fahren und Stopp) mit „set config failed“ (-13).
 */
const ptzQueues = new Map<number, Promise<unknown>>();
function ptzSerial<T>(cameraId: number, fn: () => Promise<T>): Promise<T> {
  const prev = ptzQueues.get(cameraId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  ptzQueues.set(cameraId, next);
  void next.catch(() => {}).finally(() => {
    if (ptzQueues.get(cameraId) === next) ptzQueues.delete(cameraId);
  });
  return next;
}

/** Laufende Fahrt je Kamera: Sicherheits-Stopp nach durationMs. */
const ptzAutoStops = new Map<number, NodeJS.Timeout>();

/*
 * Kameras mit Zoom-Objektiv ohne Schwenkkopf (RLC-811A u. a.) nehmen
 * PtzCtrl ZoomInc/ZoomDec an, bewegen aber nichts. Sie zoomen nur ueber
 * StartZoomFocus auf eine absolute Position (wie reolink_aio).
 */
const zoomRanges = new Map<number, { min: number; max: number }>();
const ZOOM_FALLBACK_RANGE = { min: 0, max: 33 };

async function zoomOnlyCamera(cameraId: number): Promise<boolean> {
  const caps = capsCache.get(cameraId)?.caps ?? (await getCameraCaps(cameraId).catch(() => null));
  return !!caps && caps.zoom && !caps.pan;
}

async function readZoom(cam: CameraRuntime): Promise<{ pos: number; min: number; max: number }> {
  await ensureLogin(cam);
  let range = zoomRanges.get(cam.config.id);
  if (!range) {
    // action 1 liefert zusaetzlich den Wertebereich unter "range".
    const res = await fetch(
      `${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=GetZoomFocus&token=${encodeURIComponent(cam.token ?? "")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ cmd: "GetZoomFocus", action: 1, param: { channel: cam.config.channel } }]),
        signal: AbortSignal.timeout(8000),
      }
    ).catch(() => null);
    const json = res && res.ok ? ((await res.json().catch(() => null)) as Array<Record<string, unknown>> | null) : null;
    const r = (json?.[0]?.range as { ZoomFocus?: { zoom?: { pos?: { min?: number; max?: number } } } } | undefined)
      ?.ZoomFocus?.zoom?.pos;
    range =
      typeof r?.min === "number" && typeof r?.max === "number" && r.max > r.min
        ? { min: r.min, max: r.max }
        : ZOOM_FALLBACK_RANGE;
    zoomRanges.set(cam.config.id, range);
  }
  const value = await cgi(cam, "GetZoomFocus", { channel: cam.config.channel });
  const pos = Number((value.ZoomFocus as { zoom?: { pos?: number } } | undefined)?.zoom?.pos);
  if (!Number.isFinite(pos)) throw new Error("Kamera meldet keine Zoom-Position");
  return { pos, ...range };
}

async function writeZoom(cam: CameraRuntime, pos: number): Promise<void> {
  await cgi(cam, "StartZoomFocus", { ZoomFocus: { channel: cam.config.channel, op: "ZoomPos", pos } });
}

/**
 * Optischer Zoom ueber die absolute Position. Ohne pos/step nur lesen.
 * Liefert immer { pos, min, max }.
 */
export async function cameraZoom(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<{ pos: number; min: number; max: number }> {
  const cam = await getControlCam(cameraId);
  return ptzSerial(cameraId, async () => {
    const cur = await readZoom(cam);
    let target: number | null = null;
    if (payload?.pos != null && Number.isFinite(Number(payload.pos))) {
      target = clamp(Math.round(Number(payload.pos)), cur.min, cur.max);
    } else if (payload?.step != null && Number(payload.step) !== 0) {
      target = zoomStep(cur.pos, cur.min, cur.max, Number(payload.step) > 0 ? 1 : -1);
    }
    if (target == null || target === cur.pos) return cur;
    await writeZoom(cam, target);
    return { ...cur, pos: target };
  });
}

/**
 * PTZ-Steuerung. Richtungs-/Zoom-Ops laufen, bis "Stop" kommt, laengstens
 * `durationMs` (Default 800 ms, max 5 s) – der Hub stoppt dann selbst, damit
 * die Kamera bei verlorenem Loslassen nicht endlos weiterfaehrt. Die Antwort
 * kommt sofort, nicht erst nach dem Stopp.
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

  // Neuer Befehl ersetzt den Sicherheits-Stopp der vorigen Fahrt.
  const pending = ptzAutoStops.get(cameraId);
  if (pending) {
    clearTimeout(pending);
    ptzAutoStops.delete(cameraId);
  }

  if ((op === "ZoomInc" || op === "ZoomDec" || op === "Stop") && (await zoomOnlyCamera(cameraId))) {
    // Zoom-Objektiv ohne Schwenkkopf: ein Schritt pro Befehl, Stopp ist leer.
    if (op === "Stop") return { op, zoomOnly: true };
    const z = await cameraZoom(cameraId, { step: op === "ZoomInc" ? 1 : -1 });
    return { op, zoomOnly: true, zoom: z };
  }

  await ptzSerial(cameraId, async () => {
    await ensureLogin(cam);
    await cgi(cam, "PtzCtrl", param);
  });

  if (PTZ_CONTINUOUS_OPS.has(op)) {
    const durationMs = clamp(Number(payload?.durationMs) || 800, 100, 5000);
    const timer = setTimeout(() => {
      if (ptzAutoStops.get(cameraId) !== timer) return;
      ptzAutoStops.delete(cameraId);
      void ptzSerial(cameraId, () => cgi(cam, "PtzCtrl", { channel: cam.config.channel, op: "Stop", speed })).catch(
        (e) => log(`Kamera ${cam.config.name}: PTZ-Stopp fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }, durationMs);
    ptzAutoStops.set(cameraId, timer);
    return { op, speed, durationMs };
  }
  return { op, speed };
}

/* ---------------------------------------------------------------------------
 * Automatisch folgen (Reolink Auto-Tracking) und Regel-Aktion „Kamera steuern“
 * ------------------------------------------------------------------------- */

/** Schalter in Get/SetAiCfg (readTrackingCfg): `bSmartTrack`, sonst `aiTrack`. */
async function readAutoTrack(cam: CameraRuntime): Promise<{ key: string; on: boolean }> {
  await ensureLogin(cam);
  const t = readTrackingCfg(await cgi(cam, "GetAiCfg", { channel: cam.config.channel }));
  if (!t) throw new Error("Kamera kann nicht automatisch folgen (kein Auto-Tracking in GetAiCfg)");
  return { key: t.key, on: t.on };
}

async function writeAutoTrack(cam: CameraRuntime, key: string, on: boolean): Promise<void> {
  await cgi(cam, "SetAiCfg", { channel: cam.config.channel, [key]: on ? 1 : 0 });
}

/** Automatisch folgen an/aus. Liefert den vorherigen Zustand. */
export async function setAutoTrack(cameraId: number, on: boolean): Promise<{ autoTrack: boolean; was: boolean }> {
  const cam = await getControlCam(cameraId);
  const cur = await readAutoTrack(cam);
  if (cur.on !== on) await ptzSerial(cameraId, () => writeAutoTrack(cam, cur.key, on));
  return { autoTrack: on, was: cur.on };
}

/**
 * Laufende „zurueck nach N s“-Timer je Kamera; ein neuer Lauf verlaengert.
 * Faelligkeit und Zustand vorher stehen auch in hub/.cache/scene-returns.json
 * (in einem Zug ersetzt): Nach einem Neustart stellt der Hub eine abgelaufene
 * Szene sofort zurueck und setzt eine laufende neu an (`restoreSceneReturns`).
 */
const sceneReturns = new Map<
  number,
  { timer: NodeJS.Timeout; restoreTrack: boolean | null; presetId: number | null; dueAt: number; savedAt: number }
>();
const SCENE_RETURNS_FILE = path.join(CONFIG.hubDir, ".cache", "scene-returns.json");
let sceneReturnsWrite: Promise<void> = Promise.resolve();
/** Nach dem Start gespeichert, aber die Kamera-Liste war nicht zu laden: spaeter erneut (`restoreSceneReturns`). */
let waitingSceneReturns: SavedSceneReturn[] = [];
let sceneReturnRetry: NodeJS.Timeout | null = null;

/** Stand der Rueckkehr auf die Platte; Schreibvorgaenge nacheinander. Wirft nie. */
function saveSceneReturns(): void {
  const active = [...sceneReturns.entries()].map(([cameraId, r]) => ({
    cameraId,
    dueAt: r.dueAt,
    presetId: r.presetId,
    restoreTrack: r.restoreTrack,
    savedAt: r.savedAt,
  }));
  const data = JSON.stringify(sceneReturnsToSave(active, waitingSceneReturns));
  sceneReturnsWrite = sceneReturnsWrite
    .then(() => writeFileAtomic(SCENE_RETURNS_FILE, data))
    .catch((e) => log(`Kamera-Szenen: Rückkehr nicht gespeichert (${e instanceof Error ? e.message : e})`));
}

/**
 * Kamera nach einer Szene zurueckstellen: Tracking aus, Preset der Szene
 * erneut anfahren, Tracking wie vor der Szene. Nach einem Neustart haelt die
 * Automatik vorher still (`noteRule`, wartet auf ihr eigenes Zurueckstellen),
 * wie waehrend der Szene. Wirft nie.
 */
async function returnScene(
  cam: CameraRuntime,
  presetId: number | null,
  restoreTrack: boolean | null,
  afterRestart = false
): Promise<void> {
  const cameraId = cam.config.id;
  const send = <T>(fn: () => Promise<T>) => ptzSerial(cameraId, fn);
  try {
    if (afterRestart) await motion.noteRule(cameraId, SCENE_SETTLE_MS + 5_000);
    const now = await readAutoTrack(cam).catch(() => null);
    if (now?.on) await send(() => writeAutoTrack(cam, now.key, false));
    if (presetId != null) {
      await send(() => cgi(cam, "PtzCtrl", { channel: cam.config.channel, op: "ToPos", id: presetId, speed: 48 }));
    }
    if (now && restoreTrack) {
      await new Promise((r) => setTimeout(r, SCENE_SETTLE_MS));
      await send(() => writeAutoTrack(cam, now.key, true));
    }
    log(
      `Kamera ${cam.config.name}: Szene beendet${afterRestart ? " (nach Neustart)" : ""}, zurück${
        presetId != null ? ` auf Preset ${presetId}` : ""
      }`
    );
  } catch (e) {
    log(`Kamera ${cam.config.name}: Zurückstellen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}

/** Rueckkehr ansetzen und sichern. */
function armSceneReturn(
  cam: CameraRuntime,
  presetId: number | null,
  restoreTrack: boolean | null,
  dueAt: number,
  savedAt: number,
  afterRestart = false
): void {
  const cameraId = cam.config.id;
  const timer = setTimeout(() => {
    sceneReturns.delete(cameraId);
    saveSceneReturns();
    void returnScene(cam, presetId, restoreTrack, afterRestart);
  }, Math.max(0, dueAt - Date.now()));
  sceneReturns.set(cameraId, { timer, restoreTrack, presetId, dueAt, savedAt });
  saveSceneReturns();
}

/**
 * Nach dem Start: gespeicherte Rueckkehr der Szenen (scene-return-rules.ts).
 * Abgelaufene sofort, laufende neu angesetzt, Eintraege aelter als 24 h
 * verworfen (mit Log-Zeile). Eine Szene, die seit dem Start schon lief, hat
 * Vorrang. Ist die Kamera-Liste nicht zu laden (Cloud nicht erreichbar),
 * bleibt der Eintrag stehen, und der Hub versucht es jede Minute erneut
 * (`sceneReturnCamera`). Wirft nie.
 */
export async function restoreSceneReturns(): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(SCENE_RETURNS_FILE, "utf8"));
  } catch {
    return;
  }
  await applySceneReturns(parseSceneReturns(raw), true);
}

async function applySceneReturns(saved: SavedSceneReturn[], first: boolean): Promise<void> {
  const plan = dueSceneReturns(saved, Date.now());
  for (const r of plan.discarded) {
    const hours = Math.round((Date.now() - r.savedAt) / 3_600_000);
    log(`Kamera #${r.cameraId}: Rückkehr der Szene verworfen (vor ${hours} h gespeichert)`);
  }
  // Bis zur Entscheidung bleibt jeder Eintrag auf der Platte stehen; eine
  // neue Szene derselben Kamera uebernimmt ihn (`cameraScene`).
  waitingSceneReturns = [...plan.due, ...plan.later];
  let changed = plan.discarded.length > 0;
  const settle = (r: SavedSceneReturn) => {
    waitingSceneReturns = waitingSceneReturns.filter((w) => w !== r);
    changed = true;
  };
  for (const r of [...plan.due, ...plan.later]) {
    if (!waitingSceneReturns.includes(r) || sceneReturns.has(r.cameraId)) {
      settle(r);
      continue;
    }
    let listLoaded = true;
    if (!cameras.has(r.cameraId)) {
      try {
        await loadConfigs();
      } catch {
        listLoaded = false;
      }
    }
    const cam = cameras.get(r.cameraId);
    if (sceneReturnCamera(!!cam, listLoaded) === "retry") continue;
    // Waehrend des Ladens kann eine neue Szene begonnen haben: Sie hat Vorrang.
    const taken = !waitingSceneReturns.includes(r) || sceneReturns.has(r.cameraId);
    settle(r);
    if (taken) continue;
    if (!cam) {
      log(`Kamera #${r.cameraId}: Rückkehr der Szene verworfen (Kamera nicht konfiguriert oder deaktiviert)`);
    } else if (r.dueAt <= Date.now()) {
      saveSceneReturns();
      await returnScene(cam, r.presetId, r.restoreTrack, true);
    } else {
      armSceneReturn(cam, r.presetId, r.restoreTrack, r.dueAt, r.savedAt, true);
      log(`Kamera ${cam.config.name}: Rückkehr der Szene nach dem Neustart in ${Math.round((r.dueAt - Date.now()) / 1000)} s`);
    }
  }
  if (changed) saveSceneReturns();
  const waiting = waitingSceneReturns.length;
  if (waiting === 0) return;
  if (first || changed) {
    log(`Kamera-Szenen: ${waiting} Rückkehr nach dem Neustart wartet auf die Kamera-Liste, nächster Versuch in ${SCENE_RETURN_RETRY_MS / 1000} s`);
  }
  if (!sceneReturnRetry) {
    sceneReturnRetry = setTimeout(() => {
      sceneReturnRetry = null;
      void applySceneReturns([...waitingSceneReturns], false).catch((e) =>
        log(`Kamera-Szenen: Rückkehr nach dem Neustart fehlgeschlagen (${e instanceof Error ? e.message : e})`)
      );
    }, SCENE_RETURN_RETRY_MS);
  }
}

/**
 * Regel-Aktion „Kamera steuern“: erst automatisch folgen aus (sonst zieht die
 * Kamera sofort zurueck zum Ziel), Preset anfahren, dann folgen an/aus wie
 * gewuenscht. Optional nach `returnAfterSeconds` zurueck aufs Preset und
 * Folgen wieder wie vorher.
 */
export async function cameraScene(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const cam = await getControlCam(cameraId);
  const presetId = payload?.presetId == null ? null : Number(payload.presetId);
  const autoTrack = typeof payload?.autoTrack === "boolean" ? payload.autoTrack : null;
  const returnAfter = Number(payload?.returnAfterSeconds) || 0;
  if (presetId != null && !Number.isInteger(presetId)) throw new Error("presetId ungültig");
  if (presetId == null && autoTrack == null) throw new Error("Weder Preset noch Folgen angegeben");
  // Die Regel bewegt die Kamera: Automatik haelt still, bis sie zurueck ist.
  // Erst danach lesen, sonst gilt das Tracking des Hubs als Zustand vorher.
  // true: Das Tracking des Hubs liess sich nicht ausschalten; ein „an“
  // stammt dann vom Hub, vorher galt „aus“.
  const hubTrackOn = await motion.noteRule(
    cameraId,
    returnAfter > 0 ? returnAfter * 1000 + SCENE_SETTLE_MS + 5_000 : RULE_HOLD_MS
  );

  // Nur Preset: eine Kamera ohne Auto-Tracking ist in Ordnung.
  const track = await readAutoTrack(cam).catch((e) => {
    if (autoTrack != null) throw e;
    return null;
  });

  // Zustand vor der Szene merken – bei einer Verlaengerung den urspruenglichen.
  const pending = sceneReturns.get(cameraId);
  // Gelesen: Ab jetzt bestimmt die Regel das Tracking, der Hub versucht nicht
  // mehr, es auszuschalten. Ohne Lesen bleibt es beim Hub.
  if (track && hubTrackOn) await motion.ruleOwnsTracking(cameraId);
  // Rueckkehr von vor dem Neustart, die noch auf die Kamera-Liste wartet:
  // Diese Szene uebernimmt sie wie eine Verlaengerung.
  const waited = waitingSceneReturns.find((w) => w.cameraId === cameraId);
  if (waited) waitingSceneReturns = waitingSceneReturns.filter((w) => w !== waited);
  const before = track ? (hubTrackOn ? false : track.on) : null;
  const restoreTrack = pending ? pending.restoreTrack : waited ? waited.restoreTrack : before;
  if (pending) clearTimeout(pending.timer);
  sceneReturns.delete(cameraId);
  if ((pending || waited) && returnAfter <= 0) saveSceneReturns();

  // Befehle an die Kamera ueber ihre Warteschlange: Eine Fahrt der Automatik
  // (Grundstellung, Zoom, Tracking) kann gerade unterwegs sein, und zwei
  // gleichzeitige PtzCtrl beantwortet Reolink mit -13.
  const send = <T>(fn: () => Promise<T>) => ptzSerial(cameraId, fn);
  if (presetId != null) {
    if (track?.on) await send(() => writeAutoTrack(cam, track.key, false));
    await send(() => cgi(cam, "PtzCtrl", { channel: cam.config.channel, op: "ToPos", id: presetId, speed: 48 }));
  }
  // „unveraendert“ heisst: nach dem Anfahren wieder wie vorher.
  const wantTrack = autoTrack ?? before;
  if (track && wantTrack != null) {
    const isOn = presetId != null ? false : track.on;
    if (wantTrack !== isOn) {
      // Erst ankommen lassen, sonst folgt die Kamera schon unterwegs.
      if (wantTrack && presetId != null) await new Promise((r) => setTimeout(r, SCENE_SETTLE_MS));
      await send(() => writeAutoTrack(cam, track.key, wantTrack));
    }
  }

  if (returnAfter > 0) {
    const at = Date.now();
    armSceneReturn(cam, presetId, restoreTrack, at + returnAfter * 1000, at);
  }

  log(
    `Kamera ${cam.config.name}: Szene` +
      (presetId != null ? ` Preset ${presetId}` : "") +
      (wantTrack != null ? `, folgen ${wantTrack ? "an" : "aus"}` : "") +
      (returnAfter > 0 ? `, zurück nach ${returnAfter} s` : "")
  );
  return { presetId, autoTrack: wantTrack, returnAfterSeconds: returnAfter || null };
}

/**
 * Weisslicht-Scheinwerfer an/aus auf Anforderung (Cloud, Hub-Dashboard,
 * Assistent und Waechter-Knopf „Licht an“). Lichtmodus und Helligkeit
 * bleiben, wie die Kamera sie meldet (eine Abfrage GetWhiteLed davor);
 * eine Helligkeit aus dem Auftrag gilt nur beim Einschalten.
 */
export async function setSpotlight(
  cameraId: number,
  payload: Record<string, unknown> | null
): Promise<unknown> {
  const cam = await getControlCam(cameraId);
  const on = payload?.on === true;
  // Fehlt die Angabe oder ist sie 0 bzw. keine Zahl, gibt der Auftrag keine Helligkeit vor.
  const brightness = Number(payload?.brightness) || undefined;
  const cmd = await switchSpotlight(cam, on, { brightness });
  // Von Hand geschaltet: Das Licht gehoert nicht mehr dem Hub, nach einem
  // Neustart fasst er es nicht an.
  void lightMarks.delete(cameraId);
  return { on, brightness: cmd.param.bright ?? null, mode: cmd.param.mode };
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

/**
 * Ansage über den Kamera-Lautsprecher (ONVIF-Backchannel, siehe camera-talk.ts).
 * Nicht mit `setSiren` zu verwechseln: Die Sirene kann nur den eingebauten
 * Alarmton, hier kommt gesprochener Text heraus.
 */
export async function announceOnCamera(
  cameraId: number,
  text: string,
): Promise<{ seconds: number }> {
  const cam = await getControlCam(cameraId);
  return speakOnCamera(
    {
      host: cam.config.host,
      username: cam.config.username,
      password: cam.config.password,
      label: cam.config.name,
    },
    text,
  );
}

/**
 * Kamera per Cloud-ID oder Name finden – für Einstellungen, in denen eine
 * Kamera von Hand benannt wird und die ID nicht bekannt ist.
 */
export function findCameraByRef(ref: string): CameraConfig | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const asId = Number(trimmed);
  if (Number.isInteger(asId)) {
    const byId = cameras.get(asId);
    if (byId) return byId.config;
  }
  const wanted = trimmed.toLowerCase();
  for (const cam of cameras.values()) {
    if (cam.config.name.trim().toLowerCase() === wanted) return cam.config;
  }
  return null;
}

/** Alle bekannten Kamera-Konfigurationen (Stand des letzten Cloud-Abgleichs). */
export function listCameraConfigs(): CameraConfig[] {
  return [...cameras.values()].map((cam) => cam.config);
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
  const res = await api("/api/hub/cameras", { signal: AbortSignal.timeout(CONFIG_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Kamera-Konfig-Abruf fehlgeschlagen: HTTP ${res.status}`);
  const all = (await res.json()) as CameraConfig[];

  knownCameraIds = all.map((c) => c.id);
  // DoorBirds laufen über ihr eigenes Modul (Event-Push statt Polling).
  syncDoorbirds(all.filter((c) => c.kind === "DOORBIRD"));
  const configs = all.filter((c) => c.kind !== "DOORBIRD");

  const ids = new Set(configs.map((c) => c.id));
  // Kamera entfernt oder deaktiviert: Was an ihr noch lief, endet jetzt.
  // Sonst bliebe das Ereignis in der Cloud offen, bis der Hub neu startet.
  const ended: CloudEvent[] = [];
  for (const [id, cam] of cameras) {
    if (ids.has(id)) continue;
    for (const ev of endAll(cam.debounce)) {
      ended.push({ cameraId: id, type: ev.type, phase: "end", at: new Date(ev.at).toISOString() });
    }
    cameras.delete(id);
  }
  if (ended.length > 0) queueEventUpload(ended, []);
  for (const config of configs) {
    const existing = cameras.get(config.id);
    if (existing) {
      // Host in der Cloud geaendert (z. B. manueller Umzug in ein anderes
      // VLAN): lokale Stream-Konfiguration (go2rtc.yaml + Kiosk-config.json)
      // sofort nachziehen, sonst zeigt das Live-Video auf die alte IP.
      const oldHost = existing.config.host;
      if (oldHost && config.host && oldHost !== config.host) {
        log(`Kamera ${config.name}: Host ${oldHost} → ${config.host} (Cloud) – Streams werden umgestellt`);
        void updateLocalStreams(oldHost, config.host).catch(() => {});
      }
      // Bei geaenderten Zugangsdaten/Adresse Token verwerfen: Die naechste
      // Abfrage meldet sich neu an. Die Fehlversuche von vorher sagen ueber
      // die neue Adresse nichts und zaehlen fuer die Reihenfolge im Takt
      // nicht mehr (pollOrder). Eine Abfrage, die schon laeuft, geht noch an
      // den alten Stand und zaehlt wie jede andere; die naechste beginnt im
      // Takt nach ihrem Ende.
      const changed = JSON.stringify(existing.config) !== JSON.stringify(config);
      existing.config = config;
      if (changed) {
        existing.token = null;
        existing.tokenExpiresAt = 0;
        existing.failStreak = 0;
      }
    } else {
      // Stand die Kamera schon vor dem Neustart aus, geht die Adresssuche
      // weiter, wo sie war, statt mit jedem Start neu zu beginnen.
      const relocate = relocateAtStart(downMarks.get(config.id), Date.now());
      cameras.set(config.id, {
        config,
        token: null,
        tokenExpiresAt: 0,
        states: {},
        debounce: newDebounceState(),
        lastSnapshotAt: 0,
        lastAutoSnapshotAt: 0,
        autoSnapshotSent: false,
        snapshotInFlight: false,
        pendingVehicle: false,
        unreachableLogged: false,
        lastMacLearnAt: 0,
        lastRelocateAt: relocate.lastRelocateAt,
        relocating: false,
        pollInFlight: false,
        pollStartedAt: 0,
        failStreak: 0,
        downSince: relocate.downSince,
        reachable: false,
        lastError: null,
        lastEventAt: null,
        lastPerson: null,
        lastPlate: null,
      });
    }
  }
  void downMarks.keepOnly(ids);
  configLoadedAt = Date.now();
  void syncLocalStreamsFromCloud(
    all.map((c) => ({ name: c.name, host: c.host, kind: c.kind }))
  ).catch((e) => log(`Cloud-Stream-Sync: ${e instanceof Error ? e.message : e}`));
}

/**
 * Kamera-Liste laden. Mehrere Aufrufer (Poll, Auftrag aus der Cloud) teilen
 * sich einen Abruf. Scheitert er, lehnt das Promise ab; ins Log kommt die
 * Stoerung einmal und dann alle 10 min, nicht je Versuch.
 */
function loadConfigs(): Promise<void> {
  configRefresh ??= refreshConfigs()
    .then(
      () => {
        if (configFailedAt > 0) {
          configFailedAt = 0;
          configFailLog.shouldLog("config", "", Date.now());
          log("Kamera-Liste: Cloud wieder erreichbar");
        }
      },
      (e) => {
        configFailedAt = Date.now();
        const msg = e instanceof Error ? e.message : String(e);
        if (configFailLog.shouldLog("config", msg, Date.now())) {
          log(
            `Kamera-Liste nicht abrufbar (${msg})` +
              (cameras.size > 0 ? ` – ${cameras.size} bekannte Kameras werden weiter abgefragt` : "")
          );
        }
        throw e;
      }
    )
    .finally(() => {
      configRefresh = null;
    });
  return configRefresh;
}

/** Konfiguration sicherstellen – Tasks können vor dem ersten Kamera-Poll eintreffen. */
export async function ensureCameraConfigs(): Promise<void> {
  if (configLoadedAt === 0) await loadConfigs();
}

/** Nächster Poll zieht die Kamera-Liste neu (z. B. nach Ensure einer Parkkamera). */
export function markCameraConfigStale() {
  configLoadedAt = 0;
}

/** Kamera-Lage fuer das lokale Dashboard (ohne Zugangsdaten). */
export function listCameraStatus(): CameraStatus[] {
  return [...cameras.values()]
    .map((cam) => ({
      id: cam.config.id,
      name: cam.config.name,
      host: cam.config.host,
      kind: cam.config.kind ?? "REOLINK",
      vehicleDetection: cam.config.vehicleDetection !== false,
      reachable: cam.reachable,
      lastError: cam.lastError,
      activeStates: Object.entries(cam.states)
        .filter(([, active]) => active)
        .map(([type]) => type),
      busy: cam.snapshotInFlight,
      pendingVehicle: cam.pendingVehicle,
      lastSnapshotAt:
        Math.max(cam.lastSnapshotAt, cam.lastAutoSnapshotAt) > 0
          ? new Date(Math.max(cam.lastSnapshotAt, cam.lastAutoSnapshotAt)).toISOString()
          : null,
      lastEventAt: cam.lastEventAt,
      lastPerson: cam.lastPerson,
      lastPlate: cam.lastPlate,
      caps: capsCache.get(cam.config.id)?.caps ?? null,
      clock: clockCache.get(cam.config.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/* ---------------------------------------------------------------------------
 * Uhrzeit der Kameras (nur lesen). Zeigt in der Zentrale, ob die
 * eingeblendeten Uhrzeiten auseinanderlaufen. Alle 30 Minuten, angestossen
 * vom Dashboard.
 * ------------------------------------------------------------------------- */

const CLOCK_EVERY_MS = 30 * 60_000;
const clockCache = new Map<number, CameraClock>();
let clockCheckAt = 0;
/** Routinezeilen nur bei Aenderung, sonst einmal am Tag. */
const routineLog = new ChangeLog(24 * 3_600_000);

async function readCameraClock(cam: CameraRuntime): Promise<CameraClock> {
  await ensureLogin(cam);
  const t0 = Date.now();
  const v = await cgi(cam, "GetTime", {});
  const time = v.Time as Partial<ReolinkTime> | undefined;
  if (!time || ![time.year, time.mon, time.day, time.hour, time.min, time.sec].every((x) => Number.isFinite(Number(x)))) {
    throw new Error("GetTime ohne Uhrzeit");
  }
  // Mitte der Anfrage als Vergleichszeitpunkt.
  const mid = new Date((t0 + Date.now()) / 2);
  const offsetS = clockOffsetSeconds(
    { year: +time.year!, mon: +time.mon!, day: +time.day!, hour: +time.hour!, min: +time.min!, sec: +time.sec! },
    mid
  );
  let ntp: boolean | null = null;
  let ntpServer: string | null = null;
  try {
    const n = (await cgi(cam, "GetNtp", {})).Ntp as { enable?: number; server?: string } | undefined;
    if (n) {
      ntp = n.enable === 1;
      ntpServer = typeof n.server === "string" && n.server ? n.server : null;
    }
  } catch {
    // aeltere Firmware ohne GetNtp
  }
  return { offsetS, ntp, ntpServer, checkedAt: new Date().toISOString() };
}

/** Uhren aller erreichbaren Kameras lesen (hoechstens alle 30 min, force = sofort). */
export async function refreshCameraClocks(force = false): Promise<void> {
  if (!force && Date.now() - clockCheckAt < CLOCK_EVERY_MS) return;
  clockCheckAt = Date.now();
  let tried = 0;
  let read = 0;
  for (const cam of cameras.values()) {
    if (!cam.reachable) continue;
    tried++;
    try {
      clockCache.set(cam.config.id, await readCameraClock(cam));
      read++;
    } catch (e) {
      log(`Kamera ${cam.config.name}: Uhrzeit nicht lesbar (${e instanceof Error ? e.message : e})`);
    }
  }
  // Der letzte Stand einer entfernten Kamera zaehlt nicht mehr mit.
  for (const id of clockCache.keys()) {
    if (!cameras.has(id)) clockCache.delete(id);
  }
  // Ohne gelesene Uhr gibt es nichts zu melden („alle im Takt“ waere geraten).
  // War noch keine Kamera erreichbar (kurz nach dem Start), gleich beim
  // naechsten Abruf wieder versuchen statt erst in 30 min.
  if (read === 0) {
    if (tried === 0) clockCheckAt = 0;
    return;
  }
  const off = [...clockCache.entries()].filter(([, c]) => Math.abs(c.offsetS) >= 3);
  // Alle 30 min gelesen, aber nur gemeldet, wenn sich die Lage aendert
  // (und einmal am Tag zur Erinnerung): Die Zeile war sonst immer dieselbe.
  const key = clockDriftKey(
    off.map(([id, c]) => ({ name: cameras.get(id)?.config.name ?? String(id), offsetS: c.offsetS, ntp: c.ntp }))
  );
  if (!routineLog.shouldLog("clocks", key, Date.now())) return;
  if (off.length) {
    log(
      `Kamera-Uhren weichen ab: ${off
        .map(([id, c]) => `${cameras.get(id)?.config.name ?? id} ${c.offsetS > 0 ? "+" : ""}${c.offsetS} s${c.ntp === false ? " (NTP aus)" : ""}`)
        .join(", ")}`
    );
  } else {
    // Die Zahl der eben gelesenen Uhren: Im Zwischenspeicher steht auch der
    // letzte Stand von Kameras, die gerade nicht erreichbar sind.
    log(`Kamera-Uhren: alle ${read} im Takt`);
  }
}

/* ---------------------------------------------------------------------------
 * Faehigkeiten pro Kamera (Kamera-Zentrale im Dashboard zeigt nur, was geht)
 *
 * Quelle: GetAbility (abilityChn[channel]) + GetDevInfo. Interpretation wie
 * reolink_aio: ptzType 1 = nur Zoom (AF), 2/3/5 = Schwenken/Neigen,
 * 1/2/5 = Zoom. Modelltabelle aus webcams/lib/types.ts ergaenzt Luecken.
 * ------------------------------------------------------------------------- */

export interface CameraCaps {
  model: string | null;
  firmware: string | null;
  pan: boolean;
  zoom: boolean;
  presets: boolean;
  spotlight: boolean;
  ir: boolean;
  siren: boolean;
  /** Panorama (z. B. Duo): Bild ist deutlich breiter als 16:9. */
  wide: boolean;
  /** Woher: "ability" (von der Kamera) oder "model" (nur Modelltabelle). */
  source: "ability" | "model";
  checkedAt: string;
}

const CAPS_TTL_MS = 6 * 60 * 60 * 1000;
const capsCache = new Map<number, { caps: CameraCaps; at: number }>();

/** Bekannte Modelle, falls GetAbility fehlt oder unvollstaendig ist. */
const MODEL_CAPS: Array<{ match: RegExp; pan: boolean; zoom: boolean; spotlight: boolean; siren: boolean; wide?: boolean }> = [
  { match: /E1 Pro/i, pan: true, zoom: false, spotlight: false, siren: false },
  { match: /RLC-5\d\dA/i, pan: false, zoom: false, spotlight: false, siren: false },
  { match: /RLC-810A/i, pan: false, zoom: false, spotlight: false, siren: false },
  { match: /RLC-811A/i, pan: false, zoom: true, spotlight: true, siren: false },
  { match: /RLC-823/i, pan: true, zoom: true, spotlight: true, siren: true },
  { match: /GO PT/i, pan: true, zoom: false, spotlight: true, siren: true },
  { match: /Duo/i, pan: false, zoom: false, spotlight: true, siren: true, wide: true },
];

function abilityVer(chn: Record<string, unknown> | undefined, key: string): number {
  const v = chn?.[key] as { ver?: number; permit?: number } | undefined;
  return typeof v?.ver === "number" ? v.ver : 0;
}

export async function getCameraCaps(cameraId: number, force = false): Promise<CameraCaps> {
  const cached = capsCache.get(cameraId);
  if (!force && cached && Date.now() - cached.at < CAPS_TTL_MS) return cached.caps;
  const cam = await getControlCam(cameraId);
  await ensureLogin(cam);

  let model: string | null = null;
  let firmware: string | null = null;
  try {
    const info = (await cgi(cam, "GetDevInfo", {})).DevInfo as { model?: string; firmVer?: string } | undefined;
    model = info?.model ?? null;
    firmware = info?.firmVer ?? null;
  } catch {
    // aeltere Firmware: ohne Modell weiter
  }

  const known = model ? MODEL_CAPS.find((m) => m.match.test(model!)) : undefined;
  let caps: CameraCaps;
  try {
    const ability = (await cgi(cam, "GetAbility", { User: { userName: cam.config.username } })).Ability as
      | { abilityChn?: Array<Record<string, unknown>> }
      | undefined;
    const chn = ability?.abilityChn?.[cam.config.channel] ?? ability?.abilityChn?.[0];
    if (!chn) throw new Error("abilityChn fehlt");
    const ptzType = abilityVer(chn, "ptzType");
    const ptzCtrl = abilityVer(chn, "ptzCtrl");
    caps = {
      model,
      firmware,
      pan: [2, 3, 5].includes(ptzType) || (ptzType === 0 && ptzCtrl > 0 && !!known?.pan),
      zoom: [1, 2, 5].includes(ptzType) || abilityVer(chn, "supportPtzZoom") > 0,
      presets: abilityVer(chn, "ptzPreset") > 0,
      spotlight:
        abilityVer(chn, "floodLight") > 0 ||
        abilityVer(chn, "supportFLswitch") > 0 ||
        abilityVer(chn, "supportFLBrightness") > 0 ||
        !!known?.spotlight,
      ir: abilityVer(chn, "ledControl") > 0,
      siren: abilityVer(chn, "supportAudioAlarm") > 0 || abilityVer(chn, "supportAudioAlarmEnable") > 0 || !!known?.siren,
      wide: !!known?.wide,
      source: "ability",
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    log(`Kamera ${cam.config.name}: GetAbility nicht lesbar (${e instanceof Error ? e.message : e}) – nutze Modelltabelle`);
    caps = {
      model,
      firmware,
      pan: known?.pan ?? false,
      zoom: known?.zoom ?? false,
      presets: known?.pan ?? false,
      spotlight: known?.spotlight ?? false,
      ir: true,
      siren: known?.siren ?? false,
      wide: known?.wide ?? false,
      source: "model",
      checkedAt: new Date().toISOString(),
    };
  }
  capsCache.set(cameraId, { caps, at: Date.now() });
  log(
    `Kamera ${cam.config.name}: ${model ?? "Modell ?"} – ${["pan", "zoom", "presets", "spotlight", "ir", "siren", "wide"]
      .filter((k) => caps[k as keyof CameraCaps] === true)
      .join(", ") || "keine Steuerung"} (${caps.source})`
  );
  return caps;
}

/**
 * Nur lesen: Tracking-, Wachpositions- und Zoom-Einstellungen roh, wie die
 * Kamera sie liefert (Diagnose fuer Folgen und Nahaufnahme, CAMERA_CAPS motion).
 */
export async function getMotionDiagnostics(cameraId: number): Promise<Record<string, unknown>> {
  const cam = await getControlCam(cameraId);
  await ensureLogin(cam);
  const channel = cam.config.channel;
  const read = (cmd: string) =>
    cgi(cam, cmd, { channel }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  return {
    aiCfg: await read("GetAiCfg"),
    ptzGuard: await read("GetPtzGuard"),
    zoomFocus: await read("GetZoomFocus"),
  };
}

/* ---------------------------------------------------------------------------
 * Personen: Folgen und optische Nahaufnahme (camera-motion.ts)
 * ------------------------------------------------------------------------- */

const MOTION_FILE = path.join(CONFIG.hubDir, ".cache", "camera-motion.json");
const flagOn = (v: string | undefined) => !/^(0|false|off|nein)$/i.test((v ?? "").trim());
/** Schwenk-Kameras folgen auch bei offenem Raum (frueheres Verhalten). */
const FOLLOW_ALWAYS = followAlwaysOn(process.env.HUB_FOLLOW_ALWAYS);

/** Ortszeit-Stunde fuer das Nachtfenster; nicht lesbar = NaN (dann gilt es nicht). */
function localHourOrNaN(): number {
  try {
    return berlinHour();
  } catch {
    return Number.NaN;
  }
}

const motionDriver: MotionDriver = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
  async camera(id) {
    const cam = cameras.get(id);
    if (!cam) return null;
    const caps = await getCameraCaps(id).catch(() => null);
    if (!caps) return null;
    const { parkingCameraHosts } = await import("./parking.js");
    const hosts = await parkingCameraHosts().catch(() => new Set<string>());
    return { id, name: cam.config.name, model: caps.model, pan: caps.pan, zoom: caps.zoom, zone: isZoneCamera(cam.config, hosts) };
  },
  async readZoom(id) {
    const cam = await getControlCam(id);
    return ptzSerial(id, () => readZoom(cam));
  },
  async writeZoom(id, pos) {
    const cam = await getControlCam(id);
    await ptzSerial(id, () => writeZoom(cam, pos));
  },
  async readTracking(id) {
    const cam = await getControlCam(id);
    await ensureLogin(cam);
    return cgi(cam, "GetAiCfg", { channel: cam.config.channel });
  },
  async writeTracking(id, patch) {
    const cam = await getControlCam(id);
    await ptzSerial(id, async () => {
      await ensureLogin(cam);
      await cgi(cam, "SetAiCfg", { channel: cam.config.channel, ...patch });
    });
  },
  async readGuard(id) {
    const cam = await getControlCam(id);
    await ensureLogin(cam);
    const value = await cgi(cam, "GetPtzGuard", { channel: cam.config.channel }).catch(() => null);
    const g = value?.PtzGuard as { bexistPos?: number } | undefined;
    return { supported: !!g, exists: g?.bexistPos === 1 };
  },
  async guard(id, cmd) {
    const cam = await getControlCam(id);
    await ptzSerial(id, async () => {
      await ensureLogin(cam);
      await cgi(cam, "SetPtzGuard", {
        PtzGuard: { channel: cam.config.channel, cmdStr: cmd, ...(cmd === "setPos" ? { bSaveCurrentPos: 1 } : {}) },
      });
    });
  },
  async presets(id) {
    return ((await getPtzPresets(id)) as { presets: Array<{ id: number; name: string }> }).presets;
  },
  async gotoPreset(id, presetId) {
    const cam = await getControlCam(id);
    await ptzSerial(id, async () => {
      await ensureLogin(cam);
      await cgi(cam, "PtzCtrl", { channel: cam.config.channel, op: "ToPos", id: presetId, speed: 48 });
    });
  },
  async snap(id) {
    return captureSnap(await getControlCam(id));
  },
  persons: (jpeg) => detectPersons(jpeg),
  vehicleActive: (id) => cameras.get(id)?.states.VEHICLE === true,
  followRoom: (id) => ({
    closed: cameraRoomClosed(id),
    hour: localHourOrNaN(),
    nightWindow: sentinelNightWindow(),
    always: FOLLOW_ALWAYS,
  }),
  async save(moves) {
    await fs.mkdir(path.dirname(MOTION_FILE), { recursive: true });
    await fs.writeFile(MOTION_FILE, JSON.stringify(moves));
  },
  async load() {
    const raw = await fs.readFile(MOTION_FILE, "utf8").catch(() => "[]");
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as PersistedMove[]) : [];
  },
  log,
  warn: (where, title, detail) => recordHubEvent({ kind: "camera", severity: "warn", where, title, detail }),
  count: (kind, event, data) => improve(kind, event, data),
};

const motion = new CameraMotion(motionDriver, {
  follow: flagOn(process.env.HUB_CAMERA_AUTOFOLLOW),
  zoom: flagOn(process.env.HUB_CAMERA_AUTOZOOM),
});

/** Optische Nahaufnahme fuer Gesichtserkennung und Waechter (null = digital weiter). */
export function personCloseUp(cameraId: number): Promise<CloseUp | null> {
  return motion.closeUp(cameraId);
}

/** Kamera steht in Grundstellung (Zonen-Auswertungen). */
export function cameraAtHome(cameraId: number): boolean {
  return motion.atHome(cameraId);
}

/** Die Kamera meldet gerade selbst ein Fahrzeug (VEHICLE aus dem Poll). */
export function cameraVehicleActive(cameraId: number): boolean {
  return cameras.get(cameraId)?.states.VEHICLE === true;
}

const vehicleStartListeners = new Set<(cameraId: number) => void>();

/**
 * Bei jeder VEHICLE-Flanke einer Kamera aufrufen (Halteverbot: kurzer Takt).
 * Der Zuhörer schaltet nichts und darf den Poll nicht aufhalten.
 */
export function onCameraVehicleStart(fn: (cameraId: number) => void): () => void {
  vehicleStartListeners.add(fn);
  return () => vehicleStartListeners.delete(fn);
}

function notifyVehicleStart(cameraId: number): void {
  for (const fn of vehicleStartListeners) {
    try {
      fn(cameraId);
    } catch (err) {
      log(`Kamera ${cameraId}: Fahrzeug-Zuhörer: ${err instanceof Error ? err.message : err}`);
    }
  }
}

export function waitCameraAtHome(cameraId: number, maxMs: number): Promise<boolean> {
  return motion.waitAtHome(cameraId, maxMs);
}

export function cameraFollowing(cameraId: number): boolean {
  return motion.isFollowing(cameraId);
}

/**
 * Handsteuerung aus Zentrale, Cloud oder Assistent: Automatik haelt 5 min
 * still. Fertig, sobald sie die Kamera abgegeben hat (Tracking des Hubs aus),
 * hoechstens nach HAND_HANDOVER_MAX_MS: Steht die Uebergabe hinter einem
 * laufenden Kamerabefehl der Automatik, geht der Befehl von Hand trotzdem
 * hinaus, und das Tracking des Hubs geht gleich danach aus.
 */
export async function noteCameraHand(cameraId: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), HAND_HANDOVER_MAX_MS);
  });
  try {
    // noteHand faengt eigene Fehler ab und wird nie abgelehnt.
    if ((await Promise.race([motion.noteHand(cameraId), late])) === "late") {
      improve("camera", "hand_handover_late", { cam: cameras.get(cameraId)?.config.name ?? cameraId });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Beim Hub-Start: von einem Neustart unterbrochene Bewegungen zurueckstellen. */
export function restoreCameraMotion(): Promise<void> {
  return motion.restore();
}

/** Kamera-Id zu einer IP (Kiosk-Konfiguration der Parkflaeche). */
export function cameraIdByHost(host: string): number | null {
  for (const cam of cameras.values()) if (cam.config.host === host) return cam.config.id;
  return null;
}

/* ---------------------------------------------------------------------------
 * MAC-basiertes IP-Re-Mapping: Der Hub lernt die MAC-Adresse jeder erreichten
 * Kamera (ARP-Tabelle) und meldet sie an die Cloud. Ist eine Kamera spaeter
 * unter ihrer IP nicht erreichbar, wird die MAC in der ARP-Tabelle gesucht -
 * taucht sie unter neuer IP auf (DHCP-Wechsel), stellt der Hub automatisch
 * um und aktualisiert die Cloud-Konfiguration.
 * ------------------------------------------------------------------------- */

/** MAC hoechstens einmal pro Stunde pro Kamera nachschlagen/lernen. */
const MAC_LEARN_INTERVAL_MS = 3_600_000;
/** Abstand der Re-Mapping-Versuche: relocateIntervalMs in camera-poll-rules.ts. */
const relocateStepLog = new ChangeLog();
/**
 * Seit wann eine Kamera nicht antwortet (Kamera-ID und Zeitpunkt), auf der
 * Platte: Die Stufen der Adresssuche zaehlen ab dem Ausfallbeginn, und der
 * Hub startet mehrmals am Tag neu (Update).
 */
const downMarks = new CameraMarks(path.join(CONFIG.hubDir, ".cache", "cameras-down.json"));

/** Ausfallbeginn einer Kamera setzen (bleibt, wenn sie schon aussteht) oder loeschen; auf die Platte nur bei Aenderung. */
function setDownSince(cam: CameraRuntime, at: number | null): void {
  if ((cam.downSince === null) === (at === null)) return;
  cam.downSince = at;
  void (at === null ? downMarks.delete(cam.config.id) : downMarks.set(cam.config.id, at));
}

export async function reportNetworkUpdate(
  cameraId: number,
  data: { macAddress?: string; host?: string }
): Promise<boolean> {
  const res = await api(`/api/hub/cameras/${cameraId}/network`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.ok;
}

/** MAC direkt von der Kamera (Reolink GetLocalLink) – funktioniert auch geroutet. */
async function readMacFromCamera(cam: CameraRuntime): Promise<string | null> {
  try {
    await ensureLogin(cam);
    const value = await cgi(cam, "GetLocalLink", {});
    const mac = (value.LocalLink as { mac?: string } | undefined)?.mac;
    return mac ? normalizeMac(mac) : null;
  } catch {
    return null;
  }
}

/** Per Kamera-API gelesene MACs fremder IPs (geroutete VLANs), 10 min gueltig. */
const probedMacs = new Map<string, { mac: string | null; at: number }>();
const PROBE_TTL_MS = 600_000;
const MAX_PROBES = 40;

/**
 * Fallback ohne ARP-Treffer (geroutetes VLAN, kein Router-SNMP): Kandidaten
 * aus dem letzten Netzwerk-Scan (Reolink/RTSP, keiner anderen Kamera
 * zugeordnet) mit den Zugangsdaten dieser Kamera nach ihrer MAC fragen.
 */
async function findCameraByApi(cam: CameraRuntime): Promise<string | null> {
  const wanted = cam.config.macAddress;
  if (!wanted) return null;
  const taken = new Set([...cameras.values()].map((c) => c.config.host));
  const candidates = lastScanResult()
    .devices.filter(
      (d) =>
        !taken.has(d.ip) &&
        (d.mac === null || d.mac === wanted) &&
        (/reolink/i.test(d.vendor ?? "") || d.openPorts.includes(554))
    )
    .map((d) => d.ip)
    .slice(0, MAX_PROBES);
  for (const ip of candidates) {
    const cached = probedMacs.get(ip);
    let mac = cached && Date.now() - cached.at < PROBE_TTL_MS ? cached.mac : undefined;
    if (mac === undefined) {
      const probe: CameraRuntime = {
        ...cam,
        config: { ...cam.config, host: ip },
        token: null,
        tokenExpiresAt: 0,
      };
      mac = await readMacFromCamera(probe);
      probedMacs.set(ip, { mac, at: Date.now() });
    }
    if (mac === wanted) return ip;
  }
  return null;
}

/** MAC der (gerade erfolgreich erreichten) Kamera aus der ARP-Tabelle lernen. */
async function learnCameraMac(cam: CameraRuntime): Promise<void> {
  if (Date.now() - cam.lastMacLearnAt < MAC_LEARN_INTERVAL_MS) return;
  cam.lastMacLearnAt = Date.now();
  try {
    // Lokale ARP-Tabelle, ARP-Tabelle des Routers (SNMP) oder – im gerouteten
    // VLAN ohne SNMP – die Kamera selbst (GetLocalLink).
    const mac = (await macForIp(cam.config.host)) ?? (await readMacFromCamera(cam));
    if (!mac || mac === cam.config.macAddress) return;
    const ok = await reportNetworkUpdate(cam.config.id, { macAddress: mac });
    if (ok) {
      cam.config.macAddress = mac;
      log(`Kamera ${cam.config.name}: MAC ${mac} gelernt (${cam.config.host})`);
    }
  } catch {
    // Best-effort: naechster Versuch nach Intervall.
  }
}

/**
 * Kamera unerreichbar: MAC in der ARP-Tabelle (lokal + Router) suchen. Taucht
 * sie unter einer anderen IP auf (z. B. VLAN-Umzug 192.168.1.x -> 192.168.30.x),
 * sofort umstellen und die Cloud aktualisieren.
 */
async function tryRelocateCamera(cam: CameraRuntime): Promise<boolean> {
  if (!cam.config.macAddress) return false;
  // Ein Lauf kann laenger dauern als sein Abstand (Ping-Sweep, bis zu 40
  // Anmeldeversuche): nie zwei nebeneinander.
  if (cam.relocating) return false;
  const downForMs = cam.downSince ? Date.now() - cam.downSince : 0;
  const everyMs = relocateIntervalMs(downForMs);
  if (Date.now() - cam.lastRelocateAt < everyMs) return false;
  cam.lastRelocateAt = Date.now();
  cam.relocating = true;
  improveCount("camera", "relocate_search");
  if (everyMs > 60_000 && relocateStepLog.shouldLog(String(cam.config.id), String(everyMs), Date.now())) {
    log(
      `Kamera ${cam.config.name}: seit ${Math.round(downForMs / 60_000)} min nicht erreichbar – ` +
        `Suche unter neuer Adresse nur noch alle ${Math.round(everyMs / 60_000)} min`
    );
  }
  try {
    // Sucht in lokaler + Router-ARP-Tabelle; ohne Treffer werden die direkt
    // angeschlossenen Subnetze (auch VLAN-Interfaces) einmal angepingt.
    const ip =
      (await findIpByMac(cam.config.macAddress, { sweep: true, exclude: cam.config.host })) ??
      (relocateByLoginAllowed(downForMs) ? await findCameraByApi(cam) : null);
    if (ip) {
      const oldHost = cam.config.host;
      cam.config.host = ip;
      cam.token = null;
      cam.tokenExpiresAt = 0;
      log(`Kamera ${cam.config.name}: per MAC unter neuer IP gefunden (${oldHost} → ${ip})`);
      // Unter der neuen Adresse zaehlen die Fehlversuche von vorher nicht
      // mehr: Die Kamera reiht sich im Takt wieder vorn ein (pollOrder).
      cam.failStreak = 0;
      const ok = await reportNetworkUpdate(cam.config.id, { host: ip });
      if (!ok) log(`Kamera ${cam.config.name}: IP-Update in der Cloud fehlgeschlagen`);
      // Lokale Stream-Konfiguration (go2rtc + Kiosk) nachziehen, damit auch
      // das Live-Video im Kontrollzentrum der neuen IP folgt.
      void updateLocalStreams(oldHost, ip).catch(() => {});
      return true;
    }
  } catch {
    // Best-effort: naechster Versuch nach Throttle.
  } finally {
    cam.relocating = false;
  }
  return false;
}

let pollBusy = false;

/**
 * Erreichbarkeits-Meldung (seen) drosseln: Die Cloud markiert Kameras erst
 * nach 5 min ohne Lebenszeichen als offline – ein Update pro Minute reicht.
 * Ereignisse werden weiterhin sofort gemeldet, aber ohne die Liste: Vorher
 * hing sie an jeder Ereignis-Meldung und schrieb in der Cloud jedes Mal alle
 * Kamera-Zeilen neu (mehrere tausend Mal am Tag).
 */
const SEEN_REPORT_MS = 60_000;
let lastSeenReportAt = 0;
/** Seit der letzten Meldung erreichte Kameras (ein einzelner Aussetzer zaehlt nicht). */
const seenSinceReport = new Set<number>();

interface CloudEvent {
  cameraId: number;
  type: string;
  phase: "start" | "end";
  at: string;
  plate?: string;
  /** Beginn: Bewegungs-Regeln, die der Hub dazu selbst geschaltet hat (rules.ts, `onCameraEvent`). */
  hubRules?: Array<{ ruleId: number; configAt: string }>;
}

/*
 * Meldungen an die Cloud laufen nacheinander und ausserhalb des Poll-Takts.
 * Braucht die Cloud fuer eine Meldung lange, fragt der Hub die Kameras
 * trotzdem weiter alle 2 s ab; vorher stand die Abfrage so lange still, wie
 * die Meldung brauchte (bis zum Zeitlimit von 30 s) – auch fuer die
 * Einfahrt. Auch die Kamera-Liste laedt im Hintergrund (loadConfigs): Ohne
 * Cloud laeuft die Abfrage mit dem letzten Stand weiter. Scheitert eine
 * Meldung, entfallen ihre Beginne wie bisher; ihre Enden gehen noch einmal
 * mit (endsToRetry), und was dann noch laeuft, traegt die Cloud ueber die
 * Liste der laufenden Ereignisse nach. Ein Beginn, der in der Warteschlange
 * zu alt wird, entfaellt ebenfalls (tidyOutbox): Regeln sollen nie zu einem
 * Ereignis von vorhin laufen.
 */
const EVENT_UPLOAD_TIMEOUT_MS = 15_000;
const EVENT_BATCH_MAX = 100;
const EVENT_OUTBOX_MAX = 400;
/** Nach einer gescheiterten Meldung: naechster Versuch fruehestens so spaet. */
const EVENT_UPLOAD_RETRY_MS = 10_000;
/** So lange sammelt der Hub die Meldungen der Kameras eines Takts. */
const EVENT_COALESCE_MS = 250;
let eventUploadTimer: ReturnType<typeof setTimeout> | null = null;
const eventOutbox: CloudEvent[] = [];
/**
 * Wann ein Ereignis eingereiht wurde, auf einer Uhr, die niemand stellt
 * (performance.now()). Wie lange ein Beginn schon wartet, haengt so nicht
 * allein an der Wanduhr des Hubs (tidyOutbox).
 */
const queuedAt = new WeakMap<CloudEvent, number>();
/**
 * Beginne, zu denen der Hub gerade Bewegungs-Regeln selbst schaltet: Die
 * Meldung wartet, bis feststeht, welche gelangen (hoechstens 5 s, rules.ts),
 * damit die Cloud genau diese auslaesst. Was dahinter steht, wartet mit, die
 * Reihenfolge bleibt; was davor steht, geht gleich (camera-poll-rules.ts,
 * `EventGates`).
 */
const eventGates = new EventGates<CloudEvent>();
const seenOutbox = new Set<number>();
/**
 * Was an den Kameras laeuft, festgehalten beim Einreihen der Erreichbarkeit:
 * In dem Moment decken sich Entprellung und Warteschlange (jede Abfrage
 * reiht ihre Ereignisse ohne Pause nach dem Entprellen ein). Gesendet wird
 * die Liste nur, wenn bis dahin nichts Neues dazukam; sonst legte die Cloud
 * einen Beginn doppelt an, der noch in der Warteschlange steht.
 */
const runningReport = new RunningReport<{ cameraId: number; type: string; at: string }>();
/**
 * Beginne aus gescheiterten Meldungen: Die Cloud kann sie trotzdem kennen.
 * Ihr Ende bleibt auch in einer vollen Warteschlange stehen (tidyOutbox),
 * zusammen hoechstens eine halbe Meldung: Was stehen bleibt, geht jedes Mal
 * wieder mit, und in der Meldung muss Platz fuer juengere Enden bleiben.
 */
const unconfirmedStarts = new UnconfirmedStarts();
const UNCONFIRMED_ENDS_MAX = EVENT_BATCH_MAX / 2;
let eventUploadRunning = false;
/** Laufende Stoerung: Die Zeile kommt einmal und dann alle 5 min, nicht je Versuch. */
let eventUploadFailing = false;
const uploadFailLog = new ChangeLog(5 * 60_000);
/** Start dieses Hub-Prozesses: Ereignisse von davor kann er nicht mehr beenden. */
const PROCESS_STARTED_AT = new Date().toISOString();
/** Bis die Cloud einmal bestaetigt hat, dass sie die Ereignisse von vor dem Start geschlossen hat. */
let orphansClosed = false;
/** Alle Kameras dieses Hubs inklusive DoorBird (fuer das Schliessen nach dem Start). */
let knownCameraIds: number[] = [];

/** Was seit der letzten Log-Zeile aus der Warteschlange fiel. */
const outboxLoss = { staleStarts: 0, staleEnds: 0, cutStarts: 0, cutEnds: 0 };
let outboxLossLoggedAt = 0;
const OUTBOX_LOSS_LOG_MS = 5 * 60_000;
/** Waehrend einer Stoerung steht der Ausfall selbst schon im Log: die Summe nur stuendlich. */
const OUTBOX_LOSS_LOG_FAILING_MS = 60 * 60_000;

/**
 * Verluste der Warteschlange ins Log: gesammelt in einer Zeile, nicht je
 * Vorfall. Nach einer Stoerung in jedem Fall (`force`): einmal, wenn die
 * Cloud wieder da ist, und noch einmal, wenn die Warteschlange abgearbeitet
 * ist. Bis dahin koennen wartende Beginne noch zu alt werden.
 */
function logOutboxLoss(force = false): void {
  const { staleStarts, staleEnds, cutStarts, cutEnds } = outboxLoss;
  if (staleStarts + staleEnds + cutStarts + cutEnds === 0) return;
  const every = eventUploadFailing ? OUTBOX_LOSS_LOG_FAILING_MS : OUTBOX_LOSS_LOG_MS;
  if (!force && Date.now() - outboxLossLoggedAt < every) return;
  outboxLossLoggedAt = Date.now();
  const starts = (n: number) => `${n} ${n === 1 ? "Beginn" : "Beginne"}`;
  const ends = (n: number) => `${n} ${n === 1 ? "Ende" : "Enden"}`;
  const parts: string[] = [];
  if (staleStarts > 0) {
    parts.push(
      `${starts(staleStarts)} nicht mehr gemeldet (älter als ${START_MAX_AGE_MS / 1000} s, dafür laufen keine Regeln)` +
        (staleEnds > 0 ? `, ${ends(staleEnds)} dazu entfallen` : "")
    );
  }
  if (cutStarts + cutEnds > 0) {
    parts.push(`Warteschlange voll, ${ends(cutEnds)} und ${starts(cutStarts)} verworfen`);
  }
  log(`Kamera-Event-Upload: ${parts.join("; ")}`);
  outboxLoss.staleStarts = outboxLoss.staleEnds = outboxLoss.cutStarts = outboxLoss.cutEnds = 0;
}

/** Warteschlange aufraeumen (zu alte Beginne, Obergrenze), vor jeder Meldung und nach jedem Einreihen. */
function tidyEventOutbox(): void {
  const steady = performance.now();
  const t = tidyOutbox(eventOutbox, Date.now(), START_MAX_AGE_MS, EVENT_OUTBOX_MAX, {
    unconfirmed: unconfirmedStarts,
    unconfirmedMax: UNCONFIRMED_ENDS_MAX,
    waitedMs: (e) => steady - (queuedAt.get(e) ?? steady),
  });
  if (t.queue.length === eventOutbox.length) return;
  eventOutbox.length = 0;
  eventOutbox.push(...t.queue);
  outboxLoss.staleStarts += t.staleStarts;
  outboxLoss.staleEnds += t.staleEnds;
  outboxLoss.cutStarts += t.cutStarts;
  outboxLoss.cutEnds += t.cutEnds;
  for (let i = 0; i < t.staleStarts; i++) improveCount("camera", "event_start_stale");
  logOutboxLoss();
}

function queueEventUpload(events: CloudEvent[], seen: number[]): void {
  if (events.length > 0) runningReport.enqueued();
  const steady = performance.now();
  for (const e of events) queuedAt.set(e, steady);
  eventOutbox.push(...events);
  tidyEventOutbox();
  for (const id of seen) seenOutbox.add(id);
  // Mit der Erreichbarkeit (einmal je Minute) geht mit, was gerade laeuft.
  if (seen.length > 0) runningReport.capture(runningEvents());
  // Jede Kamera meldet fuer sich; was im selben Takt anfaellt, geht trotzdem
  // in einem Aufruf hinaus (eine laufende Meldung nimmt Neues ohnehin mit).
  if (eventUploadRunning || eventUploadTimer) return;
  eventUploadTimer = setTimeout(() => {
    eventUploadTimer = null;
    void drainEventUploads();
  }, EVENT_COALESCE_MS);
}

/** Gescheiterte Meldung: einmal ins Log, Enden zuruecklegen, bald neu versuchen. */
function eventUploadFailed(
  events: CloudEvent[],
  running: Array<{ cameraId: number; type: string; at: string }> | undefined,
  reason: string
): void {
  if (uploadFailLog.shouldLog("upload", reason, Date.now())) {
    log(`Kamera-Event-Upload fehlgeschlagen: ${reason}`);
  }
  eventUploadFailing = true;
  unconfirmedStarts.failed(events, running);
  eventOutbox.unshift(...endsToRetry(events));
  // Die naechste faellige Erreichbarkeits-Meldung stoesst den neuen Versuch an.
  lastSeenReportAt = Date.now() - SEEN_REPORT_MS + EVENT_UPLOAD_RETRY_MS;
}

/** Was an den Kameras gerade als Ereignis laeuft (Stand der Entprellung). */
function runningEvents(): Array<{ cameraId: number; type: string; at: string }> {
  const out: Array<{ cameraId: number; type: string; at: string }> = [];
  for (const cam of cameras.values()) {
    for (const r of runningOf(cam.debounce)) {
      out.push({ cameraId: cam.config.id, type: r.type, at: new Date(r.at).toISOString() });
    }
  }
  return out;
}

async function drainEventUploads(): Promise<void> {
  eventUploadRunning = true;
  /** In diesem Durchlauf kam nach einer Stoerung wieder eine Meldung an. */
  let recovered = false;
  try {
    while (eventOutbox.length > 0 || seenOutbox.size > 0) {
      // Erst jetzt entscheiden, was noch hinausgeht: Seit dem Einreihen kann
      // ein Beginn zu alt geworden sein (gescheiterte Versuche davor).
      tidyEventOutbox();
      if (eventOutbox.length === 0 && seenOutbox.size === 0) break;
      // Bis vor den ersten Beginn, dessen Regeln der Hub noch schaltet; steht
      // er vorn, wartet die Meldung auf ihn. Kein Beginn geht ohne hubRules hinaus.
      const events = await eventGates.take(eventOutbox, EVENT_BATCH_MAX);
      if (events.length === 0 && seenOutbox.size === 0) continue;
      const seen = [...seenOutbox];
      seenOutbox.clear();
      const lastAlive = previousAliveAt();
      const closeOpen =
        !orphansClosed && knownCameraIds.length > 0
          ? { cameraIds: knownCameraIds, before: PROCESS_STARTED_AT, ...(lastAlive ? { lastAlive } : {}) }
          : undefined;
      // Was gerade laeuft: Ein Beginn, dessen Meldung scheiterte, wird nicht
      // wiederholt, die Cloud traegt das Ereignis anhand dieser Liste nach.
      // Sie geht nur mit, wenn sie genau der Stand nach den Ereignissen
      // dieser Meldung ist: Die Meldung leert die Warteschlange, und seit
      // dem Festhalten kam nichts Neues dazu. Sonst mit der naechsten Minute.
      const running = runningReport.take(eventOutbox.length === 0) ?? undefined;
      let ok = false;
      try {
        const sentAt = performance.now();
        const res = await api("/api/hub/camera-events", {
          method: "POST",
          body: JSON.stringify({
            events,
            seen,
            ...(running ? { running } : {}),
            ...(closeOpen ? { closeOpen } : {}),
          }),
          signal: AbortSignal.timeout(EVENT_UPLOAD_TIMEOUT_MS),
        });
        if (!res.ok) {
          eventUploadFailed(events, running, `HTTP ${res.status}`);
        } else {
          ok = true;
          unconfirmedStarts.delivered(events);
          const body = (await res.json().catch(() => null)) as {
            rulesTriggered?: number;
            orphansClosed?: number;
            orphansMore?: boolean;
            runningCreated?: number;
          } | null;
          // Je ausgeloester Regel eine Log-Zeile mit Kamera, Ereignisart und
          // Antwortzeit der Cloud (eine aeltere Cloud nennt nur die Zahl).
          noteTriggeredRules(body, performance.now() - sentAt);
          // Abgleich der laufenden Ereignisse (eine aeltere Cloud-Version
          // kennt die Liste nicht und antwortet ohne diese Angabe).
          if (running && typeof body?.runningCreated === "number" && body.runningCreated > 0) {
            log(`Kamera-Ereignisse: ${body.runningCreated} laufende in der Cloud nachgetragen`);
          }
          // Erst abhaken, wenn die Cloud es bestaetigt: Eine aeltere Cloud-
          // Version kennt closeOpen nicht und antwortet ohne diese Angabe.
          if (closeOpen && typeof body?.orphansClosed === "number" && !body.orphansMore) {
            orphansClosed = true;
            if (body.orphansClosed > 0) {
              log(`Kamera-Ereignisse: ${body.orphansClosed} offene von vor dem Hub-Start geschlossen`);
            }
          }
          if (eventUploadFailing) {
            eventUploadFailing = false;
            uploadFailLog.shouldLog("upload", "", Date.now());
            log("Kamera-Event-Upload: Cloud wieder erreichbar");
            logOutboxLoss(true);
            recovered = true;
          }
          // Regel ausgeloest (z. B. Kamera auf Preset): Tasks sofort holen.
          if ((body?.rulesTriggered ?? 0) > 0) kickTaskPoll();
        }
      } catch (e) {
        eventUploadFailed(events, running, e instanceof Error ? e.message : String(e));
      }
      // Nach einem Fehlschlag nicht sofort weiterprobieren (Cloud oder
      // Internet weg): Der naechste faellige Durchlauf nimmt den Rest mit.
      if (!ok) break;
    }
    // Was nach der Zeile zur Erholung noch entfiel, waehrend der Rest der
    // Warteschlange hinausging. Scheiterte dabei wieder eine Meldung, bleibt
    // die Summe stehen, bis die Cloud das naechste Mal wieder da ist.
    if (recovered && !eventUploadFailing) logOutboxLoss(true);
  } finally {
    eventUploadRunning = false;
  }
}

/*
 * Abfrage der Kameras: Jede laeuft fuer sich. Der Takt (alle 2 s) stoesst nur
 * an, was faellig ist; Bild-Pipelines, Regeln und die Meldung an die Cloud
 * starten, sobald die eine Kamera geantwortet hat. Vorher wartete jede Runde
 * auf alle Kameras: Eine einzige, die bis zum Zeitlimit von 8 s haengt, hielt
 * so lange die Erkennung an allen anderen auf, auch den Kennzeichen-Burst an
 * der Einfahrt.
 */
const POLL_CONCURRENCY = 6;
const pollQueue: CameraRuntime[] = [];
let pollActive = 0;
/** Ab dieser Dauer gilt eine Abfrage als langsam und ein Fehlversuch als lang (Zeitlimit der Kamera: 8 s). */
const POLL_SLOW_MS = 4_000;
const pollSlowLog = new ChangeLog(10 * 60_000);
/** Laengste Abfrage im laufenden 5-Minuten-Fenster (fuer das Lagebild). */
const POLL_STATS_WINDOW_MS = 5 * 60_000;
let pollStats = { since: Date.now(), maxMs: 0, maxName: null as string | null, slow: 0 };

/**
 * Dauer einer gelungenen Abfrage festhalten. Eine Zeitueberschreitung zaehlt
 * hier nicht: Sie steht schon als „nicht erreichbar“ im Log und im Zaehler
 * camera.unreachable, und im Hoechstwert verdeckte sie die Kamera, die
 * antwortet, aber langsam.
 */
function notePollDuration(cam: CameraRuntime, tookMs: number): void {
  const now = Date.now();
  if (now - pollStats.since > POLL_STATS_WINDOW_MS) {
    pollStats = { since: now, maxMs: 0, maxName: null, slow: 0 };
  }
  if (tookMs > pollStats.maxMs) {
    pollStats.maxMs = tookMs;
    pollStats.maxName = cam.config.name;
  }
  if (tookMs < POLL_SLOW_MS) return;
  pollStats.slow++;
  improveCount("camera", "poll_slow");
  if (pollSlowLog.shouldLog(String(cam.config.id), "slow", now)) {
    log(`Kamera ${cam.config.name}: Abfrage dauerte ${(tookMs / 1000).toFixed(1)} s (die anderen Kameras laufen weiter)`);
  }
}

function pumpPolls(): void {
  while (pollActive < POLL_CONCURRENCY && pollQueue.length > 0) {
    const cam = pollQueue.shift()!;
    pollActive++;
    cam.pollStartedAt = Date.now();
    void pollOne(cam)
      .catch((e) => log(`Kamera ${cam.config.name}: Abfrage: ${e instanceof Error ? e.message : e}`))
      .finally(() => {
        pollActive--;
        cam.pollInFlight = false;
        pumpPolls();
      });
  }
}

/** Eine Kamera abfragen und alles Weitere fuer sie anstossen. */
async function pollOne(cam: CameraRuntime): Promise<void> {
  const startedAt = Date.now();
  const events: CloudEvent[] = [];
  /** Bild-Pipelines der neuen Flanken (snapshotPlan in camera-poll-rules.ts). */
  let plan: SnapshotPlan = { vehicle: false, person: false, auto: null, held: false };
  try {
    const states = await pollStates(cam);
    // Waehrend der Abfrage entfernt oder deaktiviert (die Kamera-Liste laedt
    // daneben): Ihre Ereignisse sind schon beendet, nichts Neues beginnen.
    if (cameras.get(cam.config.id) !== cam) return;
    notePollDuration(cam, Date.now() - startedAt);
    seenSinceReport.add(cam.config.id);
    noteLink(`cam:${cam.config.id}`, cam.config.name, "camera", true);
    if (!cam.reachable && cam.lastError) {
      recordHubEvent({
        kind: "camera",
        severity: "info",
        where: cam.config.name,
        title: "wieder erreichbar",
      });
      relocateStepLog.shouldLog(String(cam.config.id), "", Date.now());
    }
    cam.reachable = true;
    cam.lastError = null;
    cam.unreachableLogged = false;
    cam.failStreak = 0;
    setDownSince(cam, null);
    void learnCameraMac(cam);

    // Person oder Fahrzeug an der Kamera, vor dem Uebernehmen dieser Messung:
    // Dann ist Bewegung keine reine Bewegung, ihr Bild bleibt wie bisher.
    const othersActive = personOrVehicleActive(states, cam.states, cam.debounce.reported);
    // Rohe Flanken starten die Bild-Pipelines (schnell, zweiter Wagen).
    const edges: string[] = [];
    for (const [type, active] of Object.entries(states)) {
      const was = cam.states[type] ?? false;
      if (active && !was) {
        if (type === "PERSON") {
          void motion
            .onPersonStart(cam.config.id)
            .catch((e) => log(`Kamera ${cam.config.name}: Folgen: ${e instanceof Error ? e.message : e}`));
        } else if (type === "VEHICLE") {
          motion.onVehicleStart(cam.config.id);
          notifyVehicleStart(cam.config.id);
        }
        edges.push(type);
      }
      cam.states[type] = active;
    }
    // Kennzeichen nie drosseln; ein Anzeige-Bild (Bewegung) sperrt die
    // Gesichtserkennung nicht mehr (snapshotJobFor in camera-poll-rules.ts).
    // Reine Bewegung holt ihr Vorschaubild hoechstens alle
    // MOTION_SNAPSHOT_MIN_MS (autoSnapshotDue).
    plan = snapshotPlan(
      edges,
      {
        inFlight: cam.snapshotInFlight,
        now: Date.now(),
        lastPipelineAt: cam.lastSnapshotAt,
        lastAutoAt: cam.lastAutoSnapshotAt,
        throttleMs: EVENT_SNAPSHOT_THROTTLE_MS,
        minMotionMs: MOTION_SNAPSHOT_MIN_MS,
        autoSent: cam.autoSnapshotSent,
        othersActive,
      },
      MOTION_PREVIEW,
      DISPLAY_SNAPSHOT
    );
    // Fuer die Ruhe-Regeln im Notbetrieb zaehlt jede Messung mit Alarm,
    // nicht nur der Beginn eines Ereignisses (ein langes Ereignis galt
    // sonst nach `idleMinutes` als Ruhe).
    if (Object.values(states).some(Boolean)) noteCameraActivity(cam.config.id);

    // Entprellte Ereignisse gehen an Cloud, Regeln und Lagebild.
    for (const ev of debounceEvents(cam.debounce, states, Date.now(), eventEndHold)) {
      if (ev.type === "PERSON" && ev.phase === "end") {
        void motion
          .onPersonEnd(cam.config.id)
          .catch((e) => log(`Kamera ${cam.config.name}: Folgen beenden: ${e instanceof Error ? e.message : e}`));
      }
      const at = new Date(ev.at).toISOString();
      events.push({ cameraId: cam.config.id, type: ev.type, phase: ev.phase, at });
      cam.lastEventAt = at;
      recordHubEvent({
        kind: "camera",
        severity: "info",
        where: cam.config.name,
        title: `${ev.type} ${ev.phase === "start" ? "erkannt" : "beendet"}`,
      });
    }
  } catch (e) {
    // Entfernte Kamera: weder melden noch im Netz nach ihr suchen.
    if (cameras.get(cam.config.id) !== cam) return;
    const msg = e instanceof Error ? e.message : String(e);
    if (cam.reachable || !cam.lastError) {
      recordHubEvent({
        kind: "camera",
        severity: "warn",
        where: cam.config.name,
        title: "nicht erreichbar",
        detail: msg,
      });
      improveCount("camera", "unreachable");
    }
    cam.reachable = false;
    cam.lastError = msg;
    // Nur ein Versuch, der lange lief, zaehlt: Solche Kameras kommen im Takt
    // nach denen an die Reihe, die antworten oder sofort ablehnen (pollOrder).
    cam.failStreak = failStreakAfter(cam.failStreak, Date.now() - startedAt, POLL_SLOW_MS);
    setDownSince(cam, Date.now());
    noteLink(`cam:${cam.config.id}`, cam.config.name, "camera", false, msg);
    if (!cam.unreachableLogged) {
      log(`Kamera ${cam.config.name}: ${msg}`);
      cam.unreachableLogged = true;
    }
    void tryRelocateCamera(cam);
  }

  // Regeln auf dem Hub (Ruhe-Erkennung, Notbetrieb ohne Cloud, markierte
  // Bewegungs-Regeln direkt): Die Meldung des Beginns nennt, was gelang.
  for (const e of events) {
    if (e.phase !== "start") continue;
    const local = onCameraEvent(e.cameraId, e.type, { at: Date.parse(e.at), camera: cam.config.name, source: "camera" });
    if (!local) continue;
    eventGates.set(
      e,
      local.then((ran) => {
        if (ran.length > 0) e.hubRules = ran;
      }),
    );
  }

  // Bild-Pipelines laufen ohne await. Fahrzeug vor Person: Das Kennzeichen
  // entscheidet ueber das Tor, das Gesicht kann die paar Sekunden warten.
  const cameraId = cam.config.id;
  const wantPerson = plan.person;
  const auto = plan.auto;
  if (plan.vehicle) {
    void (async () => {
      try {
        await uploadVehicleSnapshot(cameraId);
      } catch (e) {
        log(`Fahrzeug-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      }
      if (!wantPerson) return;
      try {
        await uploadPersonSnapshot(cameraId);
      } catch (e) {
        log(`Personen-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      }
    })();
  } else if (wantPerson) {
    uploadPersonSnapshot(cameraId).catch((e) =>
      log(`Personen-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
    );
  } else if (auto) {
    // Reine Bewegung: kleines Vorschaubild (MOTION_PREVIEW), sonst das
    // bisherige Anzeige-Bild (snapshotPlan). Nur gezaehlt, keine Zeile je Bild.
    uploadSnapshot(cameraId, auto)
      .then(({ bytes }) => {
        improveCount("camera", "preview_upload");
        improveCount("camera", "preview_bytes", bytes);
      })
      .catch((e) => {
        // Ohne Cloud scheitert jedes Anzeige-Bild mit demselben Grund: gezaehlt
        // wird jedes, ins Log kommt es je Kamera und Grund alle 5 min einmal.
        const msg = e instanceof Error ? e.message : String(e);
        improveCount("camera", "snapshot_fail");
        if (autoSnapshotFailLog.shouldLog(`${cameraId}:${msg}`, msg, Date.now())) {
          log(`Auto-Snapshot ${cam.config.name} (Kamera ${cameraId}) fehlgeschlagen: ${msg}`);
        }
      });
  } else if (plan.held) {
    improveCount("camera", "preview_skip");
  }

  // Erst die Pipelines, dann die Cloud – auch die ohne await
  // (queueEventUpload): weder die Tuer noch die naechste Abfrage warten auf
  // den Upload der Ereignisse.
  if (events.length === 0) return;
  queueEventUpload(events, []);
  for (const e of events) {
    // Reine Bewegung nur zaehlen: Diese Zeilen waren ein Fuenftel des
    // Hub-Logs; Beginn und Ende stehen in der Cloud (Kamera-Ereignisse).
    if (e.type === "MOTION") {
      if (e.phase === "start") improveCount("camera", "motion");
      continue;
    }
    log(`Kamera ${cam.config.name}: ${e.type} ${e.phase === "start" ? "erkannt" : "beendet"}`);
  }
}

/** Haupt-Loop: Konfiguration aktuell halten, faellige Kameras abfragen, Erreichbarkeit melden. */
export async function pollCameras(): Promise<void> {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const plan = configRefreshPlan({
      now: Date.now(),
      loadedAt: configLoadedAt,
      failedAt: configFailedAt,
      running: configRefresh !== null,
      haveCameras: cameras.size > 0,
      refreshMs: CONFIG_REFRESH_MS,
      retryMs: CONFIG_RETRY_MS,
    });
    // Mit bekannten Kameras nie auf die Cloud warten: Faellt sie aus, laufen
    // Erkennung und Notbetrieb mit dem letzten Stand weiter.
    if (plan === "wait") await loadConfigs();
    else if (plan === "background") void loadConfigs().catch(() => {});

    settleLightMarks(Date.now());

    const list = [...cameras.values()];
    if (list.length === 0) {
      STATE.cameras = {
        lastPollAt: new Date().toISOString(),
        configured: 0,
        reachable: 0,
        openEvents: 0,
        error: configFailedAt > 0 ? "Kamera-Liste nicht abrufbar" : null,
        pollMaxMs: 0,
        pollSlow: 0,
        pollSlowest: null,
      };
      return;
    }

    const now = Date.now();
    const due = list.filter((cam) =>
      pollDue({
        now,
        lastStartAt: cam.pollStartedAt,
        inFlight: cam.pollInFlight,
        baseMs: CAMERA_POLL_INTERVAL_MS,
      })
    );
    // Kameras, die antworten, zuerst: Eine haengende haelt ihren Platz bis
    // zum Zeitlimit und soll ihn nicht vor ihnen bekommen.
    for (const cam of pollOrder(due)) {
      cam.pollInFlight = true;
      pollQueue.push(cam);
    }
    pumpPolls();

    // Erreichbarkeit hoechstens einmal je Minute; stoesst nach einer
    // gescheiterten Meldung auch den naechsten Versuch an.
    if (seenSinceReport.size > 0 && now - lastSeenReportAt >= SEEN_REPORT_MS) {
      const seenNow = [...seenSinceReport];
      seenSinceReport.clear();
      lastSeenReportAt = now;
      queueEventUpload([], seenNow);
    }

    void motion.tick().catch((e) => log(`Kamera-Bewegung: ${e instanceof Error ? e.message : e}`));

    STATE.cameras = {
      lastPollAt: new Date().toISOString(),
      configured: list.length,
      reachable: list.filter((c) => c.reachable).length,
      openEvents: list.reduce((sum, c) => sum + Object.values(c.debounce.reported).filter(Boolean).length, 0),
      error: configFailedAt > 0 ? "Kamera-Liste nicht abrufbar – Abfrage mit dem letzten Stand" : null,
      pollMaxMs: pollStats.maxMs,
      pollSlow: pollStats.slow,
      pollSlowest: pollStats.maxName,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    STATE.cameras = {
      lastPollAt: new Date().toISOString(),
      configured: cameras.size,
      reachable: 0,
      openEvents: 0,
      error: msg,
      pollMaxMs: pollStats.maxMs,
      pollSlow: pollStats.slow,
      pollSlowest: pollStats.maxName,
    };
    // Die Stoerung der Kamera-Liste meldet loadConfigs selbst (gedrosselt).
    if (configFailedAt === 0) log(`Kamera-Poll-Fehler: ${msg}`);
  } finally {
    pollBusy = false;
  }
}

/**
 * Poll-Takt. Seit die Kameras im eigenen VLAN direkt erreichbar sind und
 * Bewegung + KI in einem Request kommen, reichen 2 s statt 5 s (im Mittel
 * ~1,5 s schneller bis zum Burst). Env HUB_CAMERA_POLL_INTERVAL in Sekunden,
 * ab 1.
 */
export const CAMERA_POLL_INTERVAL_MS = (() => {
  const n = Number(process.env.HUB_CAMERA_POLL_INTERVAL);
  return (Number.isFinite(n) && n >= 1 ? n : 2) * 1000;
})();
