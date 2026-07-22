import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { doorbirdSnapshot } from "./doorbird";
import type { DoorbirdConfig } from "./types";

/**
 * Persistente Doorbird-Livebilder zu Ereignissen (Klingel, Tür öffnen).
 *
 * Layout:
 *   logs/doorbird-events/events.jsonl          — eine Zeile pro Ereignis
 *   logs/doorbird-events/snapshots/YYYY-MM-DD/  — JPEG-Dateien
 *
 * Überschreibbar: WEBCAMS_DOORBIRD_EVENTS_DIR
 */

const ROOT =
  process.env.WEBCAMS_DOORBIRD_EVENTS_DIR ??
  path.join(process.cwd(), "logs", "doorbird-events");

const EVENTS_FILE = path.join(ROOT, "events.jsonl");
const SNAPSHOTS_DIR = path.join(ROOT, "snapshots");

const CLEANUP_INTERVAL_MS = 3600 * 1000;

function cleanupState(): { lastRun: number } {
  const g = globalThis as typeof globalThis & {
    __doorbirdEventsCleanup?: { lastRun: number };
  };
  if (!g.__doorbirdEventsCleanup) g.__doorbirdEventsCleanup = { lastRun: 0 };
  return g.__doorbirdEventsCleanup;
}

export async function fetchDoorbirdJpeg(
  db: DoorbirdConfig,
  timeoutMs = 6000,
): Promise<Buffer | null> {
  if (!db.enabled || !db.ip) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await doorbirdSnapshot(db, ctl.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function appendEventLine(record: Record<string, unknown>): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(EVENTS_FILE, line, "utf8");
}

export async function persistDoorbirdEventSnapshot(opts: {
  kind: "ring" | "door-open";
  jpeg: Buffer | null;
  meta: Record<string, unknown>;
  retentionDays: number;
}): Promise<{ relativePath: string | null }> {
  const ts = Date.now();
  const day = new Date(ts).toISOString().slice(0, 10);
  const id = randomBytes(4).toString("hex");

  await fs.mkdir(path.join(SNAPSHOTS_DIR, day), { recursive: true });

  let relativePath: string | null = null;
  if (opts.jpeg && opts.jpeg.length > 0) {
    const name = `${opts.kind}-${ts}-${id}.jpg`;
    relativePath = `snapshots/${day}/${name}`;
    const abs = path.join(SNAPSHOTS_DIR, day, name);
    const tmp = `${abs}.tmp`;
    await fs.writeFile(tmp, opts.jpeg);
    await fs.rename(tmp, abs);
  }

  await appendEventLine({
    ts: new Date(ts).toISOString(),
    kind: opts.kind,
    snapshot: relativePath,
    meta: opts.meta,
    ok: relativePath !== null,
  });

  scheduleRetentionCleanup(opts.retentionDays);
  return { relativePath };
}

function scheduleRetentionCleanup(retentionDays: number): void {
  const st = cleanupState();
  const now = Date.now();
  if (now - st.lastRun < CLEANUP_INTERVAL_MS) return;
  st.lastRun = now;
  void retentionCleanup(retentionDays);
}

async function retentionCleanup(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
    for (const ent of await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      if (name >= cutoffDay) continue;
      await fs.rm(path.join(SNAPSHOTS_DIR, name), { recursive: true, force: true });
    }
  } catch (e) {
    console.warn("[doorbird-events] retention cleanup failed", e);
  }
}
