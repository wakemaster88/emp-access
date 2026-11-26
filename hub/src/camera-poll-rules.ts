/**
 * Reine Regeln der Kamera-Abfrage (ohne I/O, testbar): welche Bild-Pipeline
 * eine neue Alarm-Flanke startet, wie lange ein Ereignis nachlaeuft, was nach
 * einer gescheiterten Meldung an die Cloud nachgereicht wird.
 */
import type { JpegSettings } from "./image-rules.js";

export type SnapshotJob = "person" | "vehicle" | "auto" | null;

export interface SnapshotGate {
  /** Personen-/Fahrzeug-Pipeline laeuft gerade. */
  inFlight: boolean;
  now: number;
  /** Letztes Bild einer Erkennungs-Pipeline (Person, Fahrzeug). */
  lastPipelineAt: number;
  /** Letztes reines Anzeige-Bild (Bewegung, Tier, Abruf aus der Cloud). */
  lastAutoAt: number;
  throttleMs: number;
  /**
   * Reine Bewegung (MOTION, ANIMAL): Mindestabstand ihrer Vorschaubilder
   * (HUB_MOTION_SNAPSHOT_MIN_S, motionSnapshotMinMs). Fehlt er oder ist er 0,
   * gilt `throttleMs` wie fuer alle anderen Anzeige-Bilder.
   */
  minMotionMs?: number;
  /** Diese Kamera hat seit dem Start des Hubs schon ein Anzeige-Bild in die Cloud gebracht. */
  autoSent?: boolean;
  /**
   * An der Kamera ist gerade eine Person oder ein Fahrzeug aktiv
   * (personOrVehicleActive). Eine Flanke von Bewegung oder Tier ist dann
   * keine reine Bewegung: Ihr Bild gehoert zur Person bzw. zum Fahrzeug.
   */
  othersActive?: boolean;
}

/**
 * Was eine neue Flanke ausloest.
 *
 * - VEHICLE startet immer (Kennzeichen nie durch eine Drossel verlieren).
 * - PERSON wartet nur auf die Erkennungs-Pipelines. Ein Anzeige-Bild zaehlt
 *   nicht: Die Kamera meldet Bewegung meist ein, zwei Sekunden vor der Person,
 *   und das Anzeige-Bild dieser Bewegung sperrte vorher 30 s lang die
 *   Gesichtserkennung (Hub-Log 22.–24.11.2026: 127 von 843 Personen-
 *   Ereignissen, an Innenkameras rund jedes dritte).
 * - Alles andere holt nie direkt nach einem Bild einer Erkennungs-Pipeline
 *   ein Anzeige-Bild; wie oft sonst, entscheidet autoSnapshotDue.
 */
export function snapshotJobFor(type: string, g: SnapshotGate): SnapshotJob {
  if (type === "VEHICLE") return "vehicle";
  if (g.inFlight) return null;
  if (g.now - g.lastPipelineAt <= g.throttleMs) return null;
  if (type === "PERSON") return "person";
  const due = autoSnapshotDue({
    type,
    now: g.now,
    lastSnapshotAt: g.lastAutoAt,
    inFlight: g.inFlight,
    throttleMs: g.throttleMs,
    minMotionMs: g.minMotionMs ?? 0,
    sent: g.autoSent ?? false,
    othersActive: g.othersActive ?? false,
  });
  return due ? "auto" : null;
}

/**
 * Reine Bewegung: Die Flanke holt nur ein Vorschaubild fuer die Kachel in
 * der Cloud. Person, Fahrzeug und Klingel haben eigene Pipelines. Bewegung
 * oder Tier, waehrend an derselben Kamera eine Person oder ein Fahrzeug
 * aktiv ist (`othersActive`), ist keine reine Bewegung: Das Bild zeigt die
 * Person oder das Fahrzeug und bleibt, wie es vor dem 25.11.2026 war.
 */
export function isPureMotion(type: string, othersActive = false): boolean {
  return (type === "MOTION" || type === "ANIMAL") && !othersActive;
}

/** Arten mit eigener Erkennungs-Pipeline, deren Bilder unveraendert bleiben. */
const PIPELINE_TYPES = ["PERSON", "VEHICLE"] as const;

/**
 * Ist an der Kamera gerade eine Person oder ein Fahrzeug aktiv? `states`:
 * Zustand dieser Abfrage; eine Art, die sie nicht gemessen hat, behaelt den
 * bisherigen (`prev`). `open`: entprellte Ereignisse, die noch laufen (auch
 * im Nachlauf, wenn der Alarm der Kamera gerade aus ist).
 */
