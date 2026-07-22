import { loadConfig } from "./config";
import type { Cam } from "./types";
import {
  empAccessGetJson,
  extractDevicesArray,
  findDeviceById,
  EmpAccessHttpError,
} from "./emp-access-client";

export type EmpAccessEventKind = "valid" | "invalid" | "info";

export interface EmpAccessEvent {
  id: string;
  ts: number;
  camId: string;
  deviceId: number;
  kind: EmpAccessEventKind;
  summary: string;
  detail?: string;
}

const MAX_EVENTS = 250;

type Runtime = {
  lastPollMs: number;
  loading: boolean;
  lastError: string | null;
  /** Erster Lauf ohne Events — sonst fluten wir beim Start. */
  seeded: boolean;
  /** `${camId}:${deviceId}` → JSON-Fingerprint */
  fingerprints: Map<string, string>;
  events: EmpAccessEvent[];
};

function rt(): Runtime {
  const g = globalThis as typeof globalThis & { __empAccessRt?: Runtime };
  if (!g.__empAccessRt) {
    g.__empAccessRt = {
      lastPollMs: 0,
      loading: false,
      lastError: null,
      seeded: false,
      fingerprints: new Map(),
      events: [],
    };
  }
  return g.__empAccessRt;
}

function stableFingerprint(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(x: unknown): unknown {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  const o = x as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeysDeep(o[k]);
  }
  return out;
}

/**
 * Grobe Einordnung anhand häufiger Feldnamen / Statusstrings.
 * Reale emp-access-Payloads können abweichen — dann landet es bei „info".
 */
export function inferAccessKind(device: Record<string, unknown>): EmpAccessEventKind {
  const blob = JSON.stringify(device).toLowerCase();

  if (
    /\b(denied|rejected|abgelehnt|ungültig|invalid|blocked|gesperrt|fehlgeschlagen)\b/.test(
      blob,
    )
  ) {
    return "invalid";
  }
  if (/(zugriff verweigert|access denied|nicht erlaubt|quota|limit)/.test(blob)) {
    return "invalid";
  }

  const ag = device.accessGranted;
  const gr = device.granted;
  if (ag === false || gr === false) return "invalid";
  if (ag === true || gr === true) return "valid";

  const st = String(device.status ?? device.state ?? "").toLowerCase();
  if (
    st &&
    /(open|opened|granted|ok|freigegeben|erlaubt|success|aktiv)/.test(st)
  ) {
    return "valid";
  }
  if (st && /(denied|reject|closed|block|fail)/.test(st)) {
    return "invalid";
  }

  return "info";
}

function deviceLabel(d: Record<string, unknown>, id: number): string {
  const name = d.name ?? d.title ?? d.label ?? d.description;
  if (typeof name === "string" && name.trim()) return name.trim();
  return `Gerät #${id}`;
}

