import { promises as fs } from "node:fs";
import path from "node:path";

const LOG_PATH =
  process.env.WEBCAMS_AUDIT_LOG ??
  path.join(process.cwd(), "logs", "audit.log");

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB rolling
const MAX_RETURN = 500;

export interface AuditEvent {
  ts: string;
  action: string;
  target?: string;
  ok?: boolean;
  meta?: Record<string, unknown>;
}

let writePromise: Promise<void> = Promise.resolve();

export async function logEvent(ev: Omit<AuditEvent, "ts">) {
  const full: AuditEvent = { ...ev, ts: new Date().toISOString() };
  // serialise writes
  writePromise = writePromise.then(async () => {
    try {
      await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
      await maybeRotate();
      await fs.appendFile(LOG_PATH, JSON.stringify(full) + "\n", "utf8");
    } catch (e) {
      console.error("[audit] write failed", e);
    }
  });
  return writePromise;
}

async function maybeRotate() {
  try {
    const stat = await fs.stat(LOG_PATH);
    if (stat.size > MAX_BYTES) {
      const archive = `${LOG_PATH}.1`;
      await fs.rename(LOG_PATH, archive).catch(() => undefined);
    }
  } catch {
    /* file does not exist yet */
  }
}

/** Nur das Datei-Ende lesen — 500 Events passen locker in 512 KB. */
const TAIL_BYTES = 512 * 1024;

export async function readEvents(limit = MAX_RETURN): Promise<AuditEvent[]> {
  try {
    const stat = await fs.stat(LOG_PATH);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fh = await fs.open(LOG_PATH, "r");
    let raw: string;
    try {
      const buf = Buffer.alloc(stat.size - start);
      await fh.read(buf, 0, buf.length, start);
      raw = buf.toString("utf8");
    } finally {
      await fh.close();
    }
    // Erste (potentiell angeschnittene) Zeile verwerfen, wenn mittig eingestiegen.
    if (start > 0) raw = raw.slice(raw.indexOf("\n") + 1);
    const lines = raw.trim().split("\n").filter(Boolean);
    const slice = lines.slice(-limit);
    return slice
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((x): x is AuditEvent => !!x)
      .reverse();
  } catch {
    return [];
  }
}
