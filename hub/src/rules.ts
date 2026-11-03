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
 * Hub keine zweite Kopie der Betriebszeit- und Sonnenlogik.
 *
 * Im Notbetrieb schaltet der Hub nur, was er lokal erreicht (Shellys mit IP).
 * Benachrichtigungen und Audio brauchen die Cloud und werden als
 * fehlgeschlagen protokolliert. Alle Laeufe gehen nachtraeglich an die Cloud
 * (`POST /api/hub/rules`), sobald sie wieder erreichbar ist.
 *
 * Doppelt ausgefuehrt wird nichts: Der Hub handelt nur, solange er die Cloud
 * nicht erreicht, und die Cloud kann in der Zeit keine Befehle in den Standort
 * schicken.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { STATE, recordHubEvent } from "./state.js";
import { deviceAction, roomCameraIds } from "./rooms.js";

interface PlanInterval {
  from: string;
  to: string;
}

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
  actions: { id: number; kind: string; deviceId: number | null; deviceAction: string | null; timerSeconds: number | null }[];
}

interface Plan {
  generatedAt: string;
  validUntil: string;
  rules: PlanRule[];
}

interface PendingRun {
  ruleId: number;
  at: string;
  triggerKind: string;
  success: boolean;
  details: { actionId: number; kind: string; target: string; ok: boolean; error?: string }[];
  errorMessage: string | null;
}

const PLAN_FILE = path.join(CONFIG.hubDir, ".cache", "rule-plan.json");
const PENDING_FILE = path.join(CONFIG.hubDir, ".cache", "rule-runs-pending.json");
const PLAN_REFRESH_MS = 15 * 60_000;
const TICK_MS = (Number(process.env.HUB_RULES_TICK_SEC) || 20) * 1000;
/** Ohne erfolgreichen Cloud-Kontakt so lange -> Notbetrieb. */
const OFFLINE_AFTER_MS = (Number(process.env.HUB_RULES_OFFLINE_SEC) || 180) * 1000;
/** Wie die Cloud: hoechstens eine Folgeregel-Ebene. */
const MAX_CHAIN_DEPTH = 1;

let plan: Plan | null = null;
let planError: string | null = null;
let pending: PendingRun[] = [];
const lastRun = new Map<number, number>();
const firedAt = new Set<string>();
/** Letzte Bewegung je Kamera (ms), fuer IDLE-Regeln. */
const lastMotion = new Map<number, number>();
const startedAt = Date.now();
let offlineSince: number | null = null;
const recent: { at: string; rule: string; trigger: string; success: boolean; error: string | null }[] = [];

/* ----------------------------------------------------------- Cloud-Status */

function lastCloudContact(): number | null {
  const last = STATE.heartbeat.lastSuccessAt;
  return last ? new Date(last).getTime() : null;
}

