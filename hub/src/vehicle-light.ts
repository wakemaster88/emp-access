/**
 * Weißlicht für einen Fahrzeug-Burst: einschalten und dafür sorgen, dass es
 * wieder ausgeht – am Ende des Bursts, spätestens nach `maxMs`, beim Beenden
 * des Hubs und, endet der Prozess vorher, durch den nächsten (Merker auf der
 * Platte). Kamera, Platte und Beenden kommen über `LightDriver` und
 * `BurstLight` herein (cameras.ts), damit die Reihenfolge testbar ist. Wann
 * und an welcher Kamera das Licht angeht: vehicle-light-rules.ts.
 */

export interface LightDriver {
  /** Merken, dass der Hub das Licht dieser Kamera einschaltet; erfüllt, sobald es auf der Platte steht. */
  mark(cameraId: number, at: number): Promise<void>;
  /** Den Merker von `at` löschen; erfüllt, sobald er von der Platte ist. */
  unmark(cameraId: number, at: number): Promise<void>;
  /** Aufräumer fürs Beenden des Hubs anmelden; liefert die Funktion zum Abmelden. */
  onShutdown(name: string, fn: () => Promise<void>): () => void;
  /** Der Hub räumt gerade auf und endet gleich. */
  isExiting(): boolean;
  log(msg: string): void;
}

export interface BurstLight {
  cameraId: number;
  /** Name der Kamera fürs Log. */
  name: string;
  /** Weißlicht an der Kamera schalten; wirft, wenn sie es nicht tut. */
  switchLight(on: boolean): Promise<void>;
}

/** Auf `work` warten, aber höchstens `maxMs`. */
function atMost(work: Promise<unknown>, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    void work
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

export class BurstLights {
  private readonly lit = new Set<number>();

  constructor(
    private readonly driver: LightDriver,
    /**
     * `maxMs`: Sicherheitsnetz, das Licht geht spätestens dann wieder aus.
     * `markWaitMs`: So lange wartet das Einschalten höchstens auf den Merker –
     * die Platte hält den Burst nicht auf.
     */
    private readonly opts: { maxMs: number; markWaitMs: number }
  ) {}

  /** An dieser Kamera brennt das Licht gerade für einen Burst. */
  isOn(cameraId: number): boolean {
    return this.lit.has(cameraId);
  }

  /**
   * Licht einschalten; liefert die Ausschalt-Funktion (null: der Hub endet,
   * es blieb aus). Was das Licht wieder ausschaltet, steht, bevor es brennt:
   * der Aufräumer fürs Beenden, der Timer und der Merker auf der Platte. Der
   * Timer lebt nur im Speicher, und nach einem Neustart gälte ein brennendes
   * Licht ohne Merker als von Hand eingeschaltet. Wirft, wenn die Kamera
   * nicht einschaltet.
   */
  async switchOn(light: BurstLight): Promise<(() => Promise<void>) | null> {
    const { driver } = this;
    const { cameraId, name } = light;
    // Der Hub endet gleich: kein Licht mehr einschalten, er bringt den Burst nicht zu Ende.
    if (driver.isExiting()) return null;
    const markedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forgetLight: () => void = () => undefined;
    /** Der Einschalt-Befehl ist an die Kamera gegangen: Ab hier kann das Licht brennen. */
    let sent = false;
    let turnedOn: Promise<void> = Promise.resolve();
    let offRun: Promise<boolean> | null = null;
    /** Der Merker ist von der Platte. Darauf wartet nur das Beenden, nie der Burst. */
    let unmarked: Promise<void> = Promise.resolve();
    const release = (): void => {
      clearTimeout(timer);
      forgetLight();
      this.lit.delete(cameraId);
    };
    /** Ausschalten, einmal für alle (Burst-Ende, Timer, Beenden); false = die Kamera hat es nicht getan. */
    const switchOff = (): Promise<boolean> =>
      (offRun ??= (async () => {
        try {
          // Erst wenn das Einschalten durch ist: „aus“ darf „an“ nicht überholen.
          await turnedOn.catch(() => {});
          if (sent) {
            await light.switchLight(false);
            driver.log(`Fahrzeug-Burst ${name}: Weißlicht aus`);
          }
          unmarked = driver.unmark(cameraId, markedAt);
          return true;
        } catch (e) {
          // Der Merker bleibt stehen: Das Ausschalten wird nachgeholt (lightMarkStep).
          driver.log(
            `Fahrzeug-Burst ${name}: Weißlicht aus fehlgeschlagen: ${e instanceof Error ? e.message : e} – wird nachgeholt`
          );
          return false;
        } finally {
          release();
        }
      })());

    forgetLight = driver.onShutdown(`weisslicht:${cameraId}`, async () => {
      if (!(await switchOff())) throw new Error("Weißlicht nicht ausgeschaltet");
      await unmarked;
    });
    this.lit.add(cameraId);
    timer = setTimeout(() => void switchOff(), this.opts.maxMs);
    turnedOn = (async () => {
      await atMost(driver.mark(cameraId, markedAt), this.opts.markWaitMs);
      // Beginnt inzwischen das Beenden, bleibt das Licht aus.
      if (driver.isExiting()) return;
      sent = true;
      await light.switchLight(true);
    })();
    try {
      await turnedOn;
    } catch (e) {
      // Ob das Licht brennt, ist offen (die Antwort blieb aus): Der Merker
      // bleibt stehen, das Nachholen sieht an der Kamera nach.
      release();
      throw e;
    }
    if (!sent) {
      await switchOff();
      return null;
    }
    return async () => {
      await switchOff();
    };
  }
}
