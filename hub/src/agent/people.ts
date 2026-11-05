/**
 * Signale fuer „Person auf dem Gelaende – Mitarbeiter?“:
 *  - Gesichts-Treffer der bestehenden Gesichtserkennung (Hub-Ereignis
 *    kind "person", Liste WHITELIST/BLACKLIST) je Kamera.
 *  - Eingestempelte Mitarbeiter aus emp-control (hub/src/staff.ts, kommt aus
 *    einem eigenen Modul; solange es fehlt, gibt es keine Stempeldaten).
 */
import type { HubEvent } from "../state.js";

const WINDOW_MS = 90_000;
/** Stempeldaten aelter als das gelten als unbekannt. */
const STAFF_MAX_AGE_MS = 20 * 60_000;

const lastFace = new Map<string, { at: number; name: string; list: string }>();

export function notePersonEvents(events: HubEvent[]): void {
  const now = Date.now();
  for (const ev of events) {
    if (ev.kind !== "person" || !ev.where || !ev.list) continue;
    const name = ev.title.replace(/^Person erkannt:\s*/, "").trim();
    lastFace.set(ev.where, { at: now, name, list: ev.list });
  }
}

/** Gesichts-Treffer an der Kamera kurz vor/nach `since`. */
export function faceAt(cameraName: string, since: number): { name: string; list: string } | null {
  const f = lastFace.get(cameraName);
  if (!f || f.at < since - WINDOW_MS) return null;
  return { name: f.name, list: f.list };
}

type StaffModule = {
  clockedInStaff?: () => Array<{ name: string; onBreak?: boolean }>;
  staffDataAge?: () => number | null;
};
let staffMod: StaffModule | null | undefined;

async function loadStaff(): Promise<StaffModule | null> {
  if (staffMod !== undefined) return staffMod;
  // Bewusst ueber eine Variable: das Modul kommt aus einem parallelen PR.
  const spec = "../staff.js";
  try {
    staffMod = (await import(spec)) as StaffModule;
  } catch {
    staffMod = null;
    setTimeout(() => (staffMod = undefined), 10 * 60_000).unref?.();
  }
  return staffMod;
}

/** Namen der eingestempelten Mitarbeiter; null = keine aktuellen Daten. */
export async function staffClockedIn(): Promise<string[] | null> {
  const mod = await loadStaff();
  if (!mod?.clockedInStaff) return null;
  const age = mod.staffDataAge?.() ?? null;
  if (age === null || age > STAFF_MAX_AGE_MS) return null;
  try {
    return mod.clockedInStaff().map((s) => s.name).filter(Boolean);
  } catch {
    return null;
  }
}
