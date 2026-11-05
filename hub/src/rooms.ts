/**
 * Raum-Steuerung im Hub: spiegelt Raeume, Geraete und Regeln aus der Cloud
 * und schaltet Shellys direkt im LAN.
 *
 * Die Cloud bleibt die einzige Stelle, an der Raeume und Regeln gepflegt
 * werden (`GET /api/hub/rooms`). Der Hub haelt den letzten Stand unter
 * hub/.cache/rooms.json vor, damit die Steuerung auch ohne Internet startet.
 *
 * Schalten:
 *  - Shelly mit IP (Schalter, Licht, Taster, Tueroeffner): direkt im LAN, mit
 *    demselben Auto-Off-Timer wie die Cloud. Faellt der Shelly lokal aus,
 *    geht der Befehl an die Cloud.
 *  - Antriebe (Markise/Rolltor), Schloesser, Ventile, Pis, Audio: ueber die
 *    Cloud (`POST /api/devices/:id/action`). Antriebe bewusst nicht lokal –
 *    die Verriegelung beider Fahrtrichtungen liegt in der Cloud
 *    (src/lib/shelly-cover.ts) und soll nicht doppelt gepflegt werden.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { shellyStatus, shellySwitch } from "./shelly.js";
import { controlSmart, hueLightStates } from "./smart-devices.js";

export interface RoomDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  ipAddress: string | null;
  shellyId: string | null;
  coverUpChannel: number | null;
  coverDownChannel: number | null;
  coverRuntimeSec: number | null;
  pulseSeconds: number | null;
  isActive: boolean;
  task: number;
  lastUpdate: string | null;
  keyRoomId: number | null;
  /** HUE_LIGHT: Bridge und Lampe. */
  hueBridgeId?: string | null;
  hueLightId?: string | null;
  /** MAMMOTION_MOWER: Geraetename bei Mammotion. */
  mowerName?: string | null;
}

export interface Room {
  id: number;
  name: string;
  number: string | null;
  building: string | null;
  floor: string | null;
  devices: RoomDevice[];
  cameras: { id: number; name: string; kind: string | null }[];
  audioZones: { id: number; name: string }[];
  operating: { id: number; name: string; open: boolean } | null;
  rules: { id: number; name: string; trigger: string; isActive: boolean; lastRunAt: string | null }[];
  /** Solltemperatur halten; geregelt von der Cloud (src/lib/room-climate.ts). */
  climate?: {
    isActive: boolean;
    /** Fuehler, dessen Temperatur geregelt wird (fuer den Klimaverlauf). */
    sensorDeviceId?: number;
    targetC: number;
    currentTargetC: number | null;
    lastTempC: number | null;
    lastReadAt: string | null;
    heating: boolean | null;
    lastError: string | null;
  } | null;
}

interface RoomsSnapshot {
  at: string;
  timezone: string;
  rooms: Room[];
  unassigned: RoomDevice[];
}

export type DeviceAction = "open" | "emergency" | "deactivate" | "reset" | "close" | "stop";
const ACTIONS = new Set<DeviceAction>(["open", "emergency", "deactivate", "reset", "close", "stop"]);

export const ROOMS_SYNC_INTERVAL_MS = 120_000;
const CACHE_FILE = path.join(CONFIG.hubDir, ".cache", "rooms.json");
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/* Gleiche Werte wie in der Cloud (src/lib/device-open.ts, pulse-constants.ts). */
const DOOR_PULSE_SEC = 3;
const DEFAULT_PULSE_SECONDS = 30;
const MAX_PULSE_SECONDS = 1800;
const LATCHING = new Set(["SCHALTER", "BELEUCHTUNG"]);
const COVER = new Set(["MARKISE", "ROLLTOR"]);

let snapshot: RoomsSnapshot | null = null;
let syncedAt: string | null = null;
let syncError: string | null = null;
/** true = Stand kommt von der Platte, die Cloud war beim Start nicht erreichbar. */
let fromCache = false;

function isCover(d: RoomDevice): boolean {
  return COVER.has(d.category ?? "");
}

/** Kanal aus der Shelly-ID (`abc_2` → 1), wie `shellySwitchIndex` in der Cloud. */
function channelOf(d: RoomDevice): number {
  const suffix = d.shellyId?.includes("_") ? Number(d.shellyId.split("_").pop()) : 0;
  return Number.isFinite(suffix) && suffix > 0 ? suffix - 1 : 0;
}

/** Auto-Off in Sekunden beim Einschalten; undefined = eingeschaltet lassen. */
function autoOffSec(d: RoomDevice, action: DeviceAction): number | undefined {
  if (action !== "open") return undefined;
  if (d.category === "TASTER") {
    const s = d.pulseSeconds;
    if (s == null || !Number.isFinite(s) || s <= 0) return DEFAULT_PULSE_SECONDS;
    return Math.min(Math.round(s), MAX_PULSE_SECONDS);
  }
  if (LATCHING.has(d.category ?? "")) return undefined;
  return DOOR_PULSE_SEC;
}

