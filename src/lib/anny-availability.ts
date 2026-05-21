/**
 * ANNY Verfügbarkeits-API: Öffnungszeiten / Zeitslots pro Resource.
 * Shared zwischen Dashboard und Utilization-Endpoint.
 */

export interface AvailabilityPeriod {
  start: string;
  end: string;
}

/**
 * ANNY's Admin-API kann je nach Account-Setup eine Organization-ID als
 * Query-Parameter (`?o={uuid}`) erwarten - n8n-Connector setzt das, wenn
 * die Credentials sie kennen. Wenn unsere `ApiConfig.extraConfig` ein
 * Feld `organizationId` enthaelt, hauen wir das an alle Requests dran.
 * Sonst lassen wir's weg (Token mit fixem Org-Scope braucht's nicht).
 */
export function extractAnnyOrganizationId(extraConfigJson: string | null | undefined): string | null {
  if (!extraConfigJson) return null;
  try {
    const parsed = JSON.parse(extraConfigJson) as Record<string, unknown>;
    const candidates = [
      parsed.organizationId,
      parsed.organization_id,
      parsed.organisationId,
      parsed.orgId,
      parsed.o,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Standard-Header fuer ANNY's Admin-API. Accept akzeptiert JSON:API und
 * application/json - der Server liefert dann passend zurueck.
 */
function annyHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json, application/json",
  };
}

/**
 * Holt die aktive Organization-ID des Tokens via /api/v1/user?include=
 * active_organization. ANNY's Admin-API erwartet typischerweise `?o={uuid}`
 * an jedem Endpoint - die ID dazu liefert dieser Endpoint zurueck.
 *
 * Implementierung gespiegelt aus dem offiziellen anny-n8n-Connector
 * (preAuthentication-Hook): GET /api/v1/user mit include=active_organization,
 * Org-ID liegt in data.relationships.active_organization.data.id.
 */
const orgIdCache = new Map<string, { value: string; expiresAt: number }>();
const ORG_CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchAnnyOrganizationId(
  baseUrl: string,
  token: string,
): Promise<string | null> {
  const cacheKey = `${baseUrl}|${token}`;
  const now = Date.now();
  const cached = orgIdCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/user?include=active_organization`,
      {
        headers: annyHeaders(token),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        relationships?: {
          active_organization?: { data?: { id?: string } };
        };
      };
    };
    const id = json?.data?.relationships?.active_organization?.data?.id;
    if (typeof id === "string" && id.trim()) {
      orgIdCache.set(cacheKey, { value: id, expiresAt: now + ORG_CACHE_TTL_MS });
      return id;
    }
  } catch { /* swallow */ }
  return null;
}

/**
 * Convenience: erst extraConfig durchforsten, falls keine Org-ID gefunden,
 * den /user-Endpoint nach Resolve fragen (mit kurzem Cache).
 */
export async function resolveAnnyOrganizationId(
  baseUrl: string,
  token: string,
  extraConfigJson: string | null | undefined,
): Promise<string | null> {
  const fromConfig = extractAnnyOrganizationId(extraConfigJson);
  if (fromConfig) return fromConfig;
  return fetchAnnyOrganizationId(baseUrl, token);
}

export function berlinOffset(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const berlin = d.toLocaleString("sv-SE", { timeZone: "Europe/Berlin" });
  const utc = d.toLocaleString("sv-SE", { timeZone: "UTC" });
  const diffMs = new Date(berlin).getTime() - new Date(utc).getTime();
  const h = Math.floor(Math.abs(diffMs) / 3600000);
  const m = Math.floor((Math.abs(diffMs) % 3600000) / 60000);
  const sign = diffMs >= 0 ? "+" : "-";
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function fetchAnnyAvailability(
  baseUrl: string,
  token: string,
  resourceIds: string[],
  dateStr: string,
): Promise<Record<string, AvailabilityPeriod[]>> {
  if (resourceIds.length === 0) return {};

  const offset = berlinOffset(dateStr);
  const startDate = `${dateStr}T00:00:00${offset}`;
  const endDate = `${dateStr}T23:59:59${offset}`;

  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    timezone: "Europe/Berlin",
  });
  for (const id of resourceIds) {
    params.append("r[]", id);
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/availability/periods?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const json = await res.json();
    const result: Record<string, AvailabilityPeriod[]> = {};
    for (const [rid, periods] of Object.entries(json)) {
      if (Array.isArray(periods)) {
        result[rid] = periods
          .map((p: Record<string, string>) => ({
            start: p.start || p.start_date || p.from || "",
            end: p.end || p.end_date || p.to || "",
          }))
          .filter((p: AvailabilityPeriod) => p.start || p.end);
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Tries /api/v1/availability/slots first (returns bookable intervals like 2h slots).
 * Falls back to /api/v1/availability/periods (operating hours) if slots endpoint unavailable.
 *
 * Optionen:
 *   slotsOnly = true -> KEIN Fallback auf periods. Wichtig fuer Use-Cases, bei
 *   denen wir explizit nur die buchbaren Slots wollen (z.B. Anfaengerkurs-
 *   Buchung im Shop). Bei leerem /slots-Endpoint kommt dann ein leeres Objekt
 *   zurueck, statt der Oeffnungszeiten der Resource.
 */
export async function fetchAnnyAvailabilityWithSlots(
  baseUrl: string,
  token: string,
  resourceIds: string[],
  dateStr: string,
  opts: { slotsOnly?: boolean } = {},
): Promise<Record<string, AvailabilityPeriod[]>> {
  if (resourceIds.length === 0) return {};
  const slotsOnly = opts.slotsOnly === true;

  const offset = berlinOffset(dateStr);
  const startDate = `${dateStr}T00:00:00${offset}`;
  const endDate = `${dateStr}T23:59:59${offset}`;

  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    timezone: "Europe/Berlin",
  });
  for (const id of resourceIds) {
    params.append("r[]", id);
  }

  function parseResponse(json: unknown): Record<string, AvailabilityPeriod[]> {
    if (!json || typeof json !== "object") return {};
    const result: Record<string, AvailabilityPeriod[]> = {};
    for (const [rid, periods] of Object.entries(json as Record<string, unknown>)) {
      if (Array.isArray(periods)) {
        result[rid] = periods
          .map((p: Record<string, string>) => ({
            start: p.start || p.start_date || p.from || "",
            end: p.end || p.end_date || p.to || "",
          }))
          .filter((p: AvailabilityPeriod) => p.start || p.end);
      }
    }
    return result;
  }

  try {
    const slotsRes = await fetch(`${baseUrl}/api/v1/availability/slots?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (slotsRes.ok) {
      const json = await slotsRes.json();
      const parsed = parseResponse(json);
      const totalSlots = Object.values(parsed).reduce((s, a) => s + a.length, 0);
      if (totalSlots > 0) return parsed;
      // /slots hat geantwortet, aber 0 Slots -> Resource hat heute schlicht
      // keine buchbaren Slots. Im slotsOnly-Modus geben wir das genau so
      // zurueck, statt auf Oeffnungszeiten zurueckzufallen.
      if (slotsOnly) return parsed;
    }
  } catch { /* slots endpoint not available, fall back */ }

  if (slotsOnly) return {};
  return fetchAnnyAvailability(baseUrl, token, resourceIds, dateStr);
}

