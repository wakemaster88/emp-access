/**
 * fast-alpr Daemon-Anbindung (hub/alpr/alpr_daemon.py).
 *
 * Zweistufige ALPR: YOLO-Plattendetektor + spezialisierte Plate-OCR (ONNX).
 * Läuft als langlebiger Python-Prozess; Anfragen via JSON-Zeilen über stdin/stdout.
 * Primäre Erkennungsstufe – macOS Vision (plate.ts) bleibt Fallback.
 *
 * Startet der Daemon nicht rechtzeitig (Modell-Download, CPU voll), wird er
 * nicht für die ganze Session abgeschaltet, sondern mit wachsendem Abstand
 * erneut versucht (5 → 10 → 20 → 30 min). Seine stderr-Ausgabe landet in
 * einem kleinen Ring und wird beim Abbruch mitgeloggt, statt zu verschwinden.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { CONFIG, log } from "./config.js";
import { STATE } from "./state.js";

const ALPR_DIR = path.join(CONFIG.hubDir, "alpr");
const PYTHON = path.join(ALPR_DIR, ".venv", "bin", "python");
const DAEMON = path.join(ALPR_DIR, "alpr_daemon.py");
const REQUEST_TIMEOUT_MS = Number(process.env.HUB_ALPR_TIMEOUT_MS || 20_000);
const STARTUP_TIMEOUT_MS = Number(process.env.HUB_ALPR_STARTUP_TIMEOUT_MS || 60_000);
const RETRY_MIN_MS = 5 * 60_000;
const RETRY_MAX_MS = 30 * 60_000;
const STDERR_RING = 30;

export interface AlprCandidate {
  /** Kompakter OCR-Text, z. B. "BOQC626E". */
  text: string;
  ocrConf: number;
  detConf: number;
  tiled?: boolean;
}

interface Pending {
  resolve: (candidates: AlprCandidate[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

type Daemon = ChildProcessByStdio<Writable, Readable, Readable>;

let child: Daemon | null = null;
let ready: Promise<boolean> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Bis wann kein Startversuch – 0 = sofort erlaubt. */
let disabledUntil = 0;
let retryMs = RETRY_MIN_MS;
/** Letzte stderr-Zeilen des Daemons (Tracebacks, Modell-Download). */
let stderrTail: string[] = [];

function installed(): boolean {
  return existsSync(PYTHON) && existsSync(DAEMON) && process.env.HUB_ALPR !== "0";
}

export function alprAvailable(): boolean {
  return installed() && Date.now() >= disabledUntil;
}

/** Für Dashboard/Diagnose: Zustand in Worten. */
export function alprStatus(): { installed: boolean; running: boolean; pausedUntil: string | null; stderr: string[] } {
  return {
    installed: installed(),
    running: !!child && STATE.alpr.ready,
    pausedUntil: Date.now() < disabledUntil ? new Date(disabledUntil).toISOString() : null,
    stderr: stderrTail.slice(-10),
  };
}

function pause(reason: string): void {
  disabledUntil = Date.now() + retryMs;
  log(
    `ALPR: ${reason} – Pause bis ${new Date(disabledUntil).toLocaleTimeString("de-DE")}, dann neuer Versuch` +
      (stderrTail.length ? `\n  stderr: ${stderrTail.slice(-5).join(" | ")}` : "")
  );
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

function teardown(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`ALPR-Daemon beendet (${reason})`));
  }
  pending.clear();
  child = null;
  ready = null;
  STATE.alpr.ready = false;
}

function startDaemon(): Promise<boolean> {
  if (ready) return ready;
  if (!alprAvailable()) return Promise.resolve(false);

  ready = new Promise<boolean>((resolve) => {
    log("ALPR: starte fast-alpr Daemon …");
    stderrTail = [];
    const proc = spawn(PYTHON, [DAEMON], {
      cwd: ALPR_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    }) as Daemon;
    child = proc;

    const startupTimer = setTimeout(() => {
      pause(`Daemon-Start nach ${Math.round(STARTUP_TIMEOUT_MS / 1000)} s nicht bereit`);
      proc.kill("SIGKILL");
      resolve(false);
    }, STARTUP_TIMEOUT_MS);

    let stderrBuf = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString("utf8");
      let idx: number;
      while ((idx = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, idx).trim();
        stderrBuf = stderrBuf.slice(idx + 1);
        if (!line) continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_RING) stderrTail.splice(0, stderrTail.length - STDERR_RING);
      }
    });

    let buffer = "";
    let isReady = false;
    proc.stdout.on("data", (d: Buffer) => {
      buffer += d.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            ready?: boolean;
            id?: number;
            candidates?: AlprCandidate[];
            error?: string;
          };
          if (msg.ready) {
            isReady = true;
            clearTimeout(startupTimer);
            retryMs = RETRY_MIN_MS;
            STATE.alpr.ready = true;
            log("ALPR: Daemon bereit");
            resolve(true);
            continue;
          }
          if (typeof msg.id === "number") {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              clearTimeout(p.timer);
              if (msg.error) p.reject(new Error(msg.error));
              else p.resolve(Array.isArray(msg.candidates) ? msg.candidates : []);
            }
          }
        } catch {
          // Ignorier kaputte Zeilen (z. B. Fortschrittsausgaben beim Modell-Download).
        }
      }
    });

    proc.on("error", (e) => {
      clearTimeout(startupTimer);
      log(`ALPR: Daemon-Fehler: ${e.message}`);
      if (!isReady) pause(`Daemon-Start fehlgeschlagen (${e.message})`);
      teardown(e.message);
      if (!isReady) resolve(false);
    });
    proc.on("close", (code) => {
      clearTimeout(startupTimer);
      if (isReady) {
        log(
          `ALPR: Daemon beendet (code=${code}) – Neustart beim nächsten Aufruf` +
            (code && stderrTail.length ? `\n  stderr: ${stderrTail.slice(-5).join(" | ")}` : "")
        );
      } else if (code !== null && code !== 0 && Date.now() >= disabledUntil) {
        // Abbruch vor „ready“ ohne Timeout: z. B. fehlendes Modul im venv.
        pause(`Daemon vor Bereitschaft beendet (code=${code})`);
      }
      teardown(`code=${code}`);
      if (!isReady) resolve(false);
    });
  });
  return ready;
}

/** Daemon beim Hub-Start vorwärmen (Modell-Load dauert einige Sekunden). */
export function alprWarmup(): void {
  if (alprAvailable()) void startDaemon();
}

/**
 * Kennzeichen-Kandidaten für ein JPEG (Dateipfad) via fast-alpr.
 * Leeres Array = nichts gefunden oder ALPR nicht verfügbar.
 */
export async function alprDetect(imagePath: string): Promise<AlprCandidate[]> {
  if (!alprAvailable()) return [];
  const ok = await startDaemon();
  if (!ok || !child) return [];

  const id = nextId++;
  const proc = child;
  return new Promise<AlprCandidate[]>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      log(
        `ALPR: Request-Timeout (${Math.round(REQUEST_TIMEOUT_MS / 1000)} s) – Daemon wird neu gestartet` +
          (stderrTail.length ? `\n  stderr: ${stderrTail.slice(-3).join(" | ")}` : "")
      );
      proc.kill("SIGKILL");
      resolve([]);
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, {
      resolve: (candidates) => resolve(candidates),
      reject: () => resolve([]),
      timer,
    });
    proc.stdin.write(JSON.stringify({ id, path: imagePath }) + "\n");
  });
}
