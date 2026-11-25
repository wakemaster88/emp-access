/**
 * Kamera-Bewegungen fuer Personen (optischer Zoom, Folgen): reine Logik ohne
 * Ein-/Ausgabe. Ablauf und Kamerabefehle in camera-motion.ts, Design in
 * docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md.
 */
import type { NormBox } from "./person-crop-rules.js";
import { inQuietHours } from "./agent/quiet.js";

/** Handsteuerung (Zentrale, Cloud, Assistent) sperrt die Automatik so lange. */
export const HAND_HOLD_MS = 5 * 60_000;
/**
 * So lange wartet ein Befehl von Hand hoechstens, bis die Automatik die
 * Kamera abgegeben hat (laufende Befehle der Automatik haben Zeitlimits bis
 * 15 s; die Handsteuerung soll darauf nicht warten).
 */
export const HAND_HANDOVER_MAX_MS = 2_000;
/** Regel-Szene ohne Rueckkehrzeit sperrt die Automatik so lange. */
export const RULE_HOLD_MS = 5 * 60_000;
export const FOLLOW_MAX_MS = 120_000;
export const FOLLOW_COOLDOWN_MS = 60_000;
/** Abstand zwischen zwei Fahrten des Zooms, gemessen ab dem Zoom-Befehl. */
export const CLOSEUP_GAP_MS = 30_000;
export const CLOSEUP_GAP_ZONE_MS = 2 * 60_000;
export const CLOSEUP_ZONE_MAX_MS = 6_000;
/**
 * Verzicht ohne Fahrt (nichts zu planen, lohnt nicht, Person weg): so lange
 * keine neue Planung (je ein Bild und die Personen-Erkennung), auch an
 * Zonen-Kameras. Kurz, weil das Objektiv sich nicht bewegt hat; der Abstand
 * CLOSEUP_GAP_ZONE_MS zaehlt erst ab einer Fahrt.
 */
export const CLOSEUP_SKIP_PAUSE_MS = 15_000;
/** Gesichtserkennung und Waechter (fragt erst nach dem Bildmodell) teilen sich eine Nahaufnahme. */
export const CLOSEUP_CACHE_MS = 45_000;
/** Ohne Nahaufnahme: so lange gilt das leere Ergebnis fuer weitere Anfragen. */
export const CLOSEUP_EMPTY_CACHE_MS = 10_000;
/** Gesichtserkennung: So gross soll das Gesicht nach der Fahrt mindestens sein. */
export const FACE_OPTICAL_MIN_PX = 64;
/** Gesichtserkennung ohne Gesicht im Bild: Die Fahrt lohnt erst ab diesem Faktor. */
export const FACE_OPTICAL_MIN_GAIN = 2;
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
/** Rueckfahrt des Zooms gescheitert: Abstand der weiteren Versuche. */
export const ZOOM_RETURN_RETRY_MS = 30_000;
/** So viele weitere Versuche, danach meldet der Hub die Kamera. */
export const ZOOM_RETURN_RETRIES = 10;
/** Tracking des Hubs liess sich nicht ausschalten: Abstand der weiteren Versuche. */
export const TRACK_OFF_RETRY_MS = 30_000;
/** So viele weitere Versuche, danach meldet der Hub die Kamera. */
export const TRACK_OFF_RETRIES = 10;

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
  /**
   * Abbruch der laufenden Nahaufnahme: Hand (bleibt bis zum Ende der Sperre
   * stehen) oder Fahrzeug (sofort zurueck).
   */
  abort: "hand" | "vehicle" | null;
  /** Letzter Zoom-Befehl einer Nahaufnahme (nicht der letzte Versuch). */
  lastCloseUpAt: number;
  /** Nach einem Verzicht ohne Fahrt: bis dahin keine neue Planung. */
  skipUntil: number;
  /** Verzicht nur, weil die Fahrt dem Gesicht nicht hilft: gilt nur fuer die Gesichtserkennung. */
  faceSkipUntil: number;
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
    skipUntil: 0,
    faceSkipUntil: 0,
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

