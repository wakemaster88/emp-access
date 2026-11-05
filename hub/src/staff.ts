/**
 * Personal: wer ist gerade eingestempelt, wer hat heute noch Schicht.
 *
 * Quelle ist emp-control (Zeiterfassung, Schichtplan). Der Hub fragt dafuer
 * nur die Cloud (`GET /api/hub/staff`); der Zugang zu emp-control (Live-
 * Monitor-Link) liegt dort in den Einstellungen und kommt nie auf den Hub.
 *
 * Abruf jede Minute. Der letzte gute Stand liegt in hub/.cache/staff.json,
 * damit Assistent und Waechter nach einem Neustart nicht blind sind –
 * `staffDataAge()` sagt, wie alt er ist. Wer den Stand nutzt, muss das Alter
 * pruefen: Eingestempelt vor zwei Stunden heisst nicht eingestempelt jetzt.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { parseStaffResponse, type StaffShift, type StaffSnapshot as Snapshot } from "./staff-parse.js";

export type { StaffMember, StaffShift } from "./staff-parse.js";

export const STAFF_SYNC_INTERVAL_MS = 60_000;
const CACHE_FILE = path.join(CONFIG.hubDir, ".cache", "staff.json");

let snapshot: Snapshot | null = null;
/** false = Cloud sagt, emp-control ist (noch) nicht verbunden. */
let configured: boolean | null = null;
let lastError: string | null = null;
let lastAttemptAt: string | null = null;

async function saveCache(data: Snapshot): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data));
  } catch (e) {
    log(`Personal: Cache nicht geschrieben (${e instanceof Error ? e.message : e})`);
  }
}

async function loadCache(): Promise<void> {
  try {
    const data = parseStaffResponse(JSON.parse(await fs.readFile(CACHE_FILE, "utf8")));
    if (data) snapshot = data;
  } catch {
    /* noch kein Cache */
  }
}

export async function syncStaff(): Promise<{ ok: boolean; error?: string }> {
  lastAttemptAt = new Date().toISOString();
  try {
    const res = await api("/api/hub/staff", { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.configured === false) {
      if (configured !== false) log(`Personal: ${String(body.reason ?? "emp-control nicht eingerichtet")}`);
      configured = false;
      lastError = String(body.reason ?? "emp-control nicht eingerichtet");
      return { ok: false, error: lastError };
    }
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
    const data = parseStaffResponse(body);
    if (!data) throw new Error("Antwort ohne Personaldaten");
    const first = !snapshot || configured !== true;
    snapshot = data;
    configured = true;
    if (lastError) log("Personal: emp-control wieder erreichbar");
    lastError = null;
    await saveCache(data);
    if (first) log(`Personal: ${data.working.length} eingestempelt (emp-control)`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== lastError) log(`Personal: Abruf fehlgeschlagen (${msg})`);
    lastError = msg;
    return { ok: false, error: msg };
  }
}

export async function startStaff(): Promise<void> {
  await loadCache();
  await syncStaff();
  setInterval(() => void syncStaff(), STAFF_SYNC_INTERVAL_MS);
}

/* ------------------------------------------------------------- Abfragen */

/** ms seit dem letzten erfolgreichen Abruf (Zeitpunkt in emp-control), null = nie. */
export function staffDataAge(now = Date.now()): number | null {
  if (!snapshot) return null;
  const t = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** Eingestempelte Mitarbeiter aus dem letzten Stand (leer, wenn unbekannt). */
export function clockedInStaff(): Array<{ name: string; since?: string; department?: string; onBreak?: boolean }> {
  return (snapshot?.working ?? []).map((w) => ({
    name: w.name,
    ...(w.since ? { since: w.since } : {}),
    ...(w.department ? { department: w.department } : {}),
    onBreak: w.onBreak,
  }));
}

/** Heutige Schichten, deren Leute noch nicht eingestempelt sind. */
export function staffOnShiftToday(): StaffShift[] {
  return snapshot?.shifts ?? [];
}

const hm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : null;

/** Kompakte Lage fuer Assistent und Status – mit Alter, damit niemand alten Stand fuer aktuell haelt. */
export function staffSummary(now = Date.now()) {
  const age = staffDataAge(now);
  return {
    source: "emp-control",
    configured,
    dataAgeMin: age == null ? null : Math.round(age / 60_000),
    stale: age == null || age > 5 * 60_000,
    error: lastError,
    lastAttemptAt,
    workingCount: snapshot?.working.length ?? 0,
    onBreakCount: snapshot?.working.filter((w) => w.onBreak).length ?? 0,
    working: (snapshot?.working ?? []).map((w) => ({
      name: w.name,
      bereich: w.department ?? w.plannedDepartment,
      seit: hm(w.since),
      pause: w.onBreak,
      schichtBis: hm(w.plannedEnd),
      verspaetungMin: w.startDiffMin != null && w.startDiffMin > 0 ? w.startDiffMin : null,
    })),
    nochNichtDa: staffOnShiftToday()
      .filter((s) => s.pending.length)
      .map((s) => ({ bereich: s.department, beginn: hm(s.start), ende: s.end, personen: s.pending })),
  };
}

/** Eingabe fuer die Tagesvorschau (day-preview-format.ts). */
export function staffPreviewInput(now = Date.now()) {
  const age = staffDataAge(now);
  return {
    configured,
    dataAgeMin: age == null ? null : Math.round(age / 60_000),
    error: lastError,
    working: (snapshot?.working ?? []).map((w) => ({
      name: w.name,
      department: w.department,
      plannedDepartment: w.plannedDepartment,
    })),
    shifts: staffOnShiftToday(),
  };
}
