import { CONFIG, api, log } from "./config.js";
import { executeTask, type HubTask } from "./tasks.js";
import { checkForUpdate } from "./updater.js";
import { startDashboard } from "./dashboard.js";
import { autoScan } from "./scanner.js";
import { pollCameras, CAMERA_POLL_INTERVAL_MS } from "./cameras.js";
import { ensureFaceSidecar, refreshGallery } from "./face.js";
import { refreshVehicleWhitelist } from "./plate.js";
import { alprWarmup } from "./alpr.js";
import { STATE, recordHeartbeat, recordTask } from "./state.js";
import { collectParkingSnapshot, ensureParkingCameras, uploadParkingTrackerFrames } from "./parking.js";

log(`EMP-Access-Hub startet: ${CONFIG.name} (${CONFIG.version}) -> ${CONFIG.apiUrl}`);

let taskLoopBusy = false;

async function reportParking() {
  try {
    await ensureParkingCameras();
    const parking = await collectParkingSnapshot();
    await api("/api/hub/parking", {
      method: "POST",
      body: JSON.stringify({ name: CONFIG.name, parking }),
    });
    await uploadParkingTrackerFrames();
  } catch (e) {
    log(`Parkplatz-Report: ${e instanceof Error ? e.message : e}`);
  }
}

async function heartbeat() {
  try {
    const parking = await collectParkingSnapshot().catch(() => undefined);
    const res = await api("/api/hub/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        name: CONFIG.name,
        hostname: CONFIG.hostname,
        version: CONFIG.version,
        modules: CONFIG.modules,
        ...(parking ? { parking } : {}),
      }),
    });
    if (!res.ok) {
      log(`Heartbeat fehlgeschlagen: HTTP ${res.status}`);
      recordHeartbeat(false, `HTTP ${res.status}`);
    } else {
      recordHeartbeat(true);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Heartbeat-Fehler: ${msg}`);
    recordHeartbeat(false, msg);
  }
}

async function pollTasks() {
  if (taskLoopBusy) return;
  taskLoopBusy = true;
  try {
    STATE.taskPolls++;
    const res = await api("/api/hub/tasks");
    if (!res.ok) return;
    const tasks = (await res.json()) as HubTask[];

    for (const task of tasks) {
      const result = await executeTask(task);
      log(`Task #${task.id} ${result.success ? "OK" : "FEHLER"}${result.error ? `: ${result.error}` : ""}`);
      recordTask({ id: task.id, type: task.type, success: result.success, error: result.error, result: result.result });
      await api(`/api/hub/tasks/${task.id}/result`, {
        method: "POST",
        body: JSON.stringify(result),
      }).catch((e) => log(`Ergebnis-Upload fehlgeschlagen: ${e?.message ?? e}`));
    }
  } catch (e) {
    log(`Task-Poll-Fehler: ${e instanceof Error ? e.message : e}`);
  } finally {
    taskLoopBusy = false;
  }
}

// Lokales Dashboard starten, sofort melden, dann in Intervallen weiterarbeiten.
startDashboard();
heartbeat();
pollTasks();
autoScan();
ensureFaceSidecar()
  .then((ok) => {
    if (ok) {
      log("Face-Sidecar bereit");
      return refreshGallery(true);
    }
    log("Face-Sidecar nicht verfügbar – Matching deaktiviert bis installiert");
  })
  .catch((e) => log(`Face-Sidecar: ${e instanceof Error ? e.message : e}`));
setInterval(heartbeat, CONFIG.heartbeatIntervalMs);
setInterval(reportParking, 8_000);
void reportParking();
setInterval(pollTasks, CONFIG.taskIntervalMs);
setInterval(checkForUpdate, CONFIG.updateIntervalMs);
setInterval(autoScan, CONFIG.scanIntervalMs);
setInterval(pollCameras, CAMERA_POLL_INTERVAL_MS);
// Gallery/Whitelist werden von den Pipelines TTL-basiert bei Bedarf geladen;
// das Intervall dient nur als Auffangnetz (statt frueher 60 s Dauer-Polling).
setInterval(() => refreshGallery(true).catch(() => {}), 900_000);
refreshVehicleWhitelist().catch(() => {});
setInterval(() => refreshVehicleWhitelist().catch(() => {}), 300_000);
alprWarmup();

process.on("SIGTERM", () => { log("SIGTERM – Hub beendet sich."); process.exit(0); });
process.on("SIGINT", () => { log("SIGINT – Hub beendet sich."); process.exit(0); });
