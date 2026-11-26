/**
 * Vergleich der Halteverbot-Erkennung auf einem Ausschnitt (ohne I/O,
 * testbar). Der Tracker kann ein Bild auf einen Ausschnitt beschränken und
 * dort mit höherer Auflösung rechnen (roi, imgsz an /classify). Ob das in
 * der Fläche mehr, weniger oder gleich viele Fahrzeuge findet, zählt der Hub
 * nebenher: Jeder 10. Durchlauf und jeder Durchlauf mit Kandidat fragt den
 * Tracker zusätzlich mit dem Hüllrechteck der Fläche plus 15 % Rand.
 *
 * Der Vergleich zählt nur. Meldung, Spur und Takt kommen allein aus der
 * Erkennung auf dem ganzen Bild (noparking-rules.ts).
 */
import { relevantBoxes, type BoxFilter, type NoParkBox } from "./noparking-rules.js";
import type { NormRect } from "./tracker-client-rules.js";
import type { Point } from "./zone-rules.js";

/** Jeder so vielte Durchlauf vergleicht, auch ohne Kandidat. */
export const SHADOW_EVERY = 10;
/** Rand um das Hüllrechteck der Fläche, Anteil an dessen Breite bzw. Höhe je Seite. */
export const SHADOW_MARGIN = 0.15;
/** Auflösung der Erkennung im Ausschnitt. */
export const SHADOW_IMGSZ = 1280;

/** HUB_NOPARK_SHADOW: Standard an; 0 (auch off, aus, false, nein, no) = kein Vergleich. */
export function shadowEnabled(raw: string | undefined): boolean {
  return !/^\s*(0|off|aus|false|nein|no)\s*$/i.test(raw ?? "");
}

/**
 * Vergleicht dieser Durchlauf? `run` zählt die Durchläufe einer Kamera mit
 * Ergebnis ab 1; `candidate`: In der Fläche steht oder stand gerade etwas
 * (eine Spur, auch mit Aussetzer).
 */
export function shadowDue(run: number, candidate: boolean, every = SHADOW_EVERY): boolean {
  if (candidate) return true;
  return every > 0 && run > 0 && run % every === 0;
}

/** Hüllrechteck der Fläche plus `margin` je Seite, auf das Bild begrenzt; null ohne brauchbare Fläche. */
export function zoneRoi(zone: readonly Point[], margin = SHADOW_MARGIN): NormRect | null {
  const pts = zone.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return null;
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const left = Math.max(0, x0 - w * margin);
  const top = Math.max(0, y0 - h * margin);
  const right = Math.min(1, x1 + w * margin);
  const bottom = Math.min(1, y1 + h * margin);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Hat der Tracker den Ausschnitt benutzt? Ein älterer Tracker ignoriert roi
 * und imgsz und nennt sie nicht in der Antwort: Dann gibt es nichts zu
 * vergleichen.
 */
export function usedRoi(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const roi = (json as { roi?: unknown }).roi;
  return Array.isArray(roi) && roi.length === 4 && roi.every((v) => typeof v === "number" && Number.isFinite(v));
}

export interface ShadowSide {
  /** Fahrzeuge in der Fläche (dieselben Regeln wie die Meldung: relevantBoxes). */
  boxes: number;
  /** Summe ihrer Sicherheit. */
  confSum: number;
}

export interface ShadowResult {
  outcome: "same" | "more" | "less";
  full: ShadowSide;
  roi: ShadowSide;
}

/**
 * Beide Wege vergleichen: Fahrzeuge in der Fläche auf dem ganzen Bild
 * (`full`) und im Ausschnitt (`roi`, Boxen schon auf das ganze Bild
 * zurückgerechnet), mit denselben Regeln für Klasse, Sicherheit,
 * Mindestgröße und Radaufstandspunkt. „more“ = der Ausschnitt findet mehr.
 */
export function shadowCompare(full: NoParkBox[], roi: NoParkBox[], zone: Point[], filter: BoxFilter): ShadowResult {
  const side = (boxes: NoParkBox[]): ShadowSide => {
    const kept = relevantBoxes(boxes, zone, filter);
    return { boxes: kept.length, confSum: kept.reduce((s, b) => s + b.conf, 0) };
  };
  const a = side(full);
  const b = side(roi);
  return { outcome: b.boxes === a.boxes ? "same" : b.boxes > a.boxes ? "more" : "less", full: a, roi: b };
}
