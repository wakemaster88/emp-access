/**
 * Regeln auf dem Hub.
 *
 * Normalbetrieb: Die Cloud ist die Regel-Engine (Cron, Kamera-Ereignisse,
 * Schaltvorgaenge). Der Hub meldet ihr nur, was sie sonst nicht saehe:
 * Schaltvorgaenge, die er selbst im LAN ausgefuehrt hat
 * (`POST /api/hub/device-switched`), damit "Geraet geschaltet"-Regeln greifen.
 *
 * Notbetrieb: Erreicht der Hub die Cloud nicht (Internet weg), fuehrt er die
 * Regeln selbst weiter – mit einem Plan, den die Cloud vorab berechnet hat
 * (`GET /api/hub/rules`, 48 h): konkrete Zeitpunkte fuer Zeit-Ausloeser und
 * erlaubte Zeitraeume fuer Bewegung, Schaltvorgang und Ruhe. So braucht der
 * Hub keine zweite Kopie der Betriebszeit- und Sonnenlogik. Neu geholt wird
 * der Plan, sobald das Lebenszeichen eine neue Regel-Version nennt, sonst
 * alle 6 Stunden; nennt die Cloud keine, alle 15 Minuten
 * (rule-plan-rules.ts, `planRefreshDue`).
 *
 * Notbetrieb heisst: seit der Karenz (180 s) kein gelungener Aufruf an die
 * Cloud, gleich welcher (cloud-contact.ts). Dann fuehrt der Hub auch die
 * Termine aus, die seit dem letzten Kontakt faellig wurden, und die bis
 * 6 Minuten davor nur mit Aus und Zu; jeden ausgefuehrten Termin merkt er
 * sich in hub/.cache, damit ihn ein Neustart nicht noch einmal ausfuehrt
 * (outage-rules.ts). Termine eines Takts laufen der Zeit nach, und was ein
 * spaeterer Termin am selben Geraet schon geschaltet hat, holt der Hub nicht
 * nach und wiederholt es nicht (`dueOutageTerms`, `outageRetryStep`).
 *
 * Im Notbetrieb schaltet der Hub nur, was er lokal erreicht (Shellys mit IP,
 * Hue, Kameras); was er schalten darf, entscheidet `outageActionStep`: Licht,
 * Schalter, Hue und Kamera-Szenen, dazu „zu“ am Rolltor zu einem Termin. Er
 * oeffnet nie etwas, Tueroeffner, Drehkreuze und Taster schaltet er gar nicht.
 * Benachrichtigungen und Audio brauchen die Cloud und stehen als
 * fehlgeschlagen im Lauf. Alle Laeufe gehen nachtraeglich an die Cloud
 * (`POST /api/hub/rules`), sobald sie wieder erreichbar ist; einen
 * gescheiterten Lauf zaehlt sie nicht als erledigt und holt die Aktionen
 * nach, die beim Hub scheiterten, oder meldet den Termin. Bis der Lauf
 * eintrifft, nennt das Lebenszeichen seine Termine (`rulesHeartbeat`), und
 * die Cloud schaltet dort nichts nach, was der Hub selbst geschaltet hat.
 *
 * Doppelt ausgefuehrt wird nichts: Der Hub handelt nur, solange er die Cloud
 * nicht erreicht, und nur mit Aktionen, deren Wiederholung nichts aendert,
 * falls die Cloud einen Termin aus der Karenz doch schon geschaltet hat.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { closeCoverLocal, deviceAction, findDevice, roomCameraIds } from "./rooms.js";
import { cameraScene, listCameraConfigs } from "./cameras.js";
import { inAllowed as inIntervals, localActionOptions, planRefreshDue, type PlanInterval } from "./rule-plan-rules.js";
import { parseTriggeredRules, ruleReport } from "./rule-report-rules.js";
import { DIRECT_ABORTED_ERROR, directRunLine, directRunOutcome, localMotionDecision, runActionsUntil } from "./motion-rules.js";
import { improveCount } from "./improve-log.js";
import { writeFileAtomic } from "./atomic-file.js";
import { onShutdown } from "./shutdown.js";
import { lastCloudContactAt, onContactResumed } from "./cloud-contact.js";
import { envSwitch, unknownSwitchLine } from "./switch-rules.js";
import { ChangeLog } from "./change-log.js";
import {
  OUTAGE_AFTER_MS,
  OUTAGE_RETRY_ATTEMPTS,
  OutageRetries,
  announcedFires,
  dueOutageTerms,
  failedRetryKeys,
  hubRunRecord,
  laterTermDevices,
  missingAfter,
  nextOutageRetry,
  outageActionKey,
  outageActionStep,
  outageActive,
  outageMotionReport,
  outageRetryStep,
  parseOutageStore,
  pruneFired,
  type HubRun,
  type OutageContext,
  type OutageRetry,
  type OutageStep,
  type OutageTerm,
  type RunDetail,
} from "./outage-rules.js";

interface PlanRule {
  id: number;
  name: string;
  roomId: number | null;
  trigger: string;
  cooldownSeconds: number;
  cameraId: number | null;
  eventType: string | null;
  triggerDeviceId: number | null;
  triggerAction: string | null;
  idleMinutes: number | null;
  allowed: PlanInterval[];
  fireAt: string[];
  /** Ende der Nachholfrist je Termin (gleiche Reihenfolge); fehlt bei aelterer Cloud. */
  fireUntil?: string[];
  /** Bewegung: Der Hub darf die Regel direkt ausfuehren (motion-rules.ts); fehlt bei aelterer Cloud. */
  hubLocal?: boolean;
  hubCameraIds?: number[];
  allowedExact?: PlanInterval[];
  lastRunAt?: string | null;
  hubConfigAt?: string;
  actions: {
    id: number;
    /** Schluessel der Aktion fuer den Lauf; fehlt bei aelterer Cloud. */
    key?: string;
    kind: string;
    deviceId: number | null;
    deviceAction: string | null;
    timerSeconds: number | null;
    targetCameraId?: number | null;
    ptzPresetId?: number | null;
    autoTrack?: boolean | null;
    returnAfterSeconds?: number | null;
  }[];
}

