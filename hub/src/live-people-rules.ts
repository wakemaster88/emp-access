/**
 * Reine Regeln fuer „erkannte Personen“ in der Zentrale (ohne I/O, testbar).
 */
export type SeenKind = "face" | "staff" | "cleared" | "suspicious" | "unknown";

export interface SeenSource {
  camera: string;
  at: number;
  /** Ereignis-Titel bzw. Label der Wiedererkennung. */
  title: string;
  /** Gesichtsliste WHITELIST | BLACKLIST. */
  list: string | null;
  origin: "face" | "sentinel" | "cleared";
}

export interface SeenPerson {
  cameraId: number;
  camera: string;
  label: string;
  kind: SeenKind;
  /** Letzte Sichtung (ms), null = nur die Kamera meldet gerade eine Person. */
  at: number | null;
  /** Kamera meldet gerade eine Person. */
  active: boolean;
}

/** Wer ist das? Juengste aussagekraeftige Quelle zuerst; null = unbekannt. */
export function personLabel(newestFirst: SeenSource[]): { text: string; kind: SeenKind } | null {
  for (const s of newestFirst) {
    if (s.origin === "face") {
      const m = /^Person erkannt:\s*(.+)$/.exec(s.title);
      if (m) return { text: m[1].trim(), kind: s.list === "BLACKLIST" ? "suspicious" : "face" };
      continue;
    }
    if (s.origin === "sentinel") {
      if (/vermutlich Mitarbeiter/i.test(s.title)) return { text: "Mitarbeiter", kind: "staff" };
      if (/auffällig/i.test(s.title)) return { text: "Auffällig", kind: "suspicious" };
      continue;
    }
    const text = s.title.trim() || "unbedenklich";
    return { text, kind: /mitarbeiter/i.test(text) ? "staff" : "cleared" };
  }
  return null;
}

/** Eine Zeile je Kamera: gerade aktive zuerst, dann die juengste Sichtung. */
export function mergeSeen(
  cams: Array<{ id: number; name: string; person: boolean }>,
  sources: SeenSource[],
  _now: number
): SeenPerson[] {
  const out: SeenPerson[] = [];
  for (const cam of cams) {
    const mine = sources.filter((s) => s.camera === cam.name).sort((a, b) => b.at - a.at);
    if (!cam.person && !mine.length) continue;
    const label = personLabel(mine);
    out.push({
      cameraId: cam.id,
      camera: cam.name,
      label: label?.text ?? "Person",
      kind: label?.kind ?? "unknown",
      at: mine[0]?.at ?? null,
      active: cam.person,
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || (b.at ?? Infinity) - (a.at ?? Infinity));
}

/* ------------------------------------------ Name an der richtigen Box */

export interface LabelBox {
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxLabel {
  text: string;
  kind: SeenKind;
}

/** Gesichts-Treffer mit Lage im Bild (Gesichtsmitte, normiert 0..1). */
export interface FaceHint {
  at: number;
  x: number;
  y: number;
  label: BoxLabel;
}

/** Boxen der letzten Abfrage mit ihrem Namen (zum Weitertragen). */
export interface LabeledFrame {
  at: number;
  boxes: Array<LabelBox & { label: BoxLabel | null }>;
}

/** So lange zeigt eine Gesichtsposition noch auf die richtige Box. */
export const HINT_MAX_AGE_MS = 15_000;
/** Aelter als das ist die letzte Abfrage kein Anhaltspunkt mehr. */
export const PREV_MAX_AGE_MS = 5_000;

const cx = (b: LabelBox) => b.x + b.w / 2;
const cy = (b: LabelBox) => b.y + b.h / 2;

/** Liegt die Gesichtsmitte im Kopfbereich (obere 45 %) der Box? */
function headHit(b: LabelBox, x: number, y: number): boolean {
  const padX = b.w * 0.15;
  return x >= b.x - padX && x <= b.x + b.w + padX && y >= b.y - b.h * 0.05 && y <= b.y + b.h * 0.45;
}

/**
 * Namen den einzelnen Boxen zuordnen statt der ganzen Kamera:
 *  1. Ein frischer Gesichts-Treffer mit Lage benennt die Box, in deren
 *     Kopfbereich er liegt.
 *  2. Namen aus der letzten Abfrage wandern zur naechstgelegenen Box, wenn
 *     sie sich hoechstens um etwa eine Boxgroesse bewegt hat.
 *  3. Ohne Lage gilt der Kamera-Name nur, wenn genau eine Person im Bild
 *     ist – bei mehreren waere jede Zuordnung geraten.
 */
export function assignBoxLabels(
  boxes: LabelBox[],
  hints: FaceHint[],
  prev: LabeledFrame | null,
  cameraLabel: BoxLabel | null,
  now: number
): Array<BoxLabel | null> {
  const out: Array<BoxLabel | null> = boxes.map(() => null);
  const taken = new Set<string>();

  // 1. Gesichtsposition, juengster Treffer zuerst.
  const fresh = hints.filter((h) => now - h.at <= HINT_MAX_AGE_MS).sort((a, b) => b.at - a.at);
  for (const h of fresh) {
    if (taken.has(h.label.text)) continue;
    let best = -1;
    let bestD = Infinity;
    boxes.forEach((b, i) => {
      if (out[i] || !headHit(b, h.x, h.y)) return;
      const d = Math.hypot(cx(b) - h.x, b.y + b.h * 0.15 - h.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      out[best] = h.label;
      taken.add(h.label.text);
    }
  }

  // 2. Weitertragen aus der letzten Abfrage (gierig nach Abstand).
  if (prev && now - prev.at <= PREV_MAX_AGE_MS) {
    const pairs: Array<{ d: number; i: number; j: number }> = [];
    prev.boxes.forEach((p, j) => {
      if (!p.label || taken.has(p.label.text)) return;
      boxes.forEach((b, i) => {
        if (out[i]) return;
        const d = Math.hypot(cx(b) - cx(p), cy(b) - cy(p));
        const reach = Math.max(0.06, Math.max(p.w, p.h, b.w, b.h) * 0.8);
        if (d <= reach) pairs.push({ d, i, j });
      });
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedPrev = new Set<number>();
    for (const { i, j } of pairs) {
      const lab = prev.boxes[j].label!;
      if (out[i] || usedPrev.has(j) || taken.has(lab.text)) continue;
      out[i] = lab;
      usedPrev.add(j);
      taken.add(lab.text);
    }
  }

  // 3. Eine einzige Person: Kamera-Name, wenn noch keiner vergeben ist.
  if (boxes.length === 1 && !out[0] && cameraLabel && !taken.has(cameraLabel.text)) out[0] = cameraLabel;
  return out;
}
