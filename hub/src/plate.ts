/**
 * Kennzeichen-OCR am Hub via macOS Vision (hub/plate/plate-ocr).
 * Liest Plates aus Fahrzeug-JPEGs; Whitelist disambiguiert Kandidaten.
 */
import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { CONFIG, api, log } from "./config.js";

const execFileAsync = promisify(execFile);

const PLATE_DIR = path.join(CONFIG.hubDir, "plate");
const BIN = path.join(PLATE_DIR, "plate-ocr");
const SRC = path.join(PLATE_DIR, "PlateOCR.swift");
const MIN_CONF = Number(process.env.HUB_PLATE_MIN_CONF || 0.55);
const OCR_TIMEOUT_MS = Number(process.env.HUB_PLATE_TIMEOUT_MS || 45_000);
const WHITELIST_TTL_MS = 60_000;

interface OcrCandidate {
  plate: string;
  confidence: number;
  source: string;
}

interface OcrResult {
  plate: string | null;
  confidence: number;
  candidates: OcrCandidate[];
  raw: string[];
}

interface WhitelistEntry {
  id: number;
  name: string;
  plate: string;
  plateNormalized: string;
}

let whitelist: WhitelistEntry[] = [];
let whitelistLoadedAt = 0;
let building: Promise<boolean> | null = null;

function normalizePlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .replace(/[Ä]/g, "AE")
    .replace(/[Ö]/g, "OE")
    .replace(/[Ü]/g, "UE")
    .replace(/ß/g, "SS")
    .replace(/[^A-Z0-9]/g, "");
}

async function ensureBinary(): Promise<boolean> {
  if (existsSync(BIN)) return true;
  if (!existsSync(SRC)) {
    log("Plate-OCR: PlateOCR.swift fehlt");
    return false;
  }
  if (building) return building;
  building = (async () => {
    log("Plate-OCR: kompiliere macOS-Vision-Binary …");
    try {
      await execFileAsync("swiftc", ["-O", "-o", BIN, SRC], {
        cwd: PLATE_DIR,
        timeout: 120_000,
      });
      log("Plate-OCR: Binary bereit");
      return existsSync(BIN);
    } catch (e) {
      log(`Plate-OCR: Compile fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      return false;
    } finally {
      building = null;
    }
  })();
  return building;
}

export async function refreshVehicleWhitelist(): Promise<void> {
  try {
    const res = await api("/api/hub/allowed-vehicles");
    if (!res.ok) return;
    const json = (await res.json()) as { vehicles?: WhitelistEntry[] };
    whitelist = json.vehicles ?? [];
    whitelistLoadedAt = Date.now();
  } catch {
    // OCR funktioniert auch ohne Whitelist.
  }
}

async function ensureWhitelist(): Promise<WhitelistEntry[]> {
  if (Date.now() - whitelistLoadedAt > WHITELIST_TTL_MS) {
    await refreshVehicleWhitelist();
  }
  return whitelist;
}

function runOcr(imagePath: string): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [imagePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Plate-OCR Timeout"));
    }, OCR_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(stdout.trim() || "{}") as OcrResult;
        resolve({
          plate: json.plate ?? null,
          confidence: Number(json.confidence) || 0,
          candidates: Array.isArray(json.candidates) ? json.candidates : [],
          raw: Array.isArray(json.raw) ? json.raw : [],
        });
      } catch {
        reject(
          new Error(
            `Plate-OCR ungültige Antwort (code=${code}): ${stdout.slice(0, 120)} ${stderr.slice(0, 80)}`
          )
        );
      }
    });
  });
}

function pickPlate(result: OcrResult, wl: WhitelistEntry[]): string | null {
  const byNorm = new Map(wl.map((v) => [v.plateNormalized, v.plate]));

  // 1) Whitelist-Treffer unter Kandidaten (auch bei niedriger Conf).
  for (const c of result.candidates) {
    const n = normalizePlate(c.plate);
    const hit = byNorm.get(n);
    if (hit) return hit;
  }

  // 2) Auto-Wahl vom Binary, falls Confidence reicht.
  if (result.plate && result.confidence >= MIN_CONF) {
    return result.plate;
  }

  // 3) Bester Kandidat über Schwelle.
  const top = result.candidates.find((c) => c.confidence >= MIN_CONF);
  return top?.plate ?? null;
}

/**
 * Liest ein Kennzeichen aus einem Fahrzeug-JPEG.
 * `null` = nichts Lesbares / OCR aus / Binary fehlt.
 */
export async function readPlateFromJpeg(jpeg: Buffer): Promise<string | null> {
  if (process.env.HUB_PLATE_OCR === "0" || process.env.HUB_PLATE_OCR === "never") {
    return null;
  }
  if (!(await ensureBinary())) return null;

  const tmp = path.join(tmpdir(), `emp-plate-${randomUUID()}.jpg`);
  try {
    await fs.writeFile(tmp, jpeg);
    const [result, wl] = await Promise.all([runOcr(tmp), ensureWhitelist()]);
    const plate = pickPlate(result, wl);
    if (plate) {
      const viaWl = wl.some((v) => normalizePlate(v.plate) === normalizePlate(plate));
      log(
        `Plate-OCR: ${plate} (conf=${result.confidence.toFixed(2)}${viaWl ? ", Whitelist" : ""})` +
          (result.candidates.length > 1
            ? ` · Alternativen: ${result.candidates
                .slice(0, 4)
                .map((c) => c.plate)
                .join(", ")}`
            : "")
      );
    } else {
      log(
        `Plate-OCR: keines (top=${result.candidates[0]?.plate ?? "—"} conf=${(
          result.candidates[0]?.confidence ?? 0
        ).toFixed(2)})`
      );
    }
    return plate;
  } catch (e) {
    log(`Plate-OCR Fehler: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}
