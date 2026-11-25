/**
 * Reine Regeln der Kamera-Abfrage (ohne I/O, testbar): welche Bild-Pipeline
 * eine neue Alarm-Flanke startet, wie lange ein Ereignis nachlaeuft, was nach
 * einer gescheiterten Meldung an die Cloud nachgereicht wird.
 */

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
 * - Alles andere (Bewegung, Tier) holt hoechstens alle `throttleMs` ein
 *   Anzeige-Bild und nie direkt nach einem Bild einer Erkennungs-Pipeline.
 */
export function snapshotJobFor(type: string, g: SnapshotGate): SnapshotJob {
  if (type === "VEHICLE") return "vehicle";
  if (g.inFlight) return null;
  if (g.now - g.lastPipelineAt <= g.throttleMs) return null;
  if (type === "PERSON") return "person";
  return g.now - g.lastAutoAt > g.throttleMs ? "auto" : null;
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
 *    ein alter Beginn nach der Wanduhr allein wieder als frisch; stand der
 *    Rechner still, zaehlte die Wartezeit allein den Stillstand nicht mit.
 * 2. Sind es danach mehr als `maxLength`, fallen zuerst Enden weg, die
 *    hoechstwahrscheinlich nichts schliessen: Je Kamera und Art fuehrt die
 *    Cloud hoechstens ein offenes Ereignis. Das erste Ende in der
 *    Warteschlange schliesst es, ebenso das Ende hinter einem Beginn, der
 *    selbst noch wartet, und das Ende zu einem Beginn aus einer gescheiterten
 *    Meldung (`unconfirmed`): Den kann die Cloud verarbeitet haben, auch wenn
 *    ein aelteres Ende derselben Kamera und Art davor steht. Diese bleiben;
 *    von den uebrigen gehen die aeltesten. Erst danach fallen Beginne weg.
 */
export function tidyOutbox<T extends QueuedEvent>(
  queue: T[],
  now: number,
  maxStartAgeMs: number,
  maxLength: number,
  opts: {
    unconfirmed?: UnconfirmedStarts;
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
  // Meldung das erste Ende ab dessen Zeitpunkt.
  const needed = new Set<number>();
  const expectsEnd = new Map<string, boolean>();
  /** Je Kamera und Art: So viele Beginne aus gescheiterten Meldungen haben ihr Ende schon gefunden. */
  const matched = new Map<string, number>();
  out.queue.forEach((e, i) => {
    const key = queueKey(e);
    if (e.phase === "start") {
      expectsEnd.set(key, true);
    } else if (e.phase === "end") {
      if (expectsEnd.get(key) ?? true) needed.add(i);
      expectsEnd.set(key, false);
      const upTo = opts.unconfirmed?.upTo(e) ?? 0;
      if (upTo > (matched.get(key) ?? 0)) {
        needed.add(i);
        matched.set(key, upTo);
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
