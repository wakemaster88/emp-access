/**
 * GARDENA smart system API Client (Husqvarna Group).
 *
 * Doku / Portal: https://developer.husqvarnagroup.cloud/
 *
 * Auth erfolgt per OAuth2 `client_credentials`: Application Key (= client_id,
 * zugleich `X-Api-Key`-Header) und Application Secret (= client_secret) werden
 * gegen ein kurzlebiges Access-Token getauscht (~24 h gueltig). Das Token
 * cachen wir pro warmer Function-Instanz im Speicher, analog zum API-Token-
 * Cache in `lib/api-auth.ts`.
 *
 * Beide Credentials legt ein Account im Developer Portal an und speichert sie
 * bei uns in `ApiConfig` (provider = GARDENA): `token` = Application Key,
 * `extraConfig` = Application Secret.
 *
 * Steuerbar ist jeweils ein VALVE-Service (Ventil oder Pumpe). Die zugehoerige
 * Service-ID (z. B. "ee5b3996-…:2") wird beim Import auf `Device.gardenaServiceId`
 * gespeichert und identifiziert das Geraet fuer Commands und Status.
 */

const AUTH_URL = "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token";
const BASE_URL = "https://api.smart.gardena.dev/v1";

// ── Token-Cache ───────────────────────────────────────────────────────────────

type TokenEntry = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();
// Sicherheitspuffer, damit wir ein Token nicht auf der Ziellinie noch verwenden.
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** Test-Helper, damit Tests den Token-Cache leeren koennen. */
export function _clearGardenaTokenCache() {
  tokenCache.clear();
}

// ── Response-Cache (Locations) ────────────────────────────────────────────────
//
// Die GARDENA-API hat ein hartes Kontingent (~700 Requests/Woche laut
// Husqvarna-Support). Status-Polling ohne Cache brennt das in Stunden ab und
// die API antwortet dann nur noch mit 429 ("explicit deny"). Deshalb werden
// GET-Antworten (Locations-Liste + Location-Details) pro warmer Function-
// Instanz gecached; alle Status-/Sensor-Abfragen teilen sich diese Daten.

const RESPONSE_CACHE_TTL_MS = 5 * 60_000;

interface ResponseCacheEntry {
  expiresAt: number;
  data: unknown;
}

const responseCache = new Map<string, ResponseCacheEntry>();

export interface GardenaCacheOptions {
  /** Cache umgehen und frische Daten holen (z. B. manueller Refresh). */
  fresh?: boolean;
}

/**
 * Cache einer Verbindung invalidieren – nach Steuerbefehlen, damit der
 * naechste Status-Abruf den neuen Ventil-Zustand zeigt.
 */
export function gardenaInvalidateCache(applicationKey: string) {
  const prefix = `${applicationKey.trim()}:`;
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

/** Test-Helper, damit Tests den Response-Cache leeren koennen. */
export function _clearGardenaResponseCache() {
  responseCache.clear();
}

export async function gardenaGetAccessToken(
  applicationKey: string,
  applicationSecret: string,
): Promise<string | null> {
  const key = applicationKey.trim();
  const secret = applicationSecret.trim();
  if (!key || !secret) return null;

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: key,
        client_secret: secret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    const ttlMs = (data.expires_in ?? 86_400) * 1000;
    tokenCache.set(key, {
      accessToken: data.access_token,
      expiresAt: Date.now() + ttlMs - TOKEN_EXPIRY_SKEW_MS,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

// ── Fetch-Helper ──────────────────────────────────────────────────────────────

interface GardenaFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

async function gardenaFetch(
  applicationKey: string,
  applicationSecret: string,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<GardenaFetchResult> {
  const token = await gardenaGetAccessToken(applicationKey, applicationSecret);
  if (!token) {
    return { ok: false, status: 401, data: null, error: "Kein Access-Token (Key/Secret prüfen)" };
  }

  const { method = "GET", body, timeoutMs = 10_000 } = init;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Authorization-Provider": "husqvarna",
    "X-Api-Key": applicationKey.trim(),
  };
  if (body !== undefined) headers["Content-Type"] = "application/vnd.api+json";

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: `GARDENA ${method} ${path} → ${res.status} ${res.statusText}`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "GARDENA fetch failed",
    };
  }
}

/** GET mit Response-Cache: erst Cache pruefen, sonst fetchen und cachen. */
async function gardenaFetchCached(
  applicationKey: string,
  applicationSecret: string,
  path: string,
  opts: GardenaCacheOptions = {},
): Promise<GardenaFetchResult> {
  const cacheKey = `${applicationKey.trim()}:${path}`;
  if (!opts.fresh) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, status: 200, data: cached.data };
    }
  }

  const res = await gardenaFetch(applicationKey, applicationSecret, path);
  if (res.ok) {
    responseCache.set(cacheKey, { expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS, data: res.data });
  }
  return res;
}

