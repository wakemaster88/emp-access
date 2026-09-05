import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { log } from "./config.js";

const execFileAsync = promisify(execFile);

/** Laengste Kante fuer Bilder, die nur angeschaut werden (Scan, Fahrzeug). */
export const DISPLAY_SNAPSHOT_MAX_PX = 1280;
/** Personen-Bilder etwas groesser: FACE_ENROLL holt sie spaeter noch einmal ab. */
export const PERSON_SNAPSHOT_MAX_PX = 1600;
const JPEG_QUALITY = 82;

/**
 * JPEG vor dem Upload verkleinern. Die Kameras liefern 4K-Bilder mit mehreren
 * Megabyte; in der Cloud werden sie nur angezeigt. Genutzt wird `sips`, das
 * auf jedem Mac vorhanden ist – der Hub laeuft laut README nur auf macOS.
 * Schlaegt das Verkleinern fehl oder ist das Bild schon klein genug, geht das
 * Original raus.
 */
export async function shrinkJpeg(input: Uint8Array, maxPx: number): Promise<Buffer> {
  const buf = Buffer.from(input);
  if (buf.length < 200 * 1024 || process.platform !== "darwin") return buf;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "emp-hub-img-"));
  const src = path.join(dir, "in.jpg");
  const dst = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(src, buf);
    await execFileAsync(
      "sips",
      ["-Z", String(maxPx), "-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), src, "--out", dst],
      { timeout: 10_000 },
    );
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
