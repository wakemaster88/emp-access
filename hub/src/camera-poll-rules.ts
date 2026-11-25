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