// ── JSON:API-Typen (nur die genutzten Felder) ────────────────────────────────

interface GardenaAttr<T> {
  value: T;
  timestamp?: string;
}

interface GardenaResource {
  id: string;
  type: string;
  relationships?: {
    device?: { data?: { id: string; type: string } };
    location?: { data?: { id: string; type: string } };
  };
  attributes?: Record<string, GardenaAttr<unknown> | undefined>;
}

interface GardenaLocationResponse {
  data?: GardenaResource;
  included?: GardenaResource[];
}

function attrValue<T>(res: GardenaResource | undefined, name: string): T | null {
  const a = res?.attributes?.[name] as GardenaAttr<T> | undefined;
  return a?.value ?? null;
}

function attrTimestamp(res: GardenaResource | undefined, name: string): string | null {
  const a = res?.attributes?.[name] as GardenaAttr<unknown> | undefined;
  return a?.timestamp ?? null;
}

// ── Locations ─────────────────────────────────────────────────────────────────

export interface GardenaLocation {
  id: string;
  name: string;
}

export async function gardenaListLocations(
  applicationKey: string,
  applicationSecret: string,
  opts: GardenaCacheOptions = {},
): Promise<{ ok: boolean; status: number; locations: GardenaLocation[]; error?: string }> {
  const res = await gardenaFetchCached(applicationKey, applicationSecret, "/locations", opts);
  if (!res.ok) {
    return { ok: false, status: res.status, locations: [], error: res.error };
  }
  const list = (res.data as { data?: { id: string; attributes?: { name?: string } }[] }).data ?? [];
  return {
    ok: true,
    status: res.status,
    locations: list.map((l) => ({ id: l.id, name: l.attributes?.name ?? l.id })),
  };
}

async function gardenaGetLocation(
  applicationKey: string,
  applicationSecret: string,
  locationId: string,
  opts: GardenaCacheOptions = {},
): Promise<GardenaLocationResponse | null> {
  const res = await gardenaFetchCached(applicationKey, applicationSecret, `/locations/${locationId}`, opts);
  if (!res.ok) return null;
  return res.data as GardenaLocationResponse;
}

// ── Geraete / Ventile ─────────────────────────────────────────────────────────

export interface GardenaValve {
  /// Service-ID des VALVE-Service (steuerbar) – landet auf Device.gardenaServiceId.
  serviceId: string;
  /// Vorschlags-Name fuer den Import (Geraet + ggf. Ventilname).
  name: string;
  /// Modell laut COMMON-Service, z. B. "GARDENA smart Water Control".
  modelType: string | null;
  /// Roh-Aktivitaet des Ventils (CLOSED, MANUAL_WATERING, …).
  activity: string | null;
  online: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  locationName: string;
}

export interface GardenaServiceStatus {
  online: boolean;
  activity: string | null;
  /// abgeleitet: laeuft das Ventil gerade (…_WATERING)?
  watering: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  rfLinkLevel: number | null;
  modelType: string | null;
}

/** Baut aus einer Location-Antwort ein Mapping deviceId → COMMON-Service. */
function indexCommonByDevice(included: GardenaResource[]): Map<string, GardenaResource> {
  const map = new Map<string, GardenaResource>();
  for (const r of included) {
    if (r.type === "COMMON") {
      const deviceId = r.relationships?.device?.data?.id ?? r.id;
      map.set(deviceId, r);
    }
  }
  return map;
}