interface Plan {
  generatedAt: string;
  validUntil: string;
  /** Regel-Version, zu der der Plan passt (src/lib/rule-version.ts); fehlt bei aelterer Cloud. */
  ruleVersion?: string;
  rules: PlanRule[];
}

/** `direct`: Bewegungs-Regel bei laufender Cloud direkt vom Hub (nicht Notbetrieb). */
type PendingRun = HubRun & { direct?: boolean };

const PLAN_FILE = path.join(CONFIG.hubDir, ".cache", "rule-plan.json");
const PENDING_FILE = path.join(CONFIG.hubDir, ".cache", "rule-runs-pending.json");
/** Letzter Kontakt und ausgefuehrte Termine (outage-rules.ts, `OutageStore`). */
const OUTAGE_FILE = path.join(CONFIG.hubDir, ".cache", "rule-outage.json");
/** Den letzten Kontakt hoechstens so oft auf die Platte schreiben. */
const CONTACT_SAVE_MS = 15_000;
/** So oft prueft der Hub, ob der Plan neu zu holen ist (rule-plan-rules.ts, `planRefreshDue`). */
const PLAN_CHECK_MS = 60_000;
const TICK_MS = (Number(process.env.HUB_RULES_TICK_SEC) || 20) * 1000;
/** Ohne erfolgreichen Cloud-Kontakt so lange -> Notbetrieb. */
const OFFLINE_AFTER_MS = (Number(process.env.HUB_RULES_OFFLINE_SEC) || OUTAGE_AFTER_MS / 1000) * 1000;
/** Schalter aus hub/.env; ein unbekannter Wert steht einmal beim Start im Log. */
function envFlag(name: string): boolean {
  return envSwitch(process.env[name], true, (value) => log(unknownSwitchLine(name, value, true)));
}
/**
 * Rolltore im Notbetrieb zufahren, wenn eine Zeit-Regel sie schliesst
 * (outage-rules.ts). Standard an; 0, false, nein, aus, no oder off: nur die
 * Cloud.
 */
const COVER_CLOSE = envFlag("HUB_EMERGENCY_COVER_CLOSE");
/**
 * Bewegungs-Regeln, die die Cloud dafuer markiert, bei laufender Cloud direkt
 * im LAN schalten (motion-rules.ts). Standard an; 0, false, nein, aus, no
 * oder off: alle Bewegungs-Regeln ueber die Cloud wie bisher.
 */
const LOCAL_MOTION = envFlag("HUB_RULES_LOCAL_MOTION");
/**
 * So lange wartet die Meldung eines Ereignisses hoechstens auf die Regeln,
 * die der Hub dazu selbst schaltet. Dauert ein Lauf laenger, nennt der Hub
 * die Regel nicht, und die Cloud fuehrt sie ebenfalls aus.
 */
const LOCAL_MOTION_WAIT_MS = 5_000;
/** Wie die Cloud: hoechstens eine Folgeregel-Ebene. */
const MAX_CHAIN_DEPTH = 1;

let plan: Plan | null = null;
let planError: string | null = null;
let planFetchedAt: number | null = null;
let planAttemptAt: number | null = null;
let planVersion: string | null = null;
/** Regel-Version aus dem letzten Lebenszeichen; null = die Cloud nennt keine. */
let cloudRuleVersion: string | null = null;
let planFetch: Promise<void> | null = null;
let pending: PendingRun[] = [];
let flushing: Promise<void> | null = null;
/** Warum eine markierte Regel ueber die Cloud lief: je Regel eine Zeile je Grund, dann stuendlich. */
const declineLog = new ChangeLog(60 * 60_000);
let flushSoon: ReturnType<typeof setTimeout> | null = null;
const lastRun = new Map<number, number>();
/** Ausgefuehrte Termine (`firedKey` -> Termin in ms), auch ueber einen Neustart. */
let fired: Record<string, number> = {};
/**
 * Termine, deren gescheitertes Aus oder Zu der Hub noch einmal schaltet
 * (`firedKey`, outage-rules.ts `nextOutageRetry`). Nur im Speicher: Nach
 * einem Neustart oder mit der Rueckkehr der Cloud versucht er nichts mehr,
 * auch nicht nach einem Lauf, der da noch dauerte (`OutageRetries`); die
 * Cloud holt dann nach, was laut seinem Lauf fehlt.
 */
const retries = new OutageRetries<{ ruleId: number; at: string; ctx: OutageContext; retry: OutageRetry }>();
/** Letzter Kontakt aus einem frueheren Lauf des Hubs (hub/.cache). */
let storedContactAt: number | null = null;
let savedContactAt: number | null = null;
let outageWrite: Promise<void> = Promise.resolve();
/** Letzte Bewegung je Kamera (ms), fuer IDLE-Regeln. */
const lastMotion = new Map<number, number>();
const startedAt = Date.now();
let offlineSince: number | null = null;
const recent: { at: string; rule: string; trigger: string; success: boolean; error: string | null }[] = [];

