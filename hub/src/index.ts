import { CONFIG, api, log } from "./config.js";
import { executeTask, type HubTask } from "./tasks.js";
import { checkForUpdate } from "./updater.js";

log(`EMP-Access-Hub startet: ${CONFIG.name} (${CONFIG.version}) -> ${CONFIG.apiUrl}`);

let taskLoopBusy = false;

async function heartbeat() {
  try {
    const res = await api("/api/hub/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        name: CONFIG.name,
        hostname: CONFIG.hostname,
        version: CONFIG.version,
        modules: CONFIG.modules,
      }),
    });
    if (!res.ok) {
      log(`Heartbeat fehlgeschlagen: HTTP ${res.status}`);
    }
  } catch (e) {
    log(`Heartbeat-Fehler: ${e instanceof Error ? e.message : e}`);
  }
}

async function pollTasks() {
  if (taskLoopBusy) return;
  taskLoopBusy = true;
  try {
    const res = await api("/api/hub/tasks");
    if (!res.ok) return;
    const tasks = (await res.json()) as HubTask[];

    for (const task of tasks) {
      const result = await executeTask(task);
      log(`Task #${task.id} ${result.success ? "OK" : "FEHLER"}${result.error ? `: ${result.error}` : ""}`);
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

// Sofort melden, dann in Intervallen weiterarbeiten.
heartbeat();
pollTasks();
setInterval(heartbeat, CONFIG.heartbeatIntervalMs);
setInterval(pollTasks, CONFIG.taskIntervalMs);
setInterval(checkForUpdate, CONFIG.updateIntervalMs);

process.on("SIGTERM", () => { log("SIGTERM – Hub beendet sich."); process.exit(0); });
process.on("SIGINT", () => { log("SIGINT – Hub beendet sich."); process.exit(0); });
