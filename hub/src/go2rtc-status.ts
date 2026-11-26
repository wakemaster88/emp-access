/**
 * go2rtc-Zustand abfragen und Probleme ins Hub-Log schreiben.
 *
 * Bisher stand im Hub-Log zu go2rtc nichts: Hingen die Livebilder der
 * Zentrale, war aus der Ferne (Log-Abruf HUB_LOG) nicht zu sehen, warum.
 * Jetzt schaut der Hub alle 2 Minuten auf /api/streams und schreibt eine
 * Zeile, sobald sich das Bild aendert (Streams ohne Daten von der Kamera,
 * H.265 im Sub-Stream, go2rtc weg). „Ohne Daten“ gilt erst nach zwei
 * Blicken in Folge; ein fallender Byte-Zaehler ist ein Neuaufbau. Dazu der
 * Abgleich ueber den Host: Kameras ohne Stream, Streams ohne Kamera und
 * Streams, deren Kamera offline ist (eigene Zeile bei Aenderung).
 * Fehlgeschlagene WebRTC-Anfragen der Zentrale loggt der Dashboard-Proxy
 * ueber `noteWebrtcFailure`, je Stream gedrosselt.
 */
import { log } from "./config.js";
import { improve } from "./improve-log.js";
import { recheckGo2rtcYaml } from "./ffmpeg-setup.js";
import {
  clientReport,
  confirmStalls,
  coverageLine,
  liveProblemLine,
  liveProblems,
  maskUrlAuth,
  repeatNote,
  streamCoverage,
  summarizeStreams,
  watchOkLine,
  webrtcFailureLine,
  webrtcFailureStep,
  webrtcOkStep,
  type CoverageCamera,
  type Go2rtcRaw,
  type StreamCoverage,
  type StreamSummary,
  type WebrtcFailState,
} from "./go2rtc-status-rules.js";

export const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");

const CHECK_EVERY_MS = 120_000;
/** Gleiche Kachel-Meldung je Stream hoechstens so oft im Log. */
const WEBRTC_LOG_EVERY_MS = 5 * 60_000;
/** Kameras erst abgleichen, wenn der Hub sie einmal abgefragt hat (sonst gelten alle als offline). */
const COVERAGE_AFTER_START_S = 60;

export interface Go2rtcState {
  reachable: boolean;
  at: number;
  streams: StreamSummary[];
  error?: string;
}

let last: Go2rtcState | null = null;
let lastLine: string | null = null;
let lastCoverageLine: string | null = null;
const prevBytes = new Map<string, number>();
/** Blicke in Folge ohne Daten je Stream (confirmStalls). */
let stallMisses = new Map<string, number>();
/** Ergebnis des letzten Waechter-Blicks; die Kurzfassung nutzt genau das, was auch die Log-Zeile sah. */
let lastCheck: {
  at: number;
  stalled: string[];
  unplayable: string[];
  watched: number;
  idle: number;
  coverage: StreamCoverage | null;
} | null = null;
/** Kameras fuer den Abgleich (von index.ts gesetzt). */
let coverageCameras: () => CoverageCamera[] = () => [];
const webrtcLogged = new Map<string, WebrtcFailState>();
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

/**
 * WebRTC-Anfrage der Zentrale an go2rtc gescheitert (HTTP-Fehler oder
 * Timeout). Gedrosselt je Stream: erste Zeile sofort, danach hoechstens
 * stuendlich „weiter ohne Bild (N Versuche seit …)“. Zugangsdaten in
 * Quell-URLs des Fehlertexts werden vorher maskiert.
 */
export function noteWebrtcFailure(src: string, rawMsg: string): void {
  const now = Date.now();
  const msg = maskUrlAuth(rawMsg);
  const f = webrtcFails.get(src) ?? { count: 0, lastAt: 0, msg: "" };
  webrtcFails.set(src, { count: f.count + 1, lastAt: now, msg });
  const step = webrtcFailureStep(webrtcLogged.get(src), now);
  webrtcLogged.set(src, step.next);
  if (!step.log) return;
  log(webrtcFailureLine(src, msg, step.log, step.next));
  improve("camera", "webrtc_fail", { src });
}

/**
 * WebRTC-Anfrage gelungen: Lag der letzte Fehlschlag mindestens 10 min
 * zurueck, endet die Zaehlung; sonst beginnt die Zeit mit Bild. Eine neue
 * Stoerung nach mindestens 10 min mit Bild kommt wieder sofort ins Log.
 */
export function noteWebrtcOk(src: string): void {
  const next = webrtcOkStep(webrtcLogged.get(src), Date.now());
  if (next) webrtcLogged.set(src, next);
  else webrtcLogged.delete(src);
}

const clientLogged = new Map<string, number>();
const clientLast = new Map<string, { at: number; line: string }>();
/** Kachel-Meldungen „signal: …“ je Stream (Echo der Proxy-Fehler), gedrosselt wie noteWebrtcFailure. */
const clientSignal = new Map<string, WebrtcFailState>();

/**
 * Zustandsmeldung einer Kachel aus dem Browser (gedrosselt ins Log): je
 * Stream und Art hoechstens alle 5 min. „signal: …“ (go2rtc lehnte die
 * Anfrage ab, der Proxy hat den Fehler schon geloggt) wie die Proxy-Zeile:
 * erste sofort, danach hoechstens stuendlich mit Anzahl.
 */
