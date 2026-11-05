/**
 * Mammotion-Maeher am Hub: startet den Python-Dienst (hub/mower/server.py,
 * PyMammotion) und reicht Status, Karte und Befehle ans Dashboard durch.
 *
 * Laeuft nur, wenn MAMMOTION_EMAIL und MAMMOTION_PASSWORD in hub/.env stehen
 * (ein eigener Zweit-Account, mit dem die Maeher in der App geteilt sind).
 * Fehlt das venv oder haben sich die Requirements geaendert, richtet der Hub
 * es selbst ein (hub/mower/install.sh) – so reicht ein normales Hub-Update.
 *
 * Zustand und Karte gehen an die Cloud (POST /api/hub/mower-sync), dort
 * erscheinen die Maeher als Geraet im Raum. Befehle aus der Cloud kommen als
 * Hub-Task MOWER_ACTION zurueck (tasks.ts → mowerAction).
 *
 * Die Maeher-Kameras traegt der Hub als Streams in go2rtc ein (mower-streams.ts).
 * go2rtc holt das Bild per WHEP beim Dienst ab, sobald jemand zuschaut.
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { buildCloudMap, type CloudMowerMap, type MowerGeo } from "./mower-map.js";
import { mowerStreamName, mowerStreamSources, needsStreamUpdate } from "./mower-streams.js";

const MOWER_PORT = Number(process.env.MOWER_PORT || 8791);
const MOWER_URL = `http://127.0.0.1:${MOWER_PORT}`;
const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");
const MOWER_DIR = path.join(CONFIG.hubDir, "mower");
const VENV_PY = path.join(MOWER_DIR, ".venv", "bin", "python");
const REQ_FILE = path.join(MOWER_DIR, "requirements.txt");
const REQ_STAMP = path.join(MOWER_DIR, ".venv", ".requirements.sha256");
/** Takt, in dem der Hub Statuswechsel fuer die Ereignis-Chronik abholt. */
const WATCH_INTERVAL_MS = 60_000;

export function mowerConfigured(): boolean {
  return Boolean(process.env.MAMMOTION_EMAIL?.trim() && process.env.MAMMOTION_PASSWORD);
}

let proc: ChildProcess | null = null;
let starting: Promise<boolean> | null = null;
let installing: Promise<boolean> | null = null;
let installError: string | null = null;
let restartDelayMs = 5_000;
let stopping = false;

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(`${MOWER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function requirementsCurrent(): boolean {
  if (!existsSync(VENV_PY) || !existsSync(REQ_STAMP)) return false;
  try {
    const want = createHash("sha256").update(readFileSync(REQ_FILE)).digest("hex");
    return readFileSync(REQ_STAMP, "utf8").trim() === want;
  } catch {
    return false;
  }
}

/** Richtet das venv ein (einmal gleichzeitig). */
function installVenv(): Promise<boolean> {
  if (installing) return installing;
  log("Mäher-Dienst: richte Python-Umgebung ein (hub/mower/install.sh) …");
  installing = new Promise<boolean>((resolve) => {
    execFile(
      "/bin/zsh",
      [path.join(MOWER_DIR, "install.sh")],
      { cwd: MOWER_DIR, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout}\n${stderr}`.trim().split("\n").slice(-3).join(" | ");
        if (err) {
          installError = out || err.message;
          log(`Mäher-Dienst: Einrichtung fehlgeschlagen: ${installError}`);
          resolve(false);
        } else {
          installError = null;
          log("Mäher-Dienst: Python-Umgebung bereit");
          resolve(true);
        }
        installing = null;
      }
    );
  });
  return installing;
}

