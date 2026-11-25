/**
 * Fahrzeug-Burst: welches Kennzeichen, welches Bild, wann aufhören.
 * Reine Logik ohne Hub-Konfiguration (testbar, vehicle-burst-rules.test.ts).
 *
 * Befund 20.11.2026 (Log der letzten 24 h, Kamera Eingang): Die OCR las
 * Kennzeichen oft über viele Bilder sicher (GT-AB 4321 auf 18 Bildern mit
 * 0,98), der Hub verwarf sie aber (Kreis unbekannt) und nahm als Bild das
 * letzte mit irgendeinem Fahrzeug – meist das wegfahrende Auto. Einzelbilder
 * lesen außerdem gern ein Zeichen falsch (ST-K statt GT-K). Darum zählt hier
 * die Mehrheit über den ganzen Burst.
 *
 * Schalten (Tor/Shelly) hängt NICHT an diesen Regeln, sondern weiter nur am
 * exakten Whitelist-Treffer pro Bild (plate-match.ts, plateMayActuate).
 */
import { normalizePlate, umlautReading } from "./plate-match.js";

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
  /** Kennzeichen in Anzeigeform (z. B. „GT-AB 4321“). */
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
  /**
   * Kreise mit Umlaut in der Schreibweise der OCR (UMLAUT_CITY_BY_PLAIN aus
   * plate-cities.ts): Eine Lesung „LUD-AB 123“ gilt dann als bekannter Kreis
   * und erscheint als „LÜD-AB 123“ (umlautReading). Fehlt die Angabe, zählen
   * nur Kreise aus `knownCity`.
   */
  umlautCity?: ReadonlyMap<string, string>;
  /** Einzelnes Bild reicht ab dieser Confidence (Standard 0,95). */
  singleFrameConf?: number;
  /**
   * Frühere Regel, nur zum Vergleich (consensusChange): Die längere Lesung
   * bekommt die Bilder der kürzeren immer, auch wenn sie selbst nur auf
   * einem Bild steht.
   */
  legacyCredit?: boolean;
}

const FORMAT = /^([A-Z]{1,3})-([A-Z]{1,2}) (\d{1,4})([EH]?)$/;

/** Kennzeichen in Anzeigeform: Kreis mit Umlaut, wenn die Lesung ihn ohne Umlaut zeigt (umlautCity). */
function shownPlate(plate: string, opts: ConsensusOptions): string {
  if (!opts.umlautCity) return plate;
  return umlautReading(plate, opts.knownCity, opts.umlautCity) ?? plate;
}

function readingOk(c: FrameCandidate, opts: ConsensusOptions): boolean {
  if (!Number.isFinite(c.confidence) || c.confidence < opts.minConf) return false;
  const m = c.plate.trim().toUpperCase().match(FORMAT);
  if (!m) return false;
  if (m[1].length < 2) return false;
  if (opts.knownCity.has(m[1])) return true;
  return !!opts.umlautCity && umlautReading(c.plate, opts.knownCity, opts.umlautCity) !== null;
}

function digitCount(plate: string): number {
  return plate.match(FORMAT)?.[3].length ?? 0;
}

/**
 * Mehrheit über alle Bilder: je Bild die beste gültige Lesung, gruppiert nach
 * normalisiertem Text. Abgeschnittene Lesungen („GT-AB 12“) zählen für die
 * längere („GT-AB 123“), wenn die längere selbst trägt: Sie steht auf
 * mindestens 2 Bildern oder auf mindestens so vielen wie die kürzere. Ein
 * einzelnes Bild mit einem Zeichen zu viel sammelt so nicht die Bilder der
 * richtigen Lesung ein. Das gilt auch für ein angehängtes E oder H
 * (Elektro-, Oldtimer-Kennzeichen): Auch dieses Zeichen muss selbst tragen.
 * Weicht das Ergebnis von der früheren Regel ab, zählt der Hub das
 * (consensusChange). Gewinnt die Gruppe mit den meisten Bildern, bei Gleichstand die höhere
 * Summe der Confidence.
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
    // Abgeschnittene Lesungen derselben Zeichenfolge zählen mit – nur für eine
    // längere Lesung, die selbst trägt (siehe oben).
    const extra = all.filter(
      (o) =>
        o !== g &&
        o.n.length < g.n.length &&
        g.n.startsWith(o.n) &&
        g.n.length - o.n.length <= 2 &&
        (opts.legacyCredit === true || g.hits.length >= 2 || g.hits.length >= o.hits.length)
    );
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

  return { plate: shownPlate(g.plate, opts), frames, confidence: top, bestIndex: middleOfBest(g.hits, top) };
}

/**
 * Weicht die Mehrheit von der früheren Regel ab (längere Lesung auf nur einem
 * Bild sammelt die kürzeren nicht mehr ein)? Liefert dann beide Kennzeichen
 * (null = keine Mehrheit), sonst null. Nur zum Mitzählen
 * (alpr.consensus_longer_single): So zeigt das Log, wie oft die Regel greift
 * und ob dabei eine richtige, nur einmal vollständig gelesene Ziffernfolge
 * verloren geht.
 */
