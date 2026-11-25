/**
 * Aufraeumen vor dem Beenden des Hubs, auf einem Weg fuer Update (mehrmals am
 * Tag), Neustart aus der Cloud, Signal und unerwarteten Fehler. Ohne das
 * Aufraeumen ginge der Diagnose-Stand der Sitzung verloren, und ein vom Hub
 * eingeschaltetes Weisslicht bliebe an, bis der naechste Prozess es
 * ausschaltet: Sein Ausschalt-Timer lebt nur im Speicher.
 */

type Cleanup = () => Promise<unknown> | unknown;

/**
 * Ein Lauf des Aufraeumens. Die Aufraeumer laufen nebeneinander, und wer sich
 * erst anmeldet, waehrend der Lauf schon wartet, laeuft noch mit (`start`).
 */
class CleanupRun {
  private readonly jobs: Array<{ name: string; done: boolean }> = [];
  private running = 0;
  private idle: (() => void) | null = null;

  /** Aufraeumer sofort starten. */
  start(name: string, fn: Cleanup): void {
    const job = { name, done: false };
    this.jobs.push(job);
    this.running++;
    void (async () => {
      try {
        await fn();
        job.done = true;
      } catch {
        // Bleibt offen: gescheitert.
      }
      if (--this.running === 0) this.idle?.();
    })();
  }

  /**
   * Warten, bis alle fertig sind, zusammen hoechstens `maxMs`. Liefert die
   * Namen derer, die nicht rechtzeitig fertig wurden oder scheiterten.
   */
  async wait(maxMs: number): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let late = false;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        late = true;
        resolve();
      }, maxMs);
    });
    while (this.running > 0 && !late) {
      await Promise.race([new Promise<void>((resolve) => (this.idle = resolve)), deadline]);
    }
    clearTimeout(timer);
    return [...new Set(this.jobs.filter((j) => !j.done).map((j) => j.name))];
  }
}

/**
 * Alle Aufraeumer nebeneinander ausfuehren, zusammen hoechstens `maxMs`: Ein
 * haengender (Kamera antwortet nicht) haelt den Neustart nicht auf. Wirft nie;
 * liefert die Namen derer, die nicht rechtzeitig fertig wurden oder scheiterten.
 */
export async function runCleanups(maxMs: number, list: Map<string, Cleanup>): Promise<string[]> {
  const run = new CleanupRun();
  for (const [name, fn] of list) run.start(name, fn);
  return run.wait(maxMs);
}

/** Zeit fuers Aufraeumen, bevor der Prozess in jedem Fall endet. */
export const SHUTDOWN_MAX_MS = 3_000;

export interface ShutdownDeps {
  /** Den Prozess beenden (launchd startet neu). */
  exit: (code: number) => void;
  /** Zeile ins Hub-Log. */
  log: (msg: string) => void;
  /** Zeit fuers Aufraeumen. */
  maxMs: number;
}

/**
 * Ein Weg fuer jedes Beenden: Update, Neustart aus der Cloud, Signal und
 * unerwarteter Fehler. Wer hier durchgeht, raeumt auf und gilt vom ersten
 * Augenblick an als beendend, damit der Hub nichts mehr anfaengt, was er
 * nicht zu Ende bringt (Auftraege abholen, Licht einschalten).
 */
export class Shutdown {
  private readonly cleanups = new Map<string, Cleanup>();
  private exiting = false;
  private code = 0;
  /** Das laufende Aufraeumen (null = der Hub endet noch nicht). */
  private run: CleanupRun | null = null;

  constructor(private readonly deps: ShutdownDeps) {}

  /**
   * Aufraeumer anmelden; liefert die Funktion zum Abmelden. Laeuft das
   * Aufraeumen schon, wird er sofort ausgefuehrt: Er kaeme sonst nie an die
   * Reihe, und was er ausschalten soll, bliebe an. Wer sich anmeldet, bevor
   * er etwas einschaltet, fragt deshalb vorher `isExiting()`.
   */
  onShutdown(name: string, fn: Cleanup): () => void {
    this.cleanups.set(name, fn);
    this.run?.start(name, fn);
    return () => {
      if (this.cleanups.get(name) === fn) this.cleanups.delete(name);
    };
  }

  /** Der Hub raeumt gerade auf und endet gleich: nichts Neues mehr anfangen. */
  isExiting(): boolean {
    return this.exiting;
  }

  /**
   * Aufraeumen und beenden. Mehrfache Aufrufe zaehlen einmal. Meldet ein
   * spaeterer Aufruf einen Fehler, endet der Prozess mit dessen Code: Ein
   * Fehler waehrend des Aufraeumens soll am Ende nicht wie ein geordnetes
   * Beenden aussehen.
   */
  exit(code: number): void {
    if (this.exiting) {
      this.code = Math.max(this.code, code);
      return;
    }
    this.exiting = true;
    this.code = code;
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      this.deps.exit(this.code);
    };
    // Sicherheitsnetz, falls das Aufraeumen selbst haengt.
    setTimeout(end, this.deps.maxMs + 1_000).unref();
    const run = new CleanupRun();
    this.run = run;
    // Ueber eine Kopie: Meldet ein Aufraeumer dabei einen weiteren an, startet
    // den schon `onShutdown`.
    for (const [name, fn] of [...this.cleanups]) run.start(name, fn);
    void run
      .wait(this.deps.maxMs)
      .then((open) => {
        // Was nicht fertig wurde, steht im Log: Dort kann noch ein Licht
        // brennen oder der Diagnose-Stand der Sitzung fehlen.
        if (open.length > 0) this.deps.log(`Aufräumen unvollständig: ${open.join(", ")}`);
      })
      .catch(() => {
        // Das Log darf das Beenden nie aufhalten.
      })
      .finally(end);
  }
}

const hub = new Shutdown({
  exit: (code) => process.exit(code),
  // Im Format des Hub-Logs (log in config.ts). Von dort wird nicht
  // importiert: config.ts verlangt die Umgebung des Hubs, dieses Modul bleibt
  // ohne sie ladbar.
  log: (msg) => console.log(`[${new Date().toISOString()}] ${msg}`),
  maxMs: SHUTDOWN_MAX_MS,
});

/** Aufraeumer des Hub-Prozesses anmelden; liefert die Funktion zum Abmelden. */
export function onShutdown(name: string, fn: Cleanup): () => void {
  return hub.onShutdown(name, fn);
}

/** Der Hub raeumt gerade auf und endet gleich: nichts Neues mehr anfangen. */
export function isExiting(): boolean {
  return hub.isExiting();
}

/** Aufraeumen und beenden (launchd startet neu). Mehrfache Aufrufe zaehlen einmal. */
export function exitHub(code: number): void {
  hub.exit(code);
}
