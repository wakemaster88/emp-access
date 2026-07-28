/**
 * Shelly-Cloud-Status über einen einzigen all_status-Abruf.
 *
 * Shelly Cloud erlaubt nur ~1 Request pro Sekunde pro Auth-Key. Einzelne
 * POST /device/status-Aufrufe je Gerät laufen bei vielen Geräten deshalb
 * sofort in HTTP 429 (TOO_MANY_REQUESTS) und alle Geräte erscheinen offline.
 *
 * Dieser Helper holt stattdessen den Status ALLER Geräte des Accounts mit
 * einem einzigen POST /device/all_status und cached das Ergebnis kurz pro
 * warmer Function-Instanz, damit parallele Anfragen (Geräteliste + einzelne
 * Status-Badges) denselben Abruf teilen.
 */

export type ShellyDeviceStatusMap = Record<string, unknown>;

export interface ShellyAllStatusEntry {
  online: boolean;
  status: ShellyDeviceStatusMap;
}

export interface ShellySwitchState {
  output: boolean | null;
  power?: number;
}

const CACHE_TTL_MS = 20_000;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<Map<string, ShellyAllStatusEntry> | null>;
}

const cache = new Map<string, CacheEntry>();

export function normalizeShellyServer(baseUrl: string): string {
  return `https://${baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

async function fetchAllStatuses(
  server: string,
  authKey: string,
): Promise<Map<string, ShellyAllStatusEntry> | null> {
  try {
    const res = await fetch(`${server}/device/all_status`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // show_info liefert _dev_info.online fuer jedes Geraet mit.
      body: new URLSearchParams({ auth_key: authKey, show_info: "true" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      isok?: boolean;
      data?: {
        devices_status?: Record<
          string,
          ShellyDeviceStatusMap & { _dev_info?: { online?: boolean } }
        >;
      };
    };
    if (!data.isok) return null;

    const map = new Map<string, ShellyAllStatusEntry>();
    for (const [id, status] of Object.entries(data.data?.devices_status ?? {})) {
      const entry: ShellyAllStatusEntry = {
        online: status._dev_info?.online ?? false,
        status,
      };
      map.set(id, entry);
      // MAC-basierte IDs koennen in der DB anders gecased sein; BLE-/Lock-IDs
      // ("XB…", "XL…") sind case-sensitiv und bleiben unter dem Original-Key.
      map.set(id.toLowerCase(), entry);
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Status-Map (deviceId → Status) aller Cloud-Geräte. Ergebnis wird pro
 * Auth-Key kurz gecached; parallele Aufrufer teilen sich denselben Request.
 */
export function shellyCloudAllStatuses(
  baseUrl: string,
  authKey: string,
): Promise<Map<string, ShellyAllStatusEntry> | null> {
  const server = normalizeShellyServer(baseUrl);
  const key = `${server}:${authKey}`;
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchAllStatuses(server, authKey.trim()).then((result) => {
    // Fehlschlaege nicht fuer die volle TTL cachen.
    if (result === null) cache.delete(key);
    return result;
  });
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, promise });
  return promise;
}

/**
 * Schaltzustand eines Kanals aus einem Geraete-Status extrahieren:
 * Gen2 (`switch:N`) bevorzugt, sonst Gen1 (`relays`/`meters`).
 */
export function shellySwitchState(
  status: ShellyDeviceStatusMap,
  switchIdx: number,
  /// Antriebe brauchen exakt den angefragten Kanal – bei ihnen unterscheidet
  /// sich "Auf" von "Zu" nur durch den Index. Der Ausweich-Griff auf einen
  /// beliebigen anderen Kanal wuerde dort die falsche Richtung melden.
  strict = false,
): ShellySwitchState {
  type SwitchEntry = { output?: boolean; apower?: number };

  let sw = status[`switch:${switchIdx}`] as SwitchEntry | undefined;
  if (sw === undefined && !strict) {
    for (let i = 0; i <= 4; i++) {
      const entry = status[`switch:${i}`] as SwitchEntry | undefined;
      if (entry !== undefined) { sw = entry; break; }
    }
  }
  if (sw !== undefined) return { output: sw.output ?? null, power: sw.apower };

  const relays = status.relays as { ison?: boolean }[] | undefined;
  const meters = status.meters as { power?: number }[] | undefined;
  const relay = strict ? relays?.[switchIdx] : (relays?.[switchIdx] ?? relays?.[0]);
  if (relay !== undefined) {
    return {
      output: relay.ison ?? null,
      power: strict
        ? meters?.[switchIdx]?.power
        : (meters?.[switchIdx]?.power ?? meters?.[0]?.power),
    };
  }

  return { output: null };
}

/**
 * Vollstaendigen Status eines Geraets ueber die lokale IP holen: Gen2 liefert
 * alle Komponenten mit `Shelly.GetStatus`, Gen1 mit `/status`. Ein Abruf statt
 * einer Anfrage je Kanal – wichtig fuer Antriebe, die zwei Relais haben.
 */
export async function shellyLocalStatusMap(
  ip: string,
  timeoutMs = 3000,
): Promise<ShellyDeviceStatusMap | null> {
  try {
    const res = await fetch(`http://${ip}/rpc/Shelly.GetStatus`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as ShellyDeviceStatusMap;
  } catch { /* Gen1 versuchen */ }

  try {
    const res = await fetch(`http://${ip}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as ShellyDeviceStatusMap;
  } catch { /* nicht erreichbar */ }

  return null;
}

/** Cloud-Suffix (`abc_1` → 1) auf 0-basierten Switch-Index mappen. */
export function shellySwitchIndex(shellyId: string | null | undefined): number {
  const suffix = shellyId?.includes("_") ? Number(shellyId.split("_").pop()) : 0;
  const safe = Number.isNaN(suffix) ? 0 : suffix;
  return safe > 0 ? safe - 1 : 0;
}

/** Basis-Geraete-ID ohne Kanal-Suffix (`abc_1` → `abc`). */
export function shellyBaseId(shellyId: string | null | undefined): string | null {
  if (!shellyId) return null;
  return shellyId.split("_")[0] ?? shellyId;
}