/** Betriebszustand der Kamera fuer das Folgen. */
export interface FollowRoom {
  /**
   * Raum der Kamera geschlossen (wie der Waechter ihn aus den Raumdaten
   * ermittelt); false = offen; null = unbekannt (keine Raumdaten, Kamera
   * ohne Raum mit Betriebszeit, Assistent aus).
   */
  closed: boolean | null;
  /** Ortszeit-Stunde; NaN = nicht lesbar. */
  hour: number;
  /** Nachtfenster des Waechters (HUB_AGENT_SENTINEL_NIGHT). */
  nightWindow: string;
  /** HUB_FOLLOW_ALWAYS: folgen auch bei offenem Raum. */
  always: boolean;
}

export const FOLLOW_ROOM_OPEN = "Raum offen";
export const FOLLOW_ROOM_UNKNOWN = "Raum unbekannt, außerhalb des Nachtfensters";

/**
 * Darf die Kamera nach dem Betriebszustand folgen? Nur bei geschlossenem
 * Raum: Im Betrieb sind dauernd Personen im Bild, und die Kamera verliesse
 * alle paar Minuten ihre Uebersicht. Ist der Zustand unbekannt, entscheidet
 * das Nachtfenster des Waechters. HUB_FOLLOW_ALWAYS folgt immer.
 */
export function followRoomBlocked(r: FollowRoom): string | null {
  if (r.always || r.closed === true) return null;
  if (r.closed === false) return FOLLOW_ROOM_OPEN;
  return inQuietHours(r.nightWindow, r.hour) ? null : FOLLOW_ROOM_UNKNOWN;
}

/** Betriebszustand fuer Zaehler und Log. */
export function roomLabel(closed: boolean | null): "offen" | "geschlossen" | "unbekannt" {
  return closed === true ? "geschlossen" : closed === false ? "offen" : "unbekannt";
}

/** HUB_FOLLOW_ALWAYS: 1, true, ja oder on stellt das Folgen auch bei offenem Raum her. */
export function followAlwaysOn(v: string | undefined): boolean {
  return /^(1|true|ja|on)$/i.test((v ?? "").trim());
}

/**
 * Grund, warum die Kamera jetzt nicht folgen darf; null = darf. Mit `room`
 * zaehlt auch der Betriebszustand (followRoomBlocked), als letzter Grund:
 * Steht er da, haette die Kamera sonst folgen duerfen. Ohne `room` (Nahaufnahme
 * des Waechters) zaehlt er nicht.
 */
export function followBlocked(st: MotionState, now: number, cam: MotionCamFlags, room?: FollowRoom): string | null {
  if (!cam.pan) return "kein Schwenkkopf";
  if (cam.zone) return "Zonen-Kamera";
  const hold = activeHold(st, now);
  if (hold) return hold === "hand" ? "Handsteuerung" : "Regel";
  if (st.following) return "folgt schon";
  if (now < st.followCooldownUntil) return "Pause nach dem Folgen";
  if (now < st.trackRetryAt) return "Tracking zuletzt nicht möglich";
  return room ? followRoomBlocked(room) : null;
}

/**
 * Grund, warum jetzt keine Nahaufnahme geht; null = geht. `zoomAway`: Die
 * Rueckfahrt der letzten Nahaufnahme steht noch aus. Eine neue wuerde die
 * hereingezoomte Stellung als Ausgangsstellung merken. `forFace`: Die
 * Gesichtserkennung fragt; ein Verzicht nur aus Gesichts-Gruenden
 * (faceSkipUntil) gilt nur fuer sie, nicht fuer den Waechter.
 */
