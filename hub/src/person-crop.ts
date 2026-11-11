/**
 * Digitaler Zoom auf Personen fuer Kameras ohne (oder zusaetzlich zum)
 * optischen Zoom: Der Tracker liefert Personen-Boxen (POST /classify →
 * persons), ffmpeg schneidet den Bereich aus dem hochaufgeloesten Bild aus
 * und vergroessert ihn. Die Ausschnitte gehen an die Gesichtserkennung und
 * an das Bildmodell.
 */
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { log } from "./config.js";
import { embedJpeg, scoreGallery, type FaceEmbedResult } from "./face.js";
import { trackerBaseUrl } from "./vision.js";
import { groupRect, headRect, largestFirst, type NormBox } from "./person-crop-rules.js";

const execFileAsync = promisify(execFile);
const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];

function ffmpegBin(): string | null {
  return FFMPEG.find((p) => existsSync(p)) ?? null;
}

/** Personen-Boxen (normiert). null = Tracker nicht erreichbar oder kennt keine Boxen. */
export async function detectPersons(jpeg: Buffer): Promise<NormBox[] | null> {
  try {
    const url = await trackerBaseUrl();
    const res = await fetch(`${url}/classify`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(jpeg),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { persons?: NormBox[] };
    if (!Array.isArray(json.persons)) return null;
    return json.persons
      .map((p) => ({ conf: Number(p.conf), x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }))
      .filter((p) => [p.x, p.y, p.w, p.h].every(Number.isFinite) && p.w > 0 && p.h > 0 && (p.conf ?? 1) >= 0.35)
      .slice(0, 20);
  } catch {
    return null;
  }
}

/** Ausschnitt ausschneiden und auf mindestens `minWidth` Pixel vergroessern. */
export async function cropJpeg(jpeg: Buffer, r: NormBox, minWidth = 800): Promise<Buffer | null> {
  const bin = ffmpegBin();
  if (!bin || r.w <= 0 || r.h <= 0) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "emp-hub-crop-"));
  const src = path.join(dir, "in.jpg");
  const dst = path.join(dir, "out.jpg");
  const f = (v: number) => v.toFixed(4);
  const vf =
    `crop=w=iw*${f(r.w)}:h=ih*${f(r.h)}:x=iw*${f(r.x)}:y=ih*${f(r.y)},` +
    `scale=w='max(iw,${minWidth})':h=-2:flags=lanczos`;
  try {
    await fs.writeFile(src, jpeg);
    await execFileAsync(bin, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", vf, "-q:v", "3", dst], { timeout: 15_000 });
    const out = await fs.readFile(dst);
    return out.length > 4 && out[0] === 0xff && out[1] === 0xd8 ? out : null;
  } catch (e) {
    log(`Personen-Ausschnitt fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Kopf-Ausschnitte der groessten Personen (fuer die Gesichtserkennung). */
export async function headCrops(jpeg: Buffer, boxes: NormBox[], max = 3): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const b of largestFirst(boxes, max)) {
    const c = await cropJpeg(jpeg, headRect(b), 640);
    if (c) out.push(c);
  }
  return out;
}

/** Ausschnitt um alle Personen (fuer das Bildmodell). null = lohnt nicht. */
export async function groupCrop(jpeg: Buffer, boxes: NormBox[]): Promise<Buffer | null> {
  const r = groupRect(boxes);
  return r ? cropJpeg(jpeg, r, 1024) : null;
}

/**
 * Gesicht ueber den digitalen Zoom suchen: Personen im Bild finden, Kopf-
 * Ausschnitte vergroessern, je Ausschnitt einbetten und gegen die Gallery
 * pruefen. Liefert den besten Treffer (sonst das erste gefundene Gesicht).
 * Vergroesserte Ausschnitte gelten als „upscaled“ → strengere Schwelle.
 */
export async function faceViaZoom(
  jpeg: Buffer
): Promise<{ face: FaceEmbedResult; matched: boolean; persons: number; box: NormBox } | null> {
  const boxes = await detectPersons(jpeg);
  if (!boxes?.length) return null;
  let best: { face: FaceEmbedResult; score: number; matched: boolean; box: NormBox } | null = null;
  for (const box of largestFirst(boxes, 3)) {
    const crop = await cropJpeg(jpeg, headRect(box), 640);
    if (!crop) continue;
    const e = await embedJpeg(crop);
    if (!e) continue;
    const face = { ...e, upscaled: true };
    const s = scoreGallery(face.embedding, { upscaled: true });
    const score = s.nearest?.score ?? 0;
    if (!best || (!!s.match && !best.matched) || score > best.score) best = { face, score, matched: !!s.match, box };
    if (s.match) break;
  }
  return best ? { face: best.face, matched: best.matched, persons: boxes.length, box: best.box } : null;
}
