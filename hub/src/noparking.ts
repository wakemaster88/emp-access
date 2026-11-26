/**
 * Halteverbot: Fahrzeuge finden, die in einer gesperrten Fläche stehen
 * bleiben – am Eingang der Schotterstreifen rechts neben der Straße.
 *
 * Kurzes Halten ist erlaubt, Stehenbleiben nicht. Der Unterschied ist allein
 * die Zeit, und genau die fehlt der übrigen Erkennung: `vision.ts` bewertet
 * Einzelbilder ohne Gedächtnis, und der Zonenzähler im Tracker weiß nur, wie
 * viele Fahrzeuge gerade in einer Fläche sind, nicht seit wann.
 *
 * Darum hier ein eigener Takt: ein Schnappschuss alle 20 s, solange etwas in
 * der Fläche ist, bei leerer Fläche alle 60 s (nachts 120 s; checkDelay in
 * noparking-rules.ts), die Fahrzeug-Boxen über die Zeit wiedererkennen und
 * mitzählen, wie lange dieselbe Box an derselben Stelle liegt. Ein stehendes Auto ist dafür der
 * einfachste Fall – es bewegt sich nicht, die Boxen sind fast deckungsgleich.
 * Deshalb genügt die Überdeckung zweier Boxen; ein dauerhafter RTSP-Stream mit
 * Objektverfolgung wäre für stehende Fahrzeuge unnötiger Aufwand.
 *
 * Geprüft wird der Radaufstandspunkt (Mitte der Box-Unterkante), nicht der
 * Mittelpunkt: Ein hoher Transporter neben der Fläche würde mit seinem
 * Mittelpunkt hineinragen, steht aber mit den Rädern daneben.
 *
 * Was gemeldet wird, entscheidet planReport (noparking-rules.ts): Ansage
 * höchstens zweimal je Fahrzeug, Nachricht beim ersten Fahrzeug einer
 * Episode mit Erinnerungen nach 30, 60 und 120 Minuten, nachts keine
 * Nachricht, ein Bild je Fahrzeug in der Historie. Dasselbe Fahrzeug ist eine
 * Box an derselben Stelle nur, solange die Stelle nicht länger beobachtet leer
 * war (sameVehicleGap); Zeiten ohne Beobachtung zählen nicht als leer. Der
 * Zustand liegt in hub/.cache/noparking.json und wird vor jeder Meldung
 * gesichert, damit ein Neustart keine zweite Erstmeldung auslöst. Zur ersten
 * Meldung eines Fahrzeugs kommt ein Ausschnitt in voller Auflösung dazu
 * (evidenceRect), in die Historie; zur ersten Nachricht genau ein Ausschnitt
 * in Telegram.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { berlinHour } from "./agent/quiet.js";
import { writeFileAtomic } from "./atomic-file.js";
import { CONFIG, api, log } from "./config.js";
import {
  announceOnCamera,
  cameraAtHome,
  cameraVehicleActive,
  captureSnapshot,
  findCameraByRef,
  listCameraConfigs,
  onCameraVehicleStart,
  type CameraConfig,
} from "./cameras.js";
import { ChangeLog } from "./change-log.js";
import { improve, improveCount, improveOutcome } from "./improve-log.js";
import { TRAIL_NOPARKING } from "./improve-rules.js";
import { snapshotTrack, trackEvents, type TrackEvent } from "./noparking-diag-rules.js";
import { recordHubEvent } from "./state.js";
import { DISPLAY_SNAPSHOT_MAX_PX, shrinkJpeg } from "./image.js";
import { jpegSize } from "./image-rules.js";
import { cropJpeg } from "./person-crop.js";
import { CheckLoop } from "./check-loop.js";
import {
  CHECK_REASON_TEXT,
  DEFAULT_MIN_AREA,
  DEFAULT_MIN_CONF,
  EVIDENCE_FACTOR,
  EVIDENCE_MIN_WIDTH_PX,
  IDLE_CHECK_MS,
  MAX_REPORT_TRIES,
  MIN_CHECK_GAP_MS,
  NIGHT_CHECK_MS,
  SPEAK_WAIT_MS,
  STUCK_RUN_MS,
  AttemptImages,
  applyDelivery,
  applyPlan,
  coverBoxes,
  emptyTrackState,
  evidenceKeyFor,
  evidenceRect,
  finishThenSave,
  hasTrackState,
  needsCloud,
  noteBlind,
  observedGapLimitMs,
  parseTrackStates,
  planReport,
  relevantBoxes,
  reportKeys,
  runExclusive,
  saveDue,
  serialQueue,
  serializeTrackStates,
  soonestCheck,
  track,
  unionBox,
  waitAtMost,
  type NoParkRun,
  type ReportPlan,
  type RunSlot,
  type TrackState,
} from "./noparking-rules.js";
import {
  SHADOW_IMGSZ,
  shadowCompare,
  shadowDue,
  shadowEnabled,
  usedRoi,
  zoneRoi,
} from "./noparking-shadow-rules.js";
import { SHUTDOWN_MAX_MS, onShutdown } from "./shutdown.js";
import { classify } from "./tracker-client.js";
import { detectVehicles, type VehicleBox } from "./vision.js";
import { parseZone, type Point } from "./zone-rules.js";

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
  /** Kurzer Takt der Schnappschüsse, solange etwas in der Fläche ist. */
  intervalSec: numEnv("HUB_NOPARK_INTERVAL", 20, 5),
  /** HUB_NOPARK_FIXED_INTERVAL=1: immer der kurze Takt, auch bei leerer Fläche. */
  fixedInterval: process.env.HUB_NOPARK_FIXED_INTERVAL === "1",
  minArea: numEnv("HUB_NOPARK_MIN_AREA", DEFAULT_MIN_AREA),
  minConf: numEnv("HUB_NOPARK_MIN_CONF", DEFAULT_MIN_CONF),
  /** Ansage über den Kamera-Lautsprecher. */
  speak: process.env.HUB_NOPARK_SPEAK !== "0",
  text:
    process.env.HUB_NOPARK_TEXT ||
    "Achtung. Sie parken im Halteverbot. Bitte entfernen Sie Ihr Fahrzeug.",
  /** Nur in diesem Zeitfenster ansagen (Stunden, lokale Zeit) – nachts still. */
  speakFrom: numEnv("HUB_NOPARK_SPEAK_FROM", 8, 0),
  speakTo: numEnv("HUB_NOPARK_SPEAK_TO", 22, 0),
  /**
   * Nachrichten (Push, Telegram) nur in diesem Zeitfenster (Stunden,
   * Ortszeit); außerhalb geht keine hinaus, weder die erste noch eine
   * Erinnerung. Historie und Ansage sind davon nicht berührt.
   */
  notifyFrom: numEnv("HUB_NOPARK_NOTIFY_FROM", 7, 0),
  notifyTo: numEnv("HUB_NOPARK_NOTIFY_TO", 22, 0),
  /**
   * Vergleich mit der Erkennung auf einem Ausschnitt der Fläche (nur
   * zählen, noparking-shadow-rules.ts). HUB_NOPARK_SHADOW=0: kein Vergleich.
   */
  shadow: shadowEnabled(process.env.HUB_NOPARK_SHADOW),
};

