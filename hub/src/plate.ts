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
import {
  KNOWN_CITY,
  normalizePlate,
  pickPlate,
  plateMayActuate,
  type OcrCandidate,
  type OcrResult,
  type PlateMatchKind,
} from "./plate-match.js";

const execFileAsync = promisify(execFile);

const PLATE_DIR = path.join(CONFIG.hubDir, "plate");
const BIN = path.join(PLATE_DIR, "plate-ocr");
const SRC = path.join(PLATE_DIR, "PlateOCR.swift");
/** Auto-OCR ohne Whitelist: eher streng, sonst viele False Positives aus Weitwinkel. */
const MIN_CONF = Number(process.env.HUB_PLATE_MIN_CONF || 0.8);
/** fast-alpr Plate-OCR ist spezialisiert – Auto-Übernahme ab dieser Confidence. */
const ALPR_MIN_CONF = Number(process.env.HUB_ALPR_MIN_CONF || 0.88);
/**
 * Mindest-Confidence, ab der ein EXAKTER Whitelist-Treffer Tor/Shelly schalten
 * darf (plateActuationAllowed). Bewusst deutlich unter der Auto-Übernahme:
 * der exakte Treffer ist das eigentliche Kriterium.
 */
const ALPR_ACTUATE_MIN_CONF = Number(process.env.HUB_ALPR_ACTUATE_MIN_CONF || 0.5);
const OCR_TIMEOUT_MS = Number(process.env.HUB_PLATE_TIMEOUT_MS || 45_000);
// 5 min: Whitelist aendert sich selten – weniger Cloud-Requests bei Bursts.
const WHITELIST_TTL_MS = 300_000;

export interface CachedVehicle {
  id: number;
  name: string;
  plate: string;
  plateNormalized: string;
  cameraId: number | null;
  doorbirdCameraId: number | null;
  cooldownMinutes: number;
  lastTriggeredAt: number | null;
  shellyAction: string;
  timerSeconds: number | null;
  shellyIp: string | null;
}

type WhitelistEntry = CachedVehicle;

let whitelist: WhitelistEntry[] = [];
let whitelistLoadedAt = 0;
let localActuators = false;
let building: Promise<boolean> | null = null;

const CACHE_FILE = path.join(CONFIG.hubDir, ".cache", "allowed-vehicles.json");

function parseTriggeredAt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null || v === "") return null;
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
}

function hydrateVehicle(v: Partial<CachedVehicle> | Record<string, unknown>): CachedVehicle {
  const r = v as Record<string, unknown>;
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    plate: String(r.plate ?? ""),
    plateNormalized: String(r.plateNormalized ?? ""),
    cameraId: r.cameraId == null ? null : Number(r.cameraId),
    doorbirdCameraId: r.doorbirdCameraId == null ? null : Number(r.doorbirdCameraId),
    cooldownMinutes: Number(r.cooldownMinutes) > 0 ? Number(r.cooldownMinutes) : 2,
    lastTriggeredAt: parseTriggeredAt(r.lastTriggeredAt),
    shellyAction: String(r.shellyAction ?? "ON"),
    timerSeconds: r.timerSeconds == null ? null : Number(r.timerSeconds),
    shellyIp: r.shellyIp ? String(r.shellyIp) : null,
  };
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

function persistWhitelist(): void {
  fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() =>
      fs.writeFile(
        CACHE_FILE,
        JSON.stringify({ at: Date.now(), localActuators, vehicles: whitelist })
      )
    )
    .catch(() => undefined);
}

async function loadWhitelistFromDisk(): Promise<boolean> {
  try {
    const raw = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as {
      vehicles?: CachedVehicle[];
      localActuators?: boolean;
    };
    if (!Array.isArray(raw.vehicles) || raw.vehicles.length === 0) return false;
    whitelist = raw.vehicles.map((v) => hydrateVehicle(v as CachedVehicle));
    localActuators = raw.localActuators === true;
    whitelistLoadedAt = Date.now();
    log(
      `Fahrzeuge: ${whitelist.length} Einträge aus Cache (offline${
        localActuators ? ", lokale Aktoren" : ""
      })`
    );
    return true;
  } catch {
    return false;
  }
}

