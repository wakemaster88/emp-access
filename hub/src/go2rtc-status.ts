/**
 * go2rtc-Zustand abfragen und Probleme ins Hub-Log schreiben.
 *
 * Bisher stand im Hub-Log zu go2rtc nichts: Hingen die Livebilder der
 * Zentrale, war aus der Ferne (Log-Abruf HUB_LOG) nicht zu sehen, warum.
 * Jetzt schaut der Hub alle 2 Minuten auf /api/streams und schreibt eine
 * Zeile, sobald sich das Bild aendert (Streams ohne Daten von der Kamera,
 * H.265 im Sub-Stream, go2rtc weg). Fehlgeschlagene WebRTC-Anfragen der
 * Zentrale loggt der Dashboard-Proxy ueber `noteWebrtcFailure`.
 */
import { log } from "./config.js";
import { improve } from "./improve-log.js";
import { liveProblemLine, liveProblems, summarizeStreams, type Go2rtcRaw, type StreamSummary } from "./go2rtc-status-rules.js";

export const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");

const CHECK_EVERY_MS = 120_000;
/** Gleicher WebRTC-Fehler je Stream hoechstens so oft im Log. */
const WEBRTC_LOG_EVERY_MS = 5 * 60_000;

export interface Go2rtcState {
  reachable: boolean;
  at: number;
  streams: StreamSummary[];
  error?: string;
}

let last: Go2rtcState | null = null;
let lastLine: string | null = null;
const prevBytes = new Map<string, number>();
const webrtcLogged = new Map<string, { at: number; msg: string }>();
const webrtcFails = new Map<string, { count: number; lastAt: number; msg: string }>();

export async function fetchGo2rtcStreams(timeoutMs = 4000): Promise<Go2rtcState> {
  try {
    const r = await fetch(`${GO2RTC_URL}/api/streams`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      last = { reachable: false, at: Date.now(), streams: [], error: `HTTP ${r.status}` };
    } else {
      const data = (await r.json()) as Record<string, Go2rtcRaw | null>;
      last = { reachable: true, at: Date.now(), streams: summarizeStreams(data) };
    }
  } catch (e) {
    last = { reachable: false, at: Date.now(), streams: [], error: e instanceof Error ? e.message : String(e) };
  }
  return last;
}

export function lastGo2rtcState(): Go2rtcState | null {
  return last;
}

/** WebRTC-Anfrage der Zentrale an go2rtc gescheitert (HTTP-Fehler oder Timeout). */
export function noteWebrtcFailure(src: string, msg: string): void {
  const now = Date.now();
  const f = webrtcFails.get(src) ?? { count: 0, lastAt: 0, msg: "" };
  webrtcFails.set(src, { count: f.count + 1, lastAt: now, msg });
  const prev = webrtcLogged.get(src);
  if (prev && prev.msg === msg && now - prev.at < WEBRTC_LOG_EVERY_MS) return;
  webrtcLogged.set(src, { at: now, msg });
  log(`go2rtc WebRTC ${src}: ${msg}`);
  improve("camera", "webrtc_fail", { src });
}

/** Gescheiterte WebRTC-Anfragen der letzten 10 Minuten je Stream. */
export function recentWebrtcFailures(): Array<{ src: string; count: number; lastAt: string; msg: string }> {
  const since = Date.now() - 10 * 60_000;
  return [...webrtcFails.entries()]
    .filter(([, f]) => f.lastAt >= since)
    .map(([src, f]) => ({ src, count: f.count, lastAt: new Date(f.lastAt).toISOString(), msg: f.msg }));
}

/** Kurzfassung fuer hub_status / Log-Abruf. */
export function go2rtcSummary(): Record<string, unknown> {
  const s = last;
  if (!s) return { checked: false };
  const p = liveProblems(s.streams, new Map());
  return {
    reachable: s.reachable,
    error: s.error ?? null,
    at: new Date(s.at).toISOString(),
    streams: s.streams.length,
    watched: s.streams.filter((x) => x.consumers > 0).length,
    noData: p.stalled,
    unplayable: p.unplayable,
    formats: Object.fromEntries(s.streams.filter((x) => x.video).map((x) => [x.name, x.video])),
    webrtcFailures: recentWebrtcFailures(),
  };
}

async function check(): Promise<void> {
  const s = await fetchGo2rtcStreams();
  let line: string | null;
  if (!s.reachable) {
    line = `go2rtc nicht erreichbar (${s.error ?? "keine Antwort"}) – Zentrale ohne Livebilder`;
  } else {
    line = liveProblemLine(liveProblems(s.streams, prevBytes), s.streams.length);
  }
  for (const x of s.streams) prevBytes.set(x.name, x.bytes);
  if (line !== lastLine) {
    if (line) {
      log(line);
      improve("camera", s.reachable ? "live_problem" : "go2rtc_down");
    } else if (lastLine) {
      log(`go2rtc: wieder alle ${s.streams.length} Streams in Ordnung`);
    }
    lastLine = line;
  }
}

export function startGo2rtcMonitor(): void {
  setTimeout(() => void check(), 20_000);
  setInterval(() => void check(), CHECK_EVERY_MS);
}
