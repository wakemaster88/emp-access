/**
 * Regeln zu den Merklisten je Kamera auf der Platte (ohne I/O, testbar). Was
 * der Hub ueber einen Neustart hinweg wissen muss, steht dort als Kamera-ID
 * und Zeitpunkt, sonst nichts. Lesen und Schreiben der Dateien:
 * camera-marks.ts.
 */

/**
 * Gespeicherte Merkliste lesen: Liste `cameras` aus Kamera-ID und ISO-Zeit,
 * als Kamera-ID → Zeitpunkt (ms). Ein Eintrag ohne gueltige Kamera-ID, ohne
 * lesbare Zeit oder mit einer Zeit in der Zukunft (eine Minute
 * Uhrenabweichung erlaubt) entfaellt; eine kaputte Datei gilt als leer.
 * Steht eine Kamera doppelt da, gilt ihr letzter Eintrag.
 */
export function parseCameraMarks(raw: string, now: number): Map<number, number> {
  const marks = new Map<number, number>();
  let list: unknown;
  try {
    list = (JSON.parse(raw) as { cameras?: unknown } | null)?.cameras;
  } catch {
    return marks;
  }
  if (!Array.isArray(list)) return marks;
  for (const entry of list) {
    const { cameraId, at } = (entry ?? {}) as { cameraId?: unknown; at?: unknown };
    if (typeof cameraId !== "number" || !Number.isInteger(cameraId) || cameraId <= 0) continue;
    if (typeof at !== "string") continue;
    const t = Date.parse(at);
    if (Number.isNaN(t) || t > now + 60_000) continue;
    marks.set(cameraId, t);
  }
  return marks;
}

/** Merkliste so schreiben, wie `parseCameraMarks` sie liest. */
export function serializeCameraMarks(marks: ReadonlyMap<number, number>): string {
  return JSON.stringify({
    cameras: [...marks].map(([cameraId, at]) => ({ cameraId, at: new Date(at).toISOString() })),
  });
}

/**
 * Kamera-IDs der Merkliste, die nicht in der Kamera-Liste stehen. Ihre
 * Eintraege entfallen: Eine entfernte Kamera bleibt nicht fuer immer in der
 * Datei, und eine wieder aufgenommene beginnt neu.
 */
export function unknownMarks(marks: ReadonlyMap<number, number>, known: ReadonlySet<number>): number[] {
  return [...marks.keys()].filter((cameraId) => !known.has(cameraId));
}