export async function refreshVehicleWhitelist(): Promise<void> {
  try {
    const res = await api("/api/hub/allowed-vehicles");
    if (!res.ok) {
      if (whitelist.length === 0) await loadWhitelistFromDisk();
      return;
    }
    const json = (await res.json()) as {
      vehicles?: CachedVehicle[];
      localActuators?: boolean;
    };
    whitelist = (json.vehicles ?? []).map((v) => hydrateVehicle(v));
    localActuators = json.localActuators === true;
    whitelistLoadedAt = Date.now();
    persistWhitelist();
    log(
      `Fahrzeuge: ${whitelist.length} Whitelist-Einträge vom Server${
        localActuators ? " (lokale Aktoren)" : ""
      }`
    );
  } catch {
    if (whitelist.length === 0) await loadWhitelistFromDisk();
  }
}

/** Für Offline-Backfill: Whitelist ohne Cloud-API setzen. */
export function setVehicleWhitelist(entries: WhitelistEntry[]): void {
  whitelist = entries.map((v) => hydrateVehicle(v));
  whitelistLoadedAt = Date.now();
}

async function ensureWhitelist(): Promise<WhitelistEntry[]> {
  if (whitelist.length === 0) await loadWhitelistFromDisk();
  if (Date.now() - whitelistLoadedAt > WHITELIST_TTL_MS) {
    await refreshVehicleWhitelist();
  }
  return whitelist;
}

/** Whitelist fuer das lokale Dashboard – ohne Aktor-Details (Shelly-IP). */
export function listWhitelistPublic(): Array<{
  id: number;
  name: string;
  plate: string;
  cameraId: number | null;
  doorbirdCameraId: number | null;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
}> {
  return whitelist
    .map((v) => ({
      id: v.id,
      name: v.name,
      plate: v.plate,
      cameraId: v.cameraId,
      doorbirdCameraId: v.doorbirdCameraId,
      cooldownMinutes: v.cooldownMinutes,
      lastTriggeredAt: v.lastTriggeredAt ? new Date(v.lastTriggeredAt).toISOString() : null,
    }))
    .sort((a, b) => a.plate.localeCompare(b.plate, "de"));
}

export function findAllowedVehicle(plate: string): CachedVehicle | null {
  const n = normalizePlate(plate);
  if (n.length < 4) return null;
  return whitelist.find((v) => v.plateNormalized === n) ?? null;
}

/** True, wenn die Cloud-API Aktoren mitliefert und skipActuators versteht. */
export function vehicleLocalActuatorsEnabled(): boolean {
  return localActuators;
}

