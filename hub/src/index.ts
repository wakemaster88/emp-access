import { CONFIG, api, log } from "./config.js";
import { executeTask, type HubTask } from "./tasks.js";
import { checkForUpdate } from "./updater.js";
import { startDashboard } from "./dashboard.js";
import { autoScan } from "./scanner.js";
import { pollCameras, CAMERA_POLL_INTERVAL_MS } from "./cameras.js";
import { ensureFaceSidecar, refreshGallery } from "./face.js";
import { refreshVehicleWhitelist } from "./plate.js";
import { alprWarmup } from "./alpr.js";
import { STATE, recordHeartbeat, recordHubEvent, recordTask } from "./state.js";
import { collectParkingSnapshot, ensureParkingCameras, uploadParkingTrackerFrames } from "./parking.js";
import { runSwitchSync, snmpConfigured } from "./snmp.js";
import { improve, startImproveLog, flushImproveSnapshot } from "./improve-log.js";
import { startSystemMetrics } from "./system-metrics.js";
import { startSystemSetup } from "./system-setup.js";

log(`EMP-Access-Hub startet: ${CONFIG.name} (${CONFIG.version}) -> ${CONFIG.apiUrl}`);

/** Nur der Claim (GET /tasks) – Ausführung läuft danach frei. */
let taskPollBusy = false;
let taskSlots = 0;
const TASK_CONCURRENCY = 4;

const HIGH_PRIORITY = new Set([
  "SCAN_SNAPSHOT",
  "DOORBIRD_OPEN",
  "CAMERA_PTZ",
  "CAMERA_SPOTLIGHT",
  "CAMERA_IR",
  "CAMERA_SIREN",
  "CAMERA_SNAPSHOT",
  // Log-Abruf ist ein reiner Dateizugriff und soll nicht hinter einem Scan warten.
  "HUB_LOG",
  "SERVICE_RESTART",
  "SYSTEM_CHECK",
]);

const BACKGROUND_TYPES = new Set(["NETWORK_SCAN", "SWITCH_SYNC"]);

let taskPollTimer: ReturnType<typeof setInterval> | null = null;
let taskPollEveryMs = CONFIG.taskIntervalMs;

function setTaskPollInterval(ms: number) {
  if (ms === taskPollEveryMs && taskPollTimer) return;
  taskPollEveryMs = ms;
  if (taskPollTimer) clearInterval(taskPollTimer);
  taskPollTimer = setInterval(() => {
    void pollTasks();
  }, taskPollEveryMs);
}

async function reportParking() {
  try {
    await ensureParkingCameras();
    const parking = await collectParkingSnapshot();
    if (STATE.parking.lastAt && parking.trackerOnline !== STATE.parking.trackerOnline) {
      recordHubEvent({
        kind: "system",
        severity: parking.trackerOnline ? "info" : "warn",
        where: "Park-Tracker",
        title: parking.trackerOnline ? "Tracker wieder online" : "Tracker offline",
      });
    }
    STATE.parking = {
      lastAt: parking.at,
      trackerOnline: parking.trackerOnline,
      lots: parking.lots.length,
    };
    await api("/api/hub/parking", {
      method: "POST",
      body: JSON.stringify({ name: CONFIG.name, parking }),
    });
    await uploadParkingTrackerFrames();
    improve("parking", parking.trackerOnline ? "report" : "tracker_down", {
      lots: parking.lots.length,
    });
  } catch (e) {
    log(`Parkplatz-Report: ${e instanceof Error ? e.message : e}`);
    improve("parking", "fail", { error: e instanceof Error ? e.message : String(e) });
  }
}

async function heartbeat() {
  try {
    const res = await api("/api/hub/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        name: CONFIG.name,
        hostname: CONFIG.hostname,
        version: CONFIG.version,
        modules: CONFIG.modules,
        // Auto-Login/Ruhezustand/Einschaltplan des Hub-Macs fuer die Hub-Karte.
        system: STATE.system ?? undefined,
      }),
    });
    if (!res.ok) {
      log(`Heartbeat fehlgeschlagen: HTTP ${res.status}`);
      recordHeartbeat(false, `HTTP ${res.status}`);
      improve("heartbeat", "fail", { error: `HTTP ${res.status}` });
    } else {
      recordHeartbeat(true);
      const data = (await res.json().catch(() => ({}))) as { pendingTasks?: number };
      const pending = Number(data.pendingTasks) || 0;
      STATE.pendingTasks = pending;
      setTaskPollInterval(pending > 0 ? 1_000 : CONFIG.taskIntervalMs);
      if (pending > 0) void pollTasks();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Heartbeat-Fehler: ${msg}`);
    recordHeartbeat(false, msg);
    improve("heartbeat", "fail", { error: msg });
  }
}

async function runAndReport(task: HubTask): Promise<void> {
  const result = await executeTask(task);
  log(`Task #${task.id} ${result.success ? "OK" : "FEHLER"}${result.error ? `: ${result.error}` : ""}`);
  recordTask({ id: task.id, type: task.type, success: result.success, error: result.error, result: result.result });
  const skipped =
    result.result &&
    typeof result.result === "object" &&
    "skipped" in (result.result as object)
      ? String((result.result as { skipped?: unknown }).skipped ?? "")
      : "";
  improve("task", skipped === "stale" ? "stale" : result.success ? "ok" : "fail", {
    type: task.type,
    error: result.error,
    skipped: skipped || undefined,
  });
  await api(`/api/hub/tasks/${task.id}/result`, {
    method: "POST",
    body: JSON.stringify(result),
  }).catch((e) => log(`Ergebnis-Upload fehlgeschlagen: ${e?.message ?? e}`));
}