export function consensusChange(
  reads: FrameRead[],
  opts: ConsensusOptions,
  now: BurstConsensus | null
): { now: string | null; before: string | null } | null {
  const before = burstConsensus(reads, { ...opts, legacyCredit: true });
  const a = now ? normalizePlate(now.plate) : null;
  const b = before ? normalizePlate(before.plate) : null;
  return a === b ? null : { now: now?.plate ?? null, before: before?.plate ?? null };
}

/** Unter den fast besten Bildern (≤ 0,02 darunter) das mittlere: Auto voll im Bild. */
function middleOfBest(hits: Array<{ index: number; conf: number }>, top: number): number {
  const near = hits.filter((h) => h.conf >= top - 0.02).map((h) => h.index).sort((a, b) => a - b);
  return near[Math.floor((near.length - 1) / 2)];
}

/** Ab dieser Sicherheit gilt eine Lesung als Schild-artig, auch ohne angenommenes Kennzeichen. */
export const PLATE_LIKE_CONF = 0.5;

/**
 * Zeigt ein Bild ein Kennzeichen? Ja bei einem angenommenen Kennzeichen oder
 * einer Schild-artigen Lesung – dieselbe Schwelle, mit der pickFallbackFrame
 * das Bild einer Sichtung ohne Kennzeichen wählt.
 */
export function frameShowsPlate(read: { plate?: string | null; candidates: FrameCandidate[] }): boolean {
  if (read.plate) return true;
  return read.candidates.some((c) => Number.isFinite(c.confidence) && c.confidence >= PLATE_LIKE_CONF);
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
    if (conf >= PLATE_LIKE_CONF && (!ocrBest || conf > ocrBest.conf)) ocrBest = { index: r.index, conf };
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
 *
 * Hat der exakte Listen-Treffer eines Bilds schon geschaltet (`actedAtIndex`),
 * stehen Kennzeichen und Bild fest: noch `afterActedFrames` Bilder (zweite
 * Chance fürs Foto), dann Schluss. Die Kennzeichen-Suche ist damit wieder
 * frei für das nächste Fahrzeug, und die Sichtung erreicht die Cloud früher.
 *
 * Im Licht-Burst (`minFrames`, HUB_VEHICLE_LIGHT_MIN_FRAMES) endet die
 * Aufnahme vor der Mindestzahl nur nach einer Schaltung, nicht schon mit
 * einem bestätigten Kennzeichen: Das Licht bleibt so lange an wie
 * entschieden (Entscheidung vom 25.11.2026).
 */
export function burstDone(reads: FrameRead[], framesTaken: number, opts: BurstDoneOptions): boolean {
  return burstDoneReason(reads, framesTaken, opts) !== null;
}

export type BurstDoneOptions = ConsensusOptions & {
  confirmFrames?: number;
  afterFrames?: number;
  /** Bild (Index), dessen exakter Listen-Treffer geschaltet hat; null = keins. */
  actedAtIndex?: number | null;
  afterActedFrames?: number;
  /** Mindestzahl der Bilder im Licht-Burst; vorher kein Ende mit „confirmed“ (0 = keine). */
  minFrames?: number;
};

/** Wie burstDone, mit Grund: „acted“ (Listen-Treffer hat geschaltet), „confirmed“ (Kennzeichen bestätigt). */
export function burstDoneReason(
  reads: FrameRead[],
  framesTaken: number,
  opts: BurstDoneOptions
): "acted" | "confirmed" | null {
  if (opts.actedAtIndex != null && opts.actedAtIndex >= 0) {
    const afterActed = Math.max(0, opts.afterActedFrames ?? 2);
    if (framesTaken - 1 - opts.actedAtIndex >= afterActed) return "acted";
  }
  if (framesTaken < (opts.minFrames ?? 0)) return null;
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
    if (k >= confirm) return framesTaken - 1 - r.index >= after ? "confirmed" : null;
  }
  return null;
}

/** Warum die Aufnahme eines Bursts endete (eine Zeile im Log, burstEndText). */
export type BurstEnd =
  /** Alarm aus und Nachlauf verbraucht. */
  | { why: "alarm" }
  /** Kennzeichen auf genug Bildern bestätigt. */
  | { why: "confirmed" }
  /** Der Listen-Treffer dieses Bilds hat geschaltet. */
  | { why: "acted"; actedAt: number }
  /** Ein Bild war nicht abrufbar. */
  | { why: "error"; detail: string }
  /** Höchstzahl der Bilder erreicht. */
  | { why: "max" };

/** Abschluss-Zeile des Bursts mit Bildzahl und Grund. */
export function burstEndText(end: BurstEnd, frames: number): string {
  switch (end.why) {
    case "alarm":
      return `VEHICLE ende nach ${frames} Frames`;
    case "confirmed":
      return `Kennzeichen sicher – fertig nach ${frames} Frames`;
    case "acted":
      return `geschaltet (Frame ${end.actedAt + 1}) – fertig nach ${frames} Frames`;
    case "error":
      return `Abbruch nach ${frames} Frames – Bild nicht abrufbar: ${end.detail}`;
    case "max":
      return `Höchstzahl erreicht – fertig nach ${frames} Frames`;
  }
}