/** Kann der Hub dieses Geraet selbst im LAN schalten? */
export function isLocalDevice(d: RoomDevice): boolean {
  if (isHue(d)) return true;
  return d.type === "SHELLY" && !!d.ipAddress && IPV4_RE.test(d.ipAddress) && !isCover(d);
}

/** Philips Hue: immer lokal ueber die gekoppelte Bridge. */
function isHue(d: RoomDevice): boolean {
  return d.type === "HUE_LIGHT" && !!d.hueBridgeId && !!d.hueLightId;
}

function allDevices(): RoomDevice[] {
  if (!snapshot) return [];
  return snapshot.rooms.flatMap((r) => r.devices).concat(snapshot.unassigned);
}

/** Alle Shellys mit IP (je Host einmal), fuer die Frueherkennung. */
export function localShellyHosts(): Array<{ host: string; label: string }> {
  const byHost = new Map<string, string[]>();
  for (const d of allDevices()) {
    if (d.type !== "SHELLY" || !d.ipAddress || !IPV4_RE.test(d.ipAddress)) continue;
    const names = byHost.get(d.ipAddress) ?? [];
    if (!names.includes(d.name)) names.push(d.name);
    byHost.set(d.ipAddress, names);
  }
  return [...byHost].map(([host, names]) => ({
    host,
    label: `${names[0]}${names.length > 1 ? ` (+${names.length - 1})` : ""} ${host}`,
  }));
}

/**
 * Klimafuehler, die der Hub im LAN lesen kann: Shellys mit IP, die als Fuehler
 * eingetragen sind oder die Temperatur eines Raumklimas liefern.
 */
export function sensorDevices(): RoomDevice[] {
  const climateSensors = new Set(
    (snapshot?.rooms ?? []).map((r) => r.climate?.sensorDeviceId).filter((id): id is number => typeof id === "number"),
  );
  return allDevices().filter(
    (d) => d.type === "SHELLY" && !!d.ipAddress && IPV4_RE.test(d.ipAddress) && (d.category === "SENSOR" || climateSensors.has(d.id)),
  );
}

async function saveCache(data: RoomsSnapshot): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data));
  } catch (e) {
    log(`Räume: Cache nicht geschrieben (${e instanceof Error ? e.message : e})`);
  }
}

async function loadCache(): Promise<void> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const data = JSON.parse(raw) as RoomsSnapshot;
    if (Array.isArray(data.rooms)) {
      snapshot = data;
      syncedAt = data.at ?? null;
      fromCache = true;
    }
  } catch {
    /* noch kein Cache */
  }
}

/** Stand aus der Cloud holen. Bei Fehler bleibt der letzte Stand stehen. */
export async function syncRooms(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await api("/api/hub/rooms");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RoomsSnapshot;
    if (!Array.isArray(data.rooms)) throw new Error("Antwort ohne Räume");
    const first = !snapshot || fromCache;
    snapshot = data;
    syncedAt = new Date().toISOString();
    syncError = null;
    fromCache = false;
    await saveCache(data);
    if (first) {
      const n = data.rooms.reduce((sum, r) => sum + r.devices.length, 0) + data.unassigned.length;
      log(`Räume: ${data.rooms.length} Räume, ${n} Geräte aus der Cloud geladen`);
    }
    return { ok: true };
  } catch (e) {
    syncError = e instanceof Error ? e.message : String(e);
    return { ok: false, error: syncError };
  }
}

export async function startRooms(): Promise<void> {
  await loadCache();
  await syncRooms();
  setInterval(() => void syncRooms(), ROOMS_SYNC_INTERVAL_MS);
}

/* ------------------------------------------------------------ Live-Status */

interface LiveState {
  reachable: boolean;
  on: boolean | null;
  powerW: number | null;
  error?: string;
}

const STATUS_TTL_MS = 4_000;
const statusCache = new Map<string, { at: number; promise: Promise<Awaited<ReturnType<typeof shellyStatus>> | null> }>();

