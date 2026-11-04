/**
 * Klimaverlauf, reiner Rechenteil: Minutenwerte zu 5-Minuten-Fenstern
 * verdichten. Ohne Netz und Platte, damit es sich testen laesst.
 */

export const BUCKET_MS = 5 * 60_000;

export interface MinuteSample {
  deviceId: number;
  /** Unix-Millisekunden der Messung. */
  at: number;
  tC: number | null;
  rh: number | null;
}

/** Ein abgeschlossenes Fenster, so wie es an die Cloud geht. */
export interface BucketSample {
  deviceId: number;
  bucketStart: string;
  tempMin: number | null;
  tempAvg: number | null;
  tempMax: number | null;
  humMin: number | null;
  humAvg: number | null;
  humMax: number | null;
  count: number;
}

export function bucketOf(at: number): number {
  return Math.floor(at / BUCKET_MS) * BUCKET_MS;
}

const round = (v: number) => Math.round(v * 100) / 100;

function stats(values: number[]): { min: number; avg: number; max: number } | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min: round(min), avg: round(sum / values.length), max: round(max) };
}

/** Minutenwerte nach Geraet und Fenster gruppieren; Fenster ohne Wert fallen weg. */
export function aggregateSamples(samples: MinuteSample[]): BucketSample[] {
  const groups = new Map<string, MinuteSample[]>();
  for (const s of samples) {
    if (s.tC == null && s.rh == null) continue;
    const key = `${s.deviceId}:${bucketOf(s.at)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: BucketSample[] = [];
  for (const [key, list] of groups) {
    const [deviceId, start] = key.split(":").map(Number);
    const t = stats(list.map((s) => s.tC).filter((v): v is number => v != null));
    const h = stats(list.map((s) => s.rh).filter((v): v is number => v != null));
    out.push({
      deviceId,
      bucketStart: new Date(start).toISOString(),
      tempMin: t?.min ?? null,
      tempAvg: t?.avg ?? null,
      tempMax: t?.max ?? null,
      humMin: h?.min ?? null,
      humAvg: h?.avg ?? null,
      humMax: h?.max ?? null,
      count: list.length,
    });
  }
  return out.sort((a, b) => a.deviceId - b.deviceId || a.bucketStart.localeCompare(b.bucketStart));
}

/** Messwert plausibel? Fuehler melden beim Aufwachen gelegentlich Unsinn. */
export function plausible(tC: number | null, rh: number | null): { tC: number | null; rh: number | null } {
  return {
    tC: tC != null && Number.isFinite(tC) && tC > -50 && tC < 100 ? round(tC) : null,
    rh: rh != null && Number.isFinite(rh) && rh >= 0 && rh <= 100 ? round(rh) : null,
  };
}