export function personOrVehicleActive(
  states: Record<string, boolean>,
  prev: Record<string, boolean>,
  open: Record<string, boolean>
): boolean {
  return PIPELINE_TYPES.some((t) => (states[t] ?? prev[t]) === true || open[t] === true);
}

/** Was die neuen Flanken einer Abfrage ausloesen. */
export interface SnapshotPlan {
  vehicle: boolean;
  person: boolean;
  /** Groesse und Qualitaet des Anzeige-Bilds; null = keins. */
  auto: JpegSettings | null;
  /** Eine Flanke reiner Bewegung, deren Bild allein der Mindestabstand zurueckhaelt (Zaehler camera.preview_skip). */
  held: boolean;
}

/**
 * Bild-Pipelines der neuen Flanken einer Abfrage (`edges`: Arten, die in
 * dieser Abfrage aktiv wurden), je Flanke nach snapshotJobFor. Das
 * Anzeige-Bild bekommt das Vorschaubild (`preview`) nur, wenn jede Flanke,
 * die es ausloest, reine Bewegung ist; sonst das bisherige Anzeige-Bild
 * (`display`).
 */
export function snapshotPlan(
  edges: string[],
  g: SnapshotGate,
  preview: JpegSettings,
  display: JpegSettings
): SnapshotPlan {
  const plan: SnapshotPlan = { vehicle: false, person: false, auto: null, held: false };
  let wantAuto = false;
  let pure = true;
  for (const type of edges) {
    const job = snapshotJobFor(type, g);
    if (job === "vehicle") plan.vehicle = true;
    else if (job === "person") plan.person = true;
    else if (job === "auto") {
      wantAuto = true;
      if (!isPureMotion(type, g.othersActive)) pure = false;
    } else if (autoSnapshotHeld(type, g)) plan.held = true;
  }
  if (wantAuto) plan.auto = pure ? preview : display;
  return plan;
}

export interface AutoSnapshotGate {
  type: string;
  now: number;
  /** Letztes Anzeige-Bild dieser Kamera (Bewegung, Tier, Abruf aus der Cloud); 0 = keins seit dem Start. */
  lastSnapshotAt: number;
  /** Personen-/Fahrzeug-Pipeline laeuft gerade. */
  inFlight: boolean;
  /** Abstand der Anzeige-Bilder aller anderen Arten (30 s). */
  throttleMs: number;
  /** Abstand der Vorschaubilder reiner Bewegung; 0 = throttleMs. */
  minMotionMs: number;
  /** Seit dem Start des Hubs ist schon ein Anzeige-Bild dieser Kamera in der Cloud angekommen. */
  sent: boolean;
  /** Person oder Fahrzeug an der Kamera aktiv (personOrVehicleActive): keine reine Bewegung. */
  othersActive?: boolean;
}

/**
 * Ist ein Anzeige-Bild faellig?
 *
 * Reine Bewegung (MOTION, ANIMAL) holt hoechstens alle `minMotionMs` ein
 * Vorschaubild (Entscheidung des Betreibers vom 25.11.2026: hoechstens alle
 * 5 Minuten). Fast jede Bewegung schrieb vorher ein neues Bild in die
 * Datenbank, rund 1.600 bis 2.700 am Tag; die Kachel in der Cloud ist damit
 * bis zu 5 Minuten alt.
 *
 * Solange seit dem Start des Hubs noch kein Bild dieser Kamera angekommen
 * ist (`sent`), gilt der kurze Abstand `throttleMs`: Die Kachel bekommt ihr
 * erstes Bild ohne Wartezeit, und ein gescheiterter Upload wird nach 30 s
 * wiederholt statt nach 5 Minuten. Die Kachel liest Camera.snapshot; das
 * loescht niemand, ein fehlendes Bild in der Cloud heisst also, dass der Hub
 * seit dem Start noch keins geschickt hat.
 *
 * Alle anderen Arten behalten `throttleMs`, ebenso Bewegung und Tier,
 * waehrend eine Person oder ein Fahrzeug aktiv ist (`othersActive`).
 */
export function autoSnapshotDue(g: AutoSnapshotGate): boolean {
  if (g.inFlight) return false;
  const gap = isPureMotion(g.type, g.othersActive) && g.sent ? Math.max(g.throttleMs, g.minMotionMs) : g.throttleMs;
  return g.now - g.lastSnapshotAt > gap;
}