/** Startet den Dienst, falls noetig. */
export async function ensureMowerSidecar(): Promise<boolean> {
  if (!mowerConfigured()) return false;
  if (await healthOk()) return true;
  if (starting) return starting;
  starting = (async () => {
    if (!requirementsCurrent() && !(await installVenv())) return false;
    if (!proc || proc.killed) spawnSidecar();
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      if (await healthOk()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return healthOk();
  })().finally(() => {
    starting = null;
  });
  return starting;
}

function spawnSidecar(): void {
  log(`Mäher-Dienst startet auf Port ${MOWER_PORT} …`);
  const child = spawn(VENV_PY, ["-I", path.join(MOWER_DIR, "server.py")], {
    cwd: MOWER_DIR,
    env: { ...process.env, MOWER_HOST: "127.0.0.1", MOWER_PORT: String(MOWER_PORT), MOWER_PARENT_WATCH: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc = child;
  const spawnedAt = Date.now();
  const pipe = (d: Buffer) => {
    for (const line of String(d).split("\n")) {
      const t = line.trim();
      if (t) log(`[mäher] ${t}`);
    }
  };
  child.stdout?.on("data", pipe);
  child.stderr?.on("data", pipe);
  child.on("exit", (code) => {
    if (proc === child) proc = null;
    if (stopping) return;
    // Lief er eine Weile stabil, faengt die Wartezeit wieder klein an.
    if (Date.now() - spawnedAt > 10 * 60_000) restartDelayMs = 5_000;
    log(`Mäher-Dienst beendet (code ${code}), Neustart in ${Math.round(restartDelayMs / 1000)} s`);
    // Der Neustart stellt die gespeicherte Sitzung wieder her (kein Passwort-Login).
    setTimeout(() => void ensureMowerSidecar(), restartDelayMs);
    restartDelayMs = Math.min(restartDelayMs * 2, 30 * 60_000);
  });
}

export function stopMowerSidecar(): void {
  stopping = true;
  proc?.kill("SIGTERM");
}

/* ------------------------------------------------------------------ API */

export interface MowerTask {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
  startTime: string;
  endTime: string;
  weekdays: string[];
  bladeHeightMm: number;
  zones: string[];
}

export interface MowerCamera {
  uid: number;
  label: string;
  /** Laeuft gerade eine Agora-Sitzung (jemand schaut zu)? */
  live: boolean;
  since: number | null;
  /** Letzter Grund, warum das Bild nicht kam oder endete. */
  error: string | null;
  /** go2rtc-Streams: roh (H265) und fuer Browser (H264). */
  stream?: string;
  streamH264?: string;
}

export interface MowerInfo {
  name: string;
  cameras?: MowerCamera[];
  firmware?: string | null;
  position?: { lat: number; lon: number } | null;
  currentZone: string | null;
  zones?: { hash: string | number; name: string }[];
  label: string;
  model: string;
  online: boolean;
  status: string;
  statusLabel: string;
  active: boolean;
  charging: boolean;
  battery: number;
  progress: number | null;
  runningTaskId: string | null;
  tasks: MowerTask[];
  errors: { code: number; text: string }[];
}

export interface MowerStatus {
  configured: boolean;
  state: string;
  error: string | null;
  account?: string | null;
  lastPollAt?: number | null;
  camera?: { available: boolean; error: string | null; maxS?: number };
  mowers: MowerInfo[];
}

export async function mowerStatus(): Promise<MowerStatus> {
  if (!mowerConfigured()) {
    return {
      configured: false,
      state: "no_credentials",
      error: "Kein Mammotion-Account in hub/.env (MAMMOTION_EMAIL, MAMMOTION_PASSWORD).",
      mowers: [],
    };
  }
  if (!(await healthOk())) {
    void ensureMowerSidecar();
    return {
      configured: true,
      state: installing ? "installing" : "starting",
      error: installError,
      mowers: [],
    };
  }
  try {
    const res = await fetch(`${MOWER_URL}/status`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as Omit<MowerStatus, "configured">;
    const mowers = (Array.isArray(data.mowers) ? data.mowers : []).map((m) => ({
      ...m,
      cameras: (Array.isArray(m.cameras) ? m.cameras : []).map((c) => {
        const stream = mowerStreamName(m.name, c.uid);
        return { ...c, stream, streamH264: `${stream}_h264` };
      }),
    }));
    return { configured: true, ...data, mowers };
  } catch (e) {
    return { configured: true, state: "error", error: e instanceof Error ? e.message : String(e), mowers: [] };
  }
}

export async function mowerMap(name: string): Promise<{ status: number; body: unknown }> {
  if (!(await healthOk())) return { status: 503, body: { error: "Mäher-Dienst läuft nicht" } };
  const res = await fetch(`${MOWER_URL}/map?mower=${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const ACTIONS = ["start_task", "pause", "resume", "stop", "dock", "enable_task", "refresh"];

export async function mowerAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const action = String(body.action ?? "");
  if (!ACTIONS.includes(action)) return { ok: false, error: "Unbekannte Aktion" };
  if (!(await ensureMowerSidecar())) return { ok: false, error: "Mäher-Dienst läuft nicht" };
  try {
    const res = await fetch(`${MOWER_URL}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mower: String(body.mower ?? ""),
        action,
        planId: body.planId != null ? String(body.planId) : undefined,
        enabled: body.enabled === true,
      }),
      // Stoppen wartet, bis der Maeher wirklich steht.
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    log(`Mäher ${String(body.mower)}: ${action}${data.ok ? "" : ` fehlgeschlagen (${data.error ?? res.status})`}`);
    return { ok: Boolean(data.ok), error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sitzung verwerfen und einmal mit Passwort neu anmelden (abgelaufene Token).
 * Der Dienst laesst das hoechstens alle sechs Stunden zu.
 */
export async function mowerRelogin(): Promise<{ ok: boolean; error?: string }> {
  if (!mowerConfigured()) return { ok: false, error: "Kein Mammotion-Account in hub/.env" };
  if (!(await ensureMowerSidecar())) return { ok: false, error: "Mäher-Dienst läuft nicht" };
  try {
    const res = await fetch(`${MOWER_URL}/relogin`, { method: "POST", signal: AbortSignal.timeout(15_000) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    log(`Mäher: Neuanmeldung ${data.ok ? "gestartet" : `abgelehnt (${data.error ?? res.status})`}`);
    if (data.ok) syncMowersSoon();
    return { ok: Boolean(data.ok), error: data.error ?? (res.status === 404 ? "Mäher-Dienst zu alt – Hub neu starten" : undefined) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* -------------------------------------------------------------- Cloud-Sync */

/** Was die Cloud vom Maeher bekommt (ohne schnell wechselndes Datenalter). */
function cloudState(m: MowerInfo) {
  return {
    model: m.model,
    label: m.label,
    online: m.online,
    status: m.status,
    statusLabel: m.statusLabel,
    active: m.active,
    charging: m.charging,
    battery: m.battery,
    progress: m.progress,
    currentZone: m.currentZone,
    runningTaskId: m.runningTaskId,
    firmware: m.firmware ?? null,
    position: m.position ?? null,
    zones: (m.zones ?? []).map((z) => z.name),
    tasks: m.tasks,
    errors: m.errors,
  };
}

const CLOUD_HEARTBEAT_MS = 5 * 60_000;
const CLOUD_MAP_EVERY_MS = 30 * 60_000;
const lastCloud = new Map<string, { json: string; at: number }>();
const lastCloudMap = new Map<string, { json: string; fetchedAt: number }>();

/**
 * Maeher an die Cloud melden: bei jeder Aenderung, sonst alle 5 Minuten.
 * Die Karte wird alle 30 Minuten neu gebaut und nur mitgeschickt, wenn sie
 * sich geaendert hat.
 */
async function syncMowersToCloud(st: MowerStatus): Promise<void> {
  if (st.state !== "ready" || st.mowers.length === 0) return;
  const now = Date.now();
  const payload: { name: string; state: ReturnType<typeof cloudState>; map?: CloudMowerMap | null }[] = [];
  for (const m of st.mowers) {
    const state = cloudState(m);
    const json = JSON.stringify(state);
    const prev = lastCloud.get(m.name);
    const item: (typeof payload)[number] = { name: m.name, state };
    const mapPrev = lastCloudMap.get(m.name);
    if (!mapPrev || now - mapPrev.fetchedAt > CLOUD_MAP_EVERY_MS) {
      try {
        const r = await mowerMap(m.name);
        if (r.status === 200) {
          const map = buildCloudMap(r.body as MowerGeo);
          const mapJson = JSON.stringify(map);
          if (map && mapJson !== mapPrev?.json) item.map = map;
          lastCloudMap.set(m.name, { json: map ? mapJson : mapPrev?.json ?? "", fetchedAt: now });
        }
      } catch {
        /* naechster Versuch in 30 min */
      }
    }
    if (item.map || !prev || prev.json !== json || now - prev.at > CLOUD_HEARTBEAT_MS) payload.push(item);
  }
  if (payload.length === 0) return;
  try {
    const res = await api("/api/hub/mower-sync", { method: "POST", body: JSON.stringify({ mowers: payload }) });
    if (!res.ok) {
      log(`Mäher-Sync: HTTP ${res.status}`);
      // Karte beim naechsten Mal erneut schicken.
      for (const p of payload) if (p.map) lastCloudMap.delete(p.name);
      return;
    }
    for (const p of payload) lastCloud.set(p.name, { json: JSON.stringify(p.state), at: now });
    const r = (await res.json().catch(() => ({}))) as { created?: number };
    if (r.created) log(`Mäher-Sync: ${r.created} Mäher in der Cloud angelegt (im Raum zuordnen)`);
  } catch (e) {
    for (const p of payload) if (p.map) lastCloudMap.delete(p.name);
    log(`Mäher-Sync: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ------------------------------------------------------- Kamera-Streams */

const announcedStreams = new Set<string>();

/**
 * Maeher-Kameras als Streams in go2rtc eintragen (PUT /api/streams, go2rtc
 * schreibt sie selbst in seine yaml). Fehlt ein Stream, weil die
 * Kamera-Verwaltung die yaml neu geschrieben hat, kommt er beim naechsten
 * Durchlauf wieder dazu. Laufende Streams bleiben unangetastet.
 */
async function syncMowerStreams(st: MowerStatus): Promise<void> {
  if (st.state !== "ready" || !st.camera?.available) return;
  const want: Record<string, string> = {};
  for (const m of st.mowers) {
    for (const c of m.cameras ?? []) Object.assign(want, mowerStreamSources(m.name, c.uid, MOWER_PORT));
  }
  if (Object.keys(want).length === 0) return;
  let have: Record<string, { producers?: { url?: string }[]; consumers?: unknown[] } | null>;
  try {
    const res = await fetch(`${GO2RTC_URL}/api/streams`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return;
    have = ((await res.json()) ?? {}) as typeof have;
  } catch {
    return; // go2rtc laeuft nicht; naechster Durchlauf
  }
  for (const [name, src] of Object.entries(want)) {
    if (!needsStreamUpdate(have[name], src)) continue;
    try {
      const res = await fetch(`${GO2RTC_URL}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`, {
        method: "PUT",
        signal: AbortSignal.timeout(4000),
      });
      // 400 kann auch "yaml nicht schreibbar" heissen, der Stream laeuft dann trotzdem bis zum Neustart.
      if (!announcedStreams.has(name)) log(`go2rtc: Mäher-Kamera ${name} eingetragen${res.ok ? "" : ` (HTTP ${res.status})`}`);
      announcedStreams.add(name);
    } catch (e) {
      log(`go2rtc: Mäher-Kamera ${name} nicht eintragbar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/* ------------------------------------------------------- Ereignis-Chronik */

const lastSeen = new Map<string, { status: string; errors: string }>();
let lastStatus: MowerStatus | null = null;

/** Letzter Stand aus dem Mäher-Takt (ohne neue Abfrage), z. B. fuer die Frueherkennung. */
export function lastMowerStatus(): MowerStatus | null {
  return lastStatus;
}

async function watchOnce(): Promise<void> {
  const st = await mowerStatus();
  lastStatus = st;
  await syncMowersToCloud(st);
  await syncMowerStreams(st);
  for (const m of st.mowers) {
    const errors = m.errors.map((e) => e.code).join(",");
    const prev = lastSeen.get(m.name);
    lastSeen.set(m.name, { status: m.status, errors });
    if (!prev) continue;
    if (prev.status !== m.status) {
      recordHubEvent({ kind: "system", severity: "info", where: m.label, title: `Mäher: ${m.statusLabel}` });
    }
    if (errors && prev.errors !== errors) {
      recordHubEvent({
        kind: "system",
        severity: "warn",
        where: m.label,
        title: "Mäher meldet Fehler",
        detail: m.errors.map((e) => e.text || `Code ${e.code}`).join(" · "),
      });
    }
  }
}

/** Nach einem Befehl den neuen Zustand bald an die Cloud melden. */
export function syncMowersSoon(): void {
  setTimeout(() => void watchOnce().catch(() => {}), 12_000);
}

export function startMower(): void {
  if (!mowerConfigured()) return;
  void ensureMowerSidecar();
  setInterval(() => void watchOnce().catch(() => {}), WATCH_INTERVAL_MS);
}
