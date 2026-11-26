/**
 * Diagnose-Ereignisse des Halteverbots (ohne I/O, testbar): Was sich an den
 * Spuren eines Durchlaufs geändert hat, aus dem Zustand vor und nach
 * `track` (noparking-rules.ts). noparking.ts schreibt daraus je Wechsel eine
 * Zeile in improve.jsonl; ein Durchlauf ohne Wechsel schreibt keine.
 *
 *  - first_seen: neues Fahrzeug in der Fläche (mit Größe, Sicherheit, Fußpunkt)
 *  - miss / found: Aussetzer beginnt / endet (das Fahrzeug fehlte in einem Bild)
 *  - lost: Spur abgerissen (MAX_MISSES Aussetzer), mit Standzeit bis dahin
 *  - reacquired: abgerissene Spur wiedergefunden (dasselbe Fahrzeug, die
 *    Standzeit läuft weiter), mit der Lücke seit der letzten Sichtung;
 *    `tight`: nur die engere Wiedererkennung (SAME_SPOT_IOU) erkannte es
 *    nach längerer beobachteter Leere als dasselbe (ebenso bei found)
 *  - left: Spur zu lange beobachtet fort (sameVehicleGap), weggefahren mit
 *    Standzeit und beobachteter Lücke
 *  - reacquired_new: neues Fahrzeug an der Stelle eines weggefahrenen (nichts
 *    übernommen, eigene Standzeit), mit der Lücke seit dessen letzter
 *    Sichtung und den leeren Prüfungen dazwischen
 *
 * Ändert nichts am Zustand; die Regeln für Spur, Meldung und Takt bleiben in
 * noparking-rules.ts.
 */
import {
  SAME_VEHICLE_IOU,
  footPoint,
  overlap,
  type LostVehicle,
  type NoParkBox,
  type Standing,
  type TrackResult,
  type TrackState,
} from "./noparking-rules.js";

/** Ein Fahrzeug vor `track`: dasselbe Objekt und seine Werte (track ändert sie an Ort und Stelle). */
interface Before {
  ref: Standing;
  misses: number;
  emptyChecks: number;
  lastSeenAt: number;
  /** Schon weggefahren (LostVehicle.gone). */
  gone: boolean;
}

/** Zustand vor `track`. */
export interface TrackSnapshot {
  standing: Before[];
  lost: Before[];
}

export function snapshotTrack(state: TrackState): TrackSnapshot {
  const before = (ref: Standing, gone: boolean): Before => ({
    ref,
    misses: ref.misses,
    emptyChecks: ref.emptyChecks,
    lastSeenAt: ref.lastSeenAt,
    gone,
  });
  return {
    standing: state.standing.map((ref) => before(ref, false)),
    lost: state.lost.map((ref) => before(ref, ref.gone)),
  };
}

/** Box in Zahlen für die Diagnose: Fläche in % des Bilds, Sicherheit, Fußpunkt. */
export interface BoxInfo {
  areaPct: number;
  conf: number;
  footX: number;
  footY: number;
}

export function boxInfo(b: NoParkBox): BoxInfo {
  const foot = footPoint(b);
  const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return { areaPct: r(b.w * b.h * 100, 2), conf: r(b.conf, 2), footX: r(foot.x, 3), footY: r(foot.y, 3) };
}

export type TrackEventName = "first_seen" | "miss" | "found" | "lost" | "reacquired" | "left" | "reacquired_new";

export interface TrackEvent {
  event: TrackEventName;
  /**
   * Noch nicht gemeldet (Kandidat): Aussetzer zählen dann als Zeile, danach
   * nur als Zähler – ein gemeldetes Fahrzeug, das flackert, füllt sonst die
   * Datei.
   */
  candidate: boolean;
  /** Standzeit in Sekunden (letzte Sichtung minus erste). */
  seconds: number;
  /**
   * Lücke in Sekunden seit der letzten Sichtung (reacquired; reacquired_new:
   * des weggefahrenen Fahrzeugs; left: beobachtet, ohne Zeiten ohne Beobachtung).
   */
  gapSec?: number;
  /** Aussetzer in Folge (found: so viele Bilder fehlte das Fahrzeug; reacquired_new, left: leere Prüfungen). */
  missed?: number;
  /** reacquired_new: Das weggefahrene Fahrzeug war schon gemeldet. */
  replacedReported?: boolean;
  /** reacquired, found: nur über die engere Wiedererkennung (SAME_SPOT_IOU) als dasselbe erkannt. */
  tight?: true;
  box?: BoxInfo;
}

