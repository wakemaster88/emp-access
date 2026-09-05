/**
 * Log-Abruf aus der Cloud (Task HUB_LOG): liefert Ausschnitte des Hub-Logs,
 * des Fehler-Logs oder der Diagnose-Zusammenfassung, ohne SSH oder Zugriff
 * auf die Maschine.
 *
 * Gelesen wird immer nur ein Fenster von 1 MB. Wo das Fenster liegt, sagt
 * der Aufrufer: am Dateiende (Standard), vor oder nach einer Byte-Position
 * (Blättern) oder ab einem Zeitpunkt – dafür wird die Datei per Binärsuche
 * über die `[ISO-Zeitstempel]` am Zeilenanfang durchsucht, was auch bei
 * 100 MB nur ein paar Lesezugriffe kostet. Tokens in URLs werden
 * vorsorglich geschwärzt.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CONFIG } from "./config.js";
import { STATE } from "./state.js";

export type HubLogFile = "hub" | "error" | "improve";
export type HubLogMode = "tail" | "at" | "before" | "after";

const MAX_LINES = 2_000;
const DEFAULT_LINES = 400;
/** Fenstergröße – ein Log kann über Wochen viele MB werden. */
const WINDOW_BYTES = 1024 * 1024;
/** Sondierung bei der Zeitsuche. */
const PROBE_BYTES = 64 * 1024;
/** Obergrenze für das Task-Ergebnis (JSON in der DB, Anzeige im Browser). */
const MAX_CHARS = 250_000;
const TS_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/;

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
  /** Zeilen im gelesenen Fenster vor dem Filter. */
  scanned: number;
  /** true = im Fenster gab es mehr passende Zeilen, als geliefert wurden. */
  truncated: boolean;
  grep: string | null;
  mode: HubLogMode;
  /** Byte-Bereich der gelieferten Zeilen – zum Blättern (`before`/`after`). */
  windowStart: number;
  windowEnd: number;
  hasOlder: boolean;
  hasNewer: boolean;
  /** Zeitstempel der ersten/letzten gelieferten Zeile, falls erkennbar. */
  firstTs: string | null;
  lastTs: string | null;
  hub: string;
  version: string;
  at: string;
}

interface LogLine {
  text: string;
  start: number;
  end: number;
  ts: string | null;
}

function tsOf(text: string): string | null {
  const m = TS_RE.exec(text);
  return m ? m[1] : null;
}

/**
 * Bytes [start, end) lesen und in ganze Zeilen zerlegen. Angeschnittene
 * Zeilen am Rand fallen weg (außer am Dateianfang/-ende).
 */
async function readWindow(
  handle: fs.FileHandle,
  size: number,
  start: number,
  end: number
): Promise<{ lines: LogLine[]; start: number; end: number }> {
  start = Math.max(0, Math.min(start, size));
  end = Math.max(start, Math.min(end, size));
  // Ein Byte vor `start` mitlesen: steht dort ein Zeilenumbruch, beginnt bei
  // `start` eine ganze Zeile (Blättern an einer Zeilengrenze), sonst ist die
  // erste Zeile angeschnitten und wird übersprungen.
  const readFrom = start > 0 ? start - 1 : 0;
  const buf = Buffer.alloc(end - readFrom);
  if (buf.length > 0) await handle.read(buf, 0, buf.length, readFrom);
  start = readFrom;

  let from = 0;
  if (readFrom > 0) {
    if (buf[0] === 0x0a) {
      from = 1;
    } else {
      const nl = buf.indexOf(0x0a);
      if (nl < 0) return { lines: [], start: end, end };
      from = nl + 1;
    }
  }
  let to = buf.length;
  if (end < size) {
    const nl = buf.lastIndexOf(0x0a);
    if (nl < from) return { lines: [], start: start + from, end: start + from };
    to = nl + 1;
  }

  const lines: LogLine[] = [];
  let pos = from;
  while (pos < to) {
    let nl = buf.indexOf(0x0a, pos);
    if (nl < 0 || nl >= to) nl = to;
    const text = buf.toString("utf8", pos, nl).replace(/\r$/, "");
    if (text.length > 0) lines.push({ text, start: start + pos, end: start + nl + 1, ts: tsOf(text) });
    pos = nl + 1;
  }
  return { lines, start: start + from, end: start + to };
}

/** Erster erkennbarer Zeitstempel ab Byte-Position `pos`. */
async function firstTsAfter(handle: fs.FileHandle, size: number, pos: number): Promise<string | null> {
  const win = await readWindow(handle, size, pos, pos + PROBE_BYTES);
  for (const l of win.lines) if (l.ts) return l.ts;
  return null;
}

