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
  /**
   * Bilder unter so vielen Bytes gehen unverkleinert hinaus (shrinkNeeded);
   * ohne Angabe SHRINK_MIN_BYTES.
   */
  minBytes?: number;
}

/**
 * Unter dieser Groesse gehen Bilder unverkleinert hinaus (alle Bildwege
 * ausser dem Vorschaubild bei reiner Bewegung): Ein so kleines JPEG lohnt
 * das Umrechnen nicht.
 */
export const SHRINK_MIN_BYTES = 200 * 1024;

/** Wird ein Bild mit `bytes` Bytes vor dem Upload verkleinert? */
export function shrinkNeeded(bytes: number, minBytes: number = SHRINK_MIN_BYTES): boolean {
  return bytes >= minBytes;
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

/** Vorschaubild bei reiner Bewegung: laengste Kante (HUB_MOTION_SNAPSHOT_MAX_PX) und JPEG-Qualitaet. */
export const MOTION_PREVIEW_DEFAULT_PX = 960;
export const MOTION_PREVIEW_MIN_PX = 320;
export const MOTION_PREVIEW_QUALITY = 70;

/**
 * Groesse und Qualitaet des Vorschaubilds, das der Hub bei reiner Bewegung
 * (MOTION, ANIMAL) fuer die Kachel in der Cloud hochlaedt: Standard 960 px
 * bei Qualitaet 70. HUB_MOTION_SNAPSHOT_MAX_PX=0 ergibt `display`, die
 * Groesse aller uebrigen Anzeige-Bilder (wie vor dem 25.11.2026). Erlaubt
 * sind 320 bis zur Groesse von `display`; ungueltige Werte ergeben den
 * Standard.
 *
 * Das Vorschaubild wird immer verkleinert (`minBytes` 0): Nachts liefern die
 * Kameras dunkle Bilder in voller Aufloesung, die oft unter SHRINK_MIN_BYTES
 * bleiben; auch sie gehen mit hoechstens `maxPx` hinaus.
 */
export function motionPreviewSettings(env: Record<string, string | undefined>, display: JpegSettings): JpegSettings {
  const t = (env.HUB_MOTION_SNAPSHOT_MAX_PX ?? "").trim();
  if (t === "0") return display;
  const maxPx = intInRange(t, MOTION_PREVIEW_MIN_PX, display.maxPx, MOTION_PREVIEW_DEFAULT_PX);
  return { maxPx, quality: MOTION_PREVIEW_QUALITY, minBytes: 0 };
}

/** Aufruf von `sips`: laengste Kante `maxPx`, JPEG mit Qualitaet `quality`. */
export function sipsArgs(maxPx: number, quality: number, src: string, dst: string): string[] {
  return ["-Z", String(maxPx), "-s", "format", "jpeg", "-s", "formatOptions", String(quality), src, "--out", dst];
}
