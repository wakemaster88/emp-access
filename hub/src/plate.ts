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
  readsAs,
  whitelistLookup,
  type OcrCandidate,
  type OcrResult,
  type PlateMatchKind,
} from "./plate-match.js";
import { LOCAL_CITY_CODES } from "./plate-cities.js";
import { ChangeLog } from "./change-log.js";
import { recordHubEvent } from "./state.js";
import {
  agoText,
  cacheOkAt,
  cacheWriteDue,
  mergeTriggeredAt,
  staleAlertSource,
  staleAlertStep,
  whitelistMaxAgeMs,
  whitelistState,
  whitelistWait,
} from "./whitelist-rules.js";

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
/** Abruf, den die Kennzeichen-Suche bei alter Liste anstoesst: Zeitlimit … */
const WHITELIST_SHARED_TIMEOUT_MS = 8_000;
/** … und so lange wartet ein Bild hoechstens darauf. */
const WHITELIST_MAX_WAIT_MS = 1_500;
/** Nach einem gescheiterten Abruf so lange kein Warten (Abruf nur im Hintergrund). */
const WHITELIST_RETRY_MS = 60_000;
/** Der Abruf-Zeitpunkt in der Cache-Datei ist hoechstens so alt (Alter nach Neustart ohne Cloud). */
const WHITELIST_STAMP_MS = 3_600_000;
/**
 * Hoechstalter der Liste ohne Cloud (HUB_WHITELIST_MAX_AGE_H, Standard 168 h,
 * 0 = unbegrenzt; Entscheidung vom 25.11.2026). Danach schaltet kein
 * Kennzeichen mehr, bis ein Abruf wieder gelingt (whitelistMayActuate).
 */
const WHITELIST_MAX_AGE_MS = whitelistMaxAgeMs(process.env.HUB_WHITELIST_MAX_AGE_H);

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
  /**
   * Ein Shelly ist zugewiesen, auch ohne IP-Adresse (dann schaltet ihn die
   * Cloud); null = die Cloud liefert die Angabe nicht (älterer Stand).
   */
  shellyLinked: boolean | null;
}

type WhitelistEntry = CachedVehicle;

let whitelist: WhitelistEntry[] = [];
/** Wann die Liste im Speicher gesetzt wurde (Cloud oder Cache-Datei); 0 = noch nie. */
let whitelistLoadedAt = 0;
/** Letzter GELUNGENER Abruf aus der Cloud, ueber Neustarts aus der Cache-Datei; null = unbekannt. */
let whitelistOkAt: number | null = null;
/** Letzter gescheiterter Abruf (0 = keiner seit dem letzten gelungenen). */
let whitelistFailedAt = 0;
/** Laufender Abruf der Liste – hoechstens einer gleichzeitig – und sein Beginn. */
let whitelistFetch: Promise<void> | null = null;
let whitelistFetchStartedAt: number | null = null;
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
    shellyLinked: typeof r.shellyLinked === "boolean" ? r.shellyLinked : null,
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

/** Inhalt der zuletzt uebernommenen Liste (fuer „hat sich etwas geaendert?“). */
let whitelistSignature: string | null = null;
/** Inhalt, der sicher in der Datei steht; weicht er ab, wird beim naechsten Abruf wieder geschrieben. */
let whitelistPersisted: string | null = null;
/** Abruf-Zeitpunkt, der sicher in der Datei steht (null = noch keiner geschrieben). */
let persistedOkAt: number | null = null;

/**
 * Liste fuer den Betrieb ohne Cloud sichern; true = geschrieben. `fetchedAt`
 * ist der letzte gelungene Abruf, `at` nur der Zeitpunkt des Schreibens
 * (auch eine lokale Oeffnung schreibt die Datei).
 */
function persistWhitelist(): Promise<boolean> {
  const okAt = whitelistOkAt;
  return fs
    .mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() =>
      fs.writeFile(
        CACHE_FILE,
        JSON.stringify({ at: Date.now(), fetchedAt: okAt, localActuators, vehicles: whitelist })
      )
    )
    .then(
      () => {
        if (okAt != null) persistedOkAt = okAt;
        return true;
      },
      () => false
    );
}