export interface AnnyServiceMatch {
  /** UUID wenn ein Match gefunden wurde, sonst null. */
  id: string | null;
  /** Alle bei ANNY gefundenen Service-Namen (Debug/Diagnose). */
  knownNames: string[];
  /** Debug-Info pro Seite (HTTP-Status, Item-Count, Body-Preview bei Leere). */
  debug: Array<{
    page: number;
    status: number;
    items: number;
    bodyPreview?: string;
  }>;
  /** Service-Konfiguration des Matches (min_duration etc.). */
  serviceInfo?: {
    minDuration: number | null;
    maxDuration: number | null;
    bookingInterval: number | null;
    hasFlexibleDuration: boolean;
    autoDuration: boolean;
    isFullDay: boolean;
  };
}

/**
 * Sucht in den ANNY-Services nach einem Service mit passendem Namen und gibt
 * dessen UUID zurueck. ANNY's Availability-Search ist serviceId-zentriert
 * (siehe https://developers.anny.co/guides/availability), unsere App
 * speichert aber nur Namen in `Service.annyNames` - daher dieser Lookup.
 *
 * Match-Strategie (in absteigender Prioritaet):
 *   1. exakter case-insensitive Name-Match
 *   2. ANNY-Name ist Substring eines gesuchten Namens (z.B. ANNY hat "Anfaengerkurs",
 *      wir suchen "Anfaengerkurs - Uebungslift")
 *   3. gesuchter Name ist Substring eines ANNY-Namens (umgekehrt)
 *
 * Wir paginieren (page[size]=100) ueber max. 5 Seiten und gehen ALLE Seiten
 * durch, auch wenn schon ein Match gefunden wurde - so koennen wir bei
 * Nicht-Fund die vollstaendige Namensliste fuer's Debugging zurueckgeben.
 */