export function noteWebrtcClient(body: Record<string, unknown>, ua: string): void {
  const r = clientReport(body, ua);
  if (!r) return;
  const now = Date.now();
  clientLast.set(r.src, { at: now, line: r.line });
  if (clientLast.size > 200) clientLast.delete(clientLast.keys().next().value as string);
  const kind = r.event.split(":")[0];
  if (r.event === "live") {
    const ok = webrtcOkStep(clientSignal.get(r.src), now);
    if (ok) clientSignal.set(r.src, ok);
    else clientSignal.delete(r.src);
  }
  if (kind === "signal") {
    const step = webrtcFailureStep(clientSignal.get(r.src), now);
    clientSignal.set(r.src, step.next);
    if (clientSignal.size > 200) clientSignal.delete(clientSignal.keys().next().value as string);
    if (!step.log) return;
    log(step.log === "first" ? r.line : `${r.line}, ${repeatNote(step.next)}`);
    improve("camera", "webrtc_client_fail", { src: r.src });
    return;
  }
  const key = `${r.src}|${kind}`;
  if (now - (clientLogged.get(key) ?? 0) < WEBRTC_LOG_EVERY_MS) return;
  clientLogged.set(key, now);
  log(r.line);
  improve("camera", r.event === "live" ? "webrtc_recovered" : r.event === "schwarz" ? "webrtc_black" : "webrtc_client_fail", { src: r.src });
}

/** Gescheiterte WebRTC-Anfragen der letzten 10 Minuten je Stream. */
export function recentWebrtcFailures(): Array<{ src: string; count: number; lastAt: string; msg: string }> {
  const since = Date.now() - 10 * 60_000;
  return [...webrtcFails.entries()]
    .filter(([, f]) => f.lastAt >= since)
    .map(([src, f]) => ({ src, count: f.count, lastAt: new Date(f.lastAt).toISOString(), msg: f.msg }));
}

/**
 * Kurzfassung fuer hub_status / Log-Abruf. „noData“ und „unplayable“ sind
 * der Befund des letzten Waechter-Blicks (gleiche Vergleichswerte wie die
 * Log-Zeile), nicht eine neue Rechnung gegen eine leere Liste.
 */
export function go2rtcSummary(): Record<string, unknown> {
  const s = last;
  if (!s) return { checked: false };
  const c = lastCheck;
  return {
    reachable: s.reachable,
    error: s.error ?? null,
    at: new Date(s.at).toISOString(),
    streams: s.streams.length,
    watched: s.streams.filter((x) => x.consumers > 0).length,
    checkedAt: c ? new Date(c.at).toISOString() : null,
    noData: c?.stalled ?? [],
    unplayable: c?.unplayable ?? [],
    idle: c?.idle ?? null,
    coverage: c?.coverage ?? null,
    formats: Object.fromEntries(s.streams.filter((x) => x.video).map((x) => [x.name, x.video])),
    webrtcFailures: recentWebrtcFailures(),
    browser: [...clientLast.values()].filter((c) => c.at >= Date.now() - 10 * 60_000).map((c) => c.line),
  };
}

async function check(): Promise<void> {
  // Hat der Kiosk die go2rtc.yaml neu geschrieben? Dann RTSP und ffmpeg erneut abgleichen.
  void recheckGo2rtcYaml();
  const s = await fetchGo2rtcStreams();
  let line: string | null;
  let coverage: StreamCoverage | null = null;
  if (!s.reachable) {
    line = `go2rtc nicht erreichbar (${s.error ?? "keine Antwort"}) – Zentrale ohne Livebilder`;
    stallMisses = new Map();
    lastCheck = null;
  } else {
    const p = liveProblems(s.streams, prevBytes);
    const confirmed = confirmStalls(p.stalled, stallMisses);
    stallMisses = confirmed.misses;
    line = liveProblemLine({ stalled: confirmed.stalled, unplayable: p.unplayable }, s.streams.length);
    const cams = process.uptime() >= COVERAGE_AFTER_START_S ? coverageCameras() : [];
    coverage = cams.length ? streamCoverage(s.streams, cams) : null;
    const watched = s.streams.filter((x) => x.consumers > 0).length;
    lastCheck = {
      at: Date.now(),
      stalled: confirmed.stalled,
      unplayable: p.unplayable,
      watched,
      idle: s.streams.length - watched,
      coverage,
    };
  }
  prevBytes.clear();
  for (const x of s.streams) prevBytes.set(x.name, x.bytes);
  if (line !== lastLine) {
    if (line) {
      log(line);
      improve("camera", s.reachable ? "live_problem" : "go2rtc_down");
    } else if (lastLine) {
      log(watchOkLine(s.streams, coverage?.camerasOffline ?? 0));
    }
    lastLine = line;
  }
  if (coverage) {
    const cl = coverageLine(coverage);
    if (cl !== lastCoverageLine) {
      if (cl) {
        log(cl);
        if (coverage.missing.length || coverage.orphans.length) improve("camera", "stream_coverage");
      } else if (lastCoverageLine) {
        log("go2rtc: Kameras und Streams passen wieder zusammen, keine Kamera offline");
      }
      lastCoverageLine = cl;
    }
  }
}

/** `cameras`: Kameras und DoorBirds mit Host und Erreichbarkeit fuer den Abgleich mit den Streams. */
export function startGo2rtcMonitor(opts: { cameras?: () => CoverageCamera[] } = {}): void {
  if (opts.cameras) coverageCameras = opts.cameras;
  setTimeout(() => void check(), 20_000);
  setInterval(() => void check(), CHECK_EVERY_MS);
}