/** Inhalt der Cache-Datei; null = keine Datei oder unlesbar. */
async function readWhitelistCache(): Promise<{
  vehicles: CachedVehicle[];
  localActuators: boolean;
  okAt: number | null;
} | null> {
  try {
    const [text, st] = await Promise.all([fs.readFile(CACHE_FILE, "utf8"), fs.stat(CACHE_FILE)]);
    const raw = JSON.parse(text) as { vehicles?: unknown; localActuators?: boolean; fetchedAt?: unknown };
    if (!Array.isArray(raw.vehicles)) return null;
    return {
      vehicles: raw.vehicles.map((v) => hydrateVehicle(v as CachedVehicle)),
      localActuators: raw.localActuators === true,
      okAt: cacheOkAt({ fetchedAt: raw.fetchedAt, mtimeMs: st.mtimeMs }),
    };
  } catch {
    return null;
  }
}

async function loadWhitelistFromDisk(): Promise<boolean> {
  // Schon eine Liste gesetzt (auch eine in der Cloud geleerte): die gilt.
  if (whitelistLoadedAt > 0) return whitelist.length > 0;
  const cached = await readWhitelistCache();
  if (!cached || cached.vehicles.length === 0) return false;
  // Waehrend des Lesens ist ein Abruf gelungen: dessen Liste gilt.
  if (whitelistLoadedAt > 0) return whitelist.length > 0;
  whitelist = cached.vehicles;
  localActuators = cached.localActuators;
  whitelistLoadedAt = Date.now();
  if (cached.okAt != null && (whitelistOkAt == null || cached.okAt > whitelistOkAt)) whitelistOkAt = cached.okAt;
  log(
    `Fahrzeuge: ${whitelist.length} Einträge aus Cache (offline, ${listAgeText(Date.now())}${
      localActuators ? ", lokale Aktoren" : ""
    })`
  );
  return true;
}

/** „Stand vor 2 Stunden“ – Alter der Liste nach dem letzten gelungenen Abruf. */
function listAgeText(now: number): string {
  return whitelistOkAt == null ? "Stand unbekannt" : `Stand vor ${agoText(now - whitelistOkAt)}`;
}

/*
 * Scheitert der Abruf, gilt die letzte Liste weiter. Das steht im Log:
 * sofort und dann hoechstens alle 30 min, mit Ursache und Alter der Liste,
 * dazu einmal der erste Erfolg danach. Ohne diese Zeilen saehe „Abruf
 * scheitert seit Tagen“ im Log aus wie „Liste unveraendert“.
 */
const whitelistFailLog = new ChangeLog(30 * 60_000);
let whitelistFailing = false;

/*
 * Liste zu alt (HUB_WHITELIST_MAX_AGE_H): Zeile beim Eintritt und dann
 * hoechstens alle 30 min, ein Hub-Ereignis beim Eintritt, beim ersten
 * gelungenen Abruf einmal die Entwarnung.
 */
const staleLog = new ChangeLog(30 * 60_000);
let staleNoted = false;

/*
 * Dieselbe Meldung geht als Befund an die Cloud (POST /api/hub/alerts,
 * Quelle „fahrzeugliste“, dort Push und Telegram), sobald sie erreichbar ist:
 * Faellt nur der Abruf der Liste aus, erfaehrt der Betreiber so davon. Der
 * erste gelungene Abruf nimmt den Befund zurueck (nach einem Neustart einmal
 * vorsorglich). Was zu senden ist, entscheidet staleAlertStep; nach einem
 * gescheiterten Versuch fruehestens 30 min spaeter wieder.
 */