/**
 * Haelt allein der Mindestabstand fuer reine Bewegung dieses Bild zurueck?
 * (Mit dem bisherigen Abstand waere es hochgeladen worden; Zaehler
 * camera.preview_skip.)
 */
export function autoSnapshotHeld(type: string, g: SnapshotGate): boolean {
  if (!isPureMotion(type, g.othersActive) || snapshotJobFor(type, g) !== null) return false;
  return snapshotJobFor(type, { ...g, minMotionMs: 0 }) === "auto";
}

/** Standard-Abstand der Vorschaubilder reiner Bewegung (HUB_MOTION_SNAPSHOT_MIN_S). */
export const MOTION_SNAPSHOT_MIN_S_DEFAULT = 300;
const MOTION_SNAPSHOT_MIN_S_LIMIT = 3_600;

/**
 * HUB_MOTION_SNAPSHOT_MIN_S in Millisekunden: ganze Sekunden von 0 bis 3600;
 * 0 = Abstand wie bei allen anderen Anzeige-Bildern (30 s, wie vor dem
 * 25.11.2026). Leer, keine ganze Zahl oder ausserhalb = Standard 300 s.
 */
export function motionSnapshotMinMs(raw: string | undefined): number {
  const t = (raw ?? "").trim();
  if (!/^\d+$/.test(t)) return MOTION_SNAPSHOT_MIN_S_DEFAULT * 1000;
  const s = Number(t);
  return s <= MOTION_SNAPSHOT_MIN_S_LIMIT ? s * 1000 : MOTION_SNAPSHOT_MIN_S_DEFAULT * 1000;
}

/**
 * Zustand einer KI-Art in einer Messung: aktiv, nicht aktiv oder null (die
 * Kamera kennt die Art nicht; der bisherige Stand bleibt).
 *
 * Ist die Fahrzeug-Erkennung der Kamera abgeschaltet, gilt VEHICLE als nicht
 * aktiv und nicht als ungemessen: Ein Fahrzeug-Ereignis, das beim Abschalten
 * gerade lief, endet dann nach dem Nachlauf. Ungemessen bliebe es bis zum
 * naechsten Hub-Start als laufend stehen.
 */
export function aiAlarmState(
  type: string,
  entry: { alarm_state?: number; support?: number } | undefined,
  vehicleDetection: boolean
): boolean | null {
  if (type === "VEHICLE" && !vehicleDetection) return false;
  return entry?.support === 1 ? entry.alarm_state === 1 : null;
}

/**
 * Vorrang des Kennzeichens vor der Gesichtserkennung an derselben Kamera.
 *
 * Die Personen-Pipeline haelt die Kamera fuer ihren ganzen Lauf (Vorlauf,
 * bis zu vier Versuche, weitere Bilder, Zoom, Upload: 8 bis 12 s und mehr).
 * Ein Fahrzeug, das in dieser Zeit kommt, wartete bisher bis zum Ende, und
 * war sein Alarm dann aus, gab es kein Kennzeichen und das Tor blieb zu.
 * Jetzt braucht die Pipeline die Kamera nur noch waehrend eines Bildes oder
 * des optischen Zooms (`use`). Dazwischen gibt sie sie ab, sobald ein
 * Fahrzeug wartet (`check`, vom Aufrufer im Takt gerufen), und arbeitet mit
 * dem weiter, was sie schon hat.
 */
export class CameraLease {
  private holding = true;
  private busy = false;

  constructor(
    private readonly vehicleWaiting: () => boolean,
    /** Kamera freigeben (genau einmal je Lauf). */
    private readonly onRelease: () => void
  ) {}

  /** Zwischen zwei Zugriffen: abgeben, wenn ein Fahrzeug wartet. */
  check(): void {
    if (this.holding && !this.busy && this.vehicleWaiting()) this.release();
  }

  /** Hat die Pipeline die Kamera nicht mehr (ein Fahrzeug wartet oder hat sie)? */
  lost(): boolean {
    this.check();
    return !this.holding;
  }

  /**
   * Bild oder Zoom. Solange `op` laeuft, wartet ein Fahrzeug; direkt danach
   * bekommt es die Kamera. Ohne Kamera laeuft `op` nicht: null.
   */
  async use<T>(op: () => Promise<T>): Promise<T | null> {
    if (this.lost()) return null;
    this.busy = true;
    try {
      return await op();
    } finally {
      this.busy = false;
      this.check();
    }
  }

