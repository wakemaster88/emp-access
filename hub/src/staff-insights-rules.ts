/**
 * Mitarbeiter-Ansicht: Stempeldaten aus emp-control mit dem zusammenfuehren,
 * was die KI des Hubs heute bemerkt hat (Gesichtserkennung, Waechter,
 * kameraübergreifende Wiedererkennung). Reine Logik, ohne Hub-Konfiguration.
 *
 * Zuordnung zu einer Person nur, wenn sie eindeutig ist: Gesichts-Treffer
 * mit passendem Namen, eine Wiedererkennung mit Namen, oder ein Waechter-
 * Urteil, bei dem genau eine Person eingestempelt war. Alles andere bleibt
 * eine allgemeine Beobachtung ohne Namen.
 */
import type { StaffMember, StaffShift } from "./staff-parse.js";

export type SightingOrigin = "face" | "sentinel" | "cleared";

export interface StaffSighting {
  at: number;
  camera: string;
  origin: SightingOrigin;
  /** Ereignistitel bzw. Label der Wiedererkennung. */
  title: string;
  detail?: string | null;
  /** WHITELIST/BLACKLIST bei Gesichts-Treffern. */
  list?: string | null;
  /** Kleidungsbeschreibung des Bildmodells (nur Wiedererkennung). */
  kleidung?: string | null;
}

export interface Flag {
  tone: "ok" | "warn" | "sky" | "off";
  text: string;
}

export interface PersonSighting {
  at: string;
  camera: string;
  how: string;
  text: string | null;
}

export interface StaffInsight {
  id: string;
  name: string;
  department: string | null;
  since: string | null;
  onBreak: boolean;
  plannedEnd: string | null;
  flags: Flag[];
  lastSeen: PersonSighting | null;
  sightings: PersonSighting[];
}

export interface Observation {
  at: string;
  camera: string;
  kind: "staff" | "alert" | "cleared";
  title: string;
  text: string | null;
}

export interface StaffInsights {
  people: StaffInsight[];
  pending: Array<{ department: string | null; start: string | null; end: string | null; names: string[] }>;
  observations: Observation[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Passt ein erkannter Name (Gesicht, Label) zu einem Mitarbeiter? */
export function nameMatches(staffName: string, seen: string): boolean {
  const a = norm(staffName);
  const b = norm(seen);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  // Kurzform (nur Vorname, „Jakob S“): alle Teile des kuerzeren im laengeren,
  // Vorname muss gleich sein.
  if (a[0] !== b[0]) return false;
  const covered = (xs: string[], ys: string[]) => xs.every((t) => ys.some((l) => l === t || (t.length === 1 && l.startsWith(t))));
  return covered(a, b) || covered(b, a);
}

const berlinDay = (ms: number) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : null;

const FACE_PREFIX = /^Person erkannt:\s*/;
const STAFF_PREFIX = /^Eingestempelt:\s*/;

/** Namen aus „Eingestempelt: A, B“ bzw. „Eingestempelt: A, B, aber …“. */
function namesFromReason(detail: string | null | undefined): string[] {
  if (!detail || !STAFF_PREFIX.test(detail)) return [];
  return detail
    .replace(STAFF_PREFIX, "")
    .split(/,\s*aber\b/)[0]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function flagsFor(w: StaffMember, now: number): Flag[] {
  const out: Flag[] = [];
  if (w.onBreak) out.push({ tone: "sky", text: "Pause" });
  if (w.startDiffMin != null && w.startDiffMin > 5) out.push({ tone: "warn", text: `${w.startDiffMin} min nach Schichtbeginn gestempelt` });
  if (w.startDiffMin != null && w.startDiffMin < -30) out.push({ tone: "off", text: `${-w.startDiffMin} min vor Schichtbeginn gestempelt` });
  const end = w.plannedEnd ? Date.parse(w.plannedEnd) : NaN;
  if (Number.isFinite(end) && now > end + 10 * 60_000) out.push({ tone: "warn", text: `Schichtende ${hm(w.plannedEnd)} überschritten` });
  if (!w.plannedEnd) out.push({ tone: "off", text: "ohne geplante Schicht" });
  const since = w.since ? Date.parse(w.since) : NaN;
  if (Number.isFinite(since) && now - since > 10 * 3600_000) out.push({ tone: "warn", text: "über 10 h eingestempelt" });
  return out;
}

export function buildStaffInsights(
  working: StaffMember[],
  shifts: StaffShift[],
  sightings: StaffSighting[],
  now = Date.now(),
): StaffInsights {
  const today = berlinDay(now);
  const todays = sightings.filter((s) => Number.isFinite(s.at) && berlinDay(s.at) === today).sort((a, b) => b.at - a.at);
  const per = new Map<string, PersonSighting[]>(working.map((w) => [w.id, []]));
  const observations: Observation[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();

  const assign = (name: string, s: PersonSighting): boolean => {
    const hits = working.filter((w) => nameMatches(w.name, name));
    if (hits.length !== 1) return false;
    per.get(hits[0].id)!.push(s);
    return true;
  };

  for (const s of todays) {
    if (s.origin === "face") {
      const name = s.title.replace(FACE_PREFIX, "").trim();
      const how = s.list === "BLACKLIST" ? "Gesicht (Sperrliste!)" : "Gesicht erkannt";
      assign(name, { at: iso(s.at), camera: s.camera, how, text: null });
      continue;
    }
    if (s.origin === "cleared") {
      const ok = assign(s.title, { at: iso(s.at), camera: s.camera, how: "wiedererkannt", text: s.kleidung ?? null });
      if (!ok) observations.push({ at: iso(s.at), camera: s.camera, kind: "cleared", title: `Wiedererkannt: ${s.title}`, text: s.kleidung ?? null });
      continue;
    }
    // Waechter
    if (s.title.includes("auffällig")) {
      observations.push({ at: iso(s.at), camera: s.camera, kind: "alert", title: "Wächter: auffällig", text: s.detail ?? null });
      continue;
    }
    const names = namesFromReason(s.detail);
    const attributed =
      names.length === 1 && assign(names[0], { at: iso(s.at), camera: s.camera, how: "vom Wächter als Mitarbeiter eingestuft", text: null });
    if (!attributed) observations.push({ at: iso(s.at), camera: s.camera, kind: "staff", title: "Wächter: vermutlich Mitarbeiter", text: s.detail ?? null });
  }

  const people: StaffInsight[] = working
    .map((w) => {
      const list = per.get(w.id) ?? [];
      return {
        id: w.id,
        name: w.name,
        department: w.department ?? w.plannedDepartment,
        since: w.since,
        onBreak: w.onBreak,
        plannedEnd: w.plannedEnd,
        flags: flagsFor(w, now),
        lastSeen: list[0] ?? null,
        sightings: list.slice(0, 20),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return {
    people,
    pending: shifts
      .filter((s) => s.pending.length)
      .map((s) => ({ department: s.department, start: s.start, end: s.end, names: s.pending })),
    observations: observations.slice(0, 40),
  };
}