// Quelle und Schluessel je Hub: Die Cloud schliesst, was eine Quelle nicht
// mehr meldet; ein zweiter Hub am selben Konto schliesst so nicht den Befund
// eines anderen.
const STALE_ALERT_SOURCE = staleAlertSource(CONFIG.name);
const STALE_ALERT_KEY = `${STALE_ALERT_SOURCE}:zu-alt`;
const STALE_ALERT_RETRY_MS = 30 * 60_000;
/** Was die Cloud bestaetigt hat: true = Befund offen, false = keiner, null = unbekannt (nach dem Start). */
let staleAlertReported: boolean | null = null;
let staleAlertFailedAt = 0;
let staleAlertSending = false;

function syncStaleAlert(stale: boolean, now: number, since: string): void {
  if (staleAlertSending) return;
  const step = staleAlertStep({
    stale,
    reported: staleAlertReported,
    now,
    failedAt: staleAlertFailedAt,
    retryMs: STALE_ALERT_RETRY_MS,
  });
  if (!step) return;
  staleAlertSending = true;
  const alerts =
    step === "open"
      ? [
          {
            key: STALE_ALERT_KEY,
            title: "Fahrzeugliste zu alt – automatische Öffnung ausgesetzt",
            detail:
              `Der Hub konnte die Fahrzeugliste seit ${since} nicht aus der Cloud abrufen. ` +
              "Kennzeichen öffnen Tor, Tür und Shelly erst wieder, wenn ein Abruf gelingt.",
            severity: "warn",
          },
        ]
      : [];
  void api("/api/hub/alerts", {
    method: "POST",
    body: JSON.stringify({ hubName: CONFIG.name, source: STALE_ALERT_SOURCE, alerts }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      staleAlertReported = step === "open";
      staleAlertFailedAt = 0;
      if (step === "open") log("Fahrzeugliste zu alt: an die Cloud gemeldet (Push und Telegram)");
    })
    .catch(() => {
      // Die Zeile zur Sperre steht ohnehin alle 30 min im Log. Ob die Cloud
      // den Befund trotzdem gespeichert hat (Zeitueberschreitung), ist offen:
      // Dann geht beim naechsten Anlass die Entwarnung vorsorglich hinaus.
      staleAlertFailedAt = Date.now();
      staleAlertReported = null;
    })
    .finally(() => {
      staleAlertSending = false;
    });
}

function noteStale(now: number): void {
  const since = whitelistOkAt == null ? "unbekannter Zeit" : agoText(now - whitelistOkAt);
  if (!staleNoted) {
    staleNoted = true;
    recordHubEvent({
      kind: "system",
      severity: "warn",
      where: "Fahrzeugliste",
      title: "Fahrzeugliste zu alt – automatische Öffnung ausgesetzt",
      detail: `seit ${since} nicht erneuert`,
    });
  }
  if (staleLog.shouldLog("stale", "zu alt", now)) {
    log(`Fahrzeugliste seit ${since} nicht erneuert, automatische Öffnung ausgesetzt`);
  }
  syncStaleAlert(true, now, since);
}

/**
 * Darf ein Kennzeichen-Treffer noch Tor, Tuer oder Shelly schalten? Nein,
 * wenn der letzte gelungene Abruf der Liste aelter als
 * HUB_WHITELIST_MAX_AGE_H ist (Standard 7 Tage). Erkennung, Sichtungen und
 * Anzeige arbeiten mit der Liste weiter; der erste gelungene Abruf hebt die
 * Sperre auf.
 */
export function whitelistMayActuate(now = Date.now()): boolean {
  if (whitelistState({ now, lastOkAt: whitelistOkAt, maxAgeMs: WHITELIST_MAX_AGE_MS }) !== "stale") return true;
  noteStale(now);
  return false;
}

async function whitelistFetchFailed(reason: string): Promise<void> {
  if (whitelist.length === 0) await loadWhitelistFromDisk();
  const now = Date.now();
  whitelistFailing = true;
  whitelistFailedAt = now;
  // Auch ohne Fahrzeug an der Kamera: Die Sperre steht im Log, sobald sie gilt.
  if (whitelist.length > 0) whitelistMayActuate(now);
  if (!whitelistFailLog.shouldLog("fetch", "fehlgeschlagen", now)) return;
  log(
    `Fahrzeuge: Abruf der Liste fehlgeschlagen (${reason}), ` +
      (whitelist.length > 0
        ? `die letzte Liste mit ${whitelist.length} Einträgen gilt weiter (${listAgeText(now)})`
        : "keine Liste geladen")
  );
}

/** Ein Abruf der Liste; scheitert nie (Fehler landen in whitelistFetchFailed). */
async function fetchWhitelist(timeoutMs?: number): Promise<void> {
  try {
    const res = await api("/api/hub/allowed-vehicles", timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
    if (!res.ok) {
      await whitelistFetchFailed(`HTTP ${res.status}`);
      return;
    }
    const json = (await res.json()) as {
      vehicles?: CachedVehicle[];
      localActuators?: boolean;
    };
    // Lokale Oeffnungen sind der Cloud erst mit dem Upload bekannt: je
    // Fahrzeug den neueren Schaltzeitpunkt behalten, nach einem Neustart den
    // aus der Cache-Datei. Sonst vergaesse das Nachladen die Sperrzeit. Ein
    // lokaler Wert weit in der Zukunft (Uhr ging vor) zaehlt dabei nicht.
    const local = whitelist.length > 0 ? whitelist : ((await readWhitelistCache())?.vehicles ?? []);
    const now = Date.now();
    const previousOkAt = whitelistOkAt;
    whitelist = mergeTriggeredAt(local, (json.vehicles ?? []).map((v) => hydrateVehicle(v)), now);
    localActuators = json.localActuators === true;
    whitelistLoadedAt = now;
    whitelistOkAt = now;
    whitelistFailedAt = 0;
    const recovered = whitelistFailing;
    if (recovered) {
      whitelistFailing = false;
      whitelistFailLog.shouldLog("fetch", "", now);
    }
    if (staleNoted) {
      staleNoted = false;
      staleLog.shouldLog("stale", "", now);
      log("Fahrzeugliste erneuert, automatische Öffnung wieder aktiv");
      recordHubEvent({ kind: "system", severity: "info", where: "Fahrzeugliste", title: "Fahrzeugliste erneuert – automatische Öffnung wieder aktiv" });
    }
    syncStaleAlert(false, now, "");
    // Alle 5 Minuten abgeholt; Datei und Log-Zeile nur, wenn sich etwas
    // geaendert hat (vorher 288 gleiche Zeilen und Schreibvorgaenge am Tag)
    // oder der Abruf davor gescheitert war. Die Datei zusaetzlich einmal je
    // Stunde, damit ihr Abruf-Zeitpunkt nach einem Neustart ohne Cloud stimmt.
    const signature = JSON.stringify([localActuators, json.vehicles ?? []]);
    if (cacheWriteDue({ changed: signature !== whitelistPersisted, now, persistedOkAt, stampMs: WHITELIST_STAMP_MS })) {
      void persistWhitelist().then((ok) => {
        if (ok) whitelistPersisted = signature;
      });
    }
    if (signature === whitelistSignature && !recovered) return;
    whitelistSignature = signature;
    log(
      `Fahrzeuge: ${whitelist.length} Whitelist-Einträge vom Server${
        localActuators ? " (lokale Aktoren)" : ""
      }${recovered ? ` (Abruf klappt wieder${previousOkAt == null ? "" : `, letzter Abruf vor ${agoText(now - previousOkAt)}`})` : ""}`
    );
  } catch (e) {
    await whitelistFetchFailed(e instanceof Error ? e.message : String(e));
  }
}

function startWhitelistFetch(timeoutMs?: number): Promise<void> {
  const run = fetchWhitelist(timeoutMs);
  whitelistFetch = run;
  whitelistFetchStartedAt = Date.now();
  const done = (): void => {
    if (whitelistFetch !== run) return;
    whitelistFetch = null;
    whitelistFetchStartedAt = null;
  };
  run.then(done, done);
  return run;
}

/**
 * Liste aus der Cloud holen (alle 5 min und nach Aenderungen). Laeuft schon
 * ein Abruf, folgt danach ein eigener: Wer nach einer Aenderung (Telegram,
 * Dashboard) nachlaedt, braucht den Stand danach. Nie zwei gleichzeitig.
 */
export function refreshVehicleWhitelist(): Promise<void> {
  const before = whitelistFetch;
  if (!before) return startWhitelistFetch();
  return before.then(() => (whitelistFetch && whitelistFetch !== before ? whitelistFetch : startWhitelistFetch()));
}

/** Für Offline-Backfill: Whitelist ohne Cloud-API setzen. */
export function setVehicleWhitelist(entries: WhitelistEntry[]): void {
  whitelist = entries.map((v) => hydrateVehicle(v));
  whitelistLoadedAt = Date.now();
  whitelistOkAt = whitelistLoadedAt;
}

/** Auf `work` warten, aber hoechstens `maxMs`. */
function atMost(work: Promise<unknown>, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

/**
 * Liste fuer den Abgleich eines Bilds. Die Kennzeichen-Suche wartet nie
 * lange: Ist die Liste aelter als 5 min, laeuft ein gemeinsamer Abruf
 * (Zeitlimit 8 s), auf den alle Bilder zusammen hoechstens 1,5 s ab seinem
 * Beginn warten; nach einem gescheiterten Abruf eine Minute lang gar nicht
 * (whitelistWait). Nur ohne jede Liste (Start ohne Cache-Datei) wartet sie
 * bis zum Ende des Abrufs.
 */
async function ensureWhitelist(): Promise<WhitelistEntry[]> {
  if (whitelist.length === 0) await loadWhitelistFromDisk();
  const plan = whitelistWait({
    now: Date.now(),
    hasList: whitelistLoadedAt > 0,
    loadedAt: whitelistLoadedAt,
    ttlMs: WHITELIST_TTL_MS,
    failedAt: whitelistFailedAt,
    retryMs: WHITELIST_RETRY_MS,
    maxWaitMs: WHITELIST_MAX_WAIT_MS,
    fetchStartedAt: whitelistFetch ? whitelistFetchStartedAt : null,
  });
  if (!plan.fetch) return whitelist;
  const hasList = whitelistLoadedAt > 0;
  const run = whitelistFetch ?? startWhitelistFetch(hasList ? WHITELIST_SHARED_TIMEOUT_MS : undefined);
  if (!Number.isFinite(plan.waitMs)) await run;
  else if (plan.waitMs > 0) await atMost(run, plan.waitMs);
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

/**
 * Listen-Fahrzeug zu einem Kennzeichen: Zeichen für Zeichen, ein Kreis mit
 * Umlaut auch in der Schreibweise ohne Umlaut (whitelistLookup in
 * plate-match.ts, Entscheidung vom 25.11.2026).
 */
export function findAllowedVehicle(plate: string): CachedVehicle | null {
  const n = normalizePlate(plate);
  if (n.length < 4) return null;
  return whitelistLookup(whitelist)(n);
}

/** True, wenn die Cloud-API Aktoren mitliefert und skipActuators versteht. */
export function vehicleLocalActuatorsEnabled(): boolean {
  return localActuators;
}

export function markVehicleTriggered(id: number): void {
  const v = whitelist.find((x) => x.id === id);
  if (v) v.lastTriggeredAt = Date.now();
  void persistWhitelist();
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
  // Tie-Break GT-K vs. G-TK: Kreis aus der Region gewinnt.
  if (LOCAL_CITY_CODES.has(city)) s += 2;
  if (new Set(mid).size === mid.length) s += 1;
  return s;
}

/** Alle plausiblen DE-Splits eines kompakten OCR-Texts ("BOXY474E" → "BO-XY 474E" …). */
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

/** Mindest-Confidence fuer ein nicht gelistetes Kennzeichen (HUB_PLATE_MIN_CONF). */
export function plateAutoMinConf(): number {
  return MIN_CONF;
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
          // readsAs: auch die Lesung ohne Umlaut hinter einem Kennzeichen mit Umlaut.
          const match = result.candidates.find((c) => readsAs(c.plate, plate));
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
      const match = result.candidates.find((c) => readsAs(c.plate, plate));
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
