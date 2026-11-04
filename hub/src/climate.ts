/**
 * Klimaverlauf im Hub: Temperatur und Luftfeuchte der Fuehler im LAN.
 *
 * Jede Minute werden die Fuehler aus dem Raum-Spiegel (rooms.ts) gelesen,
 * direkt ueber ihre IP. Batterie-Fuehler (Shelly H&T) schlafen und antworten
 * nicht; fuer sie gibt es zwei Wege: die Abfrage probiert es nach einem
 * Fehlschlag nur noch alle zehn Minuten, und der Fuehler kann per Webhook
 * selbst melden (dashboard.ts, /api/climate/report).
 *
 * Alle fuenf Minuten werden die abgeschlossenen Fenster gemittelt und an die
 * Cloud gemeldet (POST /api/hub/climate-samples). Was nicht ankommt, bleibt
 * in der Warteschlange und geht spaeter nach, bis zu sieben Tage. Minutenwerte
 * und Warteschlange liegen unter hub/.cache/climate.json, damit ein Neustart
 * nichts verliert.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { sensorDevices, type RoomDevice } from "./rooms.js";
import { shellyEnvironment } from "./shelly.js";
import { BUCKET_MS, aggregateSamples, bucketOf, plausible, type BucketSample, type MinuteSample } from "./climate-buckets.js";

const POLL_MS = 60_000;
const FLUSH_MS = BUCKET_MS;
/** Nach einem Fehlschlag (schlafender Fuehler) erst wieder nach dieser Zeit fragen. */
const BACKOFF_MS = 10 * 60_000;
const KEEP_MS = 7 * 24 * 3_600_000;
const MAX_POST = 500;
const CACHE_FILE = path.join(CONFIG.hubDir, ".cache", "climate.json");

interface ClimateCache {
  samples: MinuteSample[];
  pending: BucketSample[];
  /** Fenster vor diesem Zeitpunkt sind schon verdichtet. */
  sentUntil: number;
}

const state: ClimateCache = { samples: [], pending: [], sentUntil: 0 };
const backoffUntil = new Map<number, number>();
const lastRead = new Map<number, { at: number; tC: number | null; rh: number | null; via: "lan" | "push" }>();
let lastFlushAt: string | null = null;
let lastFlushError: string | null = null;
let started = false;

async function load(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Partial<ClimateCache>;
    if (Array.isArray(raw.samples)) state.samples = raw.samples;
    if (Array.isArray(raw.pending)) state.pending = raw.pending;
    if (typeof raw.sentUntil === "number") state.sentUntil = raw.sentUntil;
  } catch {
    // Kein Stand – frisch anfangen.
  }
}

async function save(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(state));
  } catch (e) {
    log(`Klima: Zwischenstand nicht gespeichert (${e instanceof Error ? e.message : e})`);
  }
}

function remember(deviceId: number, tC: number | null, rh: number | null, via: "lan" | "push"): boolean {
  const p = plausible(tC, rh);
  if (p.tC == null && p.rh == null) return false;
  const at = Date.now();
  state.samples.push({ deviceId, at, tC: p.tC, rh: p.rh });
  lastRead.set(deviceId, { at, ...p, via });
  return true;
}

async function poll(): Promise<void> {
  const now = Date.now();
  const devices = sensorDevices();
  await Promise.all(
    devices.map(async (d: RoomDevice) => {
      if ((backoffUntil.get(d.id) ?? 0) > now) return;
      try {
        const env = await shellyEnvironment(d.ipAddress as string);
        backoffUntil.delete(d.id);
        remember(d.id, env.tC, env.rh, "lan");
      } catch {
        backoffUntil.set(d.id, now + BACKOFF_MS);
      }
    }),
  );
}

/** Webhook eines Fuehlers (dashboard.ts). */
export function recordClimatePush(deviceId: number, tC: number | null, rh: number | null): { ok: boolean; error?: string } {
  if (!Number.isInteger(deviceId) || deviceId <= 0) return { ok: false, error: "device fehlt" };
  if (!sensorDevices().some((d) => d.id === deviceId)) return { ok: false, error: "kein bekannter Fuehler" };
  if (!remember(deviceId, tC, rh, "push")) return { ok: false, error: "kein plausibler Wert" };
  backoffUntil.set(deviceId, Date.now() + BACKOFF_MS);
  return { ok: true };
}

/** Abgeschlossene Fenster verdichten, an die Cloud schicken, Altes wegraeumen. */
async function flush(): Promise<void> {
  const now = Date.now();
  const closedBefore = bucketOf(now);
  const fresh = state.samples.filter((s) => s.at >= state.sentUntil && s.at < closedBefore);
  if (fresh.length > 0) state.pending.push(...aggregateSamples(fresh));
  state.sentUntil = closedBefore;
  state.samples = state.samples.filter((s) => s.at >= now - KEEP_MS);
  state.pending = state.pending.filter((b) => Date.parse(b.bucketStart) >= now - KEEP_MS);

  while (state.pending.length > 0) {
    const chunk = state.pending.slice(0, MAX_POST);
    try {
      const res = await api("/api/hub/climate-samples", { method: "POST", body: JSON.stringify({ samples: chunk }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.pending = state.pending.slice(chunk.length);
      lastFlushAt = new Date().toISOString();
      lastFlushError = null;
    } catch (e) {
      lastFlushError = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  await save();
}

export function startClimate(): void {
  if (started) return;
  started = true;
  void load().then(() => {
    const n = sensorDevices().length;
    log(`Klima: ${n} Fühler im LAN, ${state.pending.length} Fenster in der Warteschlange`);
    void poll();
    setInterval(() => void poll(), POLL_MS);
    // Kurz nach der Fenstergrenze, damit das letzte Fenster komplett ist.
    const untilBoundary = FLUSH_MS - (Date.now() % FLUSH_MS) + 5_000;
    setTimeout(() => {
      void flush();
      setInterval(() => void flush(), FLUSH_MS);
    }, untilBoundary);
  });
}

/** Stand fuer das Hub-Dashboard. */
export function climatePayload() {
  return {
    sensors: sensorDevices().map((d) => {
      const r = lastRead.get(d.id);
      return {
        id: d.id,
        name: d.name,
        ipAddress: d.ipAddress,
        roomId: d.keyRoomId,
        last: r ? { at: new Date(r.at).toISOString(), tC: r.tC, rh: r.rh, via: r.via } : null,
        sleeping: (backoffUntil.get(d.id) ?? 0) > Date.now(),
      };
    }),
    samples: state.samples.length,
    pending: state.pending.length,
    lastFlushAt,
    lastFlushError,
  };
}
