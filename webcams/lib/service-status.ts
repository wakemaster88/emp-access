/**
 * Health-Checks für die lokalen Dienste am iMac (Kontrollzentrum-Kachel).
 * Jeder Probe läuft unabhängig; ein Timeout oder Fehler färbt nur diese Zeile.
 */
import { doorbirdInfo } from "./doorbird";
import { empAccessGetJson, extractDevicesArray } from "./emp-access-client";
import { checkGo2rtcReachable } from "./go2rtc";
import type { Config } from "./types";

const PROBE_MS = 2500;

export interface ServiceRow {
  id: string;
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
  ms: number;
}

export interface ServiceStatusPayload {
  checkedAt: number;
  services: ServiceRow[];
}

function hubDashboardUrl(): string {
  return (process.env.HUB_DASHBOARD_URL || "http://127.0.0.1:8787").replace(
    /\/$/,
    "",
  );
}

function faceSidecarUrl(): string {
  return (process.env.FACE_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function fetchJson(
  url: string,
  timeoutMs = PROBE_MS,
): Promise<{ status: number; data: unknown; ms: number }> {
  const t0 = Date.now();
  const r = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text.slice(0, 80);
    }
  }
  return { status: r.status, data, ms: Date.now() - t0 };
}

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

function fail(id: string, name: string, err: unknown, ms: number): ServiceRow {
  const msg = err instanceof Error ? err.message : String(err);
  const short = msg.replace(/^Error:\s*/, "").slice(0, 80);
  return { id, name, ok: false, error: short || "nicht erreichbar", ms };
}

async function probeGo2rtc(config: Config): Promise<ServiceRow> {
  const name = "go2rtc";
  try {
    const { value, ms } = await timed(() =>
      checkGo2rtcReachable(config.settings.go2rtcUrl),
    );
    if (!value.reachable) {
      return {
        id: "go2rtc",
        name,
        ok: false,
        error: value.error || "nicht erreichbar",
        ms,
      };
    }
    const n = value.streams?.length ?? 0;
    return {
      id: "go2rtc",
      name,
      ok: true,
      detail: n === 1 ? "1 Stream" : `${n} Streams`,
      ms,
    };
  } catch (err) {
    return fail("go2rtc", name, err, PROBE_MS);
  }
}

async function probeTracker(config: Config): Promise<ServiceRow> {
  const name = "Tracker";
  const base = config.settings.tracker.url.replace(/\/$/, "");
  try {
    const { status, data, ms } = await fetchJson(`${base}/health`);
    const rec = asRecord(data);
    if (status >= 200 && status < 300 && rec?.ok === true) {
      const workers = Array.isArray(rec.workers) ? rec.workers.length : 0;
      return {
        id: "tracker",
        name,
        ok: true,
        detail: workers === 1 ? "1 Worker" : `${workers} Worker`,
        ms,
      };
    }
    return {
      id: "tracker",
      name,
      ok: false,
      error: `HTTP ${status}`,
      ms,
    };
  } catch (err) {
    return fail("tracker", name, err, PROBE_MS);
  }
}

async function probeHub(): Promise<ServiceRow> {
  const name = "Hub";
  try {
    const { status, data, ms } = await fetchJson(
      `${hubDashboardUrl()}/api/status`,
    );
    const rec = asRecord(data);
    if (status < 200 || status >= 300 || !rec) {
      return { id: "hub", name, ok: false, error: `HTTP ${status}`, ms };
    }
    const hb = asRecord(rec.heartbeat);
    const lastError =
      typeof hb?.lastError === "string" && hb.lastError.trim()
        ? hb.lastError.trim()
        : null;
    const version = typeof rec.version === "string" ? rec.version : "";
    if (lastError) {
      return { id: "hub", name, ok: false, error: lastError.slice(0, 80), ms };
    }
    return {
      id: "hub",
      name,
      ok: true,
      detail: version || "Heartbeat ok",
      ms,
    };
  } catch (err) {
    return fail("hub", name, err, PROBE_MS);
  }
}

async function probeFace(): Promise<ServiceRow> {
  const name = "Face";
  try {
    const { status, data, ms } = await fetchJson(`${faceSidecarUrl()}/health`);
    const rec = asRecord(data);
    if (status >= 200 && status < 300 && rec?.ok === true) {
      const model = typeof rec.model === "string" ? rec.model : "";
      return {
        id: "face",
        name,
        ok: true,
        detail: model || "bereit",
        ms,
      };
    }
    return { id: "face", name, ok: false, error: `HTTP ${status}`, ms };
  } catch (err) {
    return fail("face", name, err, PROBE_MS);
  }
}

async function probeCloud(config: Config): Promise<ServiceRow> {
  const name = "Cloud";
  const ea = config.settings.empAccess;
  const base = (ea.baseUrl || "https://emp-access.vercel.app").replace(/\/$/, "");
  try {
    if (ea.enabled && ea.apiToken.trim()) {
      const { value, ms } = await timed(() =>
        empAccessGetJson(
          base,
          ea.apiToken.trim(),
          "/api/devices",
          AbortSignal.timeout(PROBE_MS),
        ),
      );
      const list = extractDevicesArray(value);
      return {
        id: "cloud",
        name,
        ok: true,
        detail: list.length ? `${list.length} Geräte` : "API ok",
        ms,
      };
    }
    const { status, ms } = await fetchJson(base);
    if (status >= 200 && status < 400) {
      return { id: "cloud", name, ok: true, detail: `HTTP ${status}`, ms };
    }
    return { id: "cloud", name, ok: false, error: `HTTP ${status}`, ms };
  } catch (err) {
    return fail("cloud", name, err, PROBE_MS);
  }
}

async function probeDoorbird(config: Config): Promise<ServiceRow | null> {
  if (!config.doorbird.enabled || !config.doorbird.ip) return null;
  const name = "Doorbird";
  try {
    const { value, ms } = await timed(() =>
      doorbirdInfo(config.doorbird, AbortSignal.timeout(PROBE_MS)),
    );
    const rec = asRecord(value);
    const inner = asRecord(rec?.BHA) ?? rec;
    const device = typeof inner?.DEVICE_TYPE === "string" ? inner.DEVICE_TYPE : "";
    return {
      id: "doorbird",
      name,
      ok: true,
      detail: device || config.doorbird.ip,
      ms,
    };
  } catch (err) {
    return fail("doorbird", name, err, PROBE_MS);
  }
}

export async function collectServiceStatus(
  config: Config,
): Promise<ServiceStatusPayload> {
  const [go2rtc, tracker, hub, face, cloud, doorbird] =
    await Promise.all([
      probeGo2rtc(config),
      probeTracker(config),
      probeHub(),
      probeFace(),
      probeCloud(config),
      probeDoorbird(config),
    ]);

  const services = [hub, tracker, go2rtc, cloud, doorbird, face].filter(
    (s): s is ServiceRow => s !== null,
  );

  return { checkedAt: Date.now(), services };
}