function cachedStatus(host: string, fresh = false) {
  const hit = statusCache.get(host);
  if (!fresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.promise;
  const promise = shellyStatus(host).catch(() => null);
  statusCache.set(host, { at: Date.now(), promise });
  return promise;
}

/**
 * Live-Zustand aller lokal schaltbaren Geraete. Ein Shelly mit mehreren
 * Kanaelen wird nur einmal gefragt.
 */
export async function liveStates(fresh = false): Promise<Record<number, LiveState>> {
  const out: Record<number, LiveState> = {};
  const all = allDevices();
  const hue = all.filter(isHue);
  const bridges = [...new Set(hue.map((d) => d.hueBridgeId as string))];
  const hueStates = new Map(await Promise.all(bridges.map(async (b) => [b, await hueLightStates(b)] as const)));
  for (const d of hue) {
    const st = hueStates.get(d.hueBridgeId as string)?.[d.hueLightId as string];
    out[d.id] = st ? { reachable: st.reachable, on: st.on, powerW: null } : { reachable: false, on: null, powerW: null };
  }
  const local = all.filter((d) => isLocalDevice(d) && !isHue(d));
  const hosts = [...new Set(local.map((d) => d.ipAddress as string))];
  const results = new Map(
    await Promise.all(hosts.map(async (h) => [h, await cachedStatus(h, fresh)] as const))
  );
  for (const d of local) {
    const st = results.get(d.ipAddress as string);
    if (!st) {
      out[d.id] = { reachable: false, on: null, powerW: null };
      continue;
    }
    const ch = st.channels.find((c) => c.id === channelOf(d)) ?? st.channels[0];
    out[d.id] = { reachable: true, on: ch?.on ?? null, powerW: ch?.powerW ?? null };
  }
  return out;
}

/* ---------------------------------------------------------------- Schalten */

export interface ActionOutcome {
  ok: boolean;
  via: "lokal" | "cloud";
  on?: boolean | null;
  error?: string;
  /** Geraetename (fuer Protokoll und Regel-Verlauf). */
  name?: string;
}

/** Kameras eines Raums (Cloud-IDs), fuer Bewegungs- und Ruhe-Regeln. */
export function roomCameraIds(roomId: number): number[] {
  return snapshot?.rooms.find((r) => r.id === roomId)?.cameras.map((c) => c.id) ?? [];
}

async function viaCloud(id: number, action: DeviceAction): Promise<ActionOutcome> {
  try {
    const res = await api(`/api/devices/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; sent?: boolean };
    if (!res.ok) return { ok: false, via: "cloud", error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, via: "cloud", ...(body.error ? { error: body.error } : {}) };
  } catch (e) {
    return { ok: false, via: "cloud", error: `Cloud nicht erreichbar (${e instanceof Error ? e.message : e})` };
  }
}

/**
 * `localOnly` (Regel-Notbetrieb): nur im LAN schalten, nie die Cloud fragen –
 * die ist in dem Moment ohnehin nicht erreichbar.
 */
export async function deviceAction(
  id: number,
  action: string,
  opts: { localOnly?: boolean } = {}
): Promise<ActionOutcome> {
  if (!ACTIONS.has(action as DeviceAction)) return { ok: false, via: "lokal", error: "Ungültige Aktion" };
  const act = action as DeviceAction;
  const dev = allDevices().find((d) => d.id === id);
  if (!dev) return { ok: false, via: "lokal", error: "Gerät unbekannt – Räume neu laden" };
  const name = dev.name;
  const withName = (r: ActionOutcome): ActionOutcome => ({ ...r, name });
  if (opts.localOnly && !(isLocalDevice(dev) && act !== "close" && act !== "stop")) {
    return withName({ ok: false, via: "lokal", error: "Nur über die Cloud schaltbar" });
  }

  if (isHue(dev)) {
    const on = act === "open" || act === "emergency";
    const r = await controlSmart(`hue:${dev.hueBridgeId}:${dev.hueLightId}`, on);
    log(`Raum-Steuerung: ${dev.name} ${on ? "ein" : "aus"} (Hue) → ${r.ok ? "ok" : r.error}`);
    return withName({ ok: r.ok, via: "lokal", on: r.ok ? on : null, ...(r.error ? { error: r.error } : {}) });
  }

  if (isLocalDevice(dev) && act !== "close" && act !== "stop") {
    const on = act === "open" || act === "emergency";
    try {
      const r = await shellySwitch(dev.ipAddress as string, channelOf(dev), on, autoOffSec(dev, act));
      statusCache.delete(dev.ipAddress as string);
      log(`Raum-Steuerung: ${dev.name} ${on ? "ein" : "aus"} (lokal)`);
      return withName({ ok: true, via: "lokal", on: r.on });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (opts.localOnly) return withName({ ok: false, via: "lokal", error: msg });
      log(`Raum-Steuerung: ${dev.name} lokal fehlgeschlagen (${msg}), versuche Cloud`);
      const cloud = await viaCloud(id, act);
      return withName(cloud.ok ? cloud : { ...cloud, error: `Lokal: ${msg}. Cloud: ${cloud.error}` });
    }
  }

  const r = await viaCloud(id, act);
  log(`Raum-Steuerung: ${dev.name} ${act} über Cloud → ${r.ok ? "ok" : r.error}`);
  return withName(r);
}

/* -------------------------------------------------------------- Dashboard */

export function roomsPayload() {
  const mark = (d: RoomDevice) => ({ ...d, local: isLocalDevice(d) });
  return {
    syncedAt,
    syncError,
    fromCache,
    timezone: snapshot?.timezone ?? null,
    rooms: (snapshot?.rooms ?? []).map((r) => ({ ...r, devices: r.devices.map(mark) })),
    unassigned: (snapshot?.unassigned ?? []).map(mark),
  };
}
