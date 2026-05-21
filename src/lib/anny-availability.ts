/**
 * ANNY Verfügbarkeits-API: Öffnungszeiten / Zeitslots pro Resource.
 * Shared zwischen Dashboard und Utilization-Endpoint.
 */

export interface AvailabilityPeriod {
  start: string;
  end: string;
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
): Promise<AnnyServiceMatch> {
  const knownNames: string[] = [];
  const debug: AnnyServiceMatch["debug"] = [];
  if (serviceNames.length === 0) return { id: null, knownNames, debug };
  const wantedLower = serviceNames.map((n) => n.toLowerCase());
  const wantedSet = new Set(wantedLower);

  let exactMatch: string | null = null;
  let substringMatch: string | null = null;

  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({
      "page[size]": "100",
      "page[number]": String(page),
    });
    let status = 0;
    let items: unknown[] = [];
    let bodyText = "";
    try {
      const res = await fetch(`${baseUrl}/api/v1/services?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
        if (!exactMatch && wantedSet.has(lower)) {
          exactMatch = String(id);
        } else if (!substringMatch) {
          if (wantedLower.some((w) => w.includes(lower) || lower.includes(w))) {
            substringMatch = String(id);
          }
        }
      }
      if (items.length < 100) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      debug.push({ page, status, items: 0, bodyPreview: `ERR: ${msg}` });
      break;
    }
  }

  return { id: exactMatch || substringMatch, knownNames, debug };
}

/**
 * Backwards-compatible Wrapper, gibt nur die UUID zurueck (oder null).
 */
export async function fetchAnnyServiceIdByName(
  baseUrl: string,
  token: string,
  serviceNames: string[],
): Promise<string | null> {
  const match = await fetchAnnyServiceMatch(baseUrl, token, serviceNames);
  return match.id;
}

export interface ServiceStartSlot {
  startIso: string;
  endIso: string;
  startTime: string;
  endTime: string;
  available: boolean;
  remaining?: number;
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
  opts: { durationMinutes?: number; resourceId?: string } = {},
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

  try {
    const res = await fetch(`${baseUrl}/api/v1/availability/start?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
        available?: boolean;
        remaining_number_available?: number;
        unavailability_type?: string;
      };
      const startIso = it.start_date;
      if (!startIso) continue;
      const isAvailable = it.available !== false;
      let endIso = "";
      if (opts.durationMinutes && opts.durationMinutes > 0) {
        const s = new Date(startIso);
        if (!isNaN(s.getTime())) {
          endIso = new Date(s.getTime() + opts.durationMinutes * 60000).toISOString();
        }
      }
      result.push({
        startIso,
        endIso,
        startTime: fmtTimeBerlin(startIso),
        endTime: endIso ? fmtTimeBerlin(endIso) : "",
        available: isAvailable,
        remaining: it.remaining_number_available,
      });
    }
    return result;
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
  /**
   * Restkapazitaet laut ANNY (number_available - booked). Nur gesetzt, wenn
   * der Service kapazitaetsbegrenzt ist - bei unbegrenzten Slots (z.B.
   * Drop-in-Kurs) ist das Feld absent.
   */
  remaining?: number;
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
