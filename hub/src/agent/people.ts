/**
 * Signale fuer „Person auf dem Gelaende – Mitarbeiter?“:
 *  - Gesichts-Treffer der bestehenden Gesichtserkennung (Hub-Ereignis
 *    kind "person", Liste WHITELIST/BLACKLIST) je Kamera.
 *  - Eingestempelte Mitarbeiter aus emp-control (hub/src/staff.ts, kommt aus
 *    einem eigenen Modul; solange es fehlt, gibt es keine Stempeldaten).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { CONFIG } from "../config.js";
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

/* ------------------------------------- Wiedererkennung ueber Kameras */

/**
 * Personen, die heute schon als unbedenklich gelten (Mitarbeiter, Gesichts-
 * Treffer, von Aaron per Knopf freigegeben). Gespeichert wird nur eine kurze
 * Kleidungsbeschreibung des Bildmodells, kein Bild und kein Gesichtsmerkmal.
 * Taucht dieselbe Kleidung an einer anderen Kamera auf, gibt es keinen
 * neuen Alarm.
 */
export interface ClearedPerson {
  id: string;
  /** z. B. „Jakob“ oder „Mitarbeiter“ / „freigegeben“. */
  label: string;
  kleidung: string;
  camera: string;
  at: number;
  until: number;
}

const CLEAR_MS = 8 * 60 * 60_000;
const MAX_CLEARED = 30;
let cleared: ClearedPerson[] = [];
let clearedLoaded = false;
/** Alarm-Knopf „Ist in Ordnung“: Kleidung der gemeldeten Personen. */
const pendingOk = new Map<string, { camera: string; kleidung: string[]; at: number }>();

function clearedPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-people.json");
}

async function loadCleared(): Promise<void> {
  if (clearedLoaded) return;
  clearedLoaded = true;
  try {
    const raw = JSON.parse(await readFile(clearedPath(), "utf8")) as { cleared?: ClearedPerson[]; pending?: Array<[string, { camera: string; kleidung: string[]; at: number }]> };
    cleared = Array.isArray(raw.cleared) ? raw.cleared : [];
    for (const [k, v] of raw.pending ?? []) pendingOk.set(k, v);
  } catch {
    cleared = [];
  }
}

async function saveCleared(): Promise<void> {
  const now = Date.now();
  cleared = cleared.filter((c) => c.until > now).slice(-MAX_CLEARED);
  for (const [k, v] of pendingOk) if (now - v.at > CLEAR_MS) pendingOk.delete(k);
  await mkdir(path.dirname(clearedPath()), { recursive: true });
  await writeFile(clearedPath(), JSON.stringify({ cleared, pending: [...pendingOk] }, null, 2), "utf8");
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/** Aktuell bekannte Personen, aelteste zuerst (Reihenfolge = Nummern im Prompt). */
export async function activeCleared(): Promise<ClearedPerson[]> {
  await loadCleared();
  const now = Date.now();
  return cleared.filter((c) => c.until > now);
}

/** Kurztext fuer Begruendung/Prompt: „Jakob (Übungslift 14:30)“. */
export function clearedTitle(c: ClearedPerson): string {
  return `${c.label} (${c.camera} ${hhmm(c.at)})`;
}

/** Prompt-Zusatz mit der Liste der bekannten Personen. Leer, wenn keine. */
export function knownPrompt(list: ClearedPerson[]): string {
  if (!list.length) return "";
  return (
    " Heute schon als unbedenklich eingestuft (an anderen Kameras gesehen):" +
    list.map((c, i) => ` ${i + 1}) ${c.label}: ${c.kleidung}`).join(";") +
    '. Prüfe für jede Person im Bild, ob Kleidung und Aussehen eindeutig zu einer dieser Beschreibungen passen. ' +
    'Gib dafür zusätzlich "bekannt": [Nummern der passenden Einträge] und "unbekannt": Anzahl Personen ohne passenden Eintrag an. Im Zweifel gilt eine Person als unbekannt.'
  );
}

/**
 * Personen merken. `matched` sind die wiedererkannten Eintraege (werden
 * verlaengert), `kleidung` sind neue Beschreibungen, die dazukommen.
 */
export async function rememberPeople(opts: {
  camera: string;
  kleidung: string[];
  label: string;
  matched?: ClearedPerson[];
}): Promise<void> {
  await loadCleared();
  const now = Date.now();
  for (const m of opts.matched ?? []) {
    const c = cleared.find((x) => x.id === m.id);
    if (c) {
      c.until = now + CLEAR_MS;
      c.at = now;
      c.camera = opts.camera;
    }
  }
  for (const k of opts.kleidung) {
    cleared.push({ id: randomBytes(4).toString("hex"), label: opts.label, kleidung: k, camera: opts.camera, at: now, until: now + CLEAR_MS });
  }
  await saveCleared().catch(() => undefined);
}

/** Knopf „Ist in Ordnung“ fuer einen Alarm vorbereiten. null = nichts zu merken. */
export async function offerPersonOk(camera: string, kleidung: string[]): Promise<string | null> {
  if (!kleidung.length) return null;
  await loadCleared();
  const token = randomBytes(4).toString("hex");
  pendingOk.set(token, { camera, kleidung, at: Date.now() });
  await saveCleared().catch(() => undefined);
  return `pok:${token}`;
}

/** Antwort auf „Ist in Ordnung“. */
export async function answerPersonOk(token: string): Promise<string> {
  await loadCleared();
  const p = pendingOk.get(token);
  if (!p) return "Diese Meldung ist zu alt, da kann ich nichts mehr merken.";
  pendingOk.delete(token);
  await rememberPeople({ camera: p.camera, kleidung: p.kleidung, label: "von Aaron freigegeben" });
  return `Gemerkt: ${p.kleidung.length === 1 ? "diese Person gilt" : `diese ${p.kleidung.length} Personen gelten`} die nächsten 8 Stunden an allen Kameras als unbedenklich.`;
}
