/**
 * Kamera-Bewegungen fuer Personen (optischer Zoom, Folgen): reine Logik ohne
 * Ein-/Ausgabe. Ablauf und Kamerabefehle in camera-motion.ts, Design in
 * docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md.
 */
import type { NormBox } from "./person-crop-rules.js";

/** Handsteuerung (Zentrale, Cloud, Assistent) sperrt die Automatik so lange. */
export const HAND_HOLD_MS = 5 * 60_000;
/** Regel-Szene ohne Rueckkehrzeit sperrt die Automatik so lange. */
export const RULE_HOLD_MS = 5 * 60_000;
export const FOLLOW_MAX_MS = 120_000;
export const FOLLOW_COOLDOWN_MS = 60_000;
export const CLOSEUP_GAP_MS = 30_000;
export const CLOSEUP_GAP_ZONE_MS = 2 * 60_000;
export const CLOSEUP_ZONE_MAX_MS = 6_000;
/** Gesichtserkennung und Waechter (fragt erst nach dem Bildmodell) teilen sich eine Nahaufnahme. */
export const CLOSEUP_CACHE_MS = 45_000;
/** Nach der Rueckkehr: Fokus, bevor Zonen-Auswertungen wieder Bilder nehmen. */
export const HOME_SETTLE_MS = 3_000;
export const TRACK_RETRY_MS = 10 * 60_000;
/** Kein Tracking oder dauerhaft an: so lange nicht erneut fragen. */
export const TRACK_RECHECK_MS = 60 * 60_000;
/** Wachposition nur aus einer Stellung speichern, die so lange unbewegt war. */
export const GUARD_IDLE_MS = 10 * 60_000;
/** Ohne Grundstellung: so lange nicht erneut suchen. */
export const HOME_RETRY_MS = 60 * 60_000;
export const FOCUS_MS = 2_500;
export const CENTER_WAIT_MS = 3_000;
/** Darunter lohnt die optische Nahaufnahme nicht, der digitale Zoom reicht. */
export const MIN_GAIN = 1.3;

export interface Hold {
  by: "hand" | "rule";
  until: number;
}

export interface MotionState {
  hold: Hold | null;
  following: boolean;
  followUntil: number;
  followCooldownUntil: number;
  closeUp: boolean;
  /** Abbruch der laufenden Nahaufnahme: Hand (bleibt stehen) oder Fahrzeug (sofort zurueck). */
  abort: "hand" | "vehicle" | null;
  lastCloseUpAt: number;
  /** Letzte Rueckkehr in die Grundstellung. */
  homeAt: number;
  /** Letzte Bewegung (Hand, Regel, Automatik) – fuer das Speichern der Wachposition. */
  lastMovedAt: number;
  trackRetryAt: number;
}

export function newMotionState(now: number): MotionState {
  return {
    hold: null,
    following: false,
    followUntil: 0,
    followCooldownUntil: 0,
    closeUp: false,
    abort: null,
    lastCloseUpAt: Number.NEGATIVE_INFINITY,
    homeAt: Number.NEGATIVE_INFINITY,
    lastMovedAt: now,
    trackRetryAt: 0,
  };
}

export function activeHold(st: MotionState, now: number): Hold["by"] | null {
  return st.hold && now < st.hold.until ? st.hold.by : null;
}

/** Kamera in Grundstellung: keine Automatik aktiv und der Fokus hatte Zeit. */
export function isAtHome(st: MotionState, now: number): boolean {
  return !st.following && !st.closeUp && now - st.homeAt >= HOME_SETTLE_MS;
}

export interface MotionCamFlags {
  pan: boolean;
  zoom: boolean;
  zone: boolean;
}

/** Grund, warum die Kamera jetzt nicht folgen darf; null = darf. */
export function followBlocked(st: MotionState, now: number, cam: MotionCamFlags): string | null {
  if (!cam.pan) return "kein Schwenkkopf";
  if (cam.zone) return "Zonen-Kamera";
  const hold = activeHold(st, now);
  if (hold) return hold === "hand" ? "Handsteuerung" : "Regel";
  if (st.following) return "folgt schon";
  if (now < st.followCooldownUntil) return "Pause nach dem Folgen";
  if (now < st.trackRetryAt) return "Tracking zuletzt nicht möglich";
  return null;
}

/** Grund, warum jetzt keine Nahaufnahme geht; null = geht. */
export function closeUpBlocked(st: MotionState, now: number, cam: MotionCamFlags, vehicleActive: boolean): string | null {
  if (!cam.zoom) return "kein Zoom";
  const hold = activeHold(st, now);
  if (hold) return hold === "hand" ? "Handsteuerung" : "Regel";
  if (st.closeUp) return "Nahaufnahme läuft";
  if (cam.zone && vehicleActive) return "Fahrzeug an der Zonen-Kamera";
  if (now - st.lastCloseUpAt < (cam.zone ? CLOSEUP_GAP_ZONE_MS : CLOSEUP_GAP_MS)) return "letzte Nahaufnahme zu kurz her";
  return null;
}

