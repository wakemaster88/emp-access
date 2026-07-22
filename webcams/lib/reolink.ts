import type { Cam } from "./types";

interface ReolinkResponse<T = unknown> {
  cmd: string;
  code: number;
  value?: T;
  error?: { rspCode: number; detail: string };
}

interface DevInfo {
  model: string;
  name: string;
  firmVer: string;
  hardVer: string;
  serial: string;
  channelNum: number;
  type: string;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Per-Cam-Mutex. Reolink-Cams (besonders E1 Pro) werfen "set config failed"
 * oder "timeout", wenn parallele PTZ-Befehle eintreffen (Hold-Click feuert
 * Left + Stop fast gleichzeitig). Wir serialisieren alle Befehle pro Cam.
 */
const camLocks = new Map<string, Promise<unknown>>();

async function withCamLock<T>(camId: string, fn: () => Promise<T>): Promise<T> {
  const previous = camLocks.get(camId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Auch bei Fehlern muss die Kette weiterlaufen, damit nachfolgende Aufrufe
  // nicht ewig blockieren.
  camLocks.set(
    camId,
    next.catch(() => undefined),
  );
  return next;
}

/** Abgelaufene Einträge wegräumen — sonst wächst die Map mit gelöschten Cams. */
function pruneExpiredTokens() {
  const now = Date.now();
  for (const [id, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(id);
  }
}

async function login(cam: Cam, signal?: AbortSignal): Promise<string> {
  pruneExpiredTokens();
  const cached = tokenCache.get(cam.id);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const url = `http://${cam.ip}:${cam.port}/cgi-bin/api.cgi?cmd=Login`;
  const body = [
    {
      cmd: "Login",
      action: 0,
      param: {
        User: { Version: "0", userName: cam.username, password: cam.password },
      },
    },
  ];
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(`Login HTTP ${r.status}`);
  const data = (await r.json()) as ReolinkResponse<{ Token: { name: string; leaseTime: number } }>[];
  if (!Array.isArray(data) || data[0]?.code !== 0 || !data[0].value) {
    throw new Error(`Login fehlgeschlagen: ${data[0]?.error?.detail ?? "unbekannt"}`);
  }
  const token = data[0].value.Token.name;
  const lease = data[0].value.Token.leaseTime ?? 3600;
  tokenCache.set(cam.id, { token, expiresAt: Date.now() + lease * 1000 });
  return token;
}

export function invalidateToken(camId: string) {
  tokenCache.delete(camId);
}

export async function reolinkCommand<T = unknown>(
  cam: Cam,
  command: { cmd: string; action?: 0 | 1; param?: Record<string, unknown> },
  options: { signal?: AbortSignal; retry?: boolean } = {},
): Promise<T> {
  return withCamLock(cam.id, () => reolinkCommandInner<T>(cam, command, options));
}

/**
 * Reolink-Cams (insb. E1 Pro) liefern bei zu schnellen Folge-Befehlen
 * "set config failed" oder "timeout". Diese Fehler sind transient – ein
 * kurzer Delay + Retry bringt zuverlässig Erfolg.
 */
const TRANSIENT_ERROR_PATTERNS = [
  "set config failed",
  "timeout",
  "param error",
];

function isTransientError(detail?: string): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => d.includes(p));
}

async function reolinkCommandInner<T = unknown>(
  cam: Cam,
  command: { cmd: string; action?: 0 | 1; param?: Record<string, unknown> },
  options: { signal?: AbortSignal; retry?: boolean; attempt?: number } = {},
): Promise<T> {
  const { signal, retry = true, attempt = 0 } = options;
  const token = await login(cam, signal);
  const url = `http://${cam.ip}:${cam.port}/cgi-bin/api.cgi?cmd=${command.cmd}&token=${token}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ cmd: command.cmd, action: command.action ?? 0, param: command.param ?? {} }]),
    signal,
  });
  if (!r.ok) throw new Error(`Reolink ${command.cmd} HTTP ${r.status}`);
  const data = (await r.json()) as ReolinkResponse<T>[];
  const first = data[0];
  if (!first) throw new Error(`Reolink ${command.cmd}: leere Antwort`);
  if (first.code !== 0) {
    const detail = first.error?.detail;
    // Token-Probleme: einmal mit frischem Token retryn.
    if (retry && (first.error?.rspCode === -6 || detail?.includes("token"))) {
      invalidateToken(cam.id);
      return reolinkCommandInner<T>(cam, command, { ...options, retry: false });
    }
    // Transient errors (Cam überlastet, RTSP reconnect): exponential backoff.
    // 200 ms · 500 ms · 1000 ms · 2000 ms = max ~3.7 s Wartezeit bis Aufgeben.
    if (retry && attempt < 4 && isTransientError(detail)) {
      const delays = [200, 500, 1000, 2000];
      await new Promise((r) => setTimeout(r, delays[attempt] ?? 2000));
      // Bei „set config failed" hat sich Token oft verflüchtigt – frischen holen.
      if (detail?.toLowerCase().includes("set config failed")) {
        invalidateToken(cam.id);
      }
      return reolinkCommandInner<T>(cam, command, { ...options, attempt: attempt + 1 });
    }
    throw new Error(`Reolink ${command.cmd}: ${detail ?? "unbekannt"}`);
  }
  return first.value as T;
}

export async function getDevInfo(cam: Cam, signal?: AbortSignal) {
  return reolinkCommand<{ DevInfo: DevInfo }>(
    cam,
    { cmd: "GetDevInfo" },
    { signal },
  );
}

export async function ping(cam: Cam, signal?: AbortSignal): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 3000);
    const sig = signal
      ? mergeSignals(signal, ctl.signal)
      : ctl.signal;
    await getDevInfo(cam, sig);
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal) {
  if (a.aborted || b.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const c = new AbortController();
  const onAbort = () => c.abort();
  a.addEventListener("abort", onAbort);
  b.addEventListener("abort", onAbort);
  return c.signal;
}
