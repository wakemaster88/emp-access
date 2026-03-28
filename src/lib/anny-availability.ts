/**
 * ANNY Verfügbarkeits-API: Öffnungszeiten / Zeitslots pro Resource.
 * Shared zwischen Dashboard und Utilization-Endpoint.
 */

export interface AvailabilityPeriod {
  start: string;
  end: string;
}

export async function fetchAnnyAvailability(
  baseUrl: string,
  token: string,
  resourceIds: string[],
  dateStr: string,
): Promise<Record<string, AvailabilityPeriod[]>> {
  if (resourceIds.length === 0) return {};

  const startDate = `${dateStr}T00:00:00+01:00`;
  const endDate = `${dateStr}T23:59:59+01:00`;

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
 */
export async function fetchAnnyAvailabilityWithSlots(
  baseUrl: string,
  token: string,
  resourceIds: string[],
  dateStr: string,
): Promise<Record<string, AvailabilityPeriod[]>> {
  if (resourceIds.length === 0) return {};

  const startDate = `${dateStr}T00:00:00+01:00`;
  const endDate = `${dateStr}T23:59:59+01:00`;

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
    }
  } catch { /* slots endpoint not available, fall back */ }

  return fetchAnnyAvailability(baseUrl, token, resourceIds, dateStr);
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
