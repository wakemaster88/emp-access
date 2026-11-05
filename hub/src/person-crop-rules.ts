/**
 * Digitaler Zoom auf Personen: Ausschnitt-Rechtecke aus den normierten
 * Personen-Boxen des Trackers (0..1). Reine Logik.
 */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
  conf?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function clampRect(x: number, y: number, w: number, h: number): NormBox {
  const x0 = clamp01(x);
  const y0 = clamp01(y);
  return { x: x0, y: y0, w: Math.min(1 - x0, Math.max(0, w)), h: Math.min(1 - y0, Math.max(0, h)) };
}

/**
 * Kopf-/Oberkoerper-Ausschnitt einer Person fuer die Gesichtserkennung:
 * oberes Drittel der Box, rundherum etwas Rand, mindestens 4 % der Bildbreite.
 */
export function headRect(b: NormBox): NormBox {
  const hh = b.h * 0.38;
  const side = Math.max(b.w * 1.3, hh * 1.1, 0.04);
  const cx = b.x + b.w / 2;
  return clampRect(cx - side / 2, b.y - hh * 0.15, side, hh * 1.3);
}

/** Ausschnitt um alle Personen (fuer das Bildmodell), mit 25 % Rand. */
export function groupRect(boxes: NormBox[]): NormBox | null {
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  const w = x2 - x1;
  const h = y2 - y1;
  const padX = Math.max(w * 0.25, 0.03);
  const padY = Math.max(h * 0.25, 0.03);
  const r = clampRect(x1 - padX, y1 - padY, w + 2 * padX, h + 2 * padY);
  // Lohnt sich nur, wenn der Ausschnitt deutlich kleiner als das Bild ist.
  return r.w * r.h > 0.6 ? null : r;
}

/** Groesste Personen zuerst, hoechstens `max`. */
export function largestFirst(boxes: NormBox[], max = 3): NormBox[] {
  return [...boxes].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, max);
}