  /** Ende des Laufs (oder vorzeitig): Kamera abgeben. Mehrfach aufrufbar. */
  release(): void {
    if (!this.holding) return;
    this.holding = false;
    this.onRelease();
  }
}

/**
 * Nachlauf je Ereignisart. Die reine Bewegungsmeldung der Kamera (Pixel-
 * Aenderung: Wellen, Baeume, Regen, Insekten vor dem Infrarot) flackert weit
 * staerker als die KI-Alarme. Mit 6 s Nachlauf wurden daraus rund 2.400
 * Ereignisse am Tag; bei 60 s verschmelzen etwa drei Viertel davon. Das Ende
 * traegt weiter den Zeitpunkt der letzten Bewegung, die Dauer bleibt richtig.
 */
export function endHoldFor(type: string, holdMs: number, motionHoldMs: number): number {
  return type === "MOTION" ? Math.max(holdMs, motionHoldMs) : holdMs;
}

/**
 * Was der Hub aus einer gescheiterten Meldung an die Cloud spaeter noch
 * einmal sendet: jedes Ende, nie einen Beginn.
 *
 * Ohne sein Ende bliebe ein Ereignis in der Cloud offen und gaelte als
 * laufend. Ein Ende zu wiederholen schadet nie: Die Cloud schliesst damit
 * nur ein Ereignis, das vor diesem Ende begann, und findet sie keines,
 * geschieht nichts. Der Hub muss dafuer nicht wissen, ob der Beginn ankam.
 * Das weiss er auch nicht sicher: Laeuft eine Meldung ins Zeitlimit, kann die
 * Cloud sie trotzdem verarbeitet haben.
 *
 * Ein Beginn wird nie nachgemeldet: Er loest in der Cloud Regeln aus, und die
 * sollen nicht Minuten spaeter feuern. Laeuft ein solches Ereignis weiter,
 * traegt die Cloud es ueber die Liste der laufenden Ereignisse nach.
 */
export function endsToRetry<T extends { phase: string }>(events: T[]): T[] {
  return events.filter((e) => e.phase === "end");
}

/** Was die Regeln der Warteschlange von einer Meldung wissen muessen. */
export interface QueuedEvent {
  cameraId: number;
  type: string;
  phase: string;
  /** Zeitpunkt des Ereignisses (ISO, Uhr des Hubs). */
  at: string;
}

/**
 * So alt darf ein Beginn hoechstens sein, wenn er an die Cloud geht. Er loest
 * dort Regeln aus (Licht, Durchsage, Push), und die gehoeren zum Augenblick:
 * Ein Beginn, der wegen einer Stoerung laenger in der Warteschlange stand,
 * entfaellt. 30 s reichen fuer einen zweiten Versuch nach einer einzelnen
 * gescheiterten Meldung (Zeitlimit 15 s, neuer Versuch nach 10 s).
 */
export const START_MAX_AGE_MS = 30_000;

export interface OutboxTidy<T> {
  queue: T[];
  /** Beginne, die zu alt wurden. */
  staleStarts: number;
  /** Enden, deren Beginn dabei entfiel (die Cloud kennt das Ereignis nicht). */
  staleEnds: number;
  /** Wegen der Obergrenze verworfen. */
  cutStarts: number;
  cutEnds: number;
}

const queueKey = (e: { cameraId: number; type: string }): string => `${e.cameraId}:${e.type}`;

/**
 * Beginne, bei denen der Hub nicht weiss, ob die Cloud sie kennt: Sie standen
 * in einer Meldung, die er als gescheitert wertet, als Beginn oder in der
 * Liste der laufenden Ereignisse. Die Cloud kann eine solche Meldung trotzdem
 * verarbeitet haben (Zeitlimit) und fuehrt das Ereignis dann als offen. Den
 * Beginn sendet der Hub nicht noch einmal, sein Ende muss aber ankommen.
 *
 * Gemerkt wird jeder solche Beginn, nicht nur der juengste je Kamera und Art:
 * Welche der gescheiterten Meldungen die Cloud verarbeitet hat, weiss der Hub
 * nicht, offen sein kann dort also das Ereignis zu jedem von ihnen. Erledigt
 * ist ein Beginn, sobald ein Ende ab seinem Zeitpunkt angekommen ist.
 */
