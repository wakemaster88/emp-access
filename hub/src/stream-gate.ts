/**
 * Freigabe der go2rtc-Streams fuer die Zentrale (dashboard.ts) nach der
 * Einstellung „Livebild und Vorschau“ je Kamera (live-mode-rules.ts):
 * Livebild (/api/go2rtc/webrtc), Standbild (/api/go2rtc/frame.jpeg) und
 * Personen-Boxen (/api/live/boxes) gibt es nur fuer freigegebene Streams,
 * sonst 403. Kamera-Liste und go2rtc kommen von aussen, damit testbar.
 *
 * Die Stream-Liste von go2rtc ist hoechstens 10 s alt; fehlt ein Name darin,
 * wird sie neu gelesen. Antwortet go2rtc nicht, gilt die letzte gute Liste.
 * Ohne Kamera-Liste (Hub frisch gestartet, Cloud noch nicht erreicht) und
 * fuer Maeher-Streams bleibt alles erlaubt wie bisher.
 */
import { isMowerStream } from "./mower-streams.js";
import { readLiveMode, streamAllowed, type LiveModeCamera, type LiveStream } from "./live-mode-rules.js";

export const LIVE_OFF_ERROR = "Livebild und Vorschau für diese Kamera aus";
export const STREAM_GATE_MAX_AGE_MS = 10_000;

/** Pfade unter /api/go2rtc, die ein Bild der Kamera liefern. */
const GATED_PROXY_PATHS = new Set(["/webrtc", "/frame.jpeg"]);

export interface StreamGateDeps {
  cameras: () => LiveModeCamera[];
  fetchStreams: () => Promise<{ reachable: boolean; streams: LiveStream[] }>;
  now?: () => number;
}

export interface StreamGate {
  /** Antwort von go2rtc merken (auch aus /api/go2rtc/streams); nur eine erreichbare zaehlt. */
  note(st: { reachable: boolean; streams: LiveStream[] }): void;
  /** Darf die Zentrale diesen Stream abspielen (streamAllowed)? */
  allows(src: string): Promise<boolean>;
  /** Proxy /api/go2rtc<sub>?src=…: 403 fuer einen gesperrten Stream, sonst null (weiter wie bisher). */
  proxyStatus(sub: string, src: string): Promise<403 | null>;
  /** /api/live/boxes: 403 bei Kamera „aus“ oder gesperrtem Stream, sonst null. */
  boxesStatus(cameraLiveMode: string | null | undefined, src: string): Promise<403 | null>;
}

export function createStreamGate(deps: StreamGateDeps): StreamGate {
  const now = deps.now ?? Date.now;
  let known: { at: number; streams: LiveStream[] } | null = null;

  const note: StreamGate["note"] = (st) => {
    if (st.reachable) known = { at: now(), streams: st.streams.map((x) => ({ name: x.name, host: x.host })) };
  };

  const allows: StreamGate["allows"] = async (src) => {
    const cams = deps.cameras();
    if (!cams.length || isMowerStream(src)) return true;
    const fresh =
      !!known && now() - known.at < STREAM_GATE_MAX_AGE_MS && known.streams.some((x) => x.name === src);
    if (!fresh) note(await deps.fetchStreams());
    return streamAllowed(cams, known?.streams ?? [], src);
  };

  return {
    note,
    allows,
    proxyStatus: async (sub, src) => (GATED_PROXY_PATHS.has(sub) && !(await allows(src)) ? 403 : null),
    boxesStatus: async (cameraLiveMode, src) =>
      readLiveMode(cameraLiveMode) === "off" || !(await allows(src)) ? 403 : null,
  };
}