function isOnline(common: GardenaResource | undefined): boolean {
  return attrValue<string>(common, "rfLinkState") === "ONLINE";
}

function buildValveName(commonName: string | null, valveName: string | null, deviceId: string): string {
  const c = commonName?.trim();
  const v = valveName?.trim();
  if (c && v && v.toLowerCase() !== c.toLowerCase()) return `${c} – ${v}`;
  return c || v || deviceId;
}

/**
 * Listet alle steuerbaren Ventile/Pumpen ueber alle Locations des Accounts.
 * Fuer den Import-Flow im Settings-Dialog.
 */
export async function gardenaListValves(
  applicationKey: string,
  applicationSecret: string,
  opts: GardenaCacheOptions = {},
): Promise<{ ok: boolean; status: number; valves: GardenaValve[]; error?: string }> {
  const locs = await gardenaListLocations(applicationKey, applicationSecret, opts);
  if (!locs.ok) return { ok: false, status: locs.status, valves: [], error: locs.error };

  const valves: GardenaValve[] = [];
  for (const loc of locs.locations) {
    const detail = await gardenaGetLocation(applicationKey, applicationSecret, loc.id, opts);
    const included = detail?.included ?? [];
    const commonByDevice = indexCommonByDevice(included);
    const locationName = attrValue<string>(detail?.data, "name") ?? loc.name;

    for (const svc of included) {
      if (svc.type !== "VALVE") continue;
      const deviceId = svc.relationships?.device?.data?.id ?? svc.id;
      const common = commonByDevice.get(deviceId);
      valves.push({
        serviceId: svc.id,
        name: buildValveName(
          attrValue<string>(common, "name"),
          attrValue<string>(svc, "name"),
          deviceId,
        ),
        modelType: attrValue<string>(common, "modelType"),
        activity: attrValue<string>(svc, "activity"),
        online: isOnline(common),
        batteryLevel: attrValue<number>(common, "batteryLevel"),
        batteryState: attrValue<string>(common, "batteryState"),
        locationName,
      });
    }
  }

  return { ok: true, status: 200, valves };
}

/**
 * Status-Map (serviceId → Status) ueber alle Locations. Wird fuer die Geraete-
 * Liste und Detailseite genutzt; ein Abruf deckt beliebig viele Ventile ab.
 */
export async function gardenaStatusMap(
  applicationKey: string,
  applicationSecret: string,
  opts: GardenaCacheOptions = {},
): Promise<Map<string, GardenaServiceStatus>> {
  const result = new Map<string, GardenaServiceStatus>();
  const locs = await gardenaListLocations(applicationKey, applicationSecret, opts);
  if (!locs.ok) return result;

  for (const loc of locs.locations) {
    const detail = await gardenaGetLocation(applicationKey, applicationSecret, loc.id, opts);
    const included = detail?.included ?? [];
    const commonByDevice = indexCommonByDevice(included);

    for (const svc of included) {
      if (svc.type !== "VALVE") continue;
      const deviceId = svc.relationships?.device?.data?.id ?? svc.id;
      const common = commonByDevice.get(deviceId);
      const activity = attrValue<string>(svc, "activity");
      result.set(svc.id, {
        online: isOnline(common),
        activity,
        watering: !!activity && activity.includes("WATERING"),
        batteryLevel: attrValue<number>(common, "batteryLevel"),
        batteryState: attrValue<string>(common, "batteryState"),
        rfLinkLevel: attrValue<number>(common, "rfLinkLevel"),
        modelType: attrValue<string>(common, "modelType"),
      });
    }
  }

  return result;
}

// ── Sensoren (Bodenfeuchte) ───────────────────────────────────────────────────

