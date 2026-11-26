/**
 * Ein Takt, der sich nach jedem Durchlauf selbst neu plant: Die Wartezeit
 * bis zum nächsten Durchlauf ergibt sich aus dem, was der letzte gesehen
 * hat (Halteverbot: Fläche leer oder belegt).
 *
 * Genau ein Timer zur Zeit; `start` ein zweites Mal tut nichts. Ein Fehler im
 * Durchlauf oder in der Berechnung der Wartezeit reißt die Kette nicht ab,
 * und es entsteht keine unbehandelte Ablehnung. Der Durchlauf muss von sich
 * aus enden (checkNoParking endet über runExclusive spätestens nach
 * STUCK_RUN_MS).
 */

export interface CheckLoopDeps {
  /** Ein Durchlauf. */
  run: () => Promise<unknown>;
  /** Wartezeit bis zum nächsten Durchlauf, gezählt ab Beginn des letzten. */
  delayMs: () => number;
  /** Wartezeit vor dem ersten Durchlauf. */
  firstDelayMs: number;
  /** Wartezeit, wenn delayMs scheitert oder Unsinn liefert. */
  fallbackMs: number;
  /** Mindestabstand zwischen Ende und nächstem Beginn. */
  minGapMs: number;
  onError?: (err: unknown) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class CheckLoop {
  private timer: unknown = null;
  private due: number | null = null;
  private started = false;
  private stopped = false;
  private running = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: CheckLoopDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Takt beginnen. Läuft er schon (oder ist er beendet): false. */
  start(): boolean {
    if (this.started || this.stopped) return false;
    this.started = true;
    this.arm(this.deps.firstDelayMs);
    return true;
  }

  /** Takt beenden: kein weiterer Durchlauf, auch nicht nach einem laufenden. */
  stop(): void {
    this.stopped = true;
    this.disarm();
  }

  /**
   * Nächsten Durchlauf spätestens in `ms`. Ein früher geplanter bleibt; während
   * eines Durchlaufs ohne Wirkung (danach plant delayMs).
   */
  soon(ms: number): void {
    if (!this.started || this.stopped || this.running) return;
    const at = this.now() + ms;
    if (this.due === null || at < this.due) this.arm(ms);
  }

  /** Zeitpunkt des nächsten Durchlaufs (null = keiner geplant oder einer läuft). */
  get dueAt(): number | null {
    return this.due;
  }

  /** Ist gerade ein Timer gestellt? Für Tests: nie mehr als einer. */
  get armed(): boolean {
    return this.timer !== null;
  }

  private disarm(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.due = null;
  }

  private arm(ms: number): void {
    if (this.stopped) return;
    this.disarm();
    const wait = Math.max(0, ms);
    this.due = this.now() + wait;
    this.timer = this.setTimer(() => {
      this.tick().catch((err) => this.report(err));
    }, wait);
  }

  private report(err: unknown): void {
    try {
      this.deps.onError?.(err);
    } catch {
      // Die Fehlermeldung selbst darf den Takt nicht beenden.
    }
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.due = null;
    if (this.stopped) return;
    const startedAt = this.now();
    this.running = true;
    try {
      await this.deps.run();
    } catch (err) {
      this.report(err);
    }
    this.running = false;
    let wait = this.deps.fallbackMs;
    try {
      const ms = this.deps.delayMs();
      if (Number.isFinite(ms) && ms >= 0) wait = ms;
    } catch (err) {
      this.report(err);
    }
    try {
      // Verstrichene Zeit auf 0 bis `wait` begrenzt: Springt die Uhr während
      // des Durchlaufs zurück (Zeitabgleich), wird der Abstand nicht länger
      // als geplant; springt sie vor, kommt der nächste nach minGapMs.
      const elapsed = Math.min(Math.max(0, this.now() - startedAt), wait);
      this.arm(Math.max(this.deps.minGapMs, wait - elapsed));
    } catch (err) {
      this.report(err);
    }
  }
}
