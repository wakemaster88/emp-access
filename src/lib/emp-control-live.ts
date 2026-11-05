/**
 * Wer arbeitet gerade? – Live-Stand aus emp-control.
 *
 * emp-control bietet fuer seine Live-Monitore `GET /api/monitor/live?token=…`
 * an: eingestempelte Mitarbeiter (mit Pause und geplanter Schicht) und die
 * heutigen Schichten, deren Leute noch nicht eingestempelt sind. Der Token
 * gehoert zu genau einem Monitor, ist nur lesend und laesst sich dort
 * jederzeit neu erzeugen oder abschalten.
 *
 * Gespeichert wird der komplette Monitor-Link (wie emp-control ihn unter
 * Terminals & Standorte anzeigt) in `ApiConfig.extraConfig.monitorUrl` des
 * Anbieters EMP_CONTROL. Der Hub fragt nur die Cloud (`/api/hub/staff`), der
 * Token bleibt damit an einer Stelle.
 */

export interface StaffMember {
  /** emp-control-Benutzer-ID. */
  id: string;
  name: string;
  department: string | null;
  /** Einstempelzeit (ISO). */
  since: string | null;
  onBreak: boolean;
  plannedDepartment: string | null;
  /** Geplantes Schichtende (ISO), wenn eine Schicht zugewiesen ist. */
  plannedEnd: string | null;
  /** Minuten Abweichung beim Einstempeln gegenueber Schichtbeginn (+ = spaeter). */
  startDiffMin: number | null;
}

export interface StaffShift {
  department: string | null;
  start: string | null;
  end: string | null;
  /** Zugewiesen, aber noch nicht eingestempelt. */
  pending: string[];
  totalAssigned: number;
  clockedIn: number;
}

export interface StaffSnapshot {
  fetchedAt: string;
  working: StaffMember[];
  shifts: StaffShift[];
}

export interface MonitorLink {
  origin: string;
  token: string;
}

/** Monitor-Link zerlegen. Nimmt auch den API-Pfad oder `origin` + `?token=`. */
export function parseMonitorUrl(raw: unknown): MonitorLink | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const token = url.searchParams.get("token")?.trim();
  if (!token) return null;
  return { origin: url.origin, token };
}

const iso = (ts: unknown): string | null => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};
const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "-" ? s : null;
};

/** Antwort von `/api/monitor/live` in eine schlanke, stabile Form bringen. */
export function normalizeLive(body: unknown, now = new Date()): StaffSnapshot {
  const b = (body ?? {}) as { workingEmployees?: unknown[]; scheduledShifts?: unknown[] };
  const working: StaffMember[] = (Array.isArray(b.workingEmployees) ? b.workingEmployees : [])
    .map((raw) => {
      const e = raw as Record<string, unknown>;
      return {
        id: String(e.id ?? ""),
        name: text(e.name) ?? "Unbekannt",
        department: text(e.department),
        since: iso(e.startTimestamp),
        onBreak: e.onBreak === true,
        plannedDepartment: text(e.plannedDepartment),
        plannedEnd: iso(e.plannedEndTimestamp),
        startDiffMin: typeof e.startDiffMin === "number" ? e.startDiffMin : null,
      };
    })
    .sort((a, b2) => a.name.localeCompare(b2.name, "de"));

  const shifts: StaffShift[] = (Array.isArray(b.scheduledShifts) ? b.scheduledShifts : []).map((raw) => {
    const s = raw as Record<string, unknown>;
    const start = iso(s.startTimestamp);
    // emp-control liefert das Ende nur als "HH:MM" (Berlin); Datum vom Beginn.
    let end: string | null = null;
    if (start && typeof s.endTime === "string" && /^\d{2}:\d{2}$/.test(s.endTime)) {
      end = s.endTime;
    }
    return {
      department: text(s.department),
      start,
      end,
      pending: (Array.isArray(s.assignedEmployees) ? s.assignedEmployees : [])
        .map((a) => text((a as Record<string, unknown>).name))
        .filter((n): n is string => !!n),
      totalAssigned: Number(s.totalAssigned) || 0,
      clockedIn: Number(s.clockedIn) || 0,
    };
  });

  return { fetchedAt: now.toISOString(), working, shifts };
}

const cache = new Map<string, { at: number; data: StaffSnapshot }>();
const CACHE_MS = 20_000;

/** Live-Stand holen; kurz zwischengespeichert, damit mehrere Hubs nicht doppelt fragen. */
export async function fetchStaffLive(link: MonitorLink): Promise<StaffSnapshot> {
  const key = `${link.origin}|${link.token}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const res = await fetch(`${link.origin}/api/monitor/live?token=${encodeURIComponent(link.token)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new Error("emp-control lehnt den Monitor-Token ab (abgeschaltet oder neu erzeugt?)");
  if (!res.ok) throw new Error(`emp-control antwortet mit HTTP ${res.status}`);
  const data = normalizeLive(await res.json());
  cache.set(key, { at: Date.now(), data });
  return data;
}