export interface GardenaSensor {
  /// Service-ID des SENSOR-Service – landet auf IrrigationSchedule.sensorServiceId.
  serviceId: string;
  /// Geraete-Name laut COMMON-Service.
  name: string;
  /// Bodenfeuchte in Prozent (0–100), null wenn nicht gemeldet.
  soilHumidity: number | null;
  /// ISO-Zeitpunkt der letzten Bodenfeuchte-Messung.
  soilHumidityAt: string | null;
  /// Bodentemperatur in °C.
  soilTemperature: number | null;
  /// Akku in Prozent (COMMON-Service) – nicht mit Bodenfeuchte verwechseln.
  batteryLevel: number | null;
  online: boolean;
  locationName: string;
}

/**
 * Listet alle Bodenfeuchte-Sensoren (SENSOR-Services) ueber alle Locations.
 * Wird fuer die Sensor-Auswahl im Zeitplan-Dialog und den Cron genutzt.
 */
export async function gardenaListSensors(
  applicationKey: string,
  applicationSecret: string,
  opts: GardenaCacheOptions = {},
): Promise<{ ok: boolean; status: number; sensors: GardenaSensor[]; error?: string }> {
  const locs = await gardenaListLocations(applicationKey, applicationSecret, opts);
  if (!locs.ok) return { ok: false, status: locs.status, sensors: [], error: locs.error };

  const sensors: GardenaSensor[] = [];
  for (const loc of locs.locations) {
    const detail = await gardenaGetLocation(applicationKey, applicationSecret, loc.id, opts);
    const included = detail?.included ?? [];
    const commonByDevice = indexCommonByDevice(included);
    const locationName = attrValue<string>(detail?.data, "name") ?? loc.name;

    for (const svc of included) {
      if (svc.type !== "SENSOR") continue;
      const deviceId = svc.relationships?.device?.data?.id ?? svc.id;
      const common = commonByDevice.get(deviceId);
      sensors.push({
        serviceId: svc.id,
        name: attrValue<string>(common, "name") ?? deviceId,
        soilHumidity: attrValue<number>(svc, "soilHumidity"),
        soilHumidityAt: attrTimestamp(svc, "soilHumidity"),
        soilTemperature: attrValue<number>(svc, "soilTemperature"),
        online: isOnline(common),
        batteryLevel: attrValue<number>(common, "batteryLevel"),
        locationName,
      });
    }
  }

  return { ok: true, status: 200, sensors };
}

// ── Steuerung ─────────────────────────────────────────────────────────────────

export type GardenaValveCommand = "open" | "close";

/**
 * Ventil/Pumpe steuern.
 *   open  → START_SECONDS_TO_OVERRIDE (mit Laufzeit in Sekunden)
 *   close → STOP_UNTIL_NEXT_TASK
 * Die API antwortet bei Erfolg mit HTTP 202 (kein Body).
 */
export async function gardenaControlValve(
  applicationKey: string,
  applicationSecret: string,
  serviceId: string,
  command: GardenaValveCommand,
  seconds = 1800,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const attributes =
    command === "open"
      ? { command: "START_SECONDS_TO_OVERRIDE", seconds: Math.max(1, Math.round(seconds)) }
      : { command: "STOP_UNTIL_NEXT_TASK" };

  const res = await gardenaFetch(applicationKey, applicationSecret, `/command/${serviceId}`, {
    method: "PUT",
    body: { data: { id: "emp-access", type: "VALVE_CONTROL", attributes } },
    timeoutMs: 15_000,
  });

  // Gecachte Statusdaten sind nach einem Befehl veraltet.
  if (res.ok) gardenaInvalidateCache(applicationKey);

  // 202 Accepted ist der Erfolgsfall; gardenaFetch behandelt 2xx als ok.
  return { ok: res.ok, status: res.status, error: res.error };
}

/** Klartext-Label fuer die `activity` eines Ventils. */
export function gardenaActivityLabel(activity: string | null | undefined): string {
  switch (activity) {
    case "CLOSED": return "Geschlossen";
    case "MANUAL_WATERING": return "Bewässert (manuell)";
    case "SCHEDULED_WATERING": return "Bewässert (Zeitplan)";
    case "PAUSED": return "Pausiert";
    case null:
    case undefined: return "Unbekannt";
    default: return activity;
  }
}
