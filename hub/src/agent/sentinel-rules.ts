/**
 * Wann schaut sich der Assistent ein Kamera-Ereignis selbst an? Reine Logik.
 *
 * Auffaellig kann nur sein, was ausserhalb des Betriebs passiert: Person oder
 * Fahrzeug an einer Kamera, deren Raum gerade geschlossen ist, bzw. (Kamera
 * ohne Raum mit Betriebszeit) im Nachtfenster. Waehrend des Betriebs laufen
 * hunderte Personen-Ereignisse am Tag – die bewertet er nicht.
 */
import { inQuietHours } from "./quiet.js";

export interface SentinelEvent {
  kind: string;
  title: string;
  where: string | null;
}

export interface SentinelContext {
  /** true = Raum der Kamera geschlossen, false = offen, null = keine Betriebszeit bekannt. */
  closed: boolean | null;
  hour: number;
  nightWindow: string;
  /** Alle Personen/Fahrzeuge bewerten, auch im Betrieb (HUB_AGENT_SENTINEL=always). */
  always: boolean;
  lastInspectAt: number | undefined;
  now: number;
  /** Mindestabstand je Kamera. */
  cooldownMs: number;
  /** Bewertungen in der letzten Stunde (alle Kameras). */
  inspectionsLastHour: number;
  maxPerHour: number;
}

export function isTriggerEvent(ev: SentinelEvent): boolean {
  if (!ev.where) return false;
  if (ev.kind === "camera") return /^(PERSON|VEHICLE)\b.*erkannt$/.test(ev.title);
  return false;
}

export function shouldInspect(ev: SentinelEvent, ctx: SentinelContext): boolean {
  if (!isTriggerEvent(ev)) return false;
  if (ctx.lastInspectAt !== undefined && ctx.now - ctx.lastInspectAt < ctx.cooldownMs) return false;
  if (ctx.inspectionsLastHour >= ctx.maxPerHour) return false;
  if (ctx.always) return true;
  if (ctx.closed === true) return true;
  if (ctx.closed === false) return false;
  return inQuietHours(ctx.nightWindow, ctx.hour);
}

export interface Verdict {
  auffaellig: boolean;
  was: string;
  dringlichkeit: "niedrig" | "mittel" | "hoch";
}

/** Antwort des Bildmodells robust lesen (JSON, notfalls aus Text). */
export function parseVerdict(raw: string): Verdict {
  let obj: Record<string, unknown> = {};
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      obj = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const flag = obj.auffaellig ?? obj.auffällig ?? obj.suspicious;
  const auffaellig = flag === true || flag === "true" || flag === "ja";
  const d = String(obj.dringlichkeit ?? "niedrig").toLowerCase();
  return {
    auffaellig,
    was: String(obj.was ?? obj.beschreibung ?? raw).replace(/\s+/g, " ").trim().slice(0, 400),
    dringlichkeit: d === "hoch" || d === "mittel" ? d : "niedrig",
  };
}

/* ------------------------------------------------- Personen: Mitarbeiter? */

/** Nahaufnahme-Bewertung einer Person (Bildmodell, JSON). */
export interface PersonLook {
  personen: number;
  arbeitskleidung: boolean;
  mitarbeiter: boolean;
  verdaechtig: boolean;
  was: string;
}

export function parsePersonLook(raw: string): PersonLook {
  let obj: Record<string, unknown> = {};
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      obj = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const yes = (v: unknown) => v === true || v === "true" || v === "ja";
  const n = Math.round(Number(obj.personen));
  return {
    personen: Number.isFinite(n) && n >= 0 ? Math.min(n, 50) : 1,
    arbeitskleidung: yes(obj.arbeitskleidung),
    mitarbeiter: yes(obj.mitarbeiter ?? obj.wirkt_wie_mitarbeiter),
    verdaechtig: yes(obj.verdaechtig ?? obj.verdächtig),
    was: String(obj.was ?? obj.beschreibung ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

export interface PersonContext {
  /** Gesichts-Treffer der bestehenden Gesichtserkennung an dieser Kamera. */
  face: { name: string; list: string } | null;
  /** Eingestempelte Mitarbeiter (null = keine aktuellen Daten). */
  staff: string[] | null;
  look: PersonLook | null;
  hour: number;
}

export interface PersonDecision {
  alarm: boolean;
  reason: string;
}

/** Tagsueber (6–20 Uhr) arbeiten Mitarbeiter auch ausserhalb der Oeffnungszeit. */
const WORK_HOURS = (h: number) => h >= 6 && h < 20;

/**
 * Person ausserhalb des Betriebs: Alarm oder vermutlich Mitarbeiter?
 * Wichtigstes Signal sind eingestempelte Mitarbeiter, dazu Arbeitskleidung,
 * Taetigkeit und Uhrzeit. Ein Gesichts-Treffer auf der Whitelist der
 * bestehenden Gesichtserkennung reicht allein. Verdaechtiges Verhalten oder
 * Blacklist schlagen immer Alarm.
 */
export function decidePerson(ctx: PersonContext): PersonDecision {
  if (ctx.face?.list === "BLACKLIST") return { alarm: true, reason: `Gesperrte Person erkannt: ${ctx.face.name}` };
  if (ctx.look?.verdaechtig) return { alarm: true, reason: "Verhalten wirkt verdächtig" };
  if (ctx.face?.list === "WHITELIST") return { alarm: false, reason: `Gesicht erkannt: ${ctx.face.name}` };
  const staff = ctx.staff ?? [];
  if (staff.length > 0) {
    const count = ctx.look?.personen ?? 1;
    const looksStaff = !!ctx.look && (ctx.look.mitarbeiter || ctx.look.arbeitskleidung);
    if (count <= staff.length && (looksStaff || WORK_HOURS(ctx.hour))) {
      return { alarm: false, reason: `Eingestempelt: ${staff.join(", ")}` };
    }
    return {
      alarm: true,
      reason:
        count > staff.length
          ? `${count} Personen, aber nur ${staff.length} eingestempelt (${staff.join(", ")})`
          : `Eingestempelt: ${staff.join(", ")}, aber nachts und ohne Arbeitskleidung`,
    };
  }
  return { alarm: true, reason: ctx.staff === null ? "Keine Stempeldaten" : "Niemand eingestempelt" };
}
