/**
 * Fahrzeug-Burst: welches Kennzeichen, welches Bild, wann aufhören.
 * Reine Logik ohne Hub-Konfiguration (testbar, vehicle-burst-rules.test.ts).
 *
 * Befund 20.11.2026 (Log der letzten 24 h, Kamera Eingang): Die OCR las
 * Kennzeichen oft über viele Bilder sicher (GT-AR 9876 auf 18 Bildern mit
 * 0,98), der Hub verwarf sie aber (Kreis unbekannt) und nahm als Bild das
 * letzte mit irgendeinem Fahrzeug – meist das wegfahrende Auto. Einzelbilder
 * lesen außerdem gern ein Zeichen falsch (ST-U statt GT-U). Darum zählt hier
 * die Mehrheit über den ganzen Burst.
 *
 * Schalten (Tor/Shelly) hängt NICHT an diesen Regeln, sondern weiter nur am
 * exakten Whitelist-Treffer pro Bild (plate-match.ts, plateMayActuate).
 */
import { normalizePlate } from "./plate-match.js";

export interface FrameCandidate {
  plate: string;
  confidence: number;
}

/** OCR-Ergebnis eines Burst-Bilds. */
export interface FrameRead {
  index: number;
  candidates: FrameCandidate[];
}

export interface BurstConsensus {
  /** Kennzeichen in Anzeigeform (z. B. „GT-AR 9876“). */
  plate: string;
  /** Auf so vielen Bildern gelesen (inkl. abgeschnittener Lesungen). */
  frames: number;
  /** Beste Confidence dieser Lesung. */
  confidence: number;
  /** Bild, das hochgeladen wird: sichere Lesung, mitten in der Durchfahrt. */
  bestIndex: number;
}

export interface ConsensusOptions {
  /** Mindest-Confidence einer Lesung (HUB_PLATE_MIN_CONF, Standard 0,8). */
  minConf: number;
  /** Gültige Unterscheidungszeichen. */
  knownCity: ReadonlySet<string>;
  /** Einzelnes Bild reicht ab dieser Confidence (Standard 0,95). */
  singleFrameConf?: number;
}

const FORMAT = /^([A-Z]{1,3})-([A-Z]{1,2}) (\d{1,4})([EH]?)$/;

function readingOk(c: FrameCandidate, opts: ConsensusOptions): boolean {
  if (!Number.isFinite(c.confidence) || c.confidence < opts.minConf) return false;
  const m = c.plate.trim().toUpperCase().match(FORMAT);
  if (!m) return false;
  return m[1].length >= 2 && opts.knownCity.has(m[1]);
}

function digitCount(plate: string): number {
  return plate.match(FORMAT)?.[3].length ?? 0;
}

/**
 * Mehrheit über alle Bilder: je Bild die beste gültige Lesung, gruppiert nach
 * normalisiertem Text. Abgeschnittene Lesungen („GT-KS 33“) zählen für die
 * längere („GT-KS 339“). Gewinnt die Gruppe mit den meisten Bildern, bei
 * Gleichstand die höhere Summe der Confidence.
 *
 * Angenommen wird sie nur, wenn sie trägt: mindestens 2 Bilder, oder ein Bild
 * mit ≥ singleFrameConf und 3–4 Ziffern. Kennzeichen mit 1–2 Ziffern sind oft
 * abgeschnitten und brauchen 3 Bilder.
 */