const OPTICAL: Array<[RegExp, number]> = [
  [/RLC-823A 16X/i, 16],
  [/RLC-811A/i, 5],
];

/** Optischer Zoomfaktor je Modell; unbekannt vorsichtig 3. */
export function opticalFactor(model: string | null): number {
  if (model) for (const [re, f] of OPTICAL) if (re.test(model)) return f;
  return 3;
}

/** Vergroesserung bei einer Zoom-Position, linear angenommen. */
export function magnificationAt(pos: number, min: number, max: number, factor: number): number {
  if (max <= min || factor <= 1) return 1;
  const t = Math.min(1, Math.max(0, (pos - min) / (max - min)));
  return 1 + (factor - 1) * t;
}

export function posForMagnification(m: number, min: number, max: number, factor: number): number {
  if (max <= min || factor <= 1) return min;
  const t = Math.min(1, Math.max(0, (m - 1) / (factor - 1)));
  return Math.round(min + (max - min) * t);
}

/** Zoom zur Bildmitte: hoechste Vergroesserung, bei der die Box plus Rand im Bild bleibt. */
export function maxCenterGain(b: NormBox, margin = 0.03): number {
  const d = Math.max(
    Math.abs(b.x - margin - 0.5),
    Math.abs(b.x + b.w + margin - 0.5),
    Math.abs(b.y - margin - 0.5),
    Math.abs(b.y + b.h + margin - 0.5)
  );
  return d > 0 ? 0.5 / d : Number.POSITIVE_INFINITY;
}

/** Vergroesserung, bei der die Box 60 % der Bildhoehe fuellt. */
export function wantedGain(b: NormBox, fill = 0.6): number {
  return b.h > 0 ? fill / b.h : 1;
}

function boundingBox(boxes: NormBox[]): NormBox {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface ZoomRange {
  pos: number;
  min: number;
  max: number;
}

export interface ZoomPlan {
  /** Ziel-Position des Zoom-Objektivs. */
  pos: number;
  /** Vergroesserung gegenueber dem aktuellen Bild. */
  gain: number;
  /** Box, auf die gezoomt wird (alle Personen oder eine). */
  box: NormBox;
  /** Vergroesserung vorher, ab Weitwinkel gerechnet. */
  from: number;
}

/**
 * Nahaufnahme planen: erst alle Personen zusammen, sonst die groesste Person,
 * fuer die sich mindestens MIN_GAIN ergibt. Der Zoom bleibt in der Bildmitte.
 */
export function planCloseUp(boxes: NormBox[], zoom: ZoomRange, factor: number): ZoomPlan | null {
  if (!boxes.length) return null;
  const from = magnificationAt(zoom.pos, zoom.min, zoom.max, factor);
  const room = factor / from;
  if (room < MIN_GAIN) return null;
  const candidates = [boundingBox(boxes), ...[...boxes].sort((a, b) => b.w * b.h - a.w * a.h)];
  for (const box of candidates) {
    const gain = Math.min(wantedGain(box), maxCenterGain(box), room);
    if (gain >= MIN_GAIN) {
      return { pos: posForMagnification(from * gain, zoom.min, zoom.max, factor), gain, box, from };
    }
  }
  return null;
}

/** Steht die Person nach dem Nachfuehren etwa in der Bildmitte? */
export function isCentered(b: NormBox, tolX = 0.15, tolY = 0.25): boolean {
  return Math.abs(b.x + b.w / 2 - 0.5) <= tolX && Math.abs(b.y + b.h / 2 - 0.5) <= tolY;
}

export function largestBox(boxes: NormBox[]): NormBox | null {
  return boxes.length ? boxes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : null;
}

export interface TrackingCfg {
  /** Schalter in Get/SetAiCfg: `bSmartTrack` (Ein/Aus), sonst `aiTrack`. */
  key: "bSmartTrack" | "aiTrack";
  on: boolean;
  /** Personen sind als Zielart vorhanden, aber aus. */
  peopleOff: boolean;
}

export function readTrackingCfg(cfg: Record<string, unknown>): TrackingCfg | null {
  const key = typeof cfg.bSmartTrack === "number" ? "bSmartTrack" : typeof cfg.aiTrack === "number" ? "aiTrack" : null;
  if (!key) return null;
  const types = cfg.trackType as Record<string, unknown> | undefined;
  return { key, on: cfg[key] !== 0, peopleOff: typeof types?.people === "number" && types.people === 0 };
}

export interface ZoneFlags {
  host: string;
  vehicleDetection?: boolean;
  noParkDetection?: boolean;
  deliveryMode?: string | null;
}

/** Kamera mit festem Bildausschnitt fuer Auswertungen (Kennzeichen, Halteverbot, Lieferdienste, Parkflaeche). */
export function isZoneCamera(c: ZoneFlags, parkingHosts: ReadonlySet<string>): boolean {
  return c.vehicleDetection !== false || c.noParkDetection === true || !!c.deliveryMode || parkingHosts.has(c.host);
}
