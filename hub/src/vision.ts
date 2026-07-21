/**
 * Lokale Bild-Prüfung via Ollama (llava): Filtert leere Fahrzeug-Snaps,
 * wenn die Kamera-KI falsch auslöst (z.B. Aqua-Park / Weitwinkel).
 * Prüft Vollbild + Zoom-Crops (Zentrum / untere Hälfte), weicherer Prompt.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { log } from "./config.js";

const execFileAsync = promisify(execFile);

const OLLAMA_URL = (process.env.HUB_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.HUB_OLLAMA_VISION_MODEL || "llava:7b";
const VISION_TIMEOUT_MS = 45_000;
const MAX_EDGE = 1280;

const PROMPT =
  "Look carefully. Answer YES if there is any car, truck, van, SUV, bus, or motorcycle " +
  "in this photo — including distant, small, parked, or partially visible vehicles. " +
  "Answer NO only if there is definitely no such vehicle. " +
  "Water-park inflatables, building roofs, boats alone, and empty roads are NO. " +
  "Reply with only YES or NO.";

async function sipsResize(buf: Buffer, maxEdge: number): Promise<Buffer> {
  const id = randomUUID();
  const tmpIn = path.join(tmpdir(), `emp-vis-in-${id}.jpg`);
  const tmpOut = path.join(tmpdir(), `emp-vis-out-${id}.jpg`);
  try {
    await fs.writeFile(tmpIn, buf);
    await execFileAsync("sips", ["-Z", String(maxEdge), tmpIn, "--out", tmpOut], {
      timeout: 10_000,
    });
    return await fs.readFile(tmpOut);
  } catch {
    return buf;
  } finally {
    await Promise.allSettled([fs.unlink(tmpIn), fs.unlink(tmpOut)]);
  }
}

/** Zentrum (~55%) oder untere Hälfte zuschneiden und skalieren. */
async function sipsRegion(
  buf: Buffer,
  region: "center" | "lower"
): Promise<Buffer | null> {
  const id = randomUUID();
  const tmpIn = path.join(tmpdir(), `emp-vis-reg-in-${id}.jpg`);
  const tmpOut = path.join(tmpdir(), `emp-vis-reg-out-${id}.jpg`);
  try {
    await fs.writeFile(tmpIn, buf);
    // Pixelgröße ermitteln
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmpIn], {
      timeout: 5_000,
    });
    const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
    const h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
    if (!w || !h) return null;

    let cropW: number;
    let cropH: number;
    let offsetX: number;
    let offsetY: number;
    if (region === "center") {
      cropW = Math.round(w * 0.55);
      cropH = Math.round(h * 0.55);
      offsetX = Math.round((w - cropW) / 2);
      offsetY = Math.round((h - cropH) / 2);
    } else {
      // Untere 55% – oft Straße / Zufahrt
      cropW = w;
      cropH = Math.round(h * 0.55);
      offsetX = 0;
      offsetY = h - cropH;
    }

    await execFileAsync(
      "sips",
      [
        "--cropToHeightWidth",
        String(cropH),
        String(cropW),
        "--cropOffset",
        String(offsetY),
        String(offsetX),
        tmpIn,
        "--out",
        tmpOut,
      ],
      { timeout: 10_000 }
    );
    const cropped = await fs.readFile(tmpOut);
    return sipsResize(cropped, MAX_EDGE);
  } catch {
    return null;
  } finally {
    await Promise.allSettled([fs.unlink(tmpIn), fs.unlink(tmpOut)]);
  }
}

function parseYesNo(text: string): boolean | null {
  const t = text.trim().toUpperCase();
  if (!t) return null;
  if (/\bYES\b|\bJA\b/.test(t)) return true;
  if (/\bNO\b|\bNEIN\b/.test(t)) return false;
  if (t.startsWith("Y") || t.startsWith("J")) return true;
  if (t.startsWith("N")) return false;
  return null;
}

async function askOllama(jpeg: Buffer, label: string): Promise<boolean | null> {
  const b64 = jpeg.toString("base64");
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: PROMPT,
      images: [b64],
      stream: false,
      options: { num_predict: 8, temperature: 0 },
    }),
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
  });
  if (!res.ok) {
    log(`Vision-Check (${label}) fehlgeschlagen: HTTP ${res.status}`);
    return null;
  }
  const json = (await res.json()) as { response?: string };
  const raw = json.response ?? "";
  const verdict = parseYesNo(raw);
  log(`Vision (${label}): ${JSON.stringify(raw.trim())} → ${verdict === null ? "?" : verdict ? "YES" : "NO"}`);
  return verdict;
}

/**
 * Prüft, ob im JPEG ein Fahrzeug ist (Vollbild + Zoom-Crops).
 * `null` = Prüfung fehlgeschlagen (Ollama down / Timeout).
 */
export async function jpegContainsVehicle(jpeg: Buffer): Promise<boolean | null> {
  try {
    const full = await sipsResize(jpeg, MAX_EDGE);
    const fullVerdict = await askOllama(full, "full");
    if (fullVerdict === true) return true;

    // Bei NO: Zoom Zentrum + untere Hälfte (Straße) – nacheinander, Abbruch bei YES.
    for (const region of ["center", "lower"] as const) {
      const crop = await sipsRegion(jpeg, region);
      if (!crop) continue;
      const v = await askOllama(crop, region);
      if (v === true) return true;
    }

    // mind. ein klares NO → kein Fahrzeug; nur nulls → null
    if (fullVerdict === false) return false;
    return fullVerdict;
  } catch (e) {
    log(`Vision-Check Fehler: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