/** Wie lange die Meldung an die Cloud höchstens dauern darf. */
const REPORT_TIMEOUT_MS = 20_000;

export const NOPARK_INTERVAL_MS = CONF.intervalSec * 1000;

/**
 * Längster Abstand zweier Prüfungen, der als beobachtet gilt: aus dem
 * längsten eingestellten Takt (observedGapLimitMs), damit bei langem
 * HUB_NOPARK_INTERVAL leere Prüfungen zählen und eine Episode endet.
 */
const NOPARK_GAP_LIMIT_MS = observedGapLimitMs(Math.max(NOPARK_INTERVAL_MS, IDLE_CHECK_MS, NIGHT_CHECK_MS));

/* ---------------------------------------------------------------------------
 * Zone
 * ------------------------------------------------------------------------- */

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
 * Was gerade steht
 * ------------------------------------------------------------------------- */

interface CameraState extends TrackState {
  lastRunAt: number;
  lastError: string | null;
  /** Letzter Durchlauf ohne Ergebnis (Fehler, Tracker weg, Kamera nicht in Grundstellung): kurzer Takt. */
  lastRunFailed: boolean;
  /** Letzte VEHICLE-Flanke der Kamera selbst (0 = keine): kurzer Takt. */
  vehicleEventAt: number;
}

const states = new Map<number, CameraState>();

function stateFor(cameraId: number): CameraState {
  let state = states.get(cameraId);
  if (!state) {
    state = { ...emptyTrackState(), lastRunAt: 0, lastError: null, lastRunFailed: false, vehicleEventAt: 0 };
    states.set(cameraId, state);
  }
  return state;
}

/* ---------------------------------------------------------------------------
 * Zustand auf der Platte
 * ------------------------------------------------------------------------- */

const STATE_FILE = path.join(CONFIG.hubDir, ".cache", "noparking.json");
/** Zuletzt geschriebener Stand (ohne Zeitstempel), damit eine leere Fläche nichts schreibt. */
let savedKey = "";
/** Zeitpunkt des letzten Sicherns (für STATE_REFRESH_MS). */
let savedAt = 0;
let loading: Promise<void> | null = null;
/** Die Datei ist gelesen (oder fehlt): Erst ab dann darf sie überschrieben werden. */
let loaded = false;

/** Gesicherten Zustand einmal beim ersten Durchlauf laden (Höchstalter in parseTrackStates). */
function loadSavedState(): Promise<void> {
  loading ??= (async () => {
    const raw = await readFile(STATE_FILE, "utf8").catch(() => "");
    if (!raw) return;
    const fromFile = parseTrackStates(raw, Date.now());
    for (const [id, track] of fromFile) {
      if (!states.has(id)) states.set(id, { ...track, lastRunAt: 0, lastError: null, lastRunFailed: false, vehicleEventAt: 0 });
    }
    const known = [...fromFile.values()].flatMap((t) => [...t.standing, ...t.lost.filter((l) => !l.gone)]);
    const vehicles = known.length;
    const reported = known.filter((v) => v.reportedAt > 0).length;
    if (fromFile.size > 0) {
      log(
        `Halteverbot: Zustand nach dem Neustart übernommen (${vehicles} Fahrzeug${vehicles === 1 ? "" : "e"}, davon ${reported} gemeldet; ` +
          `die Zeit bis zur ersten Prüfung zählt nicht als leer)`,
      );
    }
    savedKey = serializeTrackStates(states, 0);
    savedAt = Date.now();
  })()
    .catch((err) => log(`Halteverbot: gesicherter Zustand nicht lesbar (${err instanceof Error ? err.message : err})`))
    .finally(() => {
      loaded = true;
    });
  return loading;
}

/** Sichern nacheinander: Durchlauf und Beenden teilen sich dieselbe Hilfsdatei (atomic-file.ts). */
const serially = serialQueue();

