/**
 * Gemeinsamer Aufruf des YOLO-Trackers (POST /classify) für alle Stellen im
 * Hub: Fahrzeug-Prüfung und Halteverbot (vision.ts), Personen für Wächter,
 * Belegung und Gesicht über den digitalen Zoom (person-crop.ts) und die
 * Live-Personen der Kamera-Zentrale (live-people.ts).
 *
 *  - Die PIN der Kiosk-Konfiguration (settings.adminPin, sonst
 *    HUB_TRACKER_PIN) geht als x-admin-token mit: Der Tracker verlangt sie
 *    für alles außer /health, sobald eine gesetzt ist.
 *  - Ein Zeitlimit für alle Aufrufer (HUB_VISION_TIMEOUT_MS, Standard 6 s).
 *  - Erfolg und Fehler werden je Aufrufer gezählt (tracker.<aufrufer>.ok,
 *    .fail, .off).
 *  - Ausfallschalter (breakerStep in tracker-client-rules.ts): Nach zwei
 *    Fehlern in Folge gilt der Tracker 30 s als aus. Aufrufer bekommen dann
 *    sofort kein Ergebnis (reason "off") und verhalten sich wie bei einem
 *    Fehler; jeder Zustandswechsel steht einmal im Log.
 *
 * Optional `roi` (Ausschnitt, normiert) und `imgsz`: Ein Tracker, der sie
 * kennt, nennt sie in der Antwort; ein älterer ignoriert sie und rechnet auf
 * dem ganzen Bild wie bisher.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { improve, improveCount, improveOutcome } from "./improve-log.js";
import { TRAIL_TRACKER } from "./improve-rules.js";
import {
  BREAKER_FAILS,
  BREAKER_OFF_MS,
  breakerStep,
  classifyQuery,
  newBreaker,
  trackerDown,
  trackerTimeoutMs,
  type BreakerState,
  type NormRect,
} from "./tracker-client-rules.js";

const TRACKER_DEFAULT = "http://127.0.0.1:8088";
/** Zeitlimit jedes Aufrufs (HUB_VISION_TIMEOUT_MS, siehe trackerTimeoutMs). */
export const TRACKER_TIMEOUT_MS = trackerTimeoutMs(process.env.HUB_VISION_TIMEOUT_MS);

export interface TrackerTarget {
  url: string;
  pin: string;
}

let cachedTarget: { at: number; value: TrackerTarget } | null = null;
const TARGET_TTL_MS = 60_000;

/** Adresse und PIN des Trackers: Umgebung vor Kiosk-Konfiguration, eine Minute gemerkt. */
export async function trackerTarget(): Promise<TrackerTarget> {
  if (cachedTarget && Date.now() - cachedTarget.at < TARGET_TTL_MS) {
    return cachedTarget.value;
  }
  const envUrl = (process.env.HUB_TRACKER_URL || "").replace(/\/$/, "");
  let url = envUrl || TRACKER_DEFAULT;
  let pin = process.env.HUB_TRACKER_PIN || "";
  try {
    const raw = await fs.readFile(path.join(CONFIG.repoDir, "webcams", "config.json"), "utf8");
    const cfg = JSON.parse(raw) as {
      settings?: { adminPin?: string; tracker?: { url?: string } };
    };
    if (!envUrl && cfg.settings?.tracker?.url) {
      url = String(cfg.settings.tracker.url).replace(/\/$/, "");
    }
    if (!pin && cfg.settings?.adminPin) pin = String(cfg.settings.adminPin);
  } catch {
    // Default reicht, wenn die Kiosk-Config fehlt.
  }
  const value = { url, pin };
  cachedTarget = { at: Date.now(), value };
  return value;
}

/** Basis-URL des Trackers (für Health-Checks nach einem Neustart). */
export async function trackerBaseUrl(): Promise<string> {
  return (await trackerTarget()).url;
}

/** Antwort von /classify, wie sie der Tracker schickt (ältere kennen nicht alle Felder). */
export interface ClassifyJson {
  vehicle?: boolean;
  conf?: number;
  vehicles?: unknown;
  people?: number;
  persons?: unknown;
  /** Nur ein Tracker, der Ausschnitte kennt: der benutzte Ausschnitt (normiert). */
  roi?: unknown;
  /** Nur ein Tracker, der Ausschnitte kennt: die benutzte Auflösung. */
  imgsz?: unknown;
}

export type ClassifyResult =
  | { ok: true; json: ClassifyJson; ms: number }
  | {
      ok: false;
      /** off = Tracker gilt als aus (kein Aufruf), http = Fehlerstatus, error = keine oder keine lesbare Antwort. */
      reason: "off" | "http" | "error";
      status: number | null;
      error: string;
    };

