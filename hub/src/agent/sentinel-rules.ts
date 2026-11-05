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