/**
 * Zustand sichern, wenn saveDue es verlangt (Änderung, Auffrischen nach
 * STATE_REFRESH_MS, `force` beim Beenden). Aufrufe laufen nacheinander.
 * Wirft nie.
 */
function saveState(force = false): Promise<void> {
  return serially(async () => {
    const now = Date.now();
    const key = serializeTrackStates(states, 0);
    if (!saveDue({ loaded, key, savedKey, savedAt, now, hasState: hasTrackState(states.values()), force })) return;
    try {
      await writeFileAtomic(STATE_FILE, serializeTrackStates(states, now));
      savedKey = key;
      savedAt = now;
    } catch (err) {
      log(`Halteverbot: Zustand nicht gesichert (${err instanceof Error ? err.message : err})`);
    }
  });
}

/** Der laufende Durchlauf (null = keiner), damit das Beenden kurz auf ihn wartet. */
let currentPass: Promise<void> | null = null;
/** So lange wartet das Beenden auf den laufenden Durchlauf; danach bleibt Zeit fürs Sichern. */
const SHUTDOWN_PASS_WAIT_MS = Math.max(0, SHUTDOWN_MAX_MS - 1_000);

// Ein Durchlauf, der gerade meldet, setzt seine Marken noch; danach sichern.
// Endet er nicht rechtzeitig, trägt der nächste Versuch nach dem Neustart
// denselben Schlüssel (reportKeys), und die Cloud legt nichts doppelt an.
onShutdown("halteverbot", () => finishThenSave(currentPass, SHUTDOWN_PASS_WAIT_MS, () => saveState(true)));

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

/* ---------------------------------------------------------------------------
 * Melden
 * ------------------------------------------------------------------------- */

/** Ansage-Fenster nach der Uhr des Macs (Stunde mit Minutenanteil). */
function speakHour(at: Date): number {
  return at.getHours() + at.getMinutes() / 60;
}

/** Ortszeit-Stunde für das Nachrichten-Fenster; ist sie nicht lesbar, die Uhr des Macs. */
function notifyHour(at: Date): number {
  try {
    return berlinHour(at);
  } catch {
    return at.getHours();
  }
}