async function runWithSlot(task: HubTask): Promise<void> {
  while (taskSlots >= TASK_CONCURRENCY) {
    await new Promise((r) => setTimeout(r, 40));
  }
  taskSlots++;
  try {
    await runAndReport(task);
  } finally {
    taskSlots--;
  }
}

async function pollTasks() {
  if (taskPollBusy) return;
  taskPollBusy = true;
  try {
    STATE.taskPolls++;
    const res = await api("/api/hub/tasks");
    if (!res.ok) return;
    const tasks = (await res.json()) as HubTask[];
    if (tasks.length === 0) return;

    const high = tasks.filter((t) => HIGH_PRIORITY.has(t.type));
    const background = tasks.filter((t) => BACKGROUND_TYPES.has(t.type));
    const rest = tasks.filter((t) => !HIGH_PRIORITY.has(t.type) && !BACKGROUND_TYPES.has(t.type));

    // Hoch priorisiert zuerst in die Slots, Scan nie im Pool.
    for (const task of high) void runWithSlot(task);
    for (const task of rest) void runWithSlot(task);
    for (const task of background) void runAndReport(task);
  } catch (e) {
    log(`Task-Poll-Fehler: ${e instanceof Error ? e.message : e}`);
  } finally {
    taskPollBusy = false;
  }
}

// Lokales Dashboard starten, sofort melden, dann in Intervallen weiterarbeiten.
startImproveLog();
startSystemMetrics();
// Ruhezustand verhindern, pmset nachziehen (falls sudoers-Regel), Auto-Login melden.
startSystemSetup();
recordHubEvent({
  kind: "system",
  severity: "info",
  where: "Hub",
  title: "Hub gestartet",
  detail: `${CONFIG.name} · Version ${CONFIG.version}`,
});
startDashboard();
heartbeat();
pollTasks();
autoScan();
ensureFaceSidecar()
  .then((ok) => {
    STATE.face.ready = ok;
    recordHubEvent({
      kind: "system",
      severity: ok ? "info" : "warn",
      where: "Face",
      title: ok ? "Face-Sidecar bereit" : "Face-Sidecar nicht verfügbar",
    });
    if (ok) {
      log("Face-Sidecar bereit");
      return refreshGallery(true);
    }
    log("Face-Sidecar nicht verfügbar – Matching deaktiviert bis installiert");
  })
  .catch((e) => log(`Face-Sidecar: ${e instanceof Error ? e.message : e}`));
setInterval(heartbeat, CONFIG.heartbeatIntervalMs);
setInterval(reportParking, 30_000);
void reportParking();
setTaskPollInterval(CONFIG.taskIntervalMs);
setInterval(() => {
  void checkForUpdate();
}, CONFIG.updateIntervalMs);
setInterval(autoScan, CONFIG.scanIntervalMs);
if (snmpConfigured()) {
  const snmpMs = (Number(process.env.HUB_SNMP_INTERVAL) > 0
    ? Number(process.env.HUB_SNMP_INTERVAL)
    : 900) * 1000;
  void runSwitchSync("SNMP-Auto");
  setInterval(() => {
    void runSwitchSync("SNMP-Auto");
  }, snmpMs);
}
setInterval(pollCameras, CAMERA_POLL_INTERVAL_MS);
// Gallery/Whitelist werden von den Pipelines TTL-basiert bei Bedarf geladen;
// das Intervall dient nur als Auffangnetz (statt frueher 60 s Dauer-Polling).
setInterval(() => refreshGallery(true).catch(() => {}), 900_000);
refreshVehicleWhitelist().catch(() => {});
setInterval(() => refreshVehicleWhitelist().catch(() => {}), 300_000);
// STATE.alpr.ready pflegt alpr.ts selbst (true sobald der Daemon „ready“ meldet).
alprWarmup();

process.on("SIGTERM", () => {
  log("SIGTERM – Hub beendet sich.");
  void flushImproveSnapshot("exit").finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  log("SIGINT – Hub beendet sich.");
  void flushImproveSnapshot("exit").finally(() => process.exit(0));
});