export class UnconfirmedStarts {
  /** Je Kamera und Art die Zeitpunkte (ms), aufsteigend. */
  private readonly times = new Map<string, number[]>();

  /** Meldung gescheitert: ihre Beginne und was sie als laufend nannte. */
  failed(events: QueuedEvent[], running: Array<Omit<QueuedEvent, "phase">> = []): void {
    for (const e of [...events.filter((e) => e.phase === "start"), ...running]) {
      const at = Date.parse(e.at);
      const list = this.times.get(queueKey(e)) ?? [];
      if (Number.isNaN(at) || list.includes(at)) continue;
      this.times.set(queueKey(e), [...list, at].sort((a, b) => a - b));
    }
  }

  /** Meldung angekommen: Jedes Ende erledigt die Beginne bis zu seinem Zeitpunkt. */
  delivered(events: QueuedEvent[]): void {
    for (const e of events) {
      const list = this.times.get(queueKey(e));
      const at = Date.parse(e.at);
      if (e.phase !== "end" || !list || Number.isNaN(at)) continue;
      const later = list.filter((t) => t > at);
      if (later.length > 0) this.times.set(queueKey(e), later);
      else this.times.delete(queueKey(e));
    }
  }

  /** Wie viele gemerkte Beginne dieser Kamera und Art liegen nicht nach `e`? */
  upTo(e: QueuedEvent): number {
    const at = Date.parse(e.at);
    return (this.times.get(queueKey(e)) ?? []).filter((t) => t <= at).length;
  }
}

/**
 * Warteschlange der Meldungen an die Cloud aufraeumen, vor jeder Meldung und
 * nach jedem Einreihen. Die Reihenfolge bleibt erhalten.
 *
 * 1. Beginne, die aelter als `maxStartAgeMs` sind, entfallen (siehe
 *    START_MAX_AGE_MS). Steht das Ende desselben Ereignisses schon dahinter,
 *    entfaellt es mit: Der Beginn ging nie hinaus, die Cloud kennt das
 *    Ereignis also nicht. Laeuft es noch, traegt die Cloud es ueber die Liste
 *    der laufenden Ereignisse nach, ohne Regeln. Das Alter messen zwei Uhren,
 *    und es reicht, dass eine die Grenze ueberschritten sieht: die Wanduhr
 *    (`now` gegen die Zeit des Ereignisses) und die Wartezeit in der
 *    Warteschlange (`waitedMs`). Wird die Uhr des Hubs zurueckgestellt, gaelte
 *    ein alter Beginn nach der Wanduhr allein wieder als frisch. Die Wartezeit
 *    allein reicht auch nicht: Je nach System zaehlt ihre Uhr nicht weiter,
 *    waehrend der Rechner ruht.
 * 2. Sind es danach mehr als `maxLength`, fallen zuerst Enden weg, die
 *    hoechstwahrscheinlich nichts schliessen: Je Kamera und Art fuehrt die
 *    Cloud hoechstens ein offenes Ereignis. Das erste Ende in der
 *    Warteschlange schliesst es, ebenso das Ende hinter einem Beginn, der
 *    selbst noch wartet, und das Ende zu einem Beginn aus einer gescheiterten
 *    Meldung (`unconfirmed`): Den kann die Cloud verarbeitet haben, auch wenn
 *    ein aelteres Ende derselben Kamera und Art davor steht. Diese bleiben;
 *    von den uebrigen gehen die aeltesten. Erst danach fallen Beginne weg.
 *    Allein wegen `unconfirmed` bleiben hoechstens `unconfirmedMax` Enden
 *    stehen, die aeltesten: Was stehen bleibt, geht mit jeder Meldung wieder
 *    hinaus. Verarbeitet die Cloud Meldungen, die der Hub als gescheitert
 *    wertet, muessen alte Enden weichen, damit juengere an die Reihe kommen.
 */
