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
 * Nachlauf je Ereignisart. Die reine Bewegungsmeldung der Kamera (Pixel-
 * Aenderung: Wellen, Baeume, Regen, Insekten vor dem Infrarot) flackert weit
 * staerker als die KI-Alarme. Mit 6 s Nachlauf wurden daraus rund 2.400
 * Ereignisse am Tag; bei 60 s verschmelzen etwa drei Viertel davon. Das Ende
 * traegt weiter den Zeitpunkt der letzten Bewegung, die Dauer bleibt richtig.
 */
export function endHoldFor(type: string, holdMs: number, motionHoldMs: number): number {
  return type === "MOTION" ? Math.max(holdMs, motionHoldMs) : holdMs;
}

export interface EventRef {
  cameraId: number;
  type: string;
  phase: "start" | "end";
}

/**
 * Was der Hub aus einer gescheiterten Meldung an die Cloud spaeter noch
 * einmal sendet: nur ein Ende, dessen Beginn die Cloud schon kennt. Ohne
 * dieses Ende bliebe das Ereignis dort offen und gaelte als laufend. Ein
 * Beginn wird nie nachgemeldet: Er loest in der Cloud Regeln aus, und die
 * sollen nicht Minuten spaeter feuern. Damit entfaellt auch das Ende zu
 * einem Beginn, der nie ankam.
 */
export class EndRetry {
  /** Kamera und Art, fuer die die Cloud einen Beginn ohne Ende hat. */
  private open = new Set<string>();

  private static key(e: EventRef): string {
    return `${e.cameraId}:${e.type}`;
  }

  /** Meldung ist angekommen. */
  delivered(events: EventRef[]): void {
    for (const e of events) {
      if (e.phase === "start") this.open.add(EndRetry.key(e));
      else this.open.delete(EndRetry.key(e));
    }
  }

  /**
   * Meldung ist gescheitert: liefert die Enden, die vorn in die Warteschlange
   * zurueckgehoeren. Je Kamera und Art hoechstens eines (das erste); spaetere
   * gehoeren zu einem Beginn, der selbst nicht ankam.
   */
  failed<T extends EventRef>(events: T[]): T[] {
    const kept = new Set<string>();
    const keep: T[] = [];
    for (const e of events) {
      if (e.phase !== "end") continue;
      const key = EndRetry.key(e);
      if (!this.open.has(key) || kept.has(key)) continue;
      kept.add(key);
      keep.push(e);
    }
    return keep;
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
