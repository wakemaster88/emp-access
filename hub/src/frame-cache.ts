/**
 * Standbilder von go2rtc fuer den Dashboard-Proxy (/api/go2rtc/frame.jpeg)
 * und die Personen-Boxen der Grossansicht.
 *
 * go2rtc braucht fuer ein Standbild eines ruhenden Streams 1–5 s (RTSP
 * aufbauen, auf ein Keyframe warten). Der Hub merkt sich darum das letzte
 * gute Bild pro Stream im Speicher: Mit cached=1 kommt es sofort, sonst ist
 * es der Ersatz, wenn go2rtc kein frisches liefert. Die Personen-Boxen
 * nutzen den Ersatz nie (boxesUsable in live-people-rules.ts).
 *
 * Bis 26.11.2026 schrieb der Hub jedes Bild zusaetzlich auf die Platte, und
 * solange das Dashboard offen war, holte eine Auffrischung alle 45 s Bilder
 * aller Sub-Streams. Die Zentrale zeigt bewusst kein Standbild, gelesen hat
 * diese Bilder niemand. Beides ist weg.
 */

interface Frame {
  buf: Buffer;
  type: string;
  at: number;
}

const frames = new Map<string, Frame>();
const inflight = new Map<string, Promise<Frame>>();

/** Nach dieser Zeit holt eine Anfrage mit cached=1 im Hintergrund ein neues Bild. */
const STALE_MS = 20_000;

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
  const known = frames.get(src);
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