/* ----------------------------------------------------------- Cloud-Status */

/**
 * Notbetrieb aktiv? Erst nach einer Karenzzeit ohne gelungenen Aufruf an die
 * Cloud, damit ein Ruckler nichts ausloest; nach dem Start zaehlt die Karenz
 * ab dem Start.
 */
export function isOffline(now = Date.now()): boolean {
  return outageActive(lastCloudContactAt(), startedAt, now, OFFLINE_AFTER_MS);
}

/**
 * Ab hier fuehrt der Hub Termine im Notbetrieb aus: letzter Kontakt, nach
 * einem Neustart der aus hub/.cache, sonst der Start. Termine kurz davor
 * nur mit Aus und Zu (outage-rules.ts, `outageDue`).
 */
function contactFloor(): number {
  return lastCloudContactAt() ?? storedContactAt ?? startedAt;
}

/** Letzten Kontakt und Merker sichern; Schreibvorgaenge nacheinander. Wirft nie. */
function saveOutage(): Promise<void> {
  const data = JSON.stringify({ lastContactAt: lastCloudContactAt() ?? storedContactAt, fired });
  outageWrite = outageWrite
    .then(() => writeFileAtomic(OUTAGE_FILE, data))
    .catch((e) => log(`Regeln: Merker für den Notbetrieb nicht gespeichert (${e instanceof Error ? e.message : e})`));
  return outageWrite;
}

/* ------------------------------------------------------------- Plan laden */