export function markVehicleTriggered(id: number): void {
  const v = whitelist.find((x) => x.id === id);
  if (v) v.lastTriggeredAt = Date.now();
  persistWhitelist();
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

export interface PlateScore {
  plate: string | null;
  /** Confidence des gewählten Plates bzw. besten Kandidaten. */
  confidence: number;
  candidates: OcrCandidate[];
  raw: string[];
  /** Exakter Whitelist-Treffer (matchKind === "exact"). */
  viaWhitelist: boolean;
  /** exact = steht normalisiert genau so auf der Whitelist; auto = sicher gelesen, nicht gelistet. */
  matchKind: PlateMatchKind | null;
  /** Confidence genau der Lesung hinter `plate`; null = unbekannt. Massgeblich fuers Schalten. */
  matchConfidence: number | null;
  /**
   * Unscharfer Whitelist-Treffer („vermutlich dieses Kennzeichen“). Nur fuer
   * Log und Anzeige – steht nie in `plate` und schaltet nie (plate-match.ts).
   */
  probable: string | null;
  /** Darf Tor/Shelly schalten: exakter Treffer mit Confidence ≥ HUB_ALPR_ACTUATE_MIN_CONF. */
  actuate: boolean;
}

/**
 * Sicherheitsregel fuer alle Aktoren: nur exakter Whitelist-Treffer, und wenn
 * die Lesung eine Confidence hat, mindestens HUB_ALPR_ACTUATE_MIN_CONF
 * (Standard 0.5). Jeder Pfad, der Tor oder Shelly schaltet, muss hier durch.
 */
export function plateActuationAllowed(exact: boolean, confidence: number | null): boolean {
  return plateMayActuate({ exact, confidence }, ALPR_ACTUATE_MIN_CONF);
}

/** Schwelle fuer Log-Texte. */
export function plateActuationMinConf(): number {
  return ALPR_ACTUATE_MIN_CONF;
}

/**
 * Plate-OCR mit Score – für Burst-Frame-Auswahl.
 * `vision: false` überspringt macOS Vision. Das braucht der Burst: Vision auf
 * einem leeren 4K-Frame dauert ~1,6 s und fand dort kein Kennzeichen.
 */
export async function scorePlateFromJpeg(
  jpeg: Buffer,
  opts?: { vision?: boolean }
): Promise<PlateScore> {
  const allowVision = opts?.vision !== false;
  const empty: PlateScore = {
    plate: null,
    confidence: 0,
    candidates: [],
    raw: [],
    viaWhitelist: false,
    matchKind: null,
    matchConfidence: null,
    probable: null,
    actuate: false,
  };
  if (process.env.HUB_PLATE_OCR === "0" || process.env.HUB_PLATE_OCR === "never") {
    return empty;
  }

  const tmp = path.join(tmpdir(), `emp-plate-${randomUUID()}.jpg`);
  try {
    await fs.writeFile(tmp, jpeg);
    const wlPromise = ensureWhitelist();
    /** Unscharfer Hinweis aus Stufe 1, falls Stufe 2 nichts Eigenes findet. */
    let alprProbable: string | null = null;

    // Stufe 1: fast-alpr (YOLO-Detektor + Plate-OCR) – findet auch kleine/ferne Plates.
    if (alprAvailable()) {
      const alprCands = await alprDetect(tmp);
      if (alprCands.length > 0) {
        const result = alprToOcrResult(alprCands);
        const wl = await wlPromise;
        const pick = pickPlate(result, wl, MIN_CONF);
        const plate = pick.plate;
        alprProbable = pick.probable;
        if (plate) {
          const exact = pick.matchKind === "exact";
          const match = result.candidates.find(
            (c) => normalizePlate(c.plate) === normalizePlate(plate)
          );
          return {
            plate,
            confidence: match?.confidence ?? result.confidence,
            candidates: result.candidates,
            raw: result.raw,
            viaWhitelist: exact,
            matchKind: pick.matchKind,
            matchConfidence: pick.confidence,
            probable: pick.probable,
            actuate: plateActuationAllowed(exact, pick.confidence),
          };
        }
        // ALPR fand etwas, aber keine sichere Wahl → Vision darf ergänzen.
        if (!allowVision) {
          return {
            plate: null,
            confidence: result.candidates[0]?.confidence ?? result.confidence,
            candidates: result.candidates,
            raw: result.raw,
            viaWhitelist: false,
            matchKind: null,
            matchConfidence: null,
            probable: pick.probable,
            actuate: false,
          };
        }
      } else if (!allowVision) {
        return empty;
      }
    } else if (!allowVision) {
      return empty;
    }

    // Stufe 2: macOS Vision (Fallback), nur wenn der Aufrufer sie will.
    if (!(await ensureBinary())) return empty;
    const [result, wl] = await Promise.all([runOcr(tmp), wlPromise]);
    const pick = pickPlate(result, wl, MIN_CONF);
    const plate = pick.plate;
    const viaWhitelist = pick.matchKind === "exact";
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
      matchKind: pick.matchKind,
      // Bewusst pick.confidence, nicht der oben fuer die Anzeige angehobene Wert.
      matchConfidence: pick.confidence,
      probable: pick.probable ?? alprProbable,
      actuate: plateActuationAllowed(viaWhitelist, pick.confidence),
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
  if (score.probable) {
    log(`Plate-OCR: vermutlich ${score.probable} (unscharfer Whitelist-Treffer – schaltet nicht)`);
  }
  return score.plate;
}

/**
 * Alle Texte im Bild (macOS Vision, ganzes Bild + Kacheln), z. B. für die
 * Aufschrift von Lieferwagen. Leer, wenn OCR aus ist oder das Binary fehlt.
 */
export async function readTextFromJpeg(jpeg: Buffer): Promise<string[]> {
  if (process.env.HUB_PLATE_OCR === "0" || process.env.HUB_PLATE_OCR === "never") return [];
  if (!(await ensureBinary())) return [];
  const tmp = path.join(tmpdir(), `emp-text-${randomUUID()}.jpg`);
  try {
    await fs.writeFile(tmp, jpeg);
    return (await runOcr(tmp)).raw;
  } catch (e) {
    log(`Text-OCR Fehler: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}
