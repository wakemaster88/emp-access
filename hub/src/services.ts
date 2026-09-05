/**
 * Neustart lokaler Dienste aus der Cloud (Task SERVICE_RESTART).
 *
 * Bewusst nur eine feste Liste – kein freier Befehl. Der Tracker läuft laut
 * webcams/infra als launchd-Agent; `launchctl kickstart -k` beendet ihn und
 * startet ihn sofort neu. Der Hub selbst beendet sich nach dem Melden des
 * Ergebnisses, launchd (KeepAlive) startet ihn wieder.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { trackerBaseUrl } from "./vision.js";

const execFileAsync = promisify(execFile);

const TRACKER_LABEL = process.env.HUB_TRACKER_LAUNCHD_LABEL || "com.local.webcams-tracker";
const HEALTH_WAIT_MS = 30_000;

export type RestartableService = "tracker" | "hub";

export interface RestartResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

async function trackerHealthy(): Promise<Record<string, unknown> | null> {
  try {
    const url = await trackerBaseUrl();
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function restartTracker(): Promise<RestartResult> {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid == null || process.platform !== "darwin") {
    return { success: false, error: "Tracker-Neustart nur auf macOS mit launchd möglich" };
  }
  const target = `gui/${uid}/${TRACKER_LABEL}`;
  const before = await trackerHealthy();
  log(`Dienst-Neustart: Tracker (${target}) …`);
  try {
    await execFileAsync("launchctl", ["kickstart", "-k", target], { timeout: 15_000 });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || String(e)).trim();
    log(`Dienst-Neustart: launchctl fehlgeschlagen: ${detail}`);
    return {
      success: false,
      error: `launchctl kickstart ${target}: ${detail}. Läuft der Tracker als launchd-Agent? Label per HUB_TRACKER_LAUNCHD_LABEL setzen.`,
      result: { service: "tracker", label: TRACKER_LABEL, healthyBefore: !!before },
    };
  }

  // Warten, bis der neue Prozess antwortet (YOLO-Modell laden dauert ein paar Sekunden).
  const started = Date.now();
  let health: Record<string, unknown> | null = null;
  // Kurze Pause, damit nicht noch der alte Prozess antwortet.
  await new Promise((r) => setTimeout(r, 1_500));
  while (Date.now() - started < HEALTH_WAIT_MS) {
    health = await trackerHealthy();
    if (health) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const waitedMs = Date.now() - started;
  log(`Dienst-Neustart: Tracker ${health ? `wieder da nach ${Math.round(waitedMs / 1000)} s` : "antwortet nach 30 s noch nicht"}`);
  recordHubEvent({
    kind: "system",
    severity: health ? "info" : "warn",
    where: "Tracker",
    title: health ? "Tracker neu gestartet" : "Tracker neu gestartet, antwortet noch nicht",
  });
  return {
    success: true,
    result: {
      service: "tracker",
      label: TRACKER_LABEL,
      restarted: true,
      healthy: !!health,
      waitedMs,
      health,
    },
  };
}

function restartHub(): RestartResult {
  log("Dienst-Neustart: Hub beendet sich in 2 s – launchd startet neu.");
  recordHubEvent({ kind: "system", severity: "info", where: "Hub", title: "Neustart aus der Cloud" });
  // Erst das Task-Ergebnis melden lassen, dann beenden.
  setTimeout(() => process.exit(0), 2_000).unref();
  return {
    success: true,
    result: { service: "hub", restarted: true, note: "Prozess beendet sich in 2 s, launchd startet ihn neu" },
  };
}

export async function restartService(payload: Record<string, unknown> | null): Promise<RestartResult> {
  const service = String(payload?.service ?? "");
  if (service === "tracker") return restartTracker();
  if (service === "hub") return restartHub();
  return { success: false, error: `Unbekannter Dienst: ${service || "(leer)"} – erlaubt: tracker, hub` };
}