export async function fetchAnnyServiceMatch(
  baseUrl: string,
  token: string,
  serviceNames: string[],
  organizationId?: string | null,
): Promise<AnnyServiceMatch> {
  const knownNames: string[] = [];
  const debug: AnnyServiceMatch["debug"] = [];
  if (serviceNames.length === 0) return { id: null, knownNames, debug };
  const wantedLower = serviceNames.map((n) => n.toLowerCase());
  const wantedSet = new Set(wantedLower);

  let exactMatch: string | null = null;
  let substringMatch: string | null = null;
  let matchedServiceInfo: AnnyServiceMatch["serviceInfo"] | undefined;

  // ANNY erlaubt max. page[size]=50. Wir laufen bis zu 10 Seiten - reicht
  // fuer 500 Services, drueber hinaus stoppen wir der Latenz wegen.
  const pageSize = 50;
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      "page[size]": String(pageSize),
      "page[number]": String(page),
    });
    if (organizationId) params.set("o", organizationId);
    let status = 0;
    let items: unknown[] = [];
    let bodyText = "";
    try {
      const res = await fetch(`${baseUrl}/api/v1/services?${params}`, {
        headers: annyHeaders(token),
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      if (!res.ok) {
        try { bodyText = (await res.text()).slice(0, 400); } catch { /* ignore */ }
        debug.push({ page, status, items: 0, bodyPreview: bodyText });
        break;
      }
      bodyText = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch {
        debug.push({ page, status, items: 0, bodyPreview: bodyText.slice(0, 400) });
        break;
      }
      items = Array.isArray(json)
        ? json
        : Array.isArray((json as { data?: unknown[] }).data)
          ? ((json as { data: unknown[] }).data)
          : Array.isArray((json as { items?: unknown[] }).items)
            ? ((json as { items: unknown[] }).items)
            : Array.isArray((json as { results?: unknown[] }).results)
              ? ((json as { results: unknown[] }).results)
              : [];
      debug.push({
        page,
        status,
        items: items.length,
        ...(items.length === 0 ? { bodyPreview: bodyText.slice(0, 400) } : {}),
      });
      if (items.length === 0) break;
      for (const raw of items) {
        const svc = raw as { id?: string; attributes?: Record<string, unknown>; name?: string };
        const a = (svc.attributes ?? svc) as Record<string, unknown>;
        const id = svc.id || (a.id as string | undefined);
        const name = (a.name as string | undefined) || (a.title as string | undefined);
        if (!id || !name) continue;
        knownNames.push(name);
        const lower = name.toLowerCase();
        const info: NonNullable<AnnyServiceMatch["serviceInfo"]> = {
          minDuration: typeof a.min_duration === "number" ? (a.min_duration as number) : null,
          maxDuration: typeof a.max_duration === "number" ? (a.max_duration as number) : null,
          bookingInterval:
            typeof a.booking_interval === "number" ? (a.booking_interval as number) : null,
          hasFlexibleDuration: a.has_flexible_duration === true,
          autoDuration: a.auto_duration === true,
          isFullDay: a.is_full_day === true,
        };
        if (!exactMatch && wantedSet.has(lower)) {
          exactMatch = String(id);
          matchedServiceInfo = info;
        } else if (!substringMatch) {
          if (wantedLower.some((w) => w.includes(lower) || lower.includes(w))) {
            substringMatch = String(id);
            if (!matchedServiceInfo) matchedServiceInfo = info;
          }
        }
      }
      if (items.length < pageSize) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      debug.push({ page, status, items: 0, bodyPreview: `ERR: ${msg}` });
      break;
    }
  }

  return {
    id: exactMatch || substringMatch,
    knownNames,
    debug,
    serviceInfo: matchedServiceInfo,
  };
}