function standingLabel(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

/** Antwort der Cloud auf eine Meldung (ältere Clouds kennen nicht alle Felder). */
interface CloudAnswer {
  ok: boolean;
  status: number;
  error?: string;
  sightingId?: number | null;
  pushed?: number;
  telegram?: number;
  skipped?: string;
  /** Neuere Cloud: hat sich nach notify/store gerichtet. */
  hubDecides?: boolean;
  /** Neuere Cloud: nimmt zur Sichtung einen Ausschnitt an (/evidence). */
  evidence?: boolean;
  /** Neuere Cloud: wiederholter Versuch, die Sichtung zu diesem Schlüssel gab es schon. */
  sightingExisted?: boolean;
  /** Neuere Cloud: Ausschnitt des gespeicherten Eintrags (evidenceKey) an so viele Telegram-Chats. */
  evidenceTelegram?: number;
}

/** Schlüssel einer Meldung (reportKeys) und, für die erste Nachricht ohne neuen Eintrag, der des gespeicherten (evidenceKeyFor). */
interface ReportKeys {
  storeKey: string | null;
  notifyKey: string | null;
  evidenceKey: string | null;
}

/**
 * Meldung an die Cloud. `retry`: Das Bild ist das des ersten Versuchs
 * (AttemptImages) – eine neuere Cloud setzt es nicht als aktuelles Kamerabild.
 */
async function sendReport(cameraId: number, plan: ReportPlan, keys: ReportKeys, small: Buffer, retry: boolean): Promise<CloudAnswer> {
  const q = new URLSearchParams({
    cameraId: String(cameraId),
    vehicles: String(Math.max(1, plan.store.length || plan.inZone)),
    seconds: String(plan.seconds),
    // Ab hier liest nur eine neuere Cloud mit; eine ältere entscheidet wie bisher.
    notify: plan.notify ? "1" : "0",
    store: plan.store.length > 0 ? "1" : "0",
    inZone: String(plan.inZone),
  });
  if (plan.notify?.kind === "reminder") q.set("reminder", String(plan.notify.n));
  // Gleich bei jedem Versuch: Die Cloud legt nichts doppelt an (ältere ignorieren sie).
  if (keys.storeKey) q.set("storeKey", keys.storeKey);
  if (keys.notifyKey) q.set("notifyKey", keys.notifyKey);
  // Erste Nachricht ohne neuen Eintrag: Die Cloud schickt den Ausschnitt des gespeicherten mit.
  if (keys.evidenceKey) q.set("evidenceKey", keys.evidenceKey);
  if (retry) q.set("retry", "1");
  try {
    const res = await api(`/api/hub/parking-violations?${q.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(small),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as Partial<CloudAnswer> | null;
    return {
      ok: res.ok,
      status: res.status,
      sightingId: typeof body?.sightingId === "number" ? body.sightingId : null,
      pushed: Number(body?.pushed) || 0,
      telegram: Number(body?.telegram) || 0,
      skipped: typeof body?.skipped === "string" ? body.skipped : undefined,
      hubDecides: body?.hubDecides === true,
      evidence: body?.evidence === true,
      sightingExisted: body?.sightingExisted === true,
      evidenceTelegram: Number(body?.evidenceTelegram) || 0,
      error: res.ok ? undefined : typeof (body as { error?: unknown } | null)?.error === "string" ? String((body as { error: string }).error) : undefined,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ausschnitt in voller Auflösung um die Fahrzeuge der ersten Meldung, die in
 * diesem Bild zu sehen sind (evidenceRect). null, wenn keines zu sehen ist
 * oder das Ausschneiden scheitert – die Meldung geht dann wie bisher allein
 * mit dem Übersichtsbild hinaus.
 */
async function evidenceCrop(jpeg: Buffer, plan: ReportPlan): Promise<{ jpeg: Buffer; px: string } | null> {
  const box = unionBox(plan.store.filter((s) => s.misses === 0).map((s) => s.box));
  const size = jpegSize(jpeg);
  if (!box || !size) return null;
  const rect = evidenceRect(box, EVIDENCE_FACTOR, size.width, size.height);
  if (!rect) return null;
  const out = await cropJpeg(jpeg, rect, EVIDENCE_MIN_WIDTH_PX);
  return out ? { jpeg: out, px: `${Math.round(rect.w * size.width)}×${Math.round(rect.h * size.height)} px` } : null;
}

/**
 * Bilder des ersten Versuchs je Meldung (Übersicht für die Cloud, Ausschnitt),
 * nur im Speicher. `attached`: Der Ausschnitt liegt schon in der Historie
 * (nach einer nicht zugestellten Nachricht, HTTP 502).
 */
const attemptImages = new AttemptImages<{
  small: Promise<Buffer>;
  crop: Promise<{ jpeg: Buffer; px: string } | null>;
  attached?: boolean;
}>();

/**
 * Ausschnitt zur Sichtung nachreichen (`ok`: die Cloud hat ihn angenommen,
 * `text` für die Log-Zeile). Mit `notifyKey` (der Plan trug die erste Nachricht) schickt die Cloud
 * ihn als zweites Bild an Telegram, genau einmal je erster Nachricht – auch
 * wenn die Antwort auf einen früheren Versuch verloren ging und die Nachricht
 * dort hinausging, und auch, wenn er schon in der Historie liegt. Ohne
 * notifyKey schickt die Cloud ihn an Telegram, wenn `telegram` gesetzt ist
 * (die Antwort auf die Meldung nannte Telegram-Chats): beim neuen Eintrag
 * eines Fahrzeugs, dessen Meldung eine Erinnerung trug – gewollt, die
 * Erinnerung ging mit dem Übersichtsbild hinaus, der Ausschnitt folgt –, und
 * bei einer älteren Cloud, die notifyKey nicht kennt.
 */
async function sendEvidence(
  sightingId: number,
  crop: Buffer,
  notifyKey: string | null,
  telegram: boolean,
): Promise<{ ok: boolean; text: string }> {
  const q = new URLSearchParams({ sightingId: String(sightingId), telegram: telegram ? "1" : "0" });
  if (notifyKey) q.set("notifyKey", notifyKey);
  try {
    const res = await api(`/api/hub/parking-violations/evidence?${q.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(crop),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { telegram?: unknown; existed?: unknown; error?: unknown } | null;
    improveCount("noparking", res.ok ? "evidence_ok" : "evidence_fail");
    if (!res.ok) return { ok: false, text: `HTTP ${res.status}${typeof body?.error === "string" ? ` ${body.error}` : ""}` };
    return { ok: true, text: `ok (${body?.existed === true ? "schon in der Historie, " : ""}Telegram ${Number(body?.telegram) || 0})` };
  } catch (err) {
    improveCount("noparking", "evidence_fail");
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}

/** Antwort der Cloud für die Log-Zeile der Meldung; `retryInMs`: Abstand bis zum nächsten Versuch. */
function describeAnswer(a: CloudAnswer, tries: number, gaveUp: number, retryInMs: number): string {
  if (a.ok) {
    const parts = [
      a.sightingId ? `Sichtung ${a.sightingId}${a.sightingExisted ? " (schon vorhanden)" : ""}` : null,
      `Push ${a.pushed ?? 0}`,
      `Telegram ${a.telegram ?? 0}`,
      a.evidenceTelegram ? `gespeicherter Ausschnitt an Telegram ${a.evidenceTelegram}` : null,
      a.skipped === "duplicate" ? "Nachricht schon verschickt" : a.skipped ? `ohne Nachricht (${a.skipped})` : null,
      // Ältere Cloud: entscheidet über Historie und Nachricht noch selbst.
      a.hubDecides ? null : "ältere Cloud",
    ].filter(Boolean);
    return `ok (${parts.join(", ")})`;
  }
  const why = a.status ? `HTTP ${a.status}${a.error ? ` ${a.error}` : ""}` : a.error ?? "keine Antwort";
  if (gaveUp > 0 && tries === 0) return `${why} – aufgegeben nach ${MAX_REPORT_TRIES} Versuchen`;
  const when = retryInMs > 0 ? `frühestens in ${standingLabel(retryInMs / 1000)}` : "im nächsten Durchlauf";
  return `${why} – neuer Versuch ${when} (${tries}/${MAX_REPORT_TRIES})`;
}

/** Was eine Meldung tut, in Worten. */
function planLabel(plan: ReportPlan): string {
  const parts: string[] = [];
  if (plan.speak) parts.push("Ansage");
  if (plan.notify?.kind === "first") parts.push("Nachricht");
  if (plan.notify?.kind === "reminder") parts.push(`Erinnerung ${plan.notify.n}`);
  if (plan.skipReminder > 0) parts.push(`Erinnerung ${plan.skipReminder} entfällt (Nachtruhe)`);
  if (plan.store.length > 0) parts.push("Historie");
  return parts.join(", ");
}

/**
 * Plan ausführen: Ansage und Cloud-Meldung laufen unabhängig – fällt das
 * Internet aus, spricht der Lautsprecher trotzdem, und umgekehrt. Auf die
 * Ansage wird höchstens SPEAK_WAIT_MS gewartet, auf die Cloud höchstens
 * REPORT_TIMEOUT_MS. Die Ansage wird nie wiederholt; die Meldung an die
 * Cloud, wenn die Cloud nicht mit Erfolg antwortet (zuerst im nächsten
 * Durchlauf, dann mit wachsendem Abstand, retryDelayMs).
 */
async function report(cam: CameraConfig, state: CameraState, jpeg: Buffer, plan: ReportPlan): Promise<void> {
  const count = plan.due.length || plan.store.length || plan.inZone;
  const subject = count === 1 ? "Ein Fahrzeug" : `${count} Fahrzeuge`;
  const detail = `${subject} seit ${standingLabel(plan.seconds)}`;

  if (plan.due.length > 0) {
    recordHubEvent({
      kind: "vehicle",
      severity: "alert",
      where: cam.name,
      title: "Falschparker im Halteverbot",
      detail,
    });
  }

  const speaking = plan.speak
    ? announceOnCamera(cam.id, CONF.text).catch(() => {
        // Fehlermeldung kommt bereits aus camera-talk.ts.
      })
    : null;

  let cloud = "nichts zu melden";
  let evidence = "";
  let answer: CloudAnswer | null = null;
  if (needsCloud(plan)) {
    const keys: ReportKeys = { ...reportKeys(state, plan), evidenceKey: evidenceKeyFor(state, plan) };
    // Bilder des ersten Versuchs auch für die Wiederholungen: Ist das Fahrzeug
    // bis dahin fort, zeigen Historie und Telegram trotzdem das Bild, in dem es
    // stand. Der Ausschnitt nur zum Eintrag in der Historie, parallel zur Meldung.
    const cacheKey = AttemptImages.key(cam.id, keys);
    const images = attemptImages.get(cacheKey, Date.now(), () => ({
      small: shrinkJpeg(jpeg, DISPLAY_SNAPSHOT_MAX_PX).catch(() => jpeg),
      crop: plan.store.length > 0 ? evidenceCrop(jpeg, plan).catch(() => null) : Promise.resolve(null),
    }));
    if (images.repeated) improveCount("noparking", "retry_first_image");
    answer = await sendReport(cam.id, plan, keys, await images.value.small, images.repeated);
    const deliveredAt = Date.now();
    const { gaveUp, tries } = applyDelivery(state, plan, answer.ok, deliveredAt);
    cloud = describeAnswer(answer, tries, gaveUp, state.retryAt > 0 ? state.retryAt - deliveredAt : 0);
    if (images.repeated) cloud += " · Bild des ersten Versuchs";
    if (!answer.ok) improve("noparking", "report_fail", { cam: cam.name, status: answer.status, error: answer.error, tries, gaveUp });
    // Erledigt (zugestellt oder aufgegeben): Bilder vergessen.
    if (tries === 0) attemptImages.done(cacheKey, deliveredAt);
    // Nur eine Cloud, die den Ausschnitt annimmt, bekommt ihn (ältere: kein Aufruf) – auch
    // nach einer nicht zugestellten Nachricht (HTTP 502): Die Sichtung ist dann schon
    // angelegt, der Ausschnitt kommt in die Historie, aber nicht an Telegram.
    // Liegt er nach einem 502 schon dort, braucht es den Aufruf nur noch zur ersten Nachricht (Telegram).
    const firstKey = answer.ok && plan.notify?.kind === "first" ? keys.notifyKey : null;
    const sightingId = answer.sightingId;
    if (plan.store.length > 0 && sightingId && answer.evidence && (!images.value.attached || firstKey)) {
      const crop = await images.value.crop;
      // Zur ersten Nachricht geht der Ausschnitt auch an Telegram (die Cloud schickt ihn höchstens einmal).
      const sent = crop ? await sendEvidence(sightingId, crop.jpeg, firstKey, answer.ok && (answer.telegram ?? 0) > 0) : null;
      if (sent?.ok && !answer.ok) images.value.attached = true;
      evidence = crop && sent ? ` · Ausschnitt ${crop.px}: ${sent.text}` : " · Ausschnitt: nicht erstellt";
      if (!crop) improveCount("noparking", "evidence_none");
    }
  }
  log(`Halteverbot ${cam.name}: ${detail} – ${planLabel(plan) || "keine Ansage, keine Nachricht"} · Cloud: ${cloud}${evidence}`);
  // Diagnose: gemeldet bzw. erinnert, mit der Antwort der Cloud.
  const reply = answer
    ? {
        cloudOk: answer.ok,
        status: answer.status,
        sightingId: answer.sightingId ?? null,
        pushed: answer.pushed ?? 0,
        telegram: answer.telegram ?? 0,
        skipped: answer.skipped ?? null,
      }
    : { cloudOk: null };
  if (plan.due.length > 0) {
    improve("noparking", "alert", {
      cam: cam.name,
      vehicles: plan.due.length,
      inZone: plan.inZone,
      seconds: plan.seconds,
      speak: plan.speak,
      notify: plan.notify !== null,
      store: plan.store.length > 0,
      ...reply,
    });
  } else if (plan.notify?.kind === "reminder") {
    improve("noparking", "remind", { cam: cam.name, n: plan.notify.n, inZone: plan.inZone, seconds: plan.seconds, ...reply });
  }

  // Der Takt hängt nie am Lautsprecher; die Ansage endet spätestens mit ihrer Gesamtfrist.
  if (speaking) await waitAtMost(speaking, SPEAK_WAIT_MS);
}

/* ---------------------------------------------------------------------------
 * Vergleich: Erkennung auf dem Ausschnitt der Fläche (nur zählen)
 * ------------------------------------------------------------------------- */

/** Durchläufe mit Ergebnis je Kamera (für „jeder 10.“). */
const shadowRuns = new Map<number, number>();
/** Ein Vergleich zur Zeit; läuft noch einer, entfällt der nächste. */
let shadowBusy = false;
/** Zuletzt gesehen: Tracker kennt Ausschnitte (null = noch nicht gefragt) – geloggt wird ein Wechsel. */
let shadowTrackerKnowsRoi: boolean | null = null;

/**
 * Dasselbe Bild noch einmal mit dem Hüllrechteck der Fläche plus Rand und
 * höherer Auflösung erkennen und das Ergebnis mit der eigentlichen Erkennung
 * vergleichen. Zählt nur (noparking.shadow_*); Meldung, Spur und Takt
 * bleiben unberührt. Ein älterer Tracker (ohne roi in der Antwort) wird
 * nicht gezählt. Der Aufruf verändert den Ausfallschalter des Trackers nicht
 * (probe). Wirft nie.
 */
async function compareOnRoi(cam: CameraConfig, jpeg: Buffer, zone: Point[], full: VehicleBox[]): Promise<void> {
  const roi = zoneRoi(zone);
  if (!roi || shadowBusy) return;
  shadowBusy = true;
  try {
    const r = await classify(jpeg, { caller: "noparking_shadow", roi, imgsz: SHADOW_IMGSZ, probe: true });
    if (!r.ok) return;
    const knows = usedRoi(r.json);
    if (knows !== shadowTrackerKnowsRoi) {
      shadowTrackerKnowsRoi = knows;
      log(
        knows
          ? `Halteverbot: Vergleich mit Ausschnitt läuft (jeder 10. Durchlauf und jeder mit Kandidat, nur gezählt)`
          : `Halteverbot: Tracker kennt noch keinen Ausschnitt (älterer Stand) – Vergleich ruht bis zu seinem Neustart`,
      );
    }
    if (!knows) return;
    const vehicles = (r.json as { vehicles?: unknown }).vehicles;
    const boxes = Array.isArray(vehicles) ? (vehicles as VehicleBox[]) : [];
    const res = shadowCompare(full, boxes, zone, CONF);
    improveCount("noparking", `shadow_${res.outcome}`);
    improveCount("noparking", "shadow_full_boxes", res.full.boxes);
    improveCount("noparking", "shadow_full_conf_sum", Math.round(res.full.confSum * 1000));
    improveCount("noparking", "shadow_roi_boxes", res.roi.boxes);
    improveCount("noparking", "shadow_roi_conf_sum", Math.round(res.roi.confSum * 1000));
  } finally {
    shadowBusy = false;
  }
}

/* ---------------------------------------------------------------------------
 * Diagnose: Zeilen nur bei einem Wechsel
 * ------------------------------------------------------------------------- */

/** Grund, aus dem eine Kamera zuletzt übersprungen wurde ("" = lief normal). */
const skipLog = new ChangeLog();
/** Fehler einer Kamera: eine Zeile je Fehlerbild, alle 10 min zur Erinnerung. */
const failLog = new ChangeLog(10 * 60_000);

/** Kamera übersprungen (`reason`) oder wieder normal (null): Zeile beim Wechsel, sonst gezählt. */
function noteSkip(cam: CameraConfig, reason: "skip_moved" | "skip_tracker" | null): void {
  const changed = skipLog.shouldLog(String(cam.id), reason ?? "", Date.now());
  if (!reason) return;
  if (changed) improve("noparking", reason, { cam: cam.name });
  else improveCount("noparking", reason);
}

/**
 * Wechsel der Spuren (noparking-diag-rules.ts) als Zeile in improve.jsonl.
 * Aussetzer eines schon gemeldeten Fahrzeugs werden nur gezählt.
 */
function noteTrackEvents(cam: CameraConfig, events: TrackEvent[]): void {
  for (const e of events) {
    const routine = (e.event === "miss" || e.event === "found") && !e.candidate;
    if (routine) {
      improveCount("noparking", e.event);
      continue;
    }
    const { event, box, ...data } = e;
    improve("noparking", event, { cam: cam.name, ...data, ...(box ?? {}) });
  }
}

/* ---------------------------------------------------------------------------
 * Takt
 * ------------------------------------------------------------------------- */

async function checkCamera(cam: CameraConfig, run: NoParkRun): Promise<void> {
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

  const state = stateFor(cam.id);

  // Kamera zoomt gerade auf eine Person: die Flaeche passt nicht zum Bild.
  // Die Standzeit bleibt erhalten, das naechste Bild zaehlt wieder.
  if (!cameraAtHome(cam.id)) {
    state.lastRunFailed = true;
    // Nicht beobachtet: Die Zeit zählt nicht als leere Fläche.
    noteBlind(state);
    noteSkip(cam, "skip_moved");
    return;
  }

  improveCount("noparking", "run");
  try {
    const jpeg = await captureSnapshot(cam.id);
    if (run.abandoned) return;
    const boxes = await detectVehicles(jpeg, { label: cam.name, caller: "noparking" });
    // Freigegeben, während Kamera oder Tracker trödelten: Der nächste
    // Durchlauf ist schon unterwegs und führt den Zustand.
    if (run.abandoned) return;
    state.lastRunAt = Date.now();
    if (boxes === null) {
      // Tracker weg: Zustand behalten, sonst beginnt jede Standzeit von neuem.
      state.lastError = "Tracker nicht erreichbar";
      state.lastRunFailed = true;
      noteBlind(state);
      noteSkip(cam, "skip_tracker");
      return;
    }
    state.lastError = null;
    state.lastRunFailed = false;
    noteSkip(cam, null);
    improveOutcome(TRAIL_NOPARKING, null);
    failLog.shouldLog(String(cam.id), "", Date.now());

    const relevant = relevantBoxes(boxes, zone, CONF);
    const now = state.lastRunAt;
    const before = snapshotTrack(state);
    // Verdeckt ist nicht leer: auch ein Fahrzeug mit Fußpunkt außerhalb der Fläche (Lieferwagen davor).
    const tracked = track(state, relevant, now, { gapLimitMs: NOPARK_GAP_LIMIT_MS, covers: coverBoxes(boxes, CONF) });
    noteTrackEvents(cam, trackEvents(before, state, now, tracked));

    // Vergleich nebenher: wartet nicht auf den Tracker und ändert nichts am Zustand.
    const shadowRun = (shadowRuns.get(cam.id) ?? 0) + 1;
    shadowRuns.set(cam.id, shadowRun);
    if (CONF.shadow && shadowDue(shadowRun, state.standing.length > 0)) {
      void compareOnRoi(cam, jpeg, zone, boxes).catch((err) =>
        log(`Halteverbot ${cam.name}: Vergleich: ${err instanceof Error ? err.message : err}`),
      );
    }

    const at = new Date(now);
    const plan = planReport(state, now, {
      minutes: minutesFor(cam),
      speak: CONF.speak,
      speakHour: speakHour(at),
      speakFrom: CONF.speakFrom,
      speakTo: CONF.speakTo,
      notifyHour: notifyHour(at),
      notifyFrom: CONF.notifyFrom,
      notifyTo: CONF.notifyTo,
    });
    // Zeitpunkt der Meldung, Ansagen, Episode und Schlüssel gelten ab hier,
    // unabhängig davon, wie Ansage und Cloud ausgehen.
    applyPlan(state, plan, now);
    if (plan.due.length > 0 || plan.speak || needsCloud(plan) || plan.skipReminder > 0) {
      // Vor dem Melden sichern: Stürzt der Hub dabei ab, wiederholt er nach dem
      // Neustart mit denselben Schlüsseln, ohne zweite Ansage.
      await saveState();
      if (run.abandoned) return;
      await report(cam, state, jpeg, plan);
    } else if (state.standing.some((s) => s.misses === 0 && s.reportedAt === 0)) {
      // Kandidat wartet auf die Schwelle: gezählt; den Wechsel zeigen first_seen, miss und found.
      improveCount("noparking", "waiting");
    } else if (relevant.length > 0) {
      // Fahrzeuge stehen, alle schon gemeldet: nur zählen.
      improveCount("noparking", "standing");
    } else {
      // Der Normalfall: nur zaehlen, keine Zeile in improve.jsonl.
      improveCount("noparking", "clear");
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    state.lastError = detail;
    state.lastRunFailed = true;
    noteBlind(state);
    improveOutcome(TRAIL_NOPARKING, detail);
    // Je Fehlerbild eine Zeile (und alle 10 min zur Erinnerung), gezählt wird jeder Fehler.
    if (failLog.shouldLog(String(cam.id), detail, Date.now())) {
      log(`Halteverbot ${cam.name}: ${detail}`);
      improve("noparking", "fail", { cam: cam.name, error: detail });
    } else {
      improveCount("noparking", "fail");
    }
  }
}

/** Platz für den einen laufenden Durchlauf. */
const slot: RunSlot = { current: null };
/** Kameras ohne Fläche: einmal warnen, nicht in jedem Durchlauf. */
const missingZoneWarned = new Set<number>();
/** Zuletzt geprüfte Kameras – für die Meldung, wenn sich die Auswahl ändert. */
let lastActive = "";
/** IDs der zuletzt geprüften Kameras – für den Takt und die VEHICLE-Flanke. */
let checkedIds = new Set<number>();

async function checkAll(run: NoParkRun): Promise<void> {
  await loadSavedState();
  if (run.abandoned) return;
  const cams = camerasToCheck();
  checkedIds = new Set(cams.map((c) => c.id));
  const active = cams.map((c) => c.name).join(", ");
  if (active !== lastActive) {
    lastActive = active;
    log(active ? `Halteverbot prüft: ${active}` : "Halteverbot: keine Kamera ausgewählt");
  }
  for (const cam of cams) {
    if (run.abandoned) return;
    await checkCamera(cam, run);
  }
  if (run.abandoned) return;
  // Zustände von Kameras aufräumen, für die das Halteverbot abgeschaltet wurde.
  // Erst wenn die Kamera-Liste geladen ist: Vorher fehlen alle Kameras, und
  // der nach dem Neustart übernommene Zustand ginge verloren.
  if (listCameraConfigs().length > 0) {
    const ids = new Set(cams.map((c) => c.id));
    for (const id of states.keys()) {
      if (!ids.has(id)) states.delete(id);
    }
  }
  await saveState();
}

/**
 * Ein Durchlauf über alle Kameras mit Halteverbot. Läuft schon einer, kehrt
 * der Aufruf sofort zurück. Ein Durchlauf, der länger als STUCK_RUN_MS
 * braucht, wird freigegeben und als noparking.stuck gezählt: Der Takt geht
 * weiter, der alte Durchlauf ändert den Zustand nicht mehr. Wirft nie.
 */
export async function checkNoParking(): Promise<void> {
  await runExclusive(
    slot,
    Date.now(),
    STUCK_RUN_MS,
    (run) => {
      const pass = checkAll(run);
      currentPass = pass;
      return pass.finally(() => {
        if (currentPass === pass) currentPass = null;
      });
    },
    () => {
      improveCount("noparking", "stuck");
      // Der hängende Durchlauf hat nichts beobachtet: Die Zeit zählt nicht als leer.
      for (const id of checkedIds) {
        const state = states.get(id);
        if (state) noteBlind(state);
      }
      log(`Halteverbot: Durchlauf hängt seit ${Math.round(STUCK_RUN_MS / 1000)} s – freigegeben, der nächste beginnt`);
    },
    (err) => log(`Halteverbot: Durchlauf fehlgeschlagen (${err instanceof Error ? err.message : err})`),
  );
}

/* ---------------------------------------------------------------------------
 * Takt: plant sich nach jedem Durchlauf selbst
 * ------------------------------------------------------------------------- */

let loop: CheckLoop | null = null;
/** Zuletzt geplanter Abstand – geloggt wird nur ein Wechsel. */
let lastDelayMs = 0;

/** Ortszeit-Stunde für das Nachtfenster des Takts; ist sie nicht lesbar, die Uhr des Macs. */
function localHour(at: Date): number {
  try {
    return berlinHour(at);
  } catch {
    return at.getHours();
  }
}

/** Abstand bis zum nächsten Durchlauf (checkDelay je geprüfter Kamera, die kürzeste zählt). */
function nextDelayMs(): number {
  const now = Date.now();
  const list: CameraState[] = [];
  for (const id of checkedIds) {
    const state = states.get(id);
    if (!state) continue;
    // Meldet die Kamera gerade noch ein Fahrzeug, zählt das wie eine neue Flanke.
    if (cameraVehicleActive(id)) state.vehicleEventAt = now;
    list.push(state);
  }
  const next = soonestCheck(list, now, {
    activeMs: NOPARK_INTERVAL_MS,
    idleMs: IDLE_CHECK_MS,
    nightMs: NIGHT_CHECK_MS,
    hour: localHour(new Date(now)),
    fixed: CONF.fixedInterval,
  });
  improveCount("noparking", next.ms <= NOPARK_INTERVAL_MS ? "tick_short" : "tick_long");
  if (next.ms !== lastDelayMs) {
    lastDelayMs = next.ms;
    log(`Halteverbot: Takt ${Math.round(next.ms / 1000)} s (${CHECK_REASON_TEXT[next.reason]})`);
  }
  return next.ms;
}

/**
 * Halteverbot-Prüfung starten: genau ein Takt, beim Beenden des Hubs
 * abgeräumt. Meldet eine geprüfte Kamera selbst ein Fahrzeug (VEHICLE), kommt
 * der nächste Durchlauf spätestens nach dem kurzen Takt – nicht sofort, damit
 * der Kennzeichen-Burst an derselben Kamera Vorrang behält.
 */
export function startNoParking(): void {
  if (loop) return;
  const created = new CheckLoop({
    run: checkNoParking,
    delayMs: nextDelayMs,
    firstDelayMs: NOPARK_INTERVAL_MS,
    fallbackMs: NOPARK_INTERVAL_MS,
    minGapMs: MIN_CHECK_GAP_MS,
    onError: (err) => log(`Halteverbot: Takt: ${err instanceof Error ? err.message : err}`),
  });
  loop = created;
  created.start();
  const unsubscribe = onCameraVehicleStart((cameraId) => {
    if (!checkedIds.has(cameraId)) return;
    const state = states.get(cameraId);
    if (state) state.vehicleEventAt = Date.now();
    created.soon(NOPARK_INTERVAL_MS);
  });
  onShutdown("halteverbot-takt", () => {
    created.stop();
    unsubscribe();
  });
}

/** Einstellungen in einer Zeile – fürs Startprotokoll. */
export function noParkingConfigSummary(): string {
  const takt = CONF.fixedInterval
    ? `${CONF.intervalSec} s (fest, HUB_NOPARK_FIXED_INTERVAL=1)`
    : `${CONF.intervalSec} s, leer ${Math.max(CONF.intervalSec, IDLE_CHECK_MS / 1000)} s, nachts leer ${Math.max(CONF.intervalSec, NIGHT_CHECK_MS / 1000)} s`;
  return (
    `Takt=${takt} (Abstand bis ${Math.round(NOPARK_GAP_LIMIT_MS / 1000)} s gilt als beobachtet) ` +
    `Schwelle=${CONF.minutes} min (sofern nicht je Kamera gesetzt) ` +
    `Ansage=${CONF.speak ? `${CONF.speakFrom}–${CONF.speakTo} Uhr, höchstens 2 je Fahrzeug` : "aus"} ` +
    `Nachricht=${CONF.notifyFrom}–${CONF.notifyTo} Uhr, Erinnerung nach 30/60/120 min ` +
    `Vergleich=${CONF.shadow ? "Ausschnitt, nur gezählt (HUB_NOPARK_SHADOW=0: aus)" : "aus"}` +
    // Früher: erneut melden alle N Minuten. Die Erinnerungen ersetzen das.
    (process.env.HUB_NOPARK_REPEAT_MINUTES ? " (HUB_NOPARK_REPEAT_MINUTES wird nicht mehr gelesen)" : "")
  );
}