export function tidyOutbox<T extends QueuedEvent>(
  queue: T[],
  now: number,
  maxStartAgeMs: number,
  maxLength: number,
  opts: {
    unconfirmed?: UnconfirmedStarts;
    /** So viele Enden bleiben hoechstens allein wegen `unconfirmed` stehen (siehe 2.); ohne Angabe alle. */
    unconfirmedMax?: number;
    /** So lange steht ein Eintrag schon in der Warteschlange (ms), gemessen mit einer Uhr, die niemand stellt. */
    waitedMs?: (e: T) => number;
  } = {}
): OutboxTidy<T> {
  const out: OutboxTidy<T> = { queue: [], staleStarts: 0, staleEnds: 0, cutStarts: 0, cutEnds: 0 };

  /** Kamera und Art, deren veralteter Beginn gerade entfiel: Das naechste Ende gehoert dazu. */
  const endOfStale = new Set<string>();
  for (const e of queue) {
    const key = queueKey(e);
    if (e.phase === "start") {
      if (now - Date.parse(e.at) > maxStartAgeMs || (opts.waitedMs?.(e) ?? 0) > maxStartAgeMs) {
        out.staleStarts++;
        endOfStale.add(key);
        continue;
      }
      endOfStale.delete(key);
    } else if (e.phase === "end" && endOfStale.delete(key)) {
      out.staleEnds++;
      continue;
    }
    out.queue.push(e);
  }

  let over = out.queue.length - maxLength;
  if (over <= 0) return out;

  // Enden, die sicher gebraucht werden: das erste je Kamera und Art, das Ende
  // hinter einem wartenden Beginn und zu jedem Beginn aus einer gescheiterten
  // Meldung das erste Ende ab dessen Zeitpunkt (davon hoechstens `unconfirmedMax`).
  const needed = new Set<number>();
  const expectsEnd = new Map<string, boolean>();
  /** Je Kamera und Art: So viele Beginne aus gescheiterten Meldungen haben ihr Ende schon gefunden. */
  const matched = new Map<string, number>();
  /** So viele Enden bleiben allein wegen eines solchen Beginns stehen. */
  let held = 0;
  out.queue.forEach((e, i) => {
    const key = queueKey(e);
    if (e.phase === "start") {
      expectsEnd.set(key, true);
    } else if (e.phase === "end") {
      if (expectsEnd.get(key) ?? true) needed.add(i);
      expectsEnd.set(key, false);
      const upTo = opts.unconfirmed?.upTo(e) ?? 0;
      if (upTo > (matched.get(key) ?? 0)) {
        matched.set(key, upTo);
        if (!needed.has(i) && held < (opts.unconfirmedMax ?? Infinity)) {
          needed.add(i);
          held++;
        }
      }
    }
  });
  const drop = new Set<number>();
  const passes: Array<(e: T, i: number) => boolean> = [
    (e, i) => e.phase === "end" && !needed.has(i),
    (e) => e.phase === "start",
    () => true,
  ];
  for (const fits of passes) {
    for (let i = 0; i < out.queue.length && over > 0; i++) {
      const e = out.queue[i];
      if (drop.has(i) || !fits(e, i)) continue;
      drop.add(i);
      over--;
      if (e.phase === "start") out.cutStarts++;
      else out.cutEnds++;
    }
  }
  out.queue = out.queue.filter((_, i) => !drop.has(i));
  return out;
}

/**
 * Liste der laufenden Ereignisse fuer die Cloud (geht einmal je Minute mit).
 * Die Cloud traegt anhand der Liste nach, was ihr fehlt. Das stimmt nur, wenn
 * die Liste genau der Stand nach den Ereignissen der Meldung ist, mit der sie
 * ankommt. Deshalb wird sie beim Einreihen festgehalten (`capture`: in dem
 * Moment decken sich Entprellung und Warteschlange) und nur mit der Meldung
 * gesendet, die die Warteschlange leert, ohne dass seither Neues dazukam
 * (`take`). Sonst entfaellt sie bis zur naechsten Minute.
 */
export class RunningReport<T> {
  private version = 0;
  private snap: { list: T[]; version: number } | null = null;

  /** Neue Ereignisse stehen in der Warteschlange. */
  enqueued(): void {
    this.version++;
  }

  /** Stand festhalten, direkt nach dem Einreihen. */
  capture(list: T[]): void {
    this.snap = { list, version: this.version };
  }

  /** Liste fuer die Meldung, die gerade aus der Warteschlange genommen wurde; null = nicht mitsenden. */
  take(outboxEmpty: boolean): T[] | null {
    const s = this.snap;
    if (!s || !outboxEmpty || s.version !== this.version) return null;
    this.snap = null;
    return s.list;
  }
}

