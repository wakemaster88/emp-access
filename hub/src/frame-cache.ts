/**
 * Vorschaubilder fuer die Kamera-Zentrale.
 *
 * go2rtc braucht fuer ein Standbild eines ruhenden Streams 1–5 s (RTSP
 * aufbauen, auf ein Keyframe warten). Damit Kacheln beim Oeffnen nicht
 * leer "Verbinde …" zeigen, merkt sich der Hub das letzte gute Bild pro
 * Stream und liefert es sofort aus. Solange jemand das Dashboard offen
 * hat, frischt er die Bilder der Sub-Streams im Hintergrund auf, sodass
 * die Vorschau beim naechsten Oeffnen hoechstens ~1 Minute alt ist.
 *
 * Bilder liegen zusaetzlich unter hub/.cache/frames/, damit auch direkt
 * nach einem Hub-Neustart eine Vorschau da ist.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "./config.js";

interface Frame {
  buf: Buffer;
  type: string;
  at: number;
}

const DISK_DIR = path.join(CONFIG.hubDir, ".cache", "frames");
const frames = new Map<string, Frame>();
const inflight = new Map<string, Promise<Frame>>();
const diskTried = new Set<string>();

/** Nach dieser Zeit holt eine Anfrage mit cached=1 im Hintergrund ein neues Bild. */
const STALE_MS = 20_000;
/** So lange laeuft die Hintergrund-Auffrischung nach der letzten Dashboard-Anfrage. */
const WARM_WINDOW_MS = 3 * 60_000;
const WARM_EVERY_MS = 45_000;
const WARM_PARALLEL = 3;

let lastDemandAt = 0;
let warmTimer: NodeJS.Timeout | null = null;

function diskPath(src: string): string {
  return path.join(DISK_DIR, `${src.replace(/[^\w.-]/g, "_")}.jpg`);
}

async function fromDisk(src: string): Promise<Frame | null> {
  if (diskTried.has(src)) return null;
  diskTried.add(src);
  try {
    const buf = await readFile(diskPath(src));
    // Alter unbekannt genug: als "alt" markieren, damit sofort nachgeladen wird.
    const f = { buf, type: "image/jpeg", at: 0 };
    frames.set(src, f);
    return f;
  } catch {
    return null;
  }
}

async function fetchFrame(go2rtcUrl: string, src: string): Promise<Frame> {
  const running = inflight.get(src);
  if (running) return running;
  const p = (async () => {
    const r = await fetch(`${go2rtcUrl}/api/frame.jpeg?src=${encodeURIComponent(src)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get("content-type") ?? "image/jpeg";
    if (!r.ok || buf.length < 100 || !type.startsWith("image/")) {
      throw new Error(`go2rtc frame ${src}: HTTP ${r.status}`);
    }
    const f = { buf, type, at: Date.now() };
    frames.set(src, f);
    if (type === "image/jpeg") {
      mkdir(DISK_DIR, { recursive: true })
        .then(() => writeFile(diskPath(src), buf))
        .catch(() => {});
    }
    return f;
  })().finally(() => inflight.delete(src));
  inflight.set(src, p);
  return p;
}

export interface FrameResult {
  frame: Frame;
  /** true = aus dem Zwischenspeicher, weil frisch nicht ging oder nicht verlangt war. */
  cached: boolean;
}

/**
 * cached=true: sofort das letzte Bild (falls vorhanden), Auffrischung im
 * Hintergrund. Sonst frisch von go2rtc, bei Fehler ersatzweise das letzte.
 */
export async function getFrame(go2rtcUrl: string, src: string, preferCached: boolean): Promise<FrameResult | null> {
  lastDemandAt = Date.now();
  const known = frames.get(src) ?? (await fromDisk(src));
  if (preferCached && known) {
    if (Date.now() - known.at > STALE_MS) fetchFrame(go2rtcUrl, src).catch(() => {});
    return { frame: known, cached: true };
  }
  try {
    return { frame: await fetchFrame(go2rtcUrl, src), cached: false };
  } catch {
    return known ? { frame: known, cached: true } : null;
  }
}

/**
 * Hintergrund-Auffrischung der Sub-Streams, nur solange das Dashboard in
 * den letzten Minuten benutzt wurde – sonst kostet go2rtc keine Rechenzeit.
 */
export function startFrameWarmer(go2rtcUrl: string): void {
  if (warmTimer) return;
  warmTimer = setInterval(async () => {
    if (Date.now() - lastDemandAt > WARM_WINDOW_MS) return;
    let names: string[] = [];
    try {
      const r = await fetch(`${go2rtcUrl}/api/streams`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return;
      names = Object.keys((await r.json()) ?? {});
    } catch {
      return;
    }
    // Nur Kachel-Streams: *_sub, oder Streams ohne main/sub-Endung.
    const want = names.filter((n) => n.endsWith("_sub") || !/_(main|sub)$/.test(n));
    let failed = 0;
    for (let i = 0; i < want.length; i += WARM_PARALLEL) {
      const batch = want.slice(i, i + WARM_PARALLEL);
      const res = await Promise.allSettled(batch.map((n) => fetchFrame(go2rtcUrl, n)));
      failed += res.filter((x) => x.status === "rejected").length;
    }
    if (failed && failed === want.length) log(`Vorschaubilder: go2rtc lieferte für keinen der ${want.length} Streams ein Bild`);
  }, WARM_EVERY_MS);
  warmTimer.unref?.();
}
