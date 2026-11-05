/**
 * Auslastung des KI-Modells fuer die Kachel „KI-Assistent“ unter Systeme:
 * GPU (ioreg, Apple Silicon, ohne Root), CPU und RAM der Ollama-Prozesse,
 * belegter Modellspeicher (Ollama /api/ps) und wie viel der letzten
 * 5 Minuten das Modell gerechnet hat. Abtastung alle 10 s, Verlauf 10 min.
 */
import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { promisify } from "node:util";
import { busyPct, parseGpuUtil, parseOllamaPs } from "./ai-load-rules.js";

const execFileAsync = promisify(execFile);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const SAMPLE_MS = 10_000;
const HISTORY = 60;
const BUSY_WINDOW_MS = 5 * 60_000;

export interface AiLoad {
  gpuPct: number | null;
  cpuPct: number | null;
  /** RAM der Ollama-Prozesse bzw. der geladenen Modelle (das Groessere), Bytes. */
  ramBytes: number;
  ramPct: number;
  models: string[];
  busyPct: number;
  gpuHistory: number[];
  at: number;
}

export const AI_LOAD: AiLoad = { gpuPct: null, cpuPct: null, ramBytes: 0, ramPct: 0, models: [], busyPct: 0, gpuHistory: [], at: 0 };

const spans: Array<{ start: number; end: number }> = [];

/** Aus ollama.ts: eine Anfrage an das Modell lief von start bis end. */
export function noteModelWork(start: number, end: number): void {
  spans.push({ start, end });
  const cut = Date.now() - BUSY_WINDOW_MS;
  while (spans.length && spans[0].end < cut) spans.shift();
}

async function sample(): Promise<void> {
  const now = Date.now();
  if (process.platform === "darwin") {
    const io = await execFileAsync("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"], { timeout: 4_000, maxBuffer: 4 * 1024 * 1024 }).catch(() => null);
    AI_LOAD.gpuPct = io ? parseGpuUtil(io.stdout) : null;
  }
  const ps = await execFileAsync("ps", ["-A", "-o", "%cpu=,rss=,comm="], { timeout: 4_000, maxBuffer: 4 * 1024 * 1024 }).catch(() => null);
  const proc = ps ? parseOllamaPs(ps.stdout, cpus().length) : null;
  AI_LOAD.cpuPct = proc && proc.procs > 0 ? proc.cpuPct : null;
  let modelBytes = 0;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2_000) });
    const body = (await res.json()) as { models?: Array<{ name: string; size?: number }> };
    AI_LOAD.models = (body.models ?? []).map((m) => m.name);
    modelBytes = (body.models ?? []).reduce((a, m) => a + (m.size ?? 0), 0);
  } catch {
    AI_LOAD.models = [];
  }
  AI_LOAD.ramBytes = Math.max(modelBytes, proc?.rssBytes ?? 0);
  AI_LOAD.ramPct = Math.round((AI_LOAD.ramBytes / totalmem()) * 1000) / 10;
  AI_LOAD.busyPct = busyPct(spans, now, BUSY_WINDOW_MS);
  if (AI_LOAD.gpuPct != null) {
    AI_LOAD.gpuHistory.push(AI_LOAD.gpuPct);
    if (AI_LOAD.gpuHistory.length > HISTORY) AI_LOAD.gpuHistory.shift();
  }
  AI_LOAD.at = now;
}

let started = false;
export function startAiLoad(): void {
  if (started) return;
  started = true;
  void sample();
  setInterval(() => void sample().catch(() => undefined), SAMPLE_MS).unref?.();
}

/** Kurztext fuer die Kachel: „GPU 42 % · CPU 8 % · RAM 25 GB (39 %) · aktiv 12 %“. */
export function aiLoadText(): string {
  if (!AI_LOAD.at) return "";
  const parts: string[] = [];
  if (AI_LOAD.gpuPct != null) parts.push(`GPU ${Math.round(AI_LOAD.gpuPct)} %`);
  if (AI_LOAD.cpuPct != null) parts.push(`CPU ${Math.round(AI_LOAD.cpuPct)} %`);
  if (AI_LOAD.ramBytes > 0) parts.push(`RAM ${(AI_LOAD.ramBytes / 1024 ** 3).toFixed(1)} GB (${Math.round(AI_LOAD.ramPct)} %)`);
  parts.push(`aktiv ${Math.round(AI_LOAD.busyPct)} % (5 min)`);
  return parts.join(" · ");
}
