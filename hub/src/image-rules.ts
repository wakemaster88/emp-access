/**
 * Reine Regeln fuer das Verkleinern von Bildern vor dem Upload (ohne I/O,
 * testbar). Ablauf in image.ts (shrinkJpeg).
 */

/** Gespeichertes Sichtungsbild einer Person: laengste Kante (HUB_PERSON_SNAPSHOT_MAX_PX). */
export const PERSON_SNAPSHOT_DEFAULT_PX = 1280;
export const PERSON_SNAPSHOT_MIN_PX = 640;
export const PERSON_SNAPSHOT_MAX_PX_LIMIT = 3840;
/** JPEG-Qualitaet des Sichtungsbilds (HUB_PERSON_JPEG_QUALITY). */
export const PERSON_JPEG_DEFAULT_QUALITY = 75;
export const PERSON_JPEG_MIN_QUALITY = 50;
export const PERSON_JPEG_MAX_QUALITY = 95;

/** Ganze Zahl in den Grenzen; leer, keine ganze Zahl oder ausserhalb = Standard. */
function intInRange(raw: string | undefined, min: number, max: number, fallback: number): number {
  const t = (raw ?? "").trim();
  if (!/^\d+$/.test(t)) return fallback;
  const n = Number(t);
  return n >= min && n <= max ? n : fallback;
}

export interface JpegSettings {
  maxPx: number;
  quality: number;
}

/**
 * Groesse und Qualitaet des Sichtungsbilds, das die Cloud zu einer Person
 * speichert. Die Gesichtserkennung arbeitet mit dem Original am Hub und
 * schickt ihr Merkmal mit; das gespeicherte Bild dient der Anzeige und als
 * Beleg. Ungueltige Werte ergeben den Standard.
 */
export function personSnapshotSettings(env: Record<string, string | undefined>): JpegSettings {
  return {
    maxPx: intInRange(env.HUB_PERSON_SNAPSHOT_MAX_PX, PERSON_SNAPSHOT_MIN_PX, PERSON_SNAPSHOT_MAX_PX_LIMIT, PERSON_SNAPSHOT_DEFAULT_PX),
    quality: intInRange(env.HUB_PERSON_JPEG_QUALITY, PERSON_JPEG_MIN_QUALITY, PERSON_JPEG_MAX_QUALITY, PERSON_JPEG_DEFAULT_QUALITY),
  };
}

/** Aufruf von `sips`: laengste Kante `maxPx`, JPEG mit Qualitaet `quality`. */
export function sipsArgs(maxPx: number, quality: number, src: string, dst: string): string[] {
  return ["-Z", String(maxPx), "-s", "format", "jpeg", "-s", "formatOptions", String(quality), src, "--out", dst];
}