const sec = (ms: number) => Math.round(ms / 1000);
const standingSec = (s: Standing) => sec(s.lastSeenAt - s.firstSeenAt);

/** Bestes Fahrzeug an der Stelle von `box` (Überdeckung ab SAME_VEHICLE_IOU), -1 = keines. */
function bestAt(box: NoParkBox, list: Before[]): number {
  let best = -1;
  let bestScore = SAME_VEHICLE_IOU;
  for (let i = 0; i < list.length; i++) {
    const score = overlap(box, list[i].ref.box);
    if (score >= bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Was sich zwischen `before` (snapshotTrack vor track) und `after` (Zustand
 * nach track) geändert hat; `result` (Rückgabe von track) nennt die nur eng
 * wiedererkannten Fahrzeuge.
 */
export function trackEvents(before: TrackSnapshot, after: TrackState, now: number, result?: Pick<TrackResult, "tight">): TrackEvent[] {
  const out: TrackEvent[] = [];
  const tightIds = new Set(result?.tight ?? []);
  const tight = (s: Standing) => (tightIds.has(s.id) ? { tight: true as const } : {});
  const afterStanding = new Set(after.standing);
  const afterLost = new Map<Standing, LostVehicle>(after.lost.map((l) => [l, l]));
  const all = [...before.standing, ...before.lost];
  const beforeRefs = new Set(all.map((b) => b.ref));

  // Spuren, die stehen blieben: Aussetzer beginnt oder endet.
  for (const { ref, misses } of before.standing) {
    if (!afterStanding.has(ref)) continue;
    const candidate = ref.reportedAt === 0;
    if (misses === 0 && ref.misses > 0) out.push({ event: "miss", candidate, seconds: standingSec(ref) });
    else if (misses > 0 && ref.misses === 0) out.push({ event: "found", candidate, seconds: standingSec(ref), missed: misses, ...tight(ref) });
  }

  // Abgerissen: vorher stehend, jetzt unter den abgerissenen.
  for (const { ref } of before.standing) {
    if (afterLost.has(ref)) out.push({ event: "lost", candidate: ref.reportedAt === 0, seconds: standingSec(ref) });
  }

  // Weggefahren: vorher noch dasselbe Fahrzeug möglich, jetzt nicht mehr (oder vergessen).
  const replaceable: Before[] = [];
  for (const b of all) {
    if (afterStanding.has(b.ref)) continue;
    if (b.gone) {
      replaceable.push(b);
      continue;
    }
    const l = afterLost.get(b.ref);
    if (l && !l.gone) continue;
    out.push({
      event: "left",
      candidate: b.ref.reportedAt === 0,
      seconds: standingSec(b.ref),
      gapSec: sec(b.ref.missedMs),
      missed: b.ref.emptyChecks,
    });
    replaceable.push(b);
  }

  // Neue Spuren: wiedergefunden (vorher abgerissen, dasselbe Objekt), an der
  // Stelle eines weggefahrenen (reacquired_new) oder ganz neu (first_seen).
  for (const s of after.standing) {
    const was = before.lost.find((b) => b.ref === s);
    if (was) {
      out.push({
        event: "reacquired",
        candidate: s.reportedAt === 0,
        seconds: standingSec(s),
        gapSec: sec(now - was.lastSeenAt),
        ...tight(s),
        box: boxInfo(s.box),
      });
      continue;
    }
    if (beforeRefs.has(s)) continue;
    const at = bestAt(s.box, replaceable);
    if (at < 0) {
      out.push({ event: "first_seen", candidate: true, seconds: 0, box: boxInfo(s.box) });
      continue;
    }
    const old = replaceable.splice(at, 1)[0];
    out.push({
      event: "reacquired_new",
      candidate: true,
      seconds: 0,
      gapSec: sec(now - old.lastSeenAt),
      missed: old.emptyChecks,
      replacedReported: old.ref.reportedAt > 0,
      box: boxInfo(s.box),
    });
  }
  return out;
}
