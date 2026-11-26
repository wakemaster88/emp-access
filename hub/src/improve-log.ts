/**
 * Automatisches Verbesserungslog: JSONL + periodischer Snapshot.
 * Keine Secrets (Passwort, Token, Embedding). Dient der Hub-Diagnose.
 */
import { appendFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { STATE } from "./state.js";
import { nearMissHint, recentTimes } from "./face-rules.js";
import {
  addDaily,
  hintsFor,
  localDay,
  mergeDaily,
  newTrail,
  parseDaily,
  serializeDaily,
  trailStep,
  type DailyCounts,
  type FailTrail,
} from "./improve-rules.js";
import { trackerTimeoutMs } from "./tracker-client-rules.js";

export type ImproveKind =
  | "boot"
  | "face"
  | "vision"
  | "alpr"
  | "task"
  | "parking"
  | "noparking"
  | "doorbird"
  | "camera"
  | "follow"
  | "heartbeat"
  | "snmp"
  | "soundweb"
  | "delivery"
  | "occupancy"
  | "tracker"
  | "agent"
  | "rules"
  | "shelly"
  | "smart";

const SECRET_KEYS = /password|token|embedding|authorization|apikey|secret|pin|bot/i;
const MAX_JSONL_BYTES = 8 * 1024 * 1024;
const SNAP_INTERVAL_MS = (Number(process.env.HUB_IMPROVE_INTERVAL) > 0
  ? Number(process.env.HUB_IMPROVE_INTERVAL)
  : 300) * 1000;

const counts = new Map<string, number>();
const since = new Date().toISOString();
let lastSnapAt = 0;
let writing = false;
/** Zuletzt geloggter Hinweis – die Zeile kommt nur, wenn er sich aendert. */
let lastLoggedHint: string | null = null;
/** Beinahe-Treffer nicht hochskalierter Gesichter der letzten 24 h (Zeitpunkte), fuer den Hinweis. */
let directNearMissAt: number[] = [];
/** Fehler in Folge und letzter Fehlertext je Vorgang (improveOutcome), fuer die Hinweise. */
const trails = new Map<string, FailTrail>();
/**
 * Zaehler je Tag (Ortszeit). Beim Start kommen die gespeicherten Tage aus
 * hub/.cache/improve-daily.json dazu; geschrieben wird mit dem Snapshot
 * (alle 5 Minuten und beim Beenden), erst nachdem die Datei gelesen ist.
 */
let daily: DailyCounts = {};
let dailyLoaded = false;

function enabled(): boolean {
  return process.env.HUB_IMPROVE_LOG !== "0";
}

function cacheDir(): string {
  return path.join(CONFIG.hubDir, ".cache");
}

function jsonlPath(): string {
  return path.join(cacheDir(), "improve.jsonl");
}

function latestPath(): string {
  return path.join(cacheDir(), "improve-latest.md");
}

function dailyPath(): string {
  return path.join(cacheDir(), "improve-daily.json");
}

function bump(kind: ImproveKind, event: string, by = 1): string {
  const key = `${kind}.${event}`;
  counts.set(key, (counts.get(key) ?? 0) + by);
  addDaily(daily, localDay(new Date()), key, by);
  return key;
}

function sanitize(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SECRET_KEYS.test(k)) continue;
    if (typeof v === "string" && v.length > 240) out[k] = `${v.slice(0, 240)}…`;
    else out[k] = v;
  }
  return out;
}

function n(key: string): number {
  return counts.get(key) ?? 0;
}

function hints(): string[] {
  return hintsFor(Object.fromEntries(counts), {
    system: STATE.system?.hints ?? [],
    nearMiss: nearMissHint(directNearMissAt, Date.now()),
    trails: Object.fromEntries(trails),
    trackerTimeoutSec: Math.round(trackerTimeoutMs(process.env.HUB_VISION_TIMEOUT_MS) / 1000),
  });
}

export function improveSnapshot(): {
  since: string;
  counts: Record<string, number>;
  hints: string[];
  summary: string;
  hint: string;
  /** Zaehler des heutigen Tags (Ortszeit), auch ueber Neustarts hinweg (sobald die Datei gelesen ist). */
  today: { day: string; counts: Record<string, number> };
} {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // Mengen (Bytes, Summen) wuerden die Kurzfassung anfuehren, ohne ein Ereignis zu sein.
  const top = entries
    .filter(([k]) => !k.endsWith("_bytes") && !k.endsWith("_sum"))
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`);
  const h = hints();
  const day = localDay(new Date());
  return {
    since,
    counts: Object.fromEntries(entries),
    hints: h,
    summary: top.join(" · ") || "noch keine Ereignisse",
    hint: h[0] ?? "sammelt …",
    today: { day, counts: Object.fromEntries(Object.entries(daily[day] ?? {}).sort((a, b) => b[1] - a[1])) },
  };
}

function renderMd(snap: ReturnType<typeof improveSnapshot>): string {
  const lines = [
    `# Hub-Diagnose (automatisch)`,
    ``,
    `Seit: ${snap.since}`,
    `Stand: ${new Date().toISOString()}`,
    ``,
    `## Hinweise`,
    ...snap.hints.map((x) => `- ${x}`),
    ``,
    `## Zähler`,
    ...Object.entries(snap.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## Heute (${snap.today.day}, auch über Neustarts)`,
    ...Object.entries(snap.today.counts).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `Rohdaten: \`hub/.cache/improve.jsonl\`, Tagessummen: \`hub/.cache/improve-daily.json\``,
    `Journal: \`hub/IMPROVE.md\``,
    ``,
  ];
  return lines.join("\n");
}

