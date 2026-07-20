/**
 * Lokale Bild-Prüfung via Ollama (llava): Filtert leere Fahrzeug-Snaps,
 * wenn die Kamera-KI falsch auslöst (z.B. Aqua-Park / Weitwinkel).
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
const MAX_EDGE = 1024;

/** JPEG für Ollama verkleinern (sips auf macOS). */
async function downscaleJpeg(buf: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const tmpIn = path.join(tmpdir(), `emp-vision-in-${id}.jpg`);
  const tmpOut = path.join(tmpdir(), `emp-vision-out-${id}.jpg`);
  try {
    await fs.writeFile(tmpIn, buf);
    await execFileAsync("sips", ["-Z", String(MAX_EDGE), tmpIn, "--out", tmpOut], {
      timeout: 10_000,
    });
    return await fs.readFile(tmpOut);
  } catch {
    // Fallback: Original (kann langsam sein, funktioniert aber).
    return buf;
  } finally {
    await Promise.allSettled([fs.unlink(tmpIn), fs.unlink(tmpOut)]);
  }
}

function parseYesNo(text: string): boolean | null {
  const t = text.trim().toUpperCase();
  if (!t) return null;
  if (/\bYES\b|\bJA\b/.test(t)) return true;
  if (/\bNO\b|\bNEIN\b/.test(t)) return false;
  // Einwort-Antworten
  if (t.startsWith("Y") || t.startsWith("J")) return true;
  if (t.startsWith("N")) return false;
  return null;
}

/**
 * Prüft, ob im JPEG ein klar sichtbares Fahrzeug ist.
 * `null` = Prüfung fehlgeschlagen (Ollama down / Timeout).
 */
export async function jpegContainsVehicle(jpeg: Buffer): Promise<boolean | null> {
  try {
    const small = await downscaleJpeg(jpeg);
    const b64 = small.toString("base64");
    const prompt =
      "Is there a clearly visible car, truck, van, bus, or motorcycle in this photo " +
      "(not just road, water, buildings, or inflatable structures)? Reply ONLY with YES or NO.";

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        images: [b64],
        stream: false,
        options: { num_predict: 8, temperature: 0 },
      }),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`Vision-Check fehlgeschlagen: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { response?: string };
    const verdict = parseYesNo(json.response ?? "");
    if (verdict === null) {
      log(`Vision-Check unklare Antwort: ${JSON.stringify(json.response)}`);
    }
    return verdict;
  } catch (e) {
    log(`Vision-Check Fehler: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