export interface ClassifyOptions {
  /** Wer fragt (Zähler tracker.<caller>.*). */
  caller: string;
  roi?: NormRect | null;
  imgsz?: number | null;
  /**
   * Vergleichsaufruf (etwa der Ausschnitt im Halteverbot): Sein Ausgang
   * verändert den Ausfallschalter nicht, damit er den übrigen Aufrufern
   * nie ein Ergebnis nimmt. Gilt der Tracker als aus, geht auch er nicht
   * hinaus.
   */
  probe?: boolean;
}

export interface TrackerClientDeps {
  target: () => Promise<TrackerTarget>;
  timeoutMs: number;
  now?: () => number;
  log: (msg: string) => void;
  /** Zähler je Aufrufer, z. B. "noparking.ok". */
  count: (event: string) => void;
  /** Zustandswechsel für die Diagnose (eine Zeile je Wechsel). */
  note?: (event: "down" | "up", data: Record<string, unknown>) => void;
  /** Ausgang jedes Aufrufs außer Vergleichsaufrufen: Fehlertext oder null (Hinweis „in Folge“). */
  outcome?: (error: string | null) => void;
}

export interface TrackerClient {
  classify(jpeg: Buffer, opts: ClassifyOptions): Promise<ClassifyResult>;
  breaker(): BreakerState;
}

export function createTrackerClient(deps: TrackerClientDeps): TrackerClient {
  const now = deps.now ?? Date.now;
  let breaker = newBreaker();
  let downSince = 0;

  function settle(event: "ok" | "fail", why: string, probe: boolean | undefined): void {
    if (probe) return;
    const step = breakerStep(breaker, event, now(), { fails: BREAKER_FAILS, offMs: BREAKER_OFF_MS });
    breaker = step.state;
    if (step.change === "down") {
      downSince = now();
      deps.log(
        `Tracker: ${breaker.fails} Fehler in Folge (zuletzt: ${why}) – gilt ${Math.round(BREAKER_OFF_MS / 1000)} s als aus, ` +
          "Fahrzeug- und Personen-Prüfung bekommen bis dahin kein Ergebnis",
      );
      deps.note?.("down", { fails: breaker.fails, error: why });
    } else if (step.change === "up") {
      const seconds = Math.round((now() - downSince) / 1000);
      deps.log(`Tracker antwortet wieder (war ${seconds} s aus)`);
      deps.note?.("up", { seconds });
    }
  }

  async function classify(jpeg: Buffer, opts: ClassifyOptions): Promise<ClassifyResult> {
    if (!breakerStep(breaker, "ask", now()).allow) {
      deps.count(`${opts.caller}.off`);
      return { ok: false, reason: "off", status: null, error: "Tracker gilt als aus" };
    }
    const started = now();
    let status: number | null = null;
    try {
      const { url, pin } = await deps.target();
      const res = await fetch(`${url}/classify${classifyQuery(opts)}`, {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          ...(pin ? { "x-admin-token": pin } : {}),
        },
        body: new Uint8Array(jpeg),
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      status = res.status;
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        const error = `HTTP ${res.status}`;
        settle(trackerDown(status) ? "fail" : "ok", error, opts.probe);
        deps.count(`${opts.caller}.fail`);
        if (!opts.probe) deps.outcome?.(error);
        return { ok: false, reason: "http", status, error };
      }
      const json = (await res.json()) as unknown;
      if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Antwort ohne JSON-Objekt");
      settle("ok", "", opts.probe);
      deps.count(`${opts.caller}.ok`);
      if (!opts.probe) deps.outcome?.(null);
      return { ok: true, json: json as ClassifyJson, ms: now() - started };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      settle(trackerDown(status) ? "fail" : "ok", error, opts.probe);
      deps.count(`${opts.caller}.fail`);
      if (!opts.probe) deps.outcome?.(error);
      return { ok: false, reason: "error", status, error };
    }
  }

  return { classify, breaker: () => breaker };
}

const client = createTrackerClient({
  target: trackerTarget,
  timeoutMs: TRACKER_TIMEOUT_MS,
  log,
  count: (event) => improveCount("tracker", event),
  note: (event, data) => improve("tracker", event, data),
  outcome: (error) => improveOutcome(TRAIL_TRACKER, error),
});

/** Ein Bild an /classify (gemeinsamer Aufruf, siehe oben). Wirft nie. */
export function classify(jpeg: Buffer, opts: ClassifyOptions): Promise<ClassifyResult> {
  return client.classify(jpeg, opts);
}

/** Zustand des Ausfallschalters (für Diagnose und Tests). */
export function trackerBreaker(): BreakerState {
  return client.breaker();
}