function pushEvent(ev: EmpAccessEvent) {
  const s = rt();
  s.events.unshift(ev);
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Liest Konfiguration, pollt bei Bedarf emp-access und erzeugt Events bei
 * geänderten Gerätestatus für alle Kameras mit `empAccess.enabled` und IDs.
 */
export async function refreshEmpAccessIfDue(): Promise<void> {
  const s = rt();
  if (s.loading) return;

  let cfg;
  try {
    cfg = await loadConfig();
  } catch {
    s.lastError = "config load failed";
    return;
  }

  const ea = cfg.settings.empAccess;
  if (!ea.enabled || !ea.apiToken?.trim()) {
    s.lastError = null;
    return;
  }

  const now = Date.now();
  const intervalMs = Math.max(3, ea.pollIntervalSec) * 1000;
  if (s.seeded && now - s.lastPollMs < intervalMs) return;

  const watched = new Map<string, { cam: Cam; deviceId: number }[]>();
  for (const cam of cfg.cams) {
    if (!cam.enabled || !cam.empAccess.enabled || cam.empAccess.deviceIds.length === 0)
      continue;
    for (const deviceId of cam.empAccess.deviceIds) {
      const key = `${cam.id}:${deviceId}`;
      if (!watched.has(key)) watched.set(key, []);
      watched.get(key)!.push({ cam, deviceId });
    }
  }

  if (watched.size === 0) {
    s.lastPollMs = now;
    s.seeded = true;
    s.lastError = null;
    return;
  }

  s.loading = true;
  try {
    const wasSeeded = s.seeded;
    const base = ea.baseUrl.trim() || "https://emp-access.de";
    const raw = await empAccessGetJson(
      base,
      ea.apiToken.trim(),
      "/api/devices",
    );
    const devices = extractDevicesArray(raw);

    for (const [, entries] of watched) {
      const deviceId = entries[0]!.deviceId;
      const row = findDeviceById(devices, deviceId);
      if (!row) {
        const fp = `__missing__:${deviceId}`;
        const prev = s.fingerprints.get(`${entries[0]!.cam.id}:${deviceId}`);
        const mapKey = `${entries[0]!.cam.id}:${deviceId}`;
        s.fingerprints.set(mapKey, fp);
        if (wasSeeded && prev !== fp) {
          for (const { cam } of entries) {
            pushEvent({
              id: randomId(),
              ts: Date.now(),
              camId: cam.id,
              deviceId,
              kind: "info",
              summary: `emp-access: Gerät #${deviceId} nicht in /api/devices`,
              detail: "ID oder Token prüfen.",
            });
          }
        }
        continue;
      }

      const mapKey = `${entries[0]!.cam.id}:${deviceId}`;
      const fp = stableFingerprint(row);
      const prev = s.fingerprints.get(mapKey);
      s.fingerprints.set(mapKey, fp);
      if (!wasSeeded) continue;
      if (prev === fp) continue;

      const kind = inferAccessKind(row);
      const label = deviceLabel(row, deviceId);
      const summary =
        kind === "valid"
          ? `Zugang OK · ${label}`
          : kind === "invalid"
            ? `Zugang abgelehnt · ${label}`
            : `Status · ${label}`;

      for (const { cam } of entries) {
        pushEvent({
          id: randomId(),
          ts: Date.now(),
          camId: cam.id,
          deviceId,
          kind,
          summary,
          detail: undefined,
        });
      }
    }

    s.seeded = true;
    s.lastPollMs = Date.now();
    s.lastError = null;
  } catch (e) {
    s.lastError =
      e instanceof EmpAccessHttpError
        ? `${e.message}: ${e.bodySnippet}`
        : (e as Error).message;
    console.warn("[emp-access]", s.lastError);
  } finally {
    s.loading = false;
  }
}

/**
 * Externer Event-Push (z. B. via Webhook von emp-access). Schiebt direkt einen
 * Event in die Liste und triggert dadurch sofort die Anzeige bei allen Kameras,
 * die diese Geräte-ID gemappt haben.
 */
export async function pushEmpAccessExternal(input: {
  deviceId: number;
  kind: EmpAccessEventKind;
  summary: string;
  detail?: string;
}): Promise<{ matched: number }> {
  let cfg;
  try {
    cfg = await loadConfig();
  } catch {
    return { matched: 0 };
  }
  let matched = 0;
  for (const cam of cfg.cams) {
    if (!cam.enabled || !cam.empAccess.enabled) continue;
    if (!cam.empAccess.deviceIds.includes(input.deviceId)) continue;
    pushEvent({
      id: randomId(),
      ts: Date.now(),
      camId: cam.id,
      deviceId: input.deviceId,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
    });
    matched++;
  }
  return { matched };
}

export function getEmpAccessSnapshot(empConfigured: boolean): {
  configured: boolean;
  polledAt: number;
  lastError: string | null;
  loading: boolean;
  byCam: Record<string, EmpAccessEvent[]>;
} {
  const s = rt();
  const byCam: Record<string, EmpAccessEvent[]> = {};
  for (const ev of s.events) {
    if (!byCam[ev.camId]) byCam[ev.camId] = [];
    if (byCam[ev.camId]!.length < 40) byCam[ev.camId]!.push(ev);
  }
  return {
    configured: empConfigured,
    polledAt: s.lastPollMs,
    lastError: s.lastError,
    loading: s.loading,
    byCam,
  };
}