export async function flushImproveSnapshot(reason = "interval"): Promise<void> {
  if (!enabled()) return;
  const snap = improveSnapshot();
  STATE.improve = snap;
  lastSnapAt = Date.now();
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(latestPath(), renderMd(snap), "utf8");
    await saveDaily();
    // Der Snapshot wird weiter alle 5 Minuten geschrieben; ins Log kommt er
    // beim Start, beim Beenden und wenn sich der oberste Hinweis aendert.
    // Verglichen wird ohne Zahlen: Zaehler im Hinweis („46/141“) wandern mit
    // jedem Durchlauf, die Aussage bleibt dieselbe.
    const hintKey = snap.hint.replace(/\d+/g, "#");
    if (reason !== "interval" || hintKey !== lastLoggedHint) {
      log(`Improve-Snapshot (${reason}): ${snap.hint}`);
    }
    lastLoggedHint = hintKey;
  } catch {
    // Diagnose darf den Hub nicht stören.
  }
}

/** Tagessummen sichern (ueber eine Zwischendatei, damit ein Absturz keine halbe Datei hinterlaesst). */
async function saveDaily(): Promise<void> {
  if (!dailyLoaded) return;
  const tmp = `${dailyPath()}.tmp`;
  await writeFile(tmp, serializeDaily(daily), "utf8");
  await rename(tmp, dailyPath());
}

/** Gespeicherte Tagessummen zu den seit dem Start gezaehlten nehmen. Wirft nie. */
async function loadDaily(): Promise<void> {
  try {
    daily = mergeDaily(parseDaily(await readFile(dailyPath(), "utf8")), daily);
  } catch {
    // Noch keine Datei (erster Start) oder unlesbar: Es zaehlt ab jetzt.
  }
  dailyLoaded = true;
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const s = await stat(jsonlPath());
    if (s.size < MAX_JSONL_BYTES) return;
    await rename(jsonlPath(), `${jsonlPath()}.1`).catch(() => undefined);
  } catch {
    // Datei fehlt noch.
  }
}

/**
 * Nur zaehlen, keine Zeile in improve.jsonl: fuer Routine im Sekunden- bis
 * Minutentakt („Halteverbot frei“, „Parkplatz gemeldet“, reine Bewegung).
 * Diese Zeilen fuellten die Datei zu mehr als der Haelfte und verdraengten in
 * der Diagnose-Ansicht (letzte 80 Zeilen) alles, was etwas aussagt.
 * `by`: Menge statt eines Ereignisses (z. B. gesendete Bytes, Zaehler mit
 * der Endung `_bytes`, oder Summen mit der Endung `_sum`; beide stehen nicht
 * in der Kurzfassung `summary`).
 */
export function improveCount(kind: ImproveKind, event: string, by = 1): void {
  if (!enabled()) return;
  bump(kind, event, by);
  if (Date.now() - lastSnapAt >= SNAP_INTERVAL_MS) void flushImproveSnapshot("interval");
}

/**
 * Ausgang eines wiederkehrenden Vorgangs fuer die Hinweise (improve-rules.ts):
 * `error` = Fehlertext, null = gelungen. Zaehlt nichts; die Zaehler kommen
 * wie bisher aus improve/improveCount. `key` z. B. TRAIL_NOPARKING.
 */
export function improveOutcome(key: string, error: string | null): void {
  if (!enabled()) return;
  trails.set(key, trailStep(trails.get(key) ?? newTrail(), error));
}

export function improve(
  kind: ImproveKind,
  event: string,
  data?: Record<string, unknown>
): void {
  if (!enabled()) return;
  bump(kind, event);
  if (kind === "face" && event === "near_miss" && data?.upscaled !== true) {
    const now = Date.now();
    directNearMissAt = [...recentTimes(directNearMissAt, now), now];
  }
  const row = {
    ts: new Date().toISOString(),
    kind,
    event,
    ...(sanitize(data) ?? {}),
  };
  void (async () => {
    if (writing) {
      // Zähler sind schon hoch – Zeile darf unter Last entfallen.
    }
    writing = true;
    try {
      await mkdir(cacheDir(), { recursive: true });
      await rotateIfNeeded();
      await appendFile(jsonlPath(), `${JSON.stringify(row)}\n`, "utf8");
    } catch {
      // ignorieren
    } finally {
      writing = false;
    }
  })();

  if (Date.now() - lastSnapAt >= SNAP_INTERVAL_MS) {
    void flushImproveSnapshot("interval");
  } else {
    STATE.improve = improveSnapshot();
  }
}

/**
 * Letzte JSONL-Zeilen fuer die Diagnose-Ansicht. Liest nur das Dateiende,
 * damit auch eine 8-MB-Datei nicht in den Speicher gezogen wird.
 */
export async function recentImproveEvents(limit = 80): Promise<Record<string, unknown>[]> {
  const TAIL_BYTES = 256 * 1024;
  let handle;
  try {
    handle = await open(jsonlPath(), "r");
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    await handle.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    // Erste Zeile kann abgeschnitten sein, wenn mitten im Datenstrom gelesen wurde.
    if (start > 0) lines.shift();
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((x): x is Record<string, unknown> => x !== null)
      .reverse();
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function startImproveLog(): void {
  lastSnapAt = Date.now();
  if (enabled()) void loadDaily();
  STATE.improve = improveSnapshot();
  improve("boot", "start", {
    name: CONFIG.name,
    version: CONFIG.version,
    modules: CONFIG.modules.join(","),
  });
  void flushImproveSnapshot("boot");
  setInterval(() => {
    void flushImproveSnapshot("interval");
  }, SNAP_INTERVAL_MS);
}