export function burstConsensus(reads: FrameRead[], opts: ConsensusOptions): BurstConsensus | null {
  const single = opts.singleFrameConf ?? 0.95;
  type Group = { plate: string; n: string; hits: Array<{ index: number; conf: number }> };
  const groups = new Map<string, Group>();
  for (const r of reads) {
    let best: FrameCandidate | null = null;
    for (const c of r.candidates) {
      if (!readingOk(c, opts)) continue;
      if (!best || c.confidence > best.confidence) best = c;
    }
    if (!best) continue;
    const plate = best.plate.trim().toUpperCase();
    const n = normalizePlate(plate);
    const g = groups.get(n) ?? { plate, n, hits: [] };
    g.hits.push({ index: r.index, conf: best.confidence });
    groups.set(n, g);
  }
  if (groups.size === 0) return null;

  const all = [...groups.values()];
  let winner: { g: Group; frames: number; sum: number } | null = null;
  for (const g of all) {
    // Abgeschnittene Lesungen derselben Zeichenfolge zählen mit.
    const extra = all.filter((o) => o !== g && o.n.length < g.n.length && g.n.startsWith(o.n) && g.n.length - o.n.length <= 2);
    const hits = [...g.hits, ...extra.flatMap((o) => o.hits)];
    const frames = new Set(hits.map((h) => h.index)).size;
    const sum = hits.reduce((s, h) => s + h.conf, 0);
    if (!winner || frames > winner.frames || (frames === winner.frames && sum > winner.sum)) {
      winner = { g, frames, sum };
    }
  }
  if (!winner) return null;

  const { g, frames } = winner;
  const top = Math.max(...g.hits.map((h) => h.conf));
  const digits = digitCount(g.plate);
  const enough = digits <= 2 ? frames >= 3 : frames >= 2 || top >= single;
  if (!enough) return null;

  return { plate: g.plate, frames, confidence: top, bestIndex: middleOfBest(g.hits, top) };
}

/** Unter den fast besten Bildern (≤ 0,02 darunter) das mittlere: Auto voll im Bild. */
function middleOfBest(hits: Array<{ index: number; conf: number }>, top: number): number {
  const near = hits.filter((h) => h.conf >= top - 0.02).map((h) => h.index).sort((a, b) => a - b);
  return near[Math.floor((near.length - 1) / 2)];
}

/**
 * Bild ohne sicheres Kennzeichen: Wo die OCR wenigstens etwas Schild-artiges
 * sah (≥ 0,5), ist die Front im Bild – das sicherste davon. Sonst das Bild
 * mit der größten Fahrzeug-Box (Auto am nächsten). Früher: das letzte Bild
 * mit irgendeinem Fahrzeug, also oft das wegfahrende Heck.
 * `areas[i]` = Fläche der Fahrzeug-Box (0 = keins, null = nicht geprüft).
 * null = kein brauchbares Bild.
 */
export function pickFallbackFrame(
  reads: FrameRead[],
  areas: Array<number | null>,
  minArea: number
): { index: number; why: "ocr" | "area" } | null {
  let ocrBest: { index: number; conf: number } | null = null;
  for (const r of reads) {
    const conf = Math.max(0, ...r.candidates.map((c) => (Number.isFinite(c.confidence) ? c.confidence : 0)));
    if (conf >= 0.5 && (!ocrBest || conf > ocrBest.conf)) ocrBest = { index: r.index, conf };
  }
  if (ocrBest) return { index: ocrBest.index, why: "ocr" };

  let areaBest: { index: number; area: number } | null = null;
  areas.forEach((a, index) => {
    if (a == null || !(a >= minArea) || a <= 0) return;
    if (!areaBest || a > areaBest.area) areaBest = { index, area: a };
  });
  const picked = areaBest as { index: number; area: number } | null;
  return picked ? { index: picked.index, why: "area" } : null;
}

/**
 * Burst früher beenden: Sobald ein Kennzeichen auf `confirmFrames` Bildern
 * übereinstimmt, noch `afterFrames` Bilder (Lieferdienst-Aufschrift an der
 * Seite, zweite Chance fürs Bild), dann Schluss. Spart bei 20 Bildern à
 * ~1,1 s bis zu 15 s, bis die Sichtung in der Cloud ist.
 * `reads` in Aufnahmereihenfolge, fehlende (OCR läuft noch) dürfen fehlen.
 */
export function burstDone(
  reads: FrameRead[],
  framesTaken: number,
  opts: ConsensusOptions & { confirmFrames?: number; afterFrames?: number }
): boolean {
  const confirm = Math.max(2, opts.confirmFrames ?? 3);
  const after = Math.max(0, opts.afterFrames ?? 2);
  const counts = new Map<string, number>();
  const sorted = [...reads].sort((a, b) => a.index - b.index);
  for (const r of sorted) {
    let best: FrameCandidate | null = null;
    for (const c of r.candidates) if (readingOk(c, opts) && (!best || c.confidence > best.confidence)) best = c;
    if (!best) continue;
    const n = normalizePlate(best.plate);
    const k = (counts.get(n) ?? 0) + 1;
    counts.set(n, k);
    if (k >= confirm) return framesTaken - 1 - r.index >= after;
  }
  return false;
}
