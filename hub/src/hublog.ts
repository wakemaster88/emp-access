/**
 * Log-Abruf aus der Cloud (Task HUB_LOG): liefert das Ende des Hub-Logs,
 * des Fehler-Logs oder der Diagnose-Zusammenfassung, ohne SSH oder Zugriff
 * auf die Maschine. Gelesen wird nur das Dateiende (max. 1 MB), die Zeilen
 * werden optional gefiltert und Tokens in URLs vorsorglich geschwärzt.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CONFIG } from "./config.js";
import { STATE } from "./state.js";

export type HubLogFile = "hub" | "error" | "improve";

const MAX_LINES = 2_000;
const DEFAULT_LINES = 400;
/** Nur das Dateiende lesen – ein Log kann über Wochen viele MB werden. */
const TAIL_BYTES = 1024 * 1024;
/** Obergrenze für das Task-Ergebnis (JSON in der DB, Anzeige im Browser). */
const MAX_CHARS = 250_000;

function logDir(): string {
  return process.env.HUB_LOG_DIR || path.join(homedir(), "Library", "Logs");
}

export function hubLogPath(file: HubLogFile): string {
  switch (file) {
    case "error":
      return process.env.HUB_ERROR_LOG_FILE || path.join(logDir(), "emp-hub.error.log");
    case "improve":
      return path.join(CONFIG.hubDir, ".cache", "improve-latest.md");
    default:
      return process.env.HUB_LOG_FILE || path.join(logDir(), "emp-hub.log");
  }
}

/** Tokens/Passwörter in Query-Strings unkenntlich machen. */
function redact(line: string): string {
  return line.replace(/((?:token|password|passwd|pwd|secret)=)[^&\s"']+/gi, "$1…");
}

export interface HubLogResult {
  file: HubLogFile;
  path: string;
  exists: boolean;
  sizeBytes: number;
  mtime: string | null;
  /** Zeilen nach Filter, älteste zuerst. */
  lines: string[];
  /** Zeilen im gelesenen Ausschnitt vor dem Filter. */
  scanned: number;
  /** true = es gab mehr Zeilen, als geliefert wurden. */
  truncated: boolean;
  grep: string | null;
  hub: string;
  version: string;
  at: string;
}

export async function readHubLog(payload: Record<string, unknown> | null): Promise<HubLogResult> {
  const fileRaw = String(payload?.file ?? "hub");
  const file: HubLogFile = fileRaw === "error" || fileRaw === "improve" ? fileRaw : "hub";
  const wanted = Math.min(MAX_LINES, Math.max(1, Number(payload?.lines) || DEFAULT_LINES));
  const grep = String(payload?.grep ?? "").trim().slice(0, 200) || null;
  const filePath = hubLogPath(file);

  const base = {
    file,
    path: filePath,
    grep,
    hub: CONFIG.name,
    version: CONFIG.version,
    at: new Date().toISOString(),
  };

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    if (length > 0) await handle.read(buf, 0, length, start);
    let text = buf.toString("utf8");
    // Angeschnittene erste Zeile verwerfen, wenn nicht vom Dateianfang gelesen.
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    const all = text.split("\n").filter((l) => l.length > 0);
    const needle = grep?.toLowerCase();
    const filtered = needle ? all.filter((l) => l.toLowerCase().includes(needle)) : all;
    let lines = filtered.slice(-wanted).map(redact);
    let chars = lines.reduce((n, l) => n + l.length + 1, 0);
    while (chars > MAX_CHARS && lines.length > 1) {
      chars -= lines[0].length + 1;
      lines = lines.slice(1);
    }
    return {
      ...base,
      exists: true,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
      lines,
      scanned: all.length,
      truncated: start > 0 || filtered.length > lines.length,
    };
  } catch {
    // Datei fehlt (Hub läuft z. B. nicht unter launchd): Ring aus dem Speicher.
    const mem = STATE.logs.map((l) => `[${l.ts}] ${l.msg}`);
    const needle = grep?.toLowerCase();
    const filtered = needle ? mem.filter((l) => l.toLowerCase().includes(needle)) : mem;
    return {
      ...base,
      exists: false,
      sizeBytes: 0,
      mtime: null,
      lines: filtered.slice(-wanted).map(redact),
      scanned: mem.length,
      truncated: filtered.length > wanted,
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
