import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { log } from "./config.js";
import {
  SHRINK_MIN_BYTES,
  motionPreviewSettings,
  personSnapshotSettings,
  shrinkNeeded,
  sipsArgs,
  type JpegSettings,
} from "./image-rules.js";

const execFileAsync = promisify(execFile);

/** Laengste Kante fuer Bilder, die nur angeschaut werden (Scan, Fahrzeug). */
export const DISPLAY_SNAPSHOT_MAX_PX = 1280;
/**
 * Gespeichertes Sichtungsbild einer Person (Standard 1280 px, Qualitaet 75;
 * HUB_PERSON_SNAPSHOT_MAX_PX, HUB_PERSON_JPEG_QUALITY). Die Gesichtserkennung
 * rechnet am Hub mit dem Original und schickt ihr Merkmal mit; die Cloud
 * zeigt das Bild an und behaelt es als Beleg. Nur ohne Merkmal bettet sie es
 * neu ein (FACE_ENROLL, FACE_ANALYZE).
 */
export const PERSON_SNAPSHOT = personSnapshotSettings(process.env);
/** Qualitaet aller uebrigen Bilder (Anzeige, Fahrzeuge, Halteverbot, Scan). */
const JPEG_QUALITY = 82;
/** Anzeige-Bild einer Flanke, die keine reine Bewegung ist (1280 px, Qualitaet 82). */
export const DISPLAY_SNAPSHOT: JpegSettings = { maxPx: DISPLAY_SNAPSHOT_MAX_PX, quality: JPEG_QUALITY };
/**
 * Vorschaubild bei reiner Bewegung (Standard 960 px, Qualitaet 70;
 * HUB_MOTION_SNAPSHOT_MAX_PX, 0 = wie DISPLAY_SNAPSHOT). Es dient nur der
 * Kachel in der Cloud.
 */
export const MOTION_PREVIEW = motionPreviewSettings(process.env, DISPLAY_SNAPSHOT);

/**
 * JPEG vor dem Upload verkleinern. Die Kameras liefern 4K-Bilder mit mehreren
 * Megabyte; in der Cloud werden sie nur angezeigt. `quality`: JPEG-Qualitaet,
 * ohne Angabe JPEG_QUALITY. `minBytes`: kleinere Bilder gehen unverkleinert
 * hinaus (shrinkNeeded), ohne Angabe SHRINK_MIN_BYTES; das Vorschaubild
 * hat 0. Genutzt wird `sips`, das
 * auf jedem Mac vorhanden ist – der Hub laeuft laut README nur auf macOS.
 * Schlaegt das Verkleinern fehl oder wird das Bild dabei nicht kleiner, geht
 * das Original raus.
 */
export async function shrinkJpeg(
  input: Uint8Array,
  maxPx: number,
  quality = JPEG_QUALITY,
  minBytes = SHRINK_MIN_BYTES
): Promise<Buffer> {
  const buf = Buffer.from(input);
  if (!shrinkNeeded(buf.length, minBytes) || process.platform !== "darwin") return buf;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "emp-hub-img-"));
  const src = path.join(dir, "in.jpg");
  const dst = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(src, buf);
    await execFileAsync("sips", sipsArgs(maxPx, quality, src, dst), { timeout: 10_000 });
    const out = await fs.readFile(dst);
    // Nur uebernehmen, wenn es wirklich ein JPEG ist und kleiner wurde.
    if (out.length > 4 && out[0] === 0xff && out[1] === 0xd8 && out.length < buf.length) return out;
    return buf;
  } catch (e) {
    log(`Bild verkleinern fehlgeschlagen, Original wird hochgeladen: ${e instanceof Error ? e.message : e}`);
    return buf;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