export function closeUpBlocked(
  st: MotionState,
  now: number,
  cam: MotionCamFlags,
  vehicleActive: boolean,
  zoomAway = false,
  forFace = false
): string | null {
  if (!cam.zoom) return "kein Zoom";
  const hold = activeHold(st, now);
  if (hold) return hold === "hand" ? "Handsteuerung" : "Regel";
  if (st.closeUp) return "Nahaufnahme läuft";
  if (zoomAway) return "Zoom noch nicht zurück";
  if (cam.zone && vehicleActive) return "Fahrzeug an der Zonen-Kamera";
  if (now - st.lastCloseUpAt < (cam.zone ? CLOSEUP_GAP_ZONE_MS : CLOSEUP_GAP_MS)) return "letzte Nahaufnahme zu kurz her";
  if (now < st.skipUntil) return "letzter Versuch ohne Fahrt zu kurz her";
  if (forFace && now < st.faceSkipUntil) return "Fahrt lohnte für das Gesicht eben nicht";
  return null;
}

/** Was die Gesichtserkennung ueber ihr Gesicht weiss, bevor der Zoom faehrt. */
export interface FaceNeed {
  /** Kantenlaenge des bisher besten Gesichts in Pixeln; null = kein Gesicht. */
  size: number | null;
  /** Das Gesicht ist hochskaliert (Mini-Gesicht, strengere Schwelle); nur fuer den Zaehler. */
  upscaled: boolean;
}

/**
 * Lohnt die Fahrt fuer die Gesichtserkennung? Das Gesicht soll danach
 * voraussichtlich mindestens FACE_OPTICAL_MIN_PX gross sein (Groesse in
 * Pixeln des Kamerabilds mal Faktor). Ohne Gesicht lohnt erst ein Faktor ab
 * FACE_OPTICAL_MIN_GAIN. Fuer den Waechter gilt weiter MIN_GAIN
 * (planCloseUp).
 */
export function opticalWorth(faceSizePx: number | null, gain: number): boolean {
  if (!(gain > 1)) return false;
  if (faceSizePx == null || !(faceSizePx > 0)) return gain >= FACE_OPTICAL_MIN_GAIN;
  return faceSizePx * gain >= FACE_OPTICAL_MIN_PX;
}

/** Ergebnis einer Nahaufnahme im Zwischenspeicher. */
export interface CloseUpCacheEntry {
  /** Es gibt ein Bild. */
  ok: boolean;
  /** Leer, weil die Fahrt nur dem Gesicht nicht geholfen haette. */
  faceSkip: boolean;
  ageMs: number;
}

/**
 * Gilt das gespeicherte Ergebnis fuer diese Anfrage? Ein Bild 45 s, ein
 * leeres Ergebnis 10 s. Hat nur die Gesichtserkennung verzichtet, plant der
 * Waechter selbst: Fuer ihn kann die Fahrt lohnen.
 */
export function closeUpCacheUsable(e: CloseUpCacheEntry, forFace: boolean): boolean {
  if (!e.ok && e.faceSkip && !forFace) return false;
  return e.ageMs < (e.ok ? CLOSEUP_CACHE_MS : CLOSEUP_EMPTY_CACHE_MS);
}

/**
 * Nach einer Handsteuerung: Der Zoom faehrt nur zurueck, wenn das Objektiv
 * noch dort steht, wo die Automatik es hingestellt hat. Hat jemand den Zoom
 * verstellt, bleibt seine Einstellung; steht das Objektiv schon in der
 * Ausgangsstellung, ist nichts zu tun.
 */
export function shouldRestoreZoom(current: number, autoPos: number, home: number): boolean {
  return current === autoPos && current !== home;
}

/**
 * Rueckfahrt des Zooms nach `fails` gescheiterten Versuchen aufgeben? Der
 * erste Versuch laeuft am Ende der Nahaufnahme, danach folgen hoechstens
 * ZOOM_RETURN_RETRIES weitere im Abstand von ZOOM_RETURN_RETRY_MS.
 */
export function zoomReturnGivenUp(fails: number): boolean {
  return fails > ZOOM_RETURN_RETRIES;
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
