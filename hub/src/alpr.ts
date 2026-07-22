/**
 * fast-alpr Daemon-Anbindung (hub/alpr/alpr_daemon.py).
 *
 * Zweistufige ALPR: YOLO-Plattendetektor + spezialisierte Plate-OCR (ONNX).
 * Läuft als langlebiger Python-Prozess; Anfragen via JSON-Zeilen über stdin/stdout.
 * Primäre Erkennungsstufe – macOS Vision (plate.ts) bleibt Fallback.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { CONFIG, log } from "./config.js";

const ALPR_DIR = path.join(CONFIG.hubDir, "alpr");
const PYTHON = path.join(ALPR_DIR, ".venv", "bin", "python");
const DAEMON = path.join(ALPR_DIR, "alpr_daemon.py");
const REQUEST_TIMEOUT_MS = Number(process.env.HUB_ALPR_TIMEOUT_MS || 20_000);
const STARTUP_TIMEOUT_MS = 30_000;

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

type Daemon = ChildProcessByStdio<Writable, Readable, null>;

let child: Daemon | null = null;
let ready: Promise<boolean> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let disabled = false;

export function alprAvailable(): boolean {
  return !disabled && existsSync(PYTHON) && existsSync(DAEMON) && process.env.HUB_ALPR !== "0";
}

function teardown(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`ALPR-Daemon beendet (${reason})`));
  }
  pending.clear();
  child = null;
  ready = null;
}

function startDaemon(): Promise<boolean> {
  if (ready) return ready;
  if (!alprAvailable()) return Promise.resolve(false);

  ready = new Promise<boolean>((resolve) => {
    log("ALPR: starte fast-alpr Daemon …");
    const proc = spawn(PYTHON, [DAEMON], {
      cwd: ALPR_DIR,
      stdio: ["pipe", "pipe", "ignore"],
    }) as Daemon;
    child = proc;

    const startupTimer = setTimeout(() => {
      log("ALPR: Daemon-Start Timeout – deaktiviert für diese Session");
      disabled = true;
      proc.kill("SIGKILL");
      resolve(false);
    }, STARTUP_TIMEOUT_MS);

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
      teardown(e.message);
      if (!isReady) resolve(false);
    });
    proc.on("close", (code) => {
      clearTimeout(startupTimer);
      if (isReady) log(`ALPR: Daemon beendet (code=${code}) – Neustart beim nächsten Aufruf`);
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
      log("ALPR: Request-Timeout – Daemon wird neu gestartet");
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