/**
 * Beginne, zu denen der Hub gerade Bewegungs-Regeln selbst schaltet (rules.ts,
 * `onCameraEvent`): Ihre Meldung an die Cloud wartet, bis feststeht, welche
 * gelangen (`hubRules` am Ereignis), damit die Cloud genau diese auslaesst.
 * Kein Ereignis darf mit offenem Gate hinausgehen.
 *
 * `take` nimmt vom Kopf der Warteschlange hoechstens `max` Ereignisse, aber
 * nur bis vor das erste mit offenem Gate; steht ein solches vorn, wartet es
 * darauf und schaut neu. Die Entscheidung faellt ohne Pause zwischen Pruefen
 * und Entnehmen: Was waehrend des Wartens eingereiht wird, auch mit eigenem
 * Gate, geht erst hinaus, wenn dessen Gate zu ist. Die Reihenfolge bleibt,
 * und ein Strom neuer Ereignisse haelt die vorderen nicht auf.
 */
export class EventGates<T extends object> {
  private readonly open = new Map<T, Promise<void>>();

  /** Gate setzen; es schliesst, sobald `done` endet, auch bei einem Fehler. */
  set(e: T, done: Promise<unknown>): void {
    const gate: Promise<void> = done
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.open.get(e) === gate) this.open.delete(e);
      });
    this.open.set(e, gate);
  }

  isOpen(e: T): boolean {
    return this.open.has(e);
  }

  /** Naechstes Stueck fuer die Cloud, aus `queue` entnommen; leer, wenn `queue` leer ist. */
  async take(queue: T[], max: number): Promise<T[]> {
    for (;;) {
      const head = queue.length > 0 ? this.open.get(queue[0]) : undefined;
      if (head) {
        await head;
        continue;
      }
      let n = 0;
      while (n < Math.min(max, queue.length) && !this.open.has(queue[n])) n++;
      return queue.splice(0, n);
    }
  }
}

/**
 * Uhren-Abweichungen fuer den Vergleich grob runden: Die Sekunden wandern
 * von Abfrage zu Abfrage, die Aussage („geht 9 Stunden nach“) bleibt gleich.
 */
export function clockDriftKey(offsets: Array<{ name: string; offsetS: number; ntp: boolean | null }>): string {
  return offsets
    .map((o) => {
      const abs = Math.abs(o.offsetS);
      const step = abs >= 3600 ? 3600 : abs >= 300 ? 300 : 60;
      return `${o.name}:${Math.sign(o.offsetS) * Math.round(abs / step) * step}:${o.ntp === false ? "x" : ""}`;
    })
    .sort()
    .join("|");
}

/** Kamera-Liste aus der Cloud nachladen: gar nicht, im Hintergrund oder mit Warten. */
export type ConfigRefresh = "none" | "background" | "wait";

export interface ConfigRefreshState {
  now: number;
  /** Letzter erfolgreicher Abruf (0 = noch keiner oder als veraltet markiert). */
  loadedAt: number;
  /** Letzter gescheiterter Abruf (0 = keiner seit dem letzten Erfolg). */
  failedAt: number;
  /** Ein Abruf laeuft schon. */
  running: boolean;
  /** Der Hub kennt schon Kameras. */
  haveCameras: boolean;
  refreshMs: number;
  retryMs: number;
}

/**
 * Faellt die Cloud aus, fragt der Hub die bekannten Kameras weiter ab. Vorher
 * stand vor jeder Abfrage-Runde der Abruf der Kamera-Liste, und scheiterte
 * der, entfiel die Runde: Nach 60 s ohne Cloud sah der Hub keine Person und
 * kein Fahrzeug mehr, obwohl Fahrzeugliste, Gesichter und Tor lokal vorliegen.
 * Gewartet wird nur noch, solange der Hub noch gar keine Kamera kennt.
 */
export function configRefreshPlan(s: ConfigRefreshState): ConfigRefresh {
  if (s.loadedAt > 0 && s.now - s.loadedAt <= s.refreshMs) return "none";
  if (s.running) return s.haveCameras ? "none" : "wait";
  if (s.failedAt > 0 && s.now - s.failedAt < s.retryMs) return "none";
  return s.haveCameras ? "background" : "wait";
}

/**
 * Lange Fehlversuche in Folge (`slowMs`). Eine Abfrage, die bis ins Zeitlimit
 * haengt, belegt so lange einen Platz. Eine, die sofort scheitert (HTTP-Fehler,
 * Verbindung abgewiesen), kostet nichts und kommt meist von einer Kamera, die
 * gerade hochfaehrt: Sie zaehlt hier nicht. Der Wert bestimmt nur die
 * Reihenfolge im Takt (`pollOrder`), nie den Abstand der Abfragen.
 */