/** Byte-Position, ab der Zeilen mit Zeitstempel ≥ `target` beginnen (Binärsuche). */
async function findOffsetAt(handle: fs.FileHandle, size: number, target: string): Promise<number> {
  let lo = 0;
  let hi = size;
  while (hi - lo > PROBE_BYTES) {
    const mid = Math.floor((lo + hi) / 2);
    const ts = await firstTsAfter(handle, size, mid);
    // Ohne Zeitstempel in der Sondierung (z. B. npm-Ausgabe) nach vorn weitergehen.
    if (ts === null || ts < target) lo = mid;
    else hi = mid;
  }
  return lo;
}

export async function readHubLog(payload: Record<string, unknown> | null): Promise<HubLogResult> {
  const fileRaw = String(payload?.file ?? "hub");
  const file: HubLogFile = fileRaw === "error" || fileRaw === "improve" ? fileRaw : "hub";
  const wanted = Math.min(MAX_LINES, Math.max(1, Number(payload?.lines) || DEFAULT_LINES));
  const grep = String(payload?.grep ?? "").trim().slice(0, 200) || null;
  const needle = grep?.toLowerCase();
  const filePath = hubLogPath(file);

  const atRaw = payload?.at ? Date.parse(String(payload.at)) : NaN;
  const before = Number(payload?.before);
  const after = Number(payload?.after);
  const mode: HubLogMode = Number.isFinite(atRaw)
    ? "at"
    : Number.isFinite(before)
      ? "before"
      : Number.isFinite(after)
        ? "after"
        : "tail";
  const target = mode === "at" ? new Date(atRaw).toISOString() : null;

  const base = {
    file,
    path: filePath,
    grep,
    mode,
    hub: CONFIG.name,
    version: CONFIG.version,
    at: new Date().toISOString(),
  };

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const stat = await handle.stat();
    const size = stat.size;

    let win: { lines: LogLine[]; start: number; end: number };
    /** Erste N Zeilen des Fensters (vorwärts) oder letzte N (rückwärts)? */
    let forward = false;
    if (mode === "before") {
      const end = Math.max(0, Math.min(before, size));
      win = await readWindow(handle, size, end - WINDOW_BYTES, end);
    } else if (mode === "after") {
      const start = Math.max(0, Math.min(after, size));
      win = await readWindow(handle, size, start, start + WINDOW_BYTES);
      forward = true;
    } else if (mode === "at" && target) {
      const off = await findOffsetAt(handle, size, target);
      win = await readWindow(handle, size, off, off + WINDOW_BYTES);
      // Zeilen vor dem Zeitpunkt (und Zeilen ohne Zeitstempel davor) verwerfen.
      const idx = win.lines.findIndex((l) => l.ts !== null && l.ts >= target);
      if (idx >= 0) {
        win = { lines: win.lines.slice(idx), start: win.lines[idx].start, end: win.end };
      } else if (win.end < size) {
        // Zeitpunkt liegt hinter diesem Fenster: das nächste nehmen.
        win = await readWindow(handle, size, win.end, win.end + WINDOW_BYTES);
      } else {
        win = { lines: [], start: size, end: size };
      }
      forward = true;
    } else {
      win = await readWindow(handle, size, size - WINDOW_BYTES, size);
    }

    const filtered = needle ? win.lines.filter((l) => l.text.toLowerCase().includes(needle)) : win.lines;
    let picked = forward ? filtered.slice(0, wanted) : filtered.slice(-wanted);
    let chars = picked.reduce((n, l) => n + l.text.length + 1, 0);
    while (chars > MAX_CHARS && picked.length > 1) {
      // Von der „fernen“ Seite kürzen: rückwärts die ältesten, vorwärts die neuesten.
      const dropped = forward ? picked[picked.length - 1] : picked[0];
      chars -= dropped.text.length + 1;
      picked = forward ? picked.slice(0, -1) : picked.slice(1);
    }

    const windowStart = picked[0]?.start ?? win.start;
    const windowEnd = picked[picked.length - 1]?.end ?? win.end;
    return {
      ...base,
      exists: true,
      sizeBytes: size,
      mtime: stat.mtime.toISOString(),
      lines: picked.map((l) => redact(l.text)),
      scanned: win.lines.length,
      truncated: filtered.length > picked.length,
      windowStart,
      windowEnd,
      hasOlder: windowStart > 0,
      hasNewer: windowEnd < size,
      firstTs: picked.find((l) => l.ts)?.ts ?? null,
      lastTs: [...picked].reverse().find((l) => l.ts)?.ts ?? null,
    };
  } catch {
    // Datei fehlt (Hub läuft z. B. nicht unter launchd): Ring aus dem Speicher.
    const mem = STATE.logs.map((l) => `[${l.ts}] ${l.msg}`);
    const filtered = needle ? mem.filter((l) => l.toLowerCase().includes(needle)) : mem;
    const picked = filtered.slice(-wanted).map(redact);
    return {
      ...base,
      mode: "tail",
      exists: false,
      sizeBytes: 0,
      mtime: null,
      lines: picked,
      scanned: mem.length,
      truncated: filtered.length > wanted,
      windowStart: 0,
      windowEnd: 0,
      hasOlder: false,
      hasNewer: false,
      firstTs: null,
      lastTs: null,
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
