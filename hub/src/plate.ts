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
import { alprDetect, alprAvailable, type AlprCandidate } from "./alpr.js";

const execFileAsync = promisify(execFile);

const PLATE_DIR = path.join(CONFIG.hubDir, "plate");
const BIN = path.join(PLATE_DIR, "plate-ocr");
const SRC = path.join(PLATE_DIR, "PlateOCR.swift");
/** Auto-OCR ohne Whitelist: eher streng, sonst viele False Positives aus Weitwinkel. */
const MIN_CONF = Number(process.env.HUB_PLATE_MIN_CONF || 0.8);
/** fast-alpr Plate-OCR ist spezialisiert – Auto-Übernahme ab dieser Confidence. */
const ALPR_MIN_CONF = Number(process.env.HUB_ALPR_MIN_CONF || 0.88);
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

/** Für Offline-Backfill: Whitelist ohne Cloud-API setzen. */
export function setVehicleWhitelist(entries: WhitelistEntry[]): void {
  whitelist = entries;
  whitelistLoadedAt = Date.now();
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

/** Bekannte Kreise (NRW/Umgebung) – gleiche Basis wie PlateOCR.swift. */
const KNOWN_CITY = new Set([
  "RE", "BOR", "UN", "GE", "EN", "DO", "BO", "E", "HA", "HER", "HAM", "BOT",
  "MG", "NE", "D", "K", "AC", "BN", "SU", "LEV", "GL", "ME", "RS", "W", "SG",
  "OB", "MH", "DU", "KR", "VIE", "WES", "KLE", "COE", "ST", "SO",
]);

/** Bewertung eines formatierten Kennzeichens (analog scorePlate in PlateOCR.swift). */
function scorePlateFormat(plate: string): number {
  const m = plate.match(/^([A-Z]{1,3})-([A-Z]{1,2}) (\d{1,4})([EH]?)$/);
  if (!m) return 0;
  const [, city, mid, digits] = m;
  let s = 0;
  if (city.length === 2) s += 3;
  else if (city.length === 3) s += 2;
  else s += 1;
  if (mid.length === 2) s += 3;
  else s += 1;
  if (digits.length >= 3) s += 2;
  if (KNOWN_CITY.has(city)) s += 4;
  if (new Set(mid).size === mid.length) s += 1;
  return s;
}

/** Alle plausiblen DE-Splits eines kompakten OCR-Texts ("BOQC626E" → "BO-QC 626E" …). */
function expandCompact(text: string): string[] {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = compact.match(/^([A-Z]{2,5})(\d{1,4})([EH]?)$/);
  if (!m) return [];
  const [, letters, digits, suffix] = m;
  const out: string[] = [];
  for (let cityLen = 1; cityLen <= 3; cityLen++) {
    const midLen = letters.length - cityLen;
    if (midLen < 1 || midLen > 2) continue;
    out.push(`${letters.slice(0, cityLen)}-${letters.slice(cityLen)} ${digits}${suffix}`);
  }
  return out.sort((a, b) => scorePlateFormat(b) - scorePlateFormat(a));
}

/** ALPR-Kandidaten → OcrResult (kompatibel mit pickPlate). */
function alprToOcrResult(cands: AlprCandidate[]): OcrResult {
  const candidates: OcrCandidate[] = [];
  for (const c of cands) {
    for (const plate of expandCompact(c.text)) {
      candidates.push({ plate, confidence: c.ocrConf, source: c.tiled ? "alpr-tile" : "alpr" });
    }
  }
  const top = candidates[0];
  const auto =
    top &&
    top.confidence >= ALPR_MIN_CONF &&
    scorePlateFormat(top.plate) >= 12 &&
    KNOWN_CITY.has(top.plate.split("-")[0] ?? "")
      ? top
      : null;
  return {
    plate: auto?.plate ?? null,
    confidence: auto?.confidence ?? 0,
    candidates,
    raw: cands.map((c) => c.text),
  };
}

function digitSuffix(normalized: string): string {
  const m = normalized.match(/(\d{3,4}[EH]?)$/);
  return m?.[1] ?? "";
}

/** DE-Kennzeichen grob plausibel: 1–3 + 1–2 Buchstaben, ≥3 Ziffern. */
function isPlausiblePlate(plate: string): boolean {
  return /^[A-ZÄÖÜ]{1,3}-[A-ZÄÖÜ]{1,2} \d{3,4}[EH]?$/.test(plate.trim().toUpperCase());
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function pickPlate(result: OcrResult, wl: WhitelistEntry[]): string | null {
  const byNorm = new Map(wl.map((v) => [v.plateNormalized, v.plate]));
  const candNorms = result.candidates.map((c) => ({
    plate: c.plate,
    n: normalizePlate(c.plate),
    conf: c.confidence,
  }));
  const rawNorms = result.raw.map((r) => normalizePlate(r)).filter((n) => n.length >= 5);

  // 1) Exakter Whitelist-Treffer.
  for (const { n } of candNorms) {
    const hit = byNorm.get(n);
    if (hit) return hit;
  }
  for (const n of rawNorms) {
    const hit = byNorm.get(n);
    if (hit) return hit;
  }

  // 2) Fuzzy nur bei gleicher Länge ±1 und ≤2 Zeichenunterschied, gleiche Ziffern-Endung.
  for (const v of wl) {
    const want = v.plateNormalized;
    const wantDigits = digitSuffix(want);
    if (wantDigits.length < 3) continue;
    for (const { n, conf } of candNorms) {
      if (conf < 0.25) continue;
      if (digitSuffix(n) !== wantDigits) continue;
      if (Math.abs(n.length - want.length) > 1) continue;
      if (n.length === want.length && hamming(n, want) <= 2) return v.plate;
      // Gleicher Ziffernblock, Buchstaben leicht daneben (Q-L 626E vs BOQC626E)
      if (n.endsWith(wantDigits) && want.endsWith(wantDigits)) {
        const nLetters = n.slice(0, -wantDigits.length);
        const wLetters = want.slice(0, -wantDigits.length);
        if (nLetters.length >= 2 && wLetters.includes(nLetters)) return v.plate;
      }
    }
  }

  // 3) Auto-Wahl: plausibles DE-Kennzeichen + bekannter Kreis.
  const autoOk = (plate: string, conf: number) => {
    if (conf < MIN_CONF || !isPlausiblePlate(plate)) return false;
    const city = plate.split("-")[0] ?? "";
    return city.length >= 2 && KNOWN_CITY.has(city);
  };

  if (result.plate && autoOk(result.plate, result.confidence)) {
    return result.plate;
  }
  const top = result.candidates.find((c) => autoOk(c.plate, c.confidence));
  return top?.plate ?? null;
}

export interface PlateScore {
  plate: string | null;
  /** Confidence des gewählten Plates bzw. besten Kandidaten. */
  confidence: number;
  candidates: OcrCandidate[];
  raw: string[];
  viaWhitelist: boolean;
}

/**
 * Plate-OCR mit Score – für Burst-Frame-Auswahl.
 */
export async function scorePlateFromJpeg(jpeg: Buffer): Promise<PlateScore> {
  const empty: PlateScore = {
    plate: null,
    confidence: 0,
    candidates: [],
    raw: [],
    viaWhitelist: false,
  };
  if (process.env.HUB_PLATE_OCR === "0" || process.env.HUB_PLATE_OCR === "never") {
    return empty;
  }

  const tmp = path.join(tmpdir(), `emp-plate-${randomUUID()}.jpg`);
  try {
    await fs.writeFile(tmp, jpeg);
    const wlPromise = ensureWhitelist();

    // Stufe 1: fast-alpr (YOLO-Detektor + Plate-OCR) – findet auch kleine/ferne Plates.
    if (alprAvailable()) {
      const alprCands = await alprDetect(tmp);
      if (alprCands.length > 0) {
        const result = alprToOcrResult(alprCands);
        const wl = await wlPromise;
        const plate = pickPlate(result, wl);
        if (plate) {
          const viaWhitelist = wl.some(
            (v) => normalizePlate(v.plate) === normalizePlate(plate)
          );
          const match = result.candidates.find(
            (c) => normalizePlate(c.plate) === normalizePlate(plate)
          );
          return {
            plate,
            confidence: match?.confidence ?? result.confidence,
            candidates: result.candidates,
            raw: result.raw,
            viaWhitelist,
          };
        }
        // ALPR fand etwas, aber keine sichere Wahl → Vision darf ergänzen.
      }
    }

    // Stufe 2: macOS Vision (Fallback).
    if (!(await ensureBinary())) return empty;
    const [result, wl] = await Promise.all([runOcr(tmp), wlPromise]);
    const plate = pickPlate(result, wl);
    const viaWhitelist = !!(
      plate && wl.some((v) => normalizePlate(v.plate) === normalizePlate(plate))
    );
    let confidence = 0;
    if (plate) {
      const match = result.candidates.find(
        (c) => normalizePlate(c.plate) === normalizePlate(plate)
      );
      confidence = match?.confidence ?? result.confidence;
      if (viaWhitelist && confidence < 0.5) confidence = 0.5;
    } else if (result.candidates[0]) {
      confidence = result.candidates[0].confidence;
    }
    return {
      plate,
      confidence,
      candidates: result.candidates,
      raw: result.raw,
      viaWhitelist,
    };
  } catch (e) {
    log(`Plate-OCR Fehler: ${e instanceof Error ? e.message : e}`);
    return empty;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/**
 * Liest ein Kennzeichen aus einem Fahrzeug-JPEG.
 * `null` = nichts Lesbares / OCR aus / Binary fehlt.
 */
export async function readPlateFromJpeg(jpeg: Buffer): Promise<string | null> {
  const score = await scorePlateFromJpeg(jpeg);
  if (score.plate) {
    log(
      `Plate-OCR: ${score.plate} (conf=${score.confidence.toFixed(2)}${
        score.viaWhitelist ? ", Whitelist" : ""
      })` +
        (score.candidates.length > 1
          ? ` · Alternativen: ${score.candidates
              .slice(0, 4)
              .map((c) => c.plate)
              .join(", ")}`
          : "")
    );
  } else {
    log(
      `Plate-OCR: keines (top=${score.candidates[0]?.plate ?? "—"} conf=${score.confidence.toFixed(2)})`
    );
  }
  return score.plate;
}