async function writeJson(file: string, data: unknown): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
  } catch {
    /* Cache ist Beiwerk */
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Plan holen; laeuft schon ein Abruf, wartet der Aufrufer auf diesen. Wirft nie. */
export function refreshPlan(): Promise<void> {
  planFetch ??= fetchPlan().finally(() => {
    planFetch = null;
  });
  return planFetch;
}

async function fetchPlan(): Promise<void> {
  planAttemptAt = Date.now();
  const changed = cloudRuleVersion !== null && cloudRuleVersion !== planVersion;
  try {
    const res = await api("/api/hub/rules");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Plan;
    if (!Array.isArray(data.rules)) throw new Error("Antwort ohne Regeln");
    plan = data;
    planError = null;
    planFetchedAt = Date.now();
    planVersion = typeof data.ruleVersion === "string" && data.ruleVersion ? data.ruleVersion : null;
    improveCount("rules", changed ? "plan_fetch_changed" : "plan_fetch");
    await writeJson(PLAN_FILE, data);
  } catch (e) {
    planError = e instanceof Error ? e.message : String(e);
  }
}

/** Plan holen, wenn es Zeit ist: neue Regel-Version sofort, sonst im Takt. */
function refreshPlanIfDue(now = Date.now()): void {
  if (planFetch) return;
  const state = { fetchedAt: planFetchedAt, attemptAt: planAttemptAt, planVersion, cloudVersion: cloudRuleVersion };
  if (planRefreshDue(state, now)) void refreshPlan();
}

/**
 * Lebenszeichen beantwortet: Regel-Version der Cloud (fehlt bei aelterer
 * Cloud). Weicht sie von der des Plans ab, holt der Hub ihn sofort neu.
 */
export function noteRuleVersion(version: unknown): void {
  cloudRuleVersion = typeof version === "string" && version ? version.slice(0, 64) : null;
  refreshPlanIfDue();
}

/** Laeufe an die Cloud melden; laeuft schon eine Meldung, wartet der Aufrufer auf diese. Wirft nie. */
function flushPending(): Promise<void> {
  flushing ??= sendPending().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendPending(): Promise<void> {
  if (!pending.length || isOffline()) return;
  const batch = pending.slice(0, 200);
  try {
    const res = await api("/api/hub/rules", {
      method: "POST",
      body: JSON.stringify({ runs: batch.map(({ direct: _direct, ...run }) => run) }),
    });
    if (!res.ok) return;
    // Genau die gemeldeten entfernen: Waehrenddessen kann ein Lauf dazukommen.
    const sent = new Set(batch);
    pending = pending.filter((r) => !sent.has(r));
    await writeJson(PENDING_FILE, pending);
    const outage = batch.filter((r) => !r.direct).length;
    if (outage > 0) log(`Regeln: ${outage} Läufe aus dem Notbetrieb an die Cloud gemeldet`);
  } catch {
    /* naechster Versuch */
  }
}

/** Gleich melden (Bewegung direkt vom Hub), nicht erst im Minutentakt. */
function flushPendingSoon(): void {
  if (flushSoon) return;
  flushSoon = setTimeout(() => {
    flushSoon = null;
    void flushPending();
  }, 1_000);
}

/* ------------------------------------------------------------- Ausfuehren */

function inAllowed(rule: PlanRule, now: number): boolean {
  return inIntervals(rule.allowed, now);
}

function cooledDown(rule: PlanRule, now: number): boolean {
  const last = lastRun.get(rule.id);
  return !last || now - last >= Math.max(0, rule.cooldownSeconds) * 1000;
}

/** Aktion im Notbetrieb ausfuehren, soweit `outageActionStep` sie erlaubt. */
async function runOutageAction(
  rule: PlanRule,
  a: PlanRule["actions"][number],
  ctx: OutageContext,
  depth: number,
): Promise<RunDetail> {
  const started = Date.now();
  const base = { actionId: a.id, ...(a.key ? { key: a.key } : {}), kind: a.kind };
  const device = a.deviceId ? findDevice(a.deviceId) : null;
  const step = outageActionStep(a, device, ctx);
  if ("skip" in step) {
    const target = a.kind === "CAMERA" ? `Kamera #${a.targetCameraId ?? "?"}` : a.kind === "DEVICE" ? device?.name ?? (a.deviceId ? `#${a.deviceId}` : "–") : a.kind;
    return { ...base, target, ok: false, error: step.skip };
  }
  if (step.run === "camera") {
    // Kamera steuern geht auch ohne Cloud: die Kamera haengt im LAN.
    const target = `Kamera #${a.targetCameraId}`;
    try {
      await cameraScene(a.targetCameraId as number, {
        presetId: a.ptzPresetId ?? null,
        autoTrack: a.autoTrack ?? null,
        returnAfterSeconds: a.returnAfterSeconds ?? null,
      });
      return { ...base, target, ok: true, ms: Date.now() - started };
    } catch (e) {
      return { ...base, target, ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
    }
  }
  const deviceId = a.deviceId as number;
  const act = a.deviceAction as string;
  const r = step.run === "cover-close" ? await closeCoverLocal(deviceId) : await deviceAction(deviceId, act, localActionOptions(a));
  if (step.run === "cover-close") {
    const gate = r.name ?? `#${deviceId}`;
    if (r.ok) {
      log(`Notbetrieb: Rolltor ${gate} geschlossen (Regel ${rule.name})`);
      improveCount("rules", "cover_close");
    } else {
      log(`Notbetrieb: Rolltor ${gate} nicht geschlossen (Regel ${rule.name}): ${r.error ?? "fehlgeschlagen"}`);
      improveCount("rules", "cover_close_failed");
    }
  }
  if (r.ok && depth < MAX_CHAIN_DEPTH) {
    void onDeviceSwitchedLocal(deviceId, act, depth + 1).catch((e) =>
      log(`Regeln: Folgeregel fehlgeschlagen (${e instanceof Error ? e.message : e})`),
    );
  }
  return { ...base, target: r.name ?? `#${deviceId}`, ok: r.ok, ...(r.error ? { error: r.error } : {}), ms: Date.now() - started };
}

async function executeLocal(
  rule: PlanRule,
  triggerKind: string,
  depth = 0,
  fireAt?: string,
  // Ohne Termin: Ereignis (`outageActionStep` schaltet dann nur Licht und Schalter).
  ctx: OutageContext = { timed: false },
  // Wiederholung: nur diese Aktionen (`outageActionKey`); `missing` fehlte dem Termin bisher.
  retry?: { only: ReadonlySet<string>; missing: readonly string[] },
): Promise<HubRun> {
  const now = Date.now();
  lastRun.set(rule.id, now);
  const details: RunDetail[] = [];
  for (const a of rule.actions) {
    if (retry && !retry.only.has(outageActionKey(a))) continue;
    details.push(await runOutageAction(rule, a, ctx, depth));
  }
  const run = hubRunRecord({ ruleId: rule.id, triggerKind, startedAt: now, finishedAt: Date.now(), fireAt, details, retry });
  const success = run.success;
  pending.push(run);
  if (pending.length > 2000) pending = pending.slice(-2000);
  await writeJson(PENDING_FILE, pending);
  recent.unshift({ at: run.at, rule: rule.name, trigger: triggerKind, success, error: run.errorMessage });
  recent.length = Math.min(recent.length, 30);
  if (!success) improveCount("rules", "outage_failed");
  log(`Regel (Notbetrieb) „${rule.name}“: ${success ? "ausgeführt" : `teilweise fehlgeschlagen – ${run.errorMessage}`}`);
  recordHubEvent({
    kind: "system",
    severity: success ? "info" : "warn",
    where: "Regeln",
    title: `Notbetrieb: ${rule.name}`,
    detail: success ? "vom Hub ausgeführt" : run.errorMessage ?? undefined,
  });
  return run;
}

async function tick(): Promise<void> {
  const now = Date.now();
  const offline = isOffline(now);
  if (offline && offlineSince === null) {
    offlineSince = now;
    log("Regeln: Cloud nicht erreichbar – Hub übernimmt die Regeln (Notbetrieb)");
    recordHubEvent({ kind: "system", severity: "warn", where: "Regeln", title: "Notbetrieb: Hub führt die Regeln aus" });
  } else if (!offline && offlineSince !== null) {
    offlineSince = null;
    log("Regeln: Cloud wieder erreichbar – Regeln laufen wieder in der Cloud");
    recordHubEvent({ kind: "system", severity: "info", where: "Regeln", title: "Notbetrieb beendet" });
    // Was noch fehlt, holt jetzt die Cloud nach (laut den gemeldeten Laeufen);
    // ein Lauf, der noch dauert, merkt danach nichts mehr vor.
    retries.clear();
    void flushPending();
  }
  const contact = lastCloudContactAt();
  if (contact !== null && (savedContactAt === null || contact - savedContactAt >= CONTACT_SAVE_MS)) {
    savedContactAt = contact;
    void saveOutage();
  }
  if (!offline || !plan) return;

  // Kehrt die Cloud waehrend dieses Takts zurueck, merkt er keine Wiederholung mehr vor.
  const gen = retries.generation;
  const rules = plan.rules;
  // Termine seit dem letzten Kontakt (und kurz davor nur Aus und Zu), bis zum
  // Ende ihrer Nachholfrist, aeltester zuerst.
  const terms = dueOutageTerms(rules, { lastContact: contactFloor(), now, fired, coverClose: COVER_CLOSE, device: findDevice });
  for (const term of terms) {
    // Ein zweiter Takt kann ihn waehrend eines Laufs schon ausgefuehrt haben.
    if (term.key in fired) continue;
    // Erst merken, dann schalten: Ein Neustart mitten im Lauf wiederholt nichts.
    fired = { ...pruneFired(fired, now), [term.key]: term.fireAt };
    await saveOutage();
    const run = await executeLocal(term.rule, term.rule.trigger.toLowerCase(), 0, term.at, term.ctx);
    noteRetry(term, run, null, gen);
  }
  for (const rule of rules) {
    if (rule.trigger === "IDLE" && rule.roomId && rule.idleMinutes && inAllowed(rule, now)) {
      const cams = roomCameraIds(rule.roomId);
      if (!cams.length) continue;
      const latest = Math.max(startedAt, ...cams.map((c) => lastMotion.get(c) ?? 0));
      if (now - latest < rule.idleMinutes * 60_000) continue;
      // IDLE einmal je Ruhephase: nach dem Lauf erst wieder nach neuer Bewegung.
      const last = lastRun.get(rule.id);
      if (last && last > latest) continue;
      await executeLocal(rule, "idle");
    }
  }
  await runRetries(gen);
}

/** Plan-Aktion im Notbetrieb mit ihrem Geraet (outage-rules.ts, `outageActionStep`). */
function stepFor(ctx: OutageContext): (a: PlanRule["actions"][number]) => OutageStep {
  return (a) => outageActionStep(a, a.deviceId ? findDevice(a.deviceId) : null, ctx);
}

/**
 * Nach einem Lauf zu einem Termin: gescheitertes Aus oder Zu fuer einen
 * weiteren Versuch vormerken (outage-rules.ts, `nextOutageRetry`).
 */
function noteRetry(
  term: Pick<OutageTerm<PlanRule>, "key" | "rule" | "at" | "ctx" | "until">,
  run: HubRun,
  prev: OutageRetry | null,
  // Generation zu Beginn des Takts (`OutageRetries`).
  gen: number,
): void {
  const failed = failedRetryKeys(term.rule.actions, run.details, stepFor(term.ctx));
  const missing = missingAfter(term.rule.actions, prev?.missing ?? null, run.details);
  const next = nextOutageRetry(prev, failed, Date.parse(run.at), term.until, missing);
  retries.note(term.key, next ? { ruleId: term.rule.id, at: term.at, ctx: term.ctx, retry: next } : null, gen);
}

/**
 * Faellige Wiederholungen: nur die Aktionen, die noch fehlen, mit dem Kontext
 * ihres Termins, ohne die Geraete, die inzwischen ein spaeterer Termin
 * geschaltet hat (outage-rules.ts, `outageRetryStep`). Je Termin mit der Zeit
 * jetzt, nicht der vom Beginn des Takts: Die Laeufe davor koennen dauern, und
 * nach dem Ende der Frist beginnt kein Versuch mehr.
 */
async function runRetries(gen: number): Promise<void> {
  const rules = plan?.rules ?? [];
  for (const [key, entry] of retries.list()) {
    // Die Cloud ist zurueck (ein zweiter Takt hat es bemerkt): keine weiteren Versuche.
    if (gen !== retries.generation) return;
    const now = Date.now();
    const rule = rules.find((r) => r.id === entry.ruleId) ?? null;
    const ctx: OutageContext = { ...entry.ctx, laterTerm: laterTermDevices(rules, Date.parse(entry.at), now) };
    const step = outageRetryStep(entry.retry, rule?.actions ?? null, now, stepFor(ctx));
    if ("wait" in step) continue;
    // Erst austragen, dann schalten: Ein zweiter Takt waehrend des Laufs wiederholt nichts.
    retries.delete(key);
    const name = rule?.name ?? `#${entry.ruleId}`;
    if ("drop" in step || !rule) {
      log(`Notbetrieb: Regel „${name}“, Termin ${entry.at}: kein weiterer Versuch (${"drop" in step ? step.drop : "Regel nicht mehr im Plan"})`);
      continue;
    }
    const attempt = entry.retry.attempts + 1;
    const skipped = step.skipped.length ? ` (${step.skipped.length} entfallen: ${[...new Set(step.skipped.map((s) => s.reason))].join("; ")})` : "";
    log(`Notbetrieb: Regel „${name}“, Termin ${entry.at}: Aus/Zu ${attempt}. Versuch von ${OUTAGE_RETRY_ATTEMPTS}${skipped}`);
    improveCount("rules", "outage_retry");
    const run = await executeLocal(rule, rule.trigger.toLowerCase(), 0, entry.at, ctx, {
      only: new Set(step.run),
      missing: entry.retry.missing,
    });
    noteRetry({ key, rule, at: entry.at, ctx, until: entry.retry.until }, run, { ...entry.retry, keys: step.run }, gen);
  }
}

/* -------------------------------------------------------------- Ereignisse */

/**
 * Kamera hat gerade einen Alarm aktiv (jede Messung, nicht nur der Beginn):
 * Stand der letzten Bewegung fuer die Ruhe-Regeln im Notbetrieb. Ein langes
 * Ereignis (Dauerbetrieb im Raum) galt sonst `idleMinutes` nach seinem Beginn
 * als Ruhe, obwohl noch jemand da war.
 */
export function noteCameraActivity(cameraId: number, now = Date.now()): void {
  lastMotion.set(cameraId, now);
}

/**
 * Antwort der Cloud auf eine Ereignis-Meldung: je ausgeloester Regel eine
 * Log-Zeile mit Kamera, Ereignisart und Antwortzeit der Cloud
 * (rule-report-rules.ts). Nennt eine aeltere Cloud nur die Zahl, zaehlt der
 * Hub die Regeln, statt zu loggen.
 */
export function noteTriggeredRules(body: unknown, responseMs: number): void {
  // Was die Cloud ausgefuehrt hat, zaehlt fuer die Abklingzeit der Regeln,
  // die der Hub direkt ausfuehrt (motion-rules.ts).
  const now = Date.now();
  for (const r of parseTriggeredRules(body) ?? []) noteRun(r.ruleId, now);
  const { lines, unnamed } = ruleReport(body, responseMs);
  for (const line of lines) log(line);
  if (lines.length > 0) improveCount("rules", "triggered", lines.length);
  if (unnamed > 0) improveCount("rules", "triggered_unnamed", unnamed);
}

/** Letzten Lauf einer Regel vermerken; ein juengerer bleibt stehen. */
function noteRun(ruleId: number, at: number): void {
  const last = lastRun.get(ruleId);
  if (last === undefined || at > last) lastRun.set(ruleId, at);
}

/**
 * Kamera meldet Beginn eines Ereignisses (MOTION, PERSON, VEHICLE, …).
 * Laeuft die Cloud, schaltet der Hub die Bewegungs-Regeln, die die Cloud
 * dafuer markiert, gleich selbst (motion-rules.ts); im Notbetrieb jede
 * passende Regel, aber nur mit Licht, Schaltern, Hue und Kamera-Szenen
 * (`outageActionStep`). Ergebnis: die Regeln, deren Lauf gelang, fuer die
 * Meldung an die Cloud (`hubRules`), auch im Notbetrieb: Kommt die Meldung
 * doch an (die Cloud ist gerade zurueck), schaltet die Cloud sie nicht noch
 * einmal (`outageMotionReport`). Gewartet wird hoechstens
 * `LOCAL_MOTION_WAIT_MS`. null, wenn der Hub zu diesem Ereignis nichts
 * selbst ausfuehrt. Wirft nie.
 */
export function onCameraEvent(
  cameraId: number,
  type: string,
  opts: { at?: number; camera?: string; source?: "camera" | "doorbird" } = {},
): Promise<Array<{ ruleId: number; configAt: string }>> | null {
  const now = Date.now();
  lastMotion.set(cameraId, now);
  if (!plan) return null;
  if (!isOffline(now)) return localMotion(cameraId, type, opts.at ?? now, opts.camera ?? `Kamera #${cameraId}`, opts.source ?? "camera");
  const runs: Array<Promise<{ ruleId: number; configAt: string } | null>> = [];
  for (const rule of plan.rules) {
    if (rule.trigger !== "MOTION") continue;
    if (rule.eventType && rule.eventType !== type) continue;
    const match = rule.cameraId != null ? rule.cameraId === cameraId : rule.roomId != null && roomCameraIds(rule.roomId).includes(cameraId);
    if (!match || !inAllowed(rule, now) || !cooledDown(rule, now)) continue;
    runs.push(
      withinWait(
        executeLocal(rule, "motion").then(
          (run) => outageMotionReport(rule, run),
          (e) => {
            log(`Regeln: „${rule.name}“ im Notbetrieb fehlgeschlagen (${e instanceof Error ? e.message : e})`);
            return null;
          },
        ),
      ),
    );
  }
  if (runs.length === 0) return null;
  return Promise.all(runs).then((ids) => ids.filter((x): x is { ruleId: number; configAt: string } => x !== null));
}

/**
 * Lauf im Notbetrieb fuer die Meldung des Ereignisses: Ist er nach
 * `LOCAL_MOTION_WAIT_MS` nicht fertig, nennt der Hub die Regel nicht (null);
 * der Lauf selbst geht weiter.
 */
function withinWait<T>(run: Promise<T | null>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOCAL_MOTION_WAIT_MS);
  });
  return Promise.race([run, late]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Markierte Bewegungs-Regeln zu einem Ereignis bei laufender Cloud. */
function localMotion(
  cameraId: number,
  type: string,
  at: number,
  camera: string,
  source: "camera" | "doorbird",
): Promise<Array<{ ruleId: number; configAt: string }>> | null {
  if (!plan) return null;
  const planFresh =
    planFetchedAt !== null && planVersion !== null && planVersion === cloudRuleVersion && Date.parse(plan.validUntil) > at;
  const decision = localMotionDecision(plan.rules, {
    cameraId,
    type,
    at,
    enabled: LOCAL_MOTION,
    fromCamera: source === "camera",
    planFresh,
    lastRun: (id) => lastRun.get(id) ?? null,
    device: (id) => findDevice(id),
    cameraKnown: (id) => listCameraConfigs().some((c) => c.id === id),
  });
  // Passt, aber die Cloud fuehrt sie aus: zaehlt fuer die Abklingzeit wie ihr Lauf.
  for (const { rule, reason } of decision.declined) {
    noteRun(rule.id, at);
    if (LOCAL_MOTION && declineLog.shouldLog(String(rule.id), reason, at)) {
      log(`Regel „${rule.name}“ läuft über die Cloud: ${reason}`);
    }
  }
  if (decision.declined.length > 0) improveCount("rules", "motion_cloud", decision.declined.length);
  if (decision.run.length === 0) return null;
  for (const rule of decision.run) noteRun(rule.id, at);
  return Promise.all(
    decision.run.map((rule) =>
      runDirect(rule, at, camera, type).catch((e) => {
        log(`Regel „${rule.name}“ direkt vom Hub fehlgeschlagen (${e instanceof Error ? e.message : e}), die Cloud führt sie aus`);
        return null;
      }),
    ),
  ).then((ids) => ids.filter((x): x is { ruleId: number; configAt: string } => x !== null));
}

/**
 * Aktionen einer markierten Bewegungs-Regel im LAN, nur Ein und Aus und
 * Kamera-Szene. Ist die Frist abgelaufen (`stopped`), startet keine weitere
 * Aktion mehr; sie steht mit `DIRECT_ABORTED_ERROR` im Lauf.
 */
async function executeDirect(rule: PlanRule, stopped: () => boolean): Promise<RunDetail[]> {
  const base = (a: PlanRule["actions"][number]) => ({ actionId: a.id, ...(a.key ? { key: a.key } : {}), kind: a.kind });
  return runActionsUntil(
    rule.actions,
    stopped,
    async (a): Promise<RunDetail> => {
      const started = Date.now();
      if (a.kind === "CAMERA" && a.targetCameraId) {
        const target = `Kamera #${a.targetCameraId}`;
        try {
          await cameraScene(a.targetCameraId, {
            presetId: a.ptzPresetId ?? null,
            autoTrack: a.autoTrack ?? null,
            returnAfterSeconds: a.returnAfterSeconds ?? null,
          });
          return { ...base(a), target, ok: true, ms: Date.now() - started };
        } catch (e) {
          return { ...base(a), target, ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
        }
      }
      if (a.kind !== "DEVICE" || !a.deviceId || !a.deviceAction) {
        return { ...base(a), target: a.kind, ok: false, error: "Aktion nur über die Cloud" };
      }
      const r = await deviceAction(a.deviceId, a.deviceAction, localActionOptions(a));
      return { ...base(a), target: r.name ?? `#${a.deviceId}`, ok: r.ok, ...(r.error ? { error: r.error } : {}), ms: Date.now() - started };
    },
    (a): RunDetail => ({
      ...base(a),
      target:
        a.kind === "CAMERA" ? `Kamera #${a.targetCameraId ?? "?"}` : a.deviceId ? findDevice(a.deviceId)?.name ?? `#${a.deviceId}` : a.kind,
      ok: false,
      error: DIRECT_ABORTED_ERROR,
    }),
  );
}

/**
 * Markierte Regel ausfuehren. Gelingt jede Aktion rechtzeitig, kommt die
 * Regel in die Meldung des Ereignisses, und der Lauf geht an die Cloud
 * (Verlauf). Sonst fuehrt die Cloud die Regel aus: Nach der Frist startet
 * der Hub keine Aktion mehr, und was er geschaltet hat, steht als an die
 * Cloud abgegeben im Verlauf (`directRunOutcome`).
 */
async function runDirect(
  rule: PlanRule,
  at: number,
  camera: string,
  type: string,
): Promise<{ ruleId: number; configAt: string } | null> {
  const startedAt = Date.now();
  let late = false;
  const running = executeDirect(rule, () => late);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<"late">((resolve) => {
    timer = setTimeout(() => {
      // Sofort: Die naechste Aktion des Laufs startet schon nicht mehr.
      late = true;
      resolve("late");
    }, LOCAL_MOTION_WAIT_MS);
  });
  const first = await Promise.race([running, deadline]);
  if (timer) clearTimeout(timer);
  if (first === "late") {
    improveCount("rules", "motion_local_late");
    log(`Regel „${rule.name}“: Lauf im Hub dauert über ${LOCAL_MOTION_WAIT_MS / 1000} s, die Cloud führt sie aus`);
    // Die laufende Aktion endet noch; was bis dahin gelang, kommt in den Verlauf.
    void running
      .then((details) => recordDirect(rule, at, startedAt, Date.now(), details, true))
      .catch((e) => log(`Regel „${rule.name}“: Lauf im Hub nicht vermerkt (${e instanceof Error ? e.message : e})`));
    return null;
  }
  const finishedAt = Date.now();
  const outcome = await recordDirect(rule, at, startedAt, finishedAt, first, false);
  if (!outcome.report) {
    improveCount("rules", "motion_local_failed");
    const failed = first.filter((d) => !d.ok).map((d) => `${d.target}: ${d.error ?? "fehlgeschlagen"}`).join("; ");
    log(`Regel „${rule.name}“ direkt vom Hub gescheitert (${failed}), die Cloud führt sie aus`);
    return null;
  }
  log(directRunLine(rule.name, camera, type, finishedAt - at, finishedAt - startedAt));
  improveCount("rules", "motion_local");
  return { ruleId: rule.id, configAt: rule.hubConfigAt as string };
}

/** Direkten Lauf vermerken, soweit `directRunOutcome` es will. */
async function recordDirect(
  rule: PlanRule,
  at: number,
  startedAt: number,
  finishedAt: number,
  details: RunDetail[],
  late: boolean,
): Promise<ReturnType<typeof directRunOutcome>> {
  const outcome = directRunOutcome(details, late);
  if (!outcome.record) return outcome;
  const run = hubRunRecord({
    ruleId: rule.id,
    triggerKind: "motion",
    startedAt,
    finishedAt,
    eventAt: new Date(at).toISOString(),
    details,
  });
  pending.push({ ...run, ...(outcome.handedOver ? { handedOver: true as const } : {}), direct: true });
  if (pending.length > 2000) pending = pending.slice(-2000);
  await writeJson(PENDING_FILE, pending);
  recent.unshift({
    at: run.at,
    rule: rule.name,
    trigger: outcome.handedOver ? "motion (Hub, an die Cloud abgegeben)" : "motion (Hub)",
    success: run.success,
    error: run.errorMessage,
  });
  recent.length = Math.min(recent.length, 30);
  // Abgegeben: mit dem naechsten Minutentakt melden, nach dem Lauf der Cloud.
  if (!outcome.handedOver) flushPendingSoon();
  return outcome;
}

async function onDeviceSwitchedLocal(deviceId: number, action: string, depth: number): Promise<void> {
  if (!plan) return;
  const now = Date.now();
  for (const rule of plan.rules) {
    if (rule.trigger !== "DEVICE_SWITCHED" || rule.triggerDeviceId !== deviceId) continue;
    if (rule.triggerAction && rule.triggerAction !== action) continue;
    if (!inAllowed(rule, now) || !cooledDown(rule, now)) continue;
    await executeLocal(rule, "device", depth);
  }
}

/**
 * Der Hub hat ein Geraet im LAN geschaltet (Dashboard). Online: der Cloud
 * melden, damit sie ihre Regeln startet. Offline: selbst auswerten.
 */
export async function onDeviceSwitched(deviceId: number, action: string): Promise<void> {
  if (isOffline()) {
    await onDeviceSwitchedLocal(deviceId, action, 0);
    return;
  }
  try {
    const res = await api("/api/hub/device-switched", { method: "POST", body: JSON.stringify({ deviceId, action }) });
    if (!res.ok) log(`Regeln: Schaltmeldung an die Cloud fehlgeschlagen (HTTP ${res.status})`);
  } catch (e) {
    log(`Regeln: Schaltmeldung an die Cloud fehlgeschlagen (${e instanceof Error ? e.message : e})`);
  }
}

/* --------------------------------------------------------------- Start/UI */

export async function startRules(): Promise<void> {
  plan = await readJson<Plan>(PLAN_FILE);
  pending = (await readJson<PendingRun[]>(PENDING_FILE)) ?? [];
  const stored = parseOutageStore(await readJson<unknown>(OUTAGE_FILE));
  storedContactAt = stored.lastContactAt;
  fired = pruneFired(stored.fired, Date.now());
  onShutdown("regeln", () => saveOutage());
  // Kontakt nach einer Pause zurueck: Laeufe aus dem Notbetrieb sofort melden
  // und den Kontakt sichern, nicht erst im naechsten Takt. So holt die Cloud
  // nichts nach, was der Hub schon geschaltet hat, und ein Neustart kennt den
  // juengsten Kontakt.
  onContactResumed(CONTACT_SAVE_MS, () => {
    savedContactAt = lastCloudContactAt();
    void saveOutage();
    void flushPending().catch(() => undefined);
  });
  await refreshPlan();
  setInterval(() => refreshPlanIfDue(), PLAN_CHECK_MS);
  setInterval(() => void tick().catch((e) => log(`Regeln: Tick fehlgeschlagen (${e instanceof Error ? e.message : e})`)), TICK_MS);
  setInterval(() => void flushPending(), 60_000);
  // Laeufe, die vor dem Neustart nicht mehr gemeldet wurden.
  void flushPending().catch(() => undefined);
}

/**
 * Fuer das Lebenszeichen: Notbetrieb oder Cloud, wie viele Laeufe aus dem
 * Notbetrieb noch nicht gemeldet sind und zu welchen Terminen (`fires`),
 * ob der Hub Rolltore im Notbetrieb zufaehrt und bis wann sein Plan reicht.
 * Zu einem angekuendigten Termin holt die Cloud nichts nach, was der Hub
 * selbst geschaltet hat, sondern wartet auf seinen Lauf
 * (src/lib/rule-due.ts, `hubRunAnnounced`).
 */
export function rulesHeartbeat(now = Date.now()): {
  mode: "hub" | "cloud";
  pending: number;
  fires: Array<{ ruleId: number; fireAt: string }>;
  coverClose: boolean;
  planUntil: string | null;
} {
  // Laeufe direkt vom Hub zaehlen nicht: Die Cloud hat sie mit dem Ereignis schon gesperrt.
  const outage = pending.filter((r) => !r.direct);
  return {
    mode: isOffline(now) ? "hub" : "cloud",
    pending: outage.length,
    fires: announcedFires(outage),
    coverClose: COVER_CLOSE,
    planUntil: plan?.validUntil ?? null,
  };
}

export function rulesStatus() {
  const now = Date.now();
  return {
    mode: isOffline(now) ? "hub" : "cloud",
    offlineSince: offlineSince ? new Date(offlineSince).toISOString() : null,
    planAt: plan?.generatedAt ?? null,
    planValidUntil: plan?.validUntil ?? null,
    planExpired: plan ? Date.parse(plan.validUntil) < now : true,
    planError,
    rules: plan?.rules.length ?? 0,
    pending: pending.length,
    recent,
  };
}