export function failStreakAfter(failStreak: number, tookMs: number, slowMs: number): number {
  return tookMs >= slowMs ? failStreak + 1 : 0;
}

export interface PollGate {
  now: number;
  /** Beginn der letzten Abfrage dieser Kamera (0 = noch keine). */
  lastStartAt: number;
  /** Die letzte Abfrage ist noch unterwegs oder wartet auf einen Platz. */
  inFlight: boolean;
  baseMs: number;
}

/**
 * Ob eine Kamera in diesem Takt abgefragt wird. Jede Kamera laeuft fuer sich:
 * Eine, die haengt, wird uebersprungen, bis ihre Antwort (oder das Zeitlimit)
 * da ist, und haelt weder die anderen Kameras noch deren Bild-Pipelines auf.
 * Danach ist sie im naechsten Takt wieder dabei, auch nach Stunden ohne
 * Antwort. Einen festen groesseren Abstand gibt es nicht: Er sparte kaum
 * einen Platz (die haengende Abfrage belegt ihn ohnehin bis zum Zeitlimit von
 * 8 s), verzoegerte aber die erste Abfrage nach der Rueckkehr der Kamera, und
 * dann kann schon ein Fahrzeug vor dem Tor stehen.
 */
export function pollDue(g: PollGate): boolean {
  if (g.inFlight) return false;
  if (g.lastStartAt === 0) return true;
  // Halber Takt Toleranz: Der Timer selbst schwankt um einige Millisekunden.
  return g.now - g.lastStartAt >= g.baseMs / 2;
}

/**
 * Reihenfolge, in der die faelligen Kameras eines Takts an die Reihe kommen:
 * zuerst die ohne langen Fehlversuch. Die Plaetze sind begrenzt, und eine
 * haengende Abfrage haelt ihren bis zu 8 s. Die Kameras, die antworten, sind
 * in Millisekunden durch und sollen nicht dahinter warten. Dieselben Kameras,
 * nur umsortiert; innerhalb beider Gruppen bleibt die Reihenfolge.
 */
export function pollOrder<T extends { failStreak: number }>(due: T[]): T[] {
  return [...due.filter((c) => c.failStreak === 0), ...due.filter((c) => c.failStreak > 0)];
}

/**
 * Abstand der Suche nach einer nicht erreichbaren Kamera unter neuer Adresse.
 * Ein Adresswechsel (DHCP, anderes VLAN) zeigt sich in den ersten Minuten;
 * eine defekte Kamera wird danach nur noch selten gesucht.
 */
export function relocateIntervalMs(downForMs: number): number {
  if (downForMs < 10 * 60_000) return 60_000;
  if (downForMs < 60 * 60_000) return 5 * 60_000;
  return 15 * 60_000;
}

/**
 * Die Suche per Anmeldung bei anderen Geraeten im Netz (geroutetes VLAN ohne
 * ARP) nur in der ersten Stunde eines Ausfalls: Ein Adresswechsel zeigt sich
 * bis dahin, danach waeren es nur noch Anmeldeversuche bei Nachbargeraeten.
 */
export function relocateByLoginAllowed(downForMs: number): boolean {
  return downForMs < 60 * 60_000;
}

/**
 * Stand der Adresssuche beim Anlegen einer Kamera. `downSince` ist ihr
 * gemerkter Ausfallbeginn aus der Zeit vor dem Neustart des Hubs (null: sie
 * antwortete zuletzt, oder sie ist neu in der Liste). Der Hub startet
 * mehrmals am Tag neu (Update): Stand die Kamera schon aus, zaehlen die
 * Stufen ab dem gemerkten Beginn weiter. Die naechste Suche kommt am naechsten
 * Punkt eines Rasters, das vom Ausfallbeginn an im Abstand der Stufe laeuft.
 * Das Raster haengt nicht am Start des Hubs: Bis zur naechsten Suche vergeht
 * hoechstens ein Abstand der Stufe, und mehrere Neustarts hintereinander
 * fuehren weder zu einer Pause noch zu einer Suche je Start.
 */
export function relocateAtStart(
  downSince: number | null,
  now: number
): { downSince: number | null; lastRelocateAt: number } {
  if (downSince === null) return { downSince: null, lastRelocateAt: 0 };
  const since = Math.min(downSince, now);
  const downFor = now - since;
  return { downSince: since, lastRelocateAt: now - (downFor % relocateIntervalMs(downFor)) };
}