/** Notbetrieb aktiv? Erst nach einer Karenzzeit, damit ein Ruckler nichts ausloest. */
export function isOffline(now = Date.now()): boolean {
  const last = lastCloudContact() ?? startedAt;
  return now - last > OFFLINE_AFTER_MS;
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

async function refreshPlan(): Promise<void> {
  try {
    const res = await api("/api/hub/rules");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Plan;
    if (!Array.isArray(data.rules)) throw new Error("Antwort ohne Regeln");
    plan = data;
    planError = null;
    await writeJson(PLAN_FILE, data);
  } catch (e) {
    planError = e instanceof Error ? e.message : String(e);
  }
}

async function flushPending(): Promise<void> {
  if (!pending.length || isOffline()) return;
  const batch = pending.slice(0, 200);
  try {
    const res = await api("/api/hub/rules", { method: "POST", body: JSON.stringify({ runs: batch }) });
    if (!res.ok) return;
    pending = pending.slice(batch.length);
    await writeJson(PENDING_FILE, pending);
    log(`Regeln: ${batch.length} Läufe aus dem Notbetrieb an die Cloud gemeldet`);
  } catch {
    /* naechster Versuch */
  }
}

/* ------------------------------------------------------------- Ausfuehren */

function inAllowed(rule: PlanRule, now: number): boolean {
  return rule.allowed.some((i) => now >= Date.parse(i.from) && now < Date.parse(i.to));
}

function cooledDown(rule: PlanRule, now: number): boolean {
  const last = lastRun.get(rule.id);
  return !last || now - last >= Math.max(0, rule.cooldownSeconds) * 1000;
}

async function executeLocal(rule: PlanRule, triggerKind: string, depth = 0): Promise<void> {
  const now = Date.now();
  lastRun.set(rule.id, now);
  const details: PendingRun["details"] = [];
  for (const a of rule.actions) {
    if (a.kind !== "DEVICE") {
      details.push({ actionId: a.id, kind: a.kind, target: a.kind, ok: false, error: "Im Notbetrieb nicht möglich (braucht die Cloud)" });
      continue;
    }
    if (!a.deviceId || !a.deviceAction) {
      details.push({ actionId: a.id, kind: a.kind, target: "–", ok: false, error: "Gerät oder Aktion fehlt" });
      continue;
    }
    const r = await deviceAction(a.deviceId, a.deviceAction, { localOnly: true });
    details.push({ actionId: a.id, kind: a.kind, target: r.name ?? `#${a.deviceId}`, ok: r.ok, error: r.error });
    if (r.ok && depth < MAX_CHAIN_DEPTH) void onDeviceSwitchedLocal(a.deviceId, a.deviceAction, depth + 1);
  }
  const success = details.length > 0 && details.every((d) => d.ok);
  const failed = details.filter((d) => !d.ok);
  const run: PendingRun = {
    ruleId: rule.id,
    at: new Date(now).toISOString(),
    triggerKind,
    success,
    details,
    errorMessage: failed.length ? failed.map((d) => `${d.target}: ${d.error}`).join("; ") : null,
  };
  pending.push(run);
  if (pending.length > 2000) pending = pending.slice(-2000);
  await writeJson(PENDING_FILE, pending);
  recent.unshift({ at: run.at, rule: rule.name, trigger: triggerKind, success, error: run.errorMessage });
  recent.length = Math.min(recent.length, 30);
  log(`Regel (Notbetrieb) „${rule.name}“: ${success ? "ausgeführt" : `teilweise fehlgeschlagen – ${run.errorMessage}`}`);
  recordHubEvent({
    kind: "system",
    severity: success ? "info" : "warn",
    where: "Regeln",
    title: `Notbetrieb: ${rule.name}`,
    detail: success ? "vom Hub ausgeführt" : run.errorMessage ?? undefined,
  });
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
    void flushPending();
  }
  if (!offline || !plan) return;

  for (const rule of plan.rules) {
    if (rule.fireAt.length) {
      for (const at of rule.fireAt) {
        const t = Date.parse(at);
        // Termine, die waehrend des Notbetriebs faellig werden (bis 3 min spaet).
        if (t > now || now - t > 3 * 60_000 || t < (offlineSince ?? now) - 60_000) continue;
        const key = `${rule.id}@${at}`;
        if (firedAt.has(key)) continue;
        firedAt.add(key);
        await executeLocal(rule, rule.trigger.toLowerCase());
      }
    }
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
}

/* -------------------------------------------------------------- Ereignisse */

/** Kamera meldet Beginn eines Ereignisses (MOTION, PERSON, VEHICLE, …). */
export function onCameraEvent(cameraId: number, type: string): void {
  const now = Date.now();
  lastMotion.set(cameraId, now);
  if (!isOffline(now) || !plan) return;
  for (const rule of plan.rules) {
    if (rule.trigger !== "MOTION") continue;
    if (rule.eventType && rule.eventType !== type) continue;
    const match = rule.cameraId != null ? rule.cameraId === cameraId : rule.roomId != null && roomCameraIds(rule.roomId).includes(cameraId);
    if (!match || !inAllowed(rule, now) || !cooledDown(rule, now)) continue;
    void executeLocal(rule, "motion");
  }
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
  await refreshPlan();
  setInterval(() => void refreshPlan(), PLAN_REFRESH_MS);
  setInterval(() => void tick().catch((e) => log(`Regeln: Tick fehlgeschlagen (${e instanceof Error ? e.message : e})`)), TICK_MS);
  setInterval(() => void flushPending(), 60_000);
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
