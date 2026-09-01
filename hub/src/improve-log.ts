/**
 * Automatisches Verbesserungslog: JSONL + periodischer Snapshot.
 * Keine Secrets (Passwort, Token, Embedding). Dient der Hub-Diagnose.
 */
import { appendFile, mkdir, open, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { STATE } from "./state.js";

export type ImproveKind =
  | "boot"
  | "face"
  | "vision"
  | "alpr"
  | "task"
  | "parking"
  | "doorbird"
  | "camera"
  | "heartbeat"
  | "snmp";

const SECRET_KEYS = /password|token|embedding|authorization|apikey|secret|pin|bot/i;
const MAX_JSONL_BYTES = 8 * 1024 * 1024;
const SNAP_INTERVAL_MS = (Number(process.env.HUB_IMPROVE_INTERVAL) > 0
  ? Number(process.env.HUB_IMPROVE_INTERVAL)
  : 300) * 1000;

const counts = new Map<string, number>();
const since = new Date().toISOString();
let lastSnapAt = 0;
let writing = false;

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

function bump(kind: ImproveKind, event: string): string {
  const key = `${kind}.${event}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
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
  const out: string[] = [];
  const personOk = n("face.person_match") + n("face.person_nomatch");
  const skipNoFace = n("face.skip_no_face");
  const personPipelines = personOk + skipNoFace + n("face.skip_inactive") + n("face.skip_inflight");
  const embedHit = n("face.ok") + n("face.zoom") + n("face.keep");
  if (personPipelines >= 6 && skipNoFace / personPipelines >= 0.5) {
    out.push(
      `Personen-Pipeline oft ohne Gesicht (${skipNoFace}/${personPipelines}) – Abstand, Licht oder Zoom`
    );
  }
  if (n("face.keep") >= 5 && n("face.zoom") === 0) {
    out.push("Face-Zoom findet Mini-Gesichter nicht – KEEP-Fallback trägt, Matching unsicher");
  }
  if (n("face.near_miss") >= 2) {
    out.push("Gallery-Treffer knapp unter der Schwelle – FACE_UPSCALED_THRESHOLD oder Enroll-Qualität");
  }
  if (embedHit >= 3 && n("face.person_match") === 0 && n("face.person_nomatch") >= 3 && n("face.near_miss") === 0) {
    out.push("Gesichter da, kein Match – Unbekannte oder Mini-Gesichter (best-Score im Log)");
  }
  if (n("vision.fail") >= 3) {
    out.push("YOLO-/Vision-Classify schlägt fehl – Tracker oder Timeout (HUB, 2 s)");
  }
  if (n("alpr.skip") >= 4 && n("alpr.plate") === 0) {
    out.push("Fahrzeug-Bursts ohne Plate – Zufahrt/OCR oder Fehlalarm der Kamera-KI");
  }
  if (n("task.stale") >= 1) {
    out.push("SCAN_SNAPSHOT stale (>30 s) – Hub war beschäftigt oder offline");
  }
  if (n("task.fail") >= 2) {
    out.push(`Tasks fehlgeschlagen: ${n("task.fail")} – Queue/API prüfen`);
  }
  if (n("doorbird.monitor_drop") >= 2) {
    out.push("DoorBird-Monitor bricht ab – LAN oder Idle-Timeout");
  }
  if (n("parking.tracker_down") >= 2) {
    out.push("Park-Tracker offline – YOLO-Dienst auf 8088");
  }
  if (n("heartbeat.fail") >= 3) {
    out.push("Heartbeat zur Cloud unzuverlässig");
  }
  if (out.length === 0) out.push("Keine auffälligen Raten in dieser Session");
  return out;
}

export function improveSnapshot(): {
  since: string;
  counts: Record<string, number>;
  hints: string[];
  summary: string;
  hint: string;
} {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 8).map(([k, v]) => `${k}=${v}`);
  const h = hints();
  return {
    since,
    counts: Object.fromEntries(entries),
    hints: h,
    summary: top.join(" · ") || "noch keine Ereignisse",
    hint: h[0] ?? "sammelt …",
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
    `Rohdaten: \`hub/.cache/improve.jsonl\``,
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
    log(`Improve-Snapshot (${reason}): ${snap.hint}`);
  } catch {
    // Diagnose darf den Hub nicht stören.
  }
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

export function improve(
  kind: ImproveKind,
  event: string,
  data?: Record<string, unknown>
): void {
  if (!enabled()) return;
  bump(kind, event);
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