/** Ein Schritt des Bursts: Was geschieht mit dem gerade geholten Bild? */
export type BurstStep =
  /** Bild behalten und lesen. */
  | { next: "take"; graceLeft: number }
  /**
   * Erstes Bild bei schon beendetem Alarm: erst auswerten. Zeigt es Kennzeichen
   * oder Fahrzeug, zählt es als erstes Bild des Nachlaufs (`graceLeft`), sonst
   * endet der Burst.
   */
  | { next: "check"; graceLeft: number }
  /** Nachlauf aufgebraucht: Burst endet, das Bild wird nicht mehr gebraucht. */
  | { next: "end" };

/**
 * Läuft der Burst mit diesem Bild weiter?
 *
 * - Solange die Kamera das Fahrzeug meldet: ja, der Nachlauf beginnt neu.
 * - Ohne Alarm noch `graceFrames` Bilder (der Alarm flackert, das Auto ist oft
 *   noch näher), dann Schluss.
 * - Ist der Alarm schon beim ersten Bild aus (Flackern, Burst kam spät), wird
 *   das bereits geholte Bild trotzdem gelesen und entscheidet: Kennzeichen
 *   oder Fahrzeug im Bild → weiter im Nachlauf, sonst Ende. Ein beleuchtetes
 *   Nachtbild geht so nie ungelesen verloren.
 * - `lightMinFrames` (HUB_VEHICLE_LIGHT_MIN_FRAMES, nur im Burst, für den
 *   der Hub das Weißlicht eingeschaltet hat): So viele erste Bilder werden
 *   unabhängig vom Alarm aufgenommen und gelesen. Der Nachlauf zählt dabei
 *   wie sonst weiter; danach läuft der Burst wie ohne Mindestzahl weiter
 *   oder endet. 0 = der Alarm entscheidet, genau wie ohne Licht.
 * Die Obergrenze des Bursts gilt unabhängig davon; vorzeitig endet ein
 * Licht-Burst vor der Mindestzahl nur nach einer Schaltung (burstDone).
 */
export function burstStep(s: {
  /** Schon behaltene Bilder vor diesem. */
  framesTaken: number;
  /** Die Kamera meldet das Fahrzeug bei diesem Bild. */
  alarm: boolean;
  /** Verbleibende Bilder ohne Alarm. */
  graceLeft: number;
  graceFrames: number;
  lightMinFrames?: number;
}): BurstStep {
  if (s.alarm) return { next: "take", graceLeft: s.graceFrames };
  const spent = Math.max(0, s.graceLeft - 1);
  if (s.framesTaken < (s.lightMinFrames ?? 0)) return { next: "take", graceLeft: spent };
  if (s.framesTaken === 0) return { next: "check", graceLeft: spent };
  if (s.graceLeft <= 0) return { next: "end" };
  return { next: "take", graceLeft: spent };
}

/**
 * Erstes Ergebnis ungleich null aus mehreren laufenden Prüfungen; null, wenn
 * alle null liefern. Sobald eine Prüfung etwas gefunden hat, wartet der
 * Aufrufer nicht mehr auf die langsamere (die Fahrzeug-Prüfung antwortet in
 * Millisekunden, die Kennzeichen-Suche braucht länger). Eine gescheiterte
 * Prüfung zählt als null.
 */
export function firstFound<T>(jobs: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let open = jobs.length;
    if (open === 0) resolve(null);
    const settle = (value: T | null): void => {
      if (value != null) resolve(value);
      else if (--open === 0) resolve(null);
    };
    for (const job of jobs) job.then(settle, () => settle(null));
  });
}

/**
 * Trägt nur ein einzelnes Bild das Kennzeichen der Sichtung – ohne Mehrheit
 * über den Burst, ohne Listen-Treffer und unter der Einzelbild-Schwelle der
 * Mehrheitsregel (0,95)? Die Sichtung bleibt, wie sie ist; der Hub zählt
 * diese Fälle (alpr.single_weak) als Grundlage für die Entscheidung, ob eine
 * solche Lesung künftig nur noch als Hinweis gilt.
 */
export function singleReadWeak(s: {
  /** Ein exakter Listen-Treffer hat in diesem Burst geschaltet. */
  acted: boolean;
  /** Die Mehrheitsregel hat ein Kennzeichen geliefert. */
  consensus: boolean;
  plate: string | null;
  /** Das Kennzeichen steht exakt auf der Fahrzeugliste. */
  listed: boolean;
  confidence: number;
  singleFrameConf?: number;
}): boolean {
  if (s.acted || s.consensus || !s.plate || s.listed) return false;
  return !(s.confidence >= (s.singleFrameConf ?? 0.95));
}

/** Grenze der Cloud für das Bild einer Sichtung (Route vehicle-sightings, darüber HTTP 413). */
export const SIGHTING_MAX_BYTES = 4 * 1024 * 1024;

/** Das Bild ist größer, als die Cloud für eine Sichtung annimmt. */
export function sightingImageTooLarge(bytes: number, maxBytes = SIGHTING_MAX_BYTES): boolean {
  return bytes > maxBytes;
}
