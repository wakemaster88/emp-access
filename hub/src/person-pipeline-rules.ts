/**
 * Reine Regeln der Personen-Pipeline (ohne I/O, testbar): wann die Bildserie
 * fuer die Gesichtserkennung endet, weil die Kamera keine Person mehr meldet,
 * ob das Gesicht der optischen Nahaufnahme das bisherige ersetzt und wie der
 * Hub mit Wiederholungen derselben Person umgeht (HUB_SIGHTING_REPEAT).
 * Ablauf in cameras.ts (uploadPersonSnapshot).
 */
import { faceQuality, type FaceShot, type SightingDecision } from "./face-rules.js";
import { inQuietHours } from "./agent/quiet.js";

/**
 * So lange darf das Personen-Signal der Kamera aussetzen, bevor die Pipeline
 * die Person als gegangen wertet. Laenger als ein Takt der Kamera-Abfrage
 * (2 s), kuerzer als der Nachlauf, mit dem ein Ereignis endet (6 s).
 */
export const PERSON_GONE_MS = 4_000;

export interface PipelineSignal {
  /** PERSON in der Abfrage unmittelbar vor diesem Versuch roh gesetzt. */
  rawActive: boolean;
  /**
   * Wann PERSON zuletzt roh gesetzt war: in einer Abfrage der Pipeline oder
   * der regulaeren Abfrage der Kamera (bei der rohen Flanke also der Start).
   */
  lastActiveAt: number;
  now: number;
}

/**
 * Ob die Pipeline vor dem naechsten Versuch endet. Das Signal der Kamera
 * flackert, auch wenn die Person noch im Bild ist; fuer Ereignisse wird es
 * deshalb entprellt. Fuer die Pipeline gilt dasselbe: Ein einzelner Aussetzer
 * beendet die Serie nicht, der Versuch laeuft trotzdem. Erst wenn PERSON seit
 * PERSON_GONE_MS nicht mehr gesetzt war, ist die Person gegangen.
 */
export function pipelineShouldStop(s: PipelineSignal): boolean {
  return !s.rawActive && s.now - s.lastActiveAt >= PERSON_GONE_MS;
}

/**
 * lastActiveAt nach der Abfrage vor einem Versuch: jetzt, wenn die Kamera
 * die Person meldet; sonst der spaetere Wert aus dem bisherigen Stand und der
 * regulaeren Abfrage der Kamera (`seenByPoll`, nur gelesen; sie laeuft
 * waehrend der Pipeline weiter). Beim Start gilt `seenByPoll`, ohne Wert der
 * Start selbst (rohe Flanke).
 */
export function nextLastActiveAt(s: { rawActive: boolean; now: number; prev: number; seenByPoll: number | undefined }): number {
  return s.rawActive ? s.now : Math.max(s.prev, s.seenByPoll ?? 0);
}

/**
 * Gesicht aus der optischen Nahaufnahme uebernehmen? Das bisherige ist oft
 * aus mehreren Bildern gemittelt; das neue ersetzt es nur, wenn es einen
 * Treffer in der Galerie liefert oder besser ist (faceQuality). Ohne
 * bisheriges Gesicht gilt jedes neue.
 */
export function takeOpticalFace(i: { matched: boolean; before: FaceShot | null; after: FaceShot }): boolean {
  if (i.matched || !i.before) return true;
  return faceQuality(i.after) > faceQuality(i.before);
}

/**
 * Umgang mit Wiederholungen derselben Person an einer Kamera
 * (shouldStoreSighting in face-rules.ts), HUB_SIGHTING_REPEAT:
 *  - count (Standard): die Regel wird ausgewertet und gezaehlt, hochgeladen
 *    wird jede Sichtung,
 *  - skip: Wiederholungen werden nicht hochgeladen,
 *  - off: keine Auswertung.
 * Leer oder unbekannt ergibt den Standard.
 */
export type SightingRepeatMode = "count" | "skip" | "off";

export function sightingRepeatMode(v: string | undefined): SightingRepeatMode {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "skip") return "skip";
  if (t === "off" || t === "aus" || t === "0" || t === "false") return "off";
  return "count";
}

/**
 * Hochladen oder als Wiederholung weglassen? Nur mit skip faellt eine
 * Wiederholung weg; count und off laden jede Sichtung hoch.
 */
export function sightingAction(mode: SightingRepeatMode, decision: Pick<SightingDecision, "store">): "upload" | "skip" {
  return mode === "skip" && !decision.store ? "skip" : "upload";
}

/**
 * Ueberwachungszeit (Ortszeit), in der jede Sichtung gespeichert wird: festes
 * Fenster nach der Uhr des Hubs (Entscheidung vom 25.11.2026). Zeitplan und
 * Schalter der Ueberwachung in der Cloud fragt der Hub dafuer nicht ab.
 */
export const SIGHTING_SURVEILLANCE_HOURS = "22-7";

/**
 * Liegt die Stunde in der Ueberwachungszeit (SIGHTING_SURVEILLANCE_HOURS)?
 * Ist sie nicht lesbar, null: Dann gilt die Ueberwachungszeit, und keine
 * Sichtung wird als Wiederholung weggelassen.
 */
export function sightingSurveillance(hour: number): boolean | null {
  return Number.isFinite(hour) ? inQuietHours(SIGHTING_SURVEILLANCE_HOURS, hour) : null;
}