/**
 * Backwards-compatible Wrapper, gibt nur die UUID zurueck (oder null).
 */
export async function fetchAnnyServiceIdByName(
  baseUrl: string,
  token: string,
  serviceNames: string[],
  organizationId?: string | null,
): Promise<string | null> {
  const match = await fetchAnnyServiceMatch(baseUrl, token, serviceNames, organizationId);
  return match.id;
}

export interface AnnyServiceCatalogEntry {
  id: string;
  name: string;
  info: NonNullable<AnnyServiceMatch["serviceInfo"]>;
}

/**
 * Listet ALLE Services des ANNY-Accounts. Im Gegensatz zu
 * fetchAnnyServiceMatch wird hier nicht nach Namen gefiltert - sinnvoll fuer
 * den Slot-Overview-Endpoint, der mehrere EMP-Services in einem Request
 * gegen den ANNY-Catalog matchen muss (statt N Pagination-Loops zu fahren).
 *
 * Pagination identisch zu fetchAnnyServiceMatch (page[size]=50, max 10 Seiten).
 */
export async function fetchAllAnnyServices(
  baseUrl: string,
  token: string,
  organizationId?: string | null,
): Promise<AnnyServiceCatalogEntry[]> {
  const out: AnnyServiceCatalogEntry[] = [];
  const pageSize = 50;
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      "page[size]": String(pageSize),
      "page[number]": String(page),
    });
    if (organizationId) params.set("o", organizationId);
    try {
      const res = await fetch(`${baseUrl}/api/v1/services?${params}`, {
        headers: annyHeaders(token),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) break;
      const json = (await res.json()) as unknown;
      const items: unknown[] = Array.isArray(json)
        ? json
        : Array.isArray((json as { data?: unknown[] }).data)
          ? ((json as { data: unknown[] }).data)
          : Array.isArray((json as { items?: unknown[] }).items)
            ? ((json as { items: unknown[] }).items)
            : [];
      if (items.length === 0) break;
      for (const raw of items) {
        const svc = raw as { id?: string; attributes?: Record<string, unknown>; name?: string };
        const a = (svc.attributes ?? svc) as Record<string, unknown>;
        const id = svc.id || (a.id as string | undefined);
        const name = (a.name as string | undefined) || (a.title as string | undefined);
        if (!id || !name) continue;
        out.push({
          id: String(id),
          name,
          info: {
            minDuration: typeof a.min_duration === "number" ? (a.min_duration as number) : null,
            maxDuration: typeof a.max_duration === "number" ? (a.max_duration as number) : null,
            bookingInterval:
              typeof a.booking_interval === "number" ? (a.booking_interval as number) : null,
            hasFlexibleDuration: a.has_flexible_duration === true,
            autoDuration: a.auto_duration === true,
            isFullDay: a.is_full_day === true,
          },
        });
      }
      if (items.length < pageSize) break;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Lokales Name-Matching gegen einen vorgeladenen ANNY-Service-Katalog.
 * Spiegelt die Match-Strategie aus fetchAnnyServiceMatch wider:
 *   1. exakter case-insensitive Name-Match
 *   2. Substring-Match (in beide Richtungen)
 */
export function matchAnnyServiceInCatalog(
  catalog: AnnyServiceCatalogEntry[],
  serviceNames: string[],
): AnnyServiceCatalogEntry | null {
  if (serviceNames.length === 0 || catalog.length === 0) return null;
  const wanted = serviceNames.map((n) => n.toLowerCase());
  const wantedSet = new Set(wanted);
  let exact: AnnyServiceCatalogEntry | null = null;
  let substring: AnnyServiceCatalogEntry | null = null;
  for (const entry of catalog) {
    const lower = entry.name.toLowerCase();
    if (!exact && wantedSet.has(lower)) {
      exact = entry;
      break;
    }
    if (!substring && wanted.some((w) => w.includes(lower) || lower.includes(w))) {
      substring = entry;
    }
  }
  return exact || substring;
}

/**
 * Ein Slot wie ANNY's `/api/v1/availability/start` ihn ausspuckt - 1:1
 * Mapping der relevanten Felder, plus lokal berechnete End-Zeit.
 *
 * ANNY-Doku (https://developers.anny.co/guides/availability, Step 3):
 *   {
 *     "start_date": "...",
 *     "available": true,
 *     "number_available": 3,            // GESAMTKAPAZITAET dieses Slots
 *     "remaining_number_available": 2,  // davon noch frei
 *     "resource_ids": ["r1","r2","r3"]
 *   }
 *
 * Wir mappen:
 *   capacity            = number_available           (max. moegliche Bookings)
 *   remaining           = remaining_number_available (noch freie Bookings)
 *   resourceIds         = resource_ids               (Resources, die diesen Slot
 *                                                     aktuell noch bedienen koennen)
 *   unavailabilityType  = unavailability_type        (`booked_out`,
 *                                                     `lead_time_conflict`,
 *                                                     `under_min_duration`,
 *                                                     `staggered_conflict`)
 */
export interface ServiceStartSlot {
  startIso: string;
  endIso: string;
  startTime: string;
  endTime: string;
  available: boolean;
  capacity?: number;
  remaining?: number;
  resourceIds?: string[];
  unavailabilityType?: string;
}

/**
 * Holt die buchbaren Start-Intervalle eines Services fuer ein Datum.
 * Mapped auf den korrekten ANNY-Endpoint:
 *   GET /api/v1/availability/start?service_id=...&date=YYYY-MM-DD
 * Das ist der einzige Endpoint, der echte service-spezifische Slots liefert
 * (z.B. "Anfaengerkurs 12:00 / 14:00 / 16:00"). /availability/periods sind
 * dagegen die rohen Oeffnungszeiten der Resource - voellig anderer Datentyp.
 *
 * `durationMinutes` ist optional: wenn gesetzt, berechnen wir die End-Zeit
 * lokal als start + duration (ANNY's Antwort liefert nur Start-Zeiten zurueck).
 */
export async function fetchAnnyServiceStartSlots(
  baseUrl: string,
  token: string,
  serviceId: string,
  dateStr: string,
  opts: {
    /**
     * Wird als `duration={n}` an die API gesendet und filtert ANNY's
     * Verfuegbarkeitsberechnung. VORSICHT: das veraendert auch
     * `remaining_number_available` - nur setzen, wenn man sicher ist.
     */
    durationMinutes?: number;
    /**
     * Wird NICHT an die API gesendet. Wird lokal benutzt, um die End-Zeit
     * jedes zurueckgegebenen Slots zu berechnen (start + slotDurationMinutes).
     * Fuer Anzeige im UI ("12:00-13:00" statt "12:00-").
     */
    slotDurationMinutes?: number | null;
    resourceId?: string;
    organizationId?: string | null;
  } = {},
): Promise<ServiceStartSlot[]> {
  const params = new URLSearchParams({
    service_id: serviceId,
    date: dateStr,
    timezone: "Europe/Berlin",
  });
  if (opts.durationMinutes && opts.durationMinutes > 0) {
    params.set("duration", String(opts.durationMinutes));
  }
  if (opts.resourceId) params.set("resource_id", opts.resourceId);
  if (opts.organizationId) params.set("o", opts.organizationId);

  const slotDurationForDisplay =
    opts.durationMinutes && opts.durationMinutes > 0
      ? opts.durationMinutes
      : opts.slotDurationMinutes && opts.slotDurationMinutes > 0
        ? opts.slotDurationMinutes
        : null;

  try {
    const res = await fetch(`${baseUrl}/api/v1/availability/start?${params}`, {
      headers: annyHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const items: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown[] }).data)
        ? ((json as { data: unknown[] }).data)
        : [];
    const result: ServiceStartSlot[] = [];
    for (const raw of items) {
      const it = raw as {
        start_date?: string;
        end_date?: string;
        available?: boolean;
        number_available?: number;
        remaining_number_available?: number;
        unavailability_type?: string;
        resource_ids?: string[];
      };
      const startIso = it.start_date;
      if (!startIso) continue;
      const isAvailable = it.available !== false;
      // ANNY liefert seit kurzem teilweise auch `end_date` mit. Wenn nicht,
      // berechnen wir es lokal aus start + slotDurationForDisplay.
      let endIso = typeof it.end_date === "string" ? it.end_date : "";
      if (!endIso && slotDurationForDisplay) {
        const s = new Date(startIso);
        if (!isNaN(s.getTime())) {
          endIso = new Date(s.getTime() + slotDurationForDisplay * 60000).toISOString();
        }
      }
      const slot: ServiceStartSlot = {
        startIso,
        endIso,
        startTime: fmtTimeBerlin(startIso),
        endTime: endIso ? fmtTimeBerlin(endIso) : "",
        available: isAvailable,
      };
      if (typeof it.number_available === "number") slot.capacity = it.number_available;
      if (typeof it.remaining_number_available === "number")
        slot.remaining = it.remaining_number_available;
      if (Array.isArray(it.resource_ids)) slot.resourceIds = it.resource_ids;
      if (typeof it.unavailability_type === "string" && it.unavailability_type)
        slot.unavailabilityType = it.unavailability_type;
      result.push(slot);
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Holt fuer einen Service die "Oeffnungszeiten" (raw availability periods)
 * eines konkreten Datums. ANNY-Endpoint:
 *   GET /api/v1/availability/periods?service_id=...&start_date=...&end_date=...
 *
 * Das sind die merged schedule/timeslot-Bloecke - praktisch fuer Day-Pass-
 * Services (Tageskarten / Strandbad), wo wir keine Slots haben aber dennoch
 * die Geoeffnet-Zeit anzeigen wollen.
 */
export async function fetchAnnyServicePeriods(
  baseUrl: string,
  token: string,
  serviceId: string,
  dateStr: string,
  organizationId?: string | null,
): Promise<AvailabilityPeriod[]> {
  const offset = berlinOffset(dateStr);
  const startDate = `${dateStr}T00:00:00${offset}`;
  const endDate = `${dateStr}T23:59:59${offset}`;
  const params = new URLSearchParams({
    service_id: serviceId,
    start_date: startDate,
    end_date: endDate,
    timezone: "Europe/Berlin",
  });
  if (organizationId) params.set("o", organizationId);
  try {
    const res = await fetch(`${baseUrl}/api/v1/availability/periods?${params}`, {
      headers: annyHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const out: AvailabilityPeriod[] = [];
    const pushIfPeriod = (p: unknown) => {
      if (!p || typeof p !== "object") return;
      const o = p as Record<string, string | undefined>;
      const start = o.start || o.start_date || o.from || "";
      const end = o.end || o.end_date || o.to || "";
      if (start || end) out.push({ start, end });
    };
    if (Array.isArray(json)) {
      for (const p of json) pushIfPeriod(p);
    } else if (json && typeof json === "object") {
      // Per-Resource gruppiert: { "<resourceId>": Period[] }
      for (const v of Object.values(json as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          for (const p of v) pushIfPeriod(p);
        } else if (v && typeof v === "object") {
          pushIfPeriod(v);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Vereinigt ueberlappende oder anstossende Perioden zu kompakten Bloecken.
 * Bei mehreren Resources liefert /availability/periods oft identische
 * Bloecke mehrfach - deduplizieren + mergen erspart "10:00-18:00, 10:00-18:00"
 * in der UI.
 */
export function mergeAvailabilityPeriods(periods: AvailabilityPeriod[]): AvailabilityPeriod[] {
  const parsed = periods
    .map((p) => ({ start: new Date(p.start), end: new Date(p.end), raw: p }))
    .filter((p) => !isNaN(p.start.getTime()) && !isNaN(p.end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (parsed.length === 0) return [];
  const merged: typeof parsed = [parsed[0]];
  for (let i = 1; i < parsed.length; i++) {
    const last = merged[merged.length - 1];
    const cur = parsed[i];
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      merged.push(cur);
    }
  }
  return merged.map((p) => ({ start: p.start.toISOString(), end: p.end.toISOString() }));
}

/**
 * Holt fuer einen Service die Daten (YYYY-MM-DD) in einem Range, an denen
 * mindestens ein Slot verfuegbar ist. ANNY-Endpoint:
 *   GET /api/v1/availability/start-dates?service_id=...&start_date=...&end_date=...
 *
 * Praktisch zum Filtern "Service heute ueberhaupt buchbar?", insbesondere
 * fuer Day-Pass-Services (wo /availability/start nicht aussagekraeftig ist)
 * und fuer saisonale Services (Ferienkurs erst im Juli etc.).
 */
export async function fetchAnnyServiceStartDates(
  baseUrl: string,
  token: string,
  serviceId: string,
  startDate: string,
  endDate: string,
  organizationId?: string | null,
): Promise<string[]> {
  const params = new URLSearchParams({
    service_id: serviceId,
    start_date: startDate,
    end_date: endDate,
    timezone: "Europe/Berlin",
  });
  if (organizationId) params.set("o", organizationId);
  try {
    const res = await fetch(`${baseUrl}/api/v1/availability/start-dates?${params}`, {
      headers: annyHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const items: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown[] }).data)
        ? ((json as { data: unknown[] }).data)
        : [];
    const out: string[] = [];
    for (const it of items) {
      if (typeof it === "string") {
        out.push(it);
      } else if (it && typeof it === "object") {
        // JSON:API-Variante: { type: "...", attributes: { date: "..." } }
        // oder { date: "..." } / { start_date: "..." }
        const obj = it as Record<string, unknown>;
        const d =
          (obj.date as string | undefined)
          || (obj.start_date as string | undefined)
          || ((obj.attributes as Record<string, unknown> | undefined)?.date as string | undefined);
        if (typeof d === "string") out.push(d);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function fmtTimeBerlin(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export type AvailabilitySlot = {
  startTime: string;
  endTime: string;
  startIso: string;
  endIso: string;
  /** Gesamtkapazitaet des Slots (ANNY: number_available). */
  capacity?: number;
  /** Aktuell freie Plaetze (ANNY: remaining_number_available). */
  remaining?: number;
  /** false = ANNY meldet diesen Slot als gesperrt. */
  available?: boolean;
  /** ANNY-Grund fuer Nicht-Verfuegbarkeit (booked_out, lead_time_conflict, ...). */
  unavailabilityType?: string;
};

/** Erzeugt deduplizierte, sortierte Slots aus Roh-Perioden. */
export function periodsToSlots(periods: AvailabilityPeriod[]): AvailabilitySlot[] {
  const seen = new Set<string>();
  return periods
    .map((p) => ({
      startTime: fmtTimeBerlin(p.start),
      endTime: fmtTimeBerlin(p.end),
      startIso: p.start,
      endIso: p.end,
    }))
    .filter((s) => {
      if (!s.startTime || !s.endTime) return false;
      const key = `${s.startTime}-${s.endTime}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}
