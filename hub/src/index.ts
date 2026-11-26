import { startGo2rtcMonitor } from "./go2rtc-status.js";
import { writeSync } from "node:fs";
import { CONFIG, api, log } from "./config.js";
import { executeTask, type HubTask } from "./tasks.js";
import { errorText, resultBody, runGuarded } from "./task-guard.js";
import { exitHub, isExiting, onShutdown } from "./shutdown.js";
import { checkForUpdate, repoAccessStatus, setRestartHold } from "./updater.js";
import { serialRuns } from "./heartbeat-rules.js";
import { PREFLIGHT_OK, isPreflightRun } from "./updater-rules.js";
import { startDashboard } from "./dashboard.js";
import { dashboardAccessMode } from "./dashboard-auth.js";
import { autoScan } from "./scanner.js";
import { onTaskKick } from "./task-kick.js";
import { pollCameras, CAMERA_POLL_INTERVAL_MS, restoreCameraMotion, restoreSceneReturns } from "./cameras.js";
import { ALIVE_INTERVAL_MS, markAlive } from "./alive-mark.js";
import { ensureFaceSidecar, refreshGallery } from "./face.js";
import { refreshVehicleWhitelist } from "./plate.js";
import { alprWarmup } from "./alpr.js";
import { STATE, recordHeartbeat, recordHubEvent, recordTask } from "./state.js";
import { reportParking } from "./parking.js";
import { PARKING_REPORT_TICK_MS } from "./parking-rules.js";
import { checkNoParking, noParkingConfigSummary, NOPARK_INTERVAL_MS } from "./noparking.js";
import { AUTO_LABEL, runSwitchSync, snmpConfigured } from "./snmp.js";
import { startVlanCheck } from "./vlan-check.js";
import { improve, startImproveLog, flushImproveSnapshot } from "./improve-log.js";
import { startSystemMetrics } from "./system-metrics.js";
import { startSystemSetup } from "./system-setup.js";
import { ensureFfmpeg } from "./ffmpeg-setup.js";
import { startHueSync } from "./smart-devices.js";
import { startSoundweb } from "./soundweb.js";
import { startRooms } from "./rooms.js";
import { startClimate } from "./climate.js";
import { noteRuleVersion, rulesHeartbeat, startRules } from "./rules.js";
import { startMower, stopMowerSidecar } from "./mower.js";
import { startAgent } from "./agent/agent.js";
import { holdSentinelCoverage, onCoverageShrink, sentinelBusy, sentinelCoverage } from "./agent/sentinel.js";
import { startHealthTrends } from "./health-trends.js";
import { startStaff } from "./staff.js";

// Pre-Flight des Selbst-Updates (updater.ts): Bis hierher sind alle Module
// geladen – Syntax, Importe und Abhaengigkeiten des neuen Stands stimmen also.
// Nichts starten, nur bestaetigen und beenden. Muss VOR allem anderen stehen
// und darf nie entfallen (Vertrag mit dem laufenden Updater, updater-rules.ts).
if (isPreflightRun(process.env)) {
  // Synchron schreiben: nach process.exit ginge eine gepufferte Ausgabe verloren.
  writeSync(1, `${PREFLIGHT_OK}\n`);
  process.exit(0);
}

/**
 * Unerwarteter Fehler: laut loggen, aufraeumen, beenden – launchd (KeepAlive)
 * startet neu. Ohne Handler beendet Node den Prozess in beiden Faellen
 * ebenfalls, aber nur mit einer Zeile in emp-hub.error.log; so steht der
 * Grund auch im Hub-Log und der Maeher-Sidecar wird gestoppt. Bewusst kein
 * Weiterlaufen: Der Zustand ist danach unklar.
 */
let fatalHandled = false;
function fatal(kind: string, err: unknown): void {
  const text = err instanceof Error ? err.stack || err.message : String(err);
  // Auch nach stderr (emp-hub.error.log), wie Node es ohne Handler taete.
  console.error(`[${new Date().toISOString()}] ${kind}: ${text}`);
  if (fatalHandled) return;
  fatalHandled = true;
  // Aufraeumen darf den Neustart nie aufhalten.
  setTimeout(() => process.exit(1), 5_000).unref();
  try {
    log(`FATAL – ${kind}: ${text} – Hub beendet sich (launchd startet neu).`);
    // Derselbe Weg wie jedes andere Beenden: Vom ersten Augenblick an holt
    // der Hub keine Auftraege mehr ab, die er nicht zu Ende fuehren koennte.
    exitHub(1);
  } catch {
    process.exit(1);
  }
}
process.on("uncaughtException", (err) => fatal("unbehandelte Ausnahme", err));
process.on("unhandledRejection", (reason) => fatal("unbehandelte Promise-Ablehnung", reason));

log(`EMP-Access-Hub startet: ${CONFIG.name} (${CONFIG.version}) -> ${CONFIG.apiUrl}`);

/** Nur der Claim (GET /tasks) – Ausführung läuft danach frei. */
let taskPollBusy = false;
let taskSlots = 0;
const TASK_CONCURRENCY = 4;

const HIGH_PRIORITY = new Set([
  "SCAN_SNAPSHOT",
  // Licht aus der Cloud oder einer Regel: sofort schalten.
  "HUE_SET",
  // Maeher-Befehl aus dem Raum-Widget: sofort weitergeben.
  "MOWER_ACTION",
  // Regel „Kamera steuern“ (z. B. Klingel → Halle auf Preset): sofort.
  "CAMERA_SCENE",
  "DOORBIRD_OPEN",
  "DOORBIRD_HOLD",
  "CAMERA_PTZ",
  "CAMERA_SPOTLIGHT",
  "CAMERA_IR",
  "CAMERA_SIREN",
  "CAMERA_SNAPSHOT",
  // MCP-Schnittstelle: ein KI-Assistent wartet in der Cloud auf die Antwort.
  "AGENT_TOOL",
  // Log-Abruf ist ein reiner Dateizugriff und soll nicht hinter einem Scan warten.
  "HUB_LOG",
  "SERVICE_RESTART",
  "SYSTEM_CHECK",
  // Ein Fader, der hinter einem Netzwerk-Scan wartet, fühlt sich kaputt an.
  "SOUNDWEB_SET",
  "SOUNDWEB_SYNC",
]);

// FACE_ANALYZE: Stapel alter Sichtungen, darf keinen Slot fuer eilige Tasks blockieren.
const BACKGROUND_TYPES = new Set(["NETWORK_SCAN", "SWITCH_SYNC", "FACE_ANALYZE"]);

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

/**
 * Lebenszeichen an die Cloud, nacheinander (serialRuns): Ein Lebenszeichen,
 * das waehrend eines laufenden angefordert wird, baut seinen Inhalt erst nach
 * dessen Antwort. So ueberschreibt ein frueher gebautes nie ein spaeteres,
 * etwa die Liste bewachter Kameras nach dem Wegfall einer Kamera.
 */
const heartbeat = serialRuns(sendHeartbeat);

async function sendHeartbeat(): Promise<void> {
  try {
    const res = await api("/api/hub/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        name: CONFIG.name,
        hostname: CONFIG.hostname,
        version: CONFIG.version,
        modules: CONFIG.modules,
        // Auto-Login/Ruhezustand/Einschaltplan des Hub-Macs fuer die Hub-Karte,
        // dazu, wie das lokale Dashboard erreichbar ist ("local", "lan-token",
        // "lan-open"); die Cloud legt system unveraendert in HubAgent.status ab.
        system: STATE.system
          ? { ...STATE.system, dashboardAccess: dashboardAccessMode(CONFIG.dashboardHost, CONFIG.dashboardToken) }
          : undefined,
        // Deploy-Key/Update-Zugang fuer die Liste in den Cloud-Einstellungen.
        repoAccess: repoAccessStatus() ?? undefined,
        // Kameras, die der Waechter mit Bildern gerade nachweislich bewacht
        // (sentinel-cover-rules.ts): Dort meldet die Cloud unbekannte Personen
        // nicht selbst, solange diese Meldung hoechstens 5 Minuten alt ist.
        sentinel: sentinelCoverage(),
        // Notbetrieb der Regeln und noch nicht gemeldete Termine: Zu einem
        // angekuendigten Termin holt die Cloud nichts nach, was der Hub selbst
        // geschaltet hat (src/lib/rule-due.ts, hubRunAnnounced).
        rules: rulesHeartbeat(),
      }),
    });
    if (!res.ok) {
      log(`Heartbeat fehlgeschlagen: HTTP ${res.status}`);
      recordHeartbeat(false, `HTTP ${res.status}`);
      improve("heartbeat", "fail", { error: `HTTP ${res.status}` });
    } else {
      recordHeartbeat(true);
      const data = (await res.json().catch(() => ({}))) as { pendingTasks?: number; ruleVersion?: unknown };
      const pending = Number(data.pendingTasks) || 0;
      STATE.pendingTasks = pending;
      setTaskPollInterval(pending > 0 ? 1_000 : CONFIG.taskIntervalMs);
      if (pending > 0) void pollTasks();
      // Regeln geaendert: Plan fuer den Notbetrieb sofort neu holen (rules.ts).
      noteRuleVersion(data.ruleVersion);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Heartbeat-Fehler: ${msg}`);
    recordHeartbeat(false, msg);
    improve("heartbeat", "fail", { error: msg });
  }
}

/**
 * Faellt eine Kamera aus der Liste des Waechters, geht das Lebenszeichen
 * sofort hinaus statt erst im naechsten Takt: Die Cloud meldet dann dort
 * wieder selbst. Hoechstens eines alle 10 s; heartbeat() faengt jeden Fehler.
 */
const EARLY_HEARTBEAT_GAP_MS = 10_000;
let earlyHeartbeatAt = 0;
let earlyHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
onCoverageShrink(() => {
  if (earlyHeartbeatTimer) return;
  const wait = Math.max(0, earlyHeartbeatAt + EARLY_HEARTBEAT_GAP_MS - Date.now());
  earlyHeartbeatTimer = setTimeout(() => {
    earlyHeartbeatTimer = null;
    earlyHeartbeatAt = Date.now();
    void heartbeat();
  }, wait);
});

/**
 * Neustart nach einem Update (updater.ts): Zuerst meldet der Hub der Cloud
 * eine leere Liste bewachter Kameras, damit sie ab jetzt selbst meldet; dann
 * wartet der Neustart auf laufende Bewertungen des Waechters (hoechstens
 * 3 min), damit deren Alarm noch hinausgeht.
 */
setRestartHold({
  pending: async () => {
    holdSentinelCoverage("Neustart des Hubs nach einem Update");
    await heartbeat();
  },
  busy: sentinelBusy,
});

async function runAndReport(task: HubTask): Promise<void> {
  // Ein Handler, der wirft, darf den Hub nicht beenden: Der Fehler geht als
  // fehlgeschlagen an die Cloud, alle anderen Auftraege laufen weiter.
  const result = await runGuarded(() => executeTask(task));
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
    body: resultBody(result),
  }).catch((e) => log(`Ergebnis-Upload fehlgeschlagen: ${e?.message ?? e}`));
}

/** Auftrag im Hintergrund: Auch ein Fehler beim Melden endet im Log, nicht im Hub-Neustart. */
function runInBackground(task: HubTask, run: (task: HubTask) => Promise<void>): void {
  run(task).catch((e) => log(`Task #${task.id} (${task.type}): ${errorText(e)}`));
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

/** Kam während eines Abrufs ein Kick (Regel ausgelöst), gleich noch einmal holen. */
let taskPollAgain = false;
onTaskKick(() => {
  if (taskPollBusy) taskPollAgain = true;
  else void pollTasks();
});

async function pollTasks() {
  if (taskPollBusy) return;
  // Waehrend des Aufraeumens vor dem Neustart keine Auftraege mehr abholen:
  // Sie blieben halb ausgefuehrt liegen. Der neu gestartete Hub holt sie.
  if (isExiting()) return;
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
    for (const task of high) runInBackground(task, runWithSlot);
    for (const task of rest) runInBackground(task, runWithSlot);
    for (const task of background) runInBackground(task, runAndReport);
  } catch (e) {
    log(`Task-Poll-Fehler: ${e instanceof Error ? e.message : e}`);
  } finally {
    taskPollBusy = false;
    if (taskPollAgain) {
      taskPollAgain = false;
      void pollTasks();
    }
  }
}

// Lokales Dashboard starten, sofort melden, dann in Intervallen weiterarbeiten.
startImproveLog();
startSystemMetrics();
// go2rtc beobachten: Streams ohne Daten oder in H.265 landen im Hub-Log.
startGo2rtcMonitor();
// Ruhezustand verhindern, pmset nachziehen (falls sudoers-Regel), Auto-Login melden.
startSystemSetup();
// ffmpeg fuer go2rtc-Standbilder: bei Bedarf per Homebrew nachinstallieren.
void ensureFfmpeg();
// Hue-Lampen und -Gruppen in die Cloud melden (dort im Raum zuordnen).
startHueSync();
recordHubEvent({
  kind: "system",
  severity: "info",
  where: "Hub",
  title: "Hub gestartet",
  detail: `${CONFIG.name} · Version ${CONFIG.version}`,
});
startDashboard().catch((e) => log(`Lokales Dashboard nicht gestartet: ${errorText(e)}`));
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
// Parkmeldung (parking.ts): faengt jeden Fehler selbst, ein Lauf zur Zeit.
const parkingReport = () => reportParking().catch((e) => log(`Parkplatz-Report: ${errorText(e)}`));
setInterval(parkingReport, PARKING_REPORT_TICK_MS);
void parkingReport();
setTaskPollInterval(CONFIG.taskIntervalMs);
setInterval(() => {
  void checkForUpdate();
}, CONFIG.updateIntervalMs);
setInterval(autoScan, CONFIG.scanIntervalMs);
if (snmpConfigured()) {
  const snmpMs = (Number(process.env.HUB_SNMP_INTERVAL) > 0
    ? Number(process.env.HUB_SNMP_INTERVAL)
    : 900) * 1000;
  void runSwitchSync(AUTO_LABEL);
  setInterval(() => {
    void runSwitchSync(AUTO_LABEL);
  }, snmpMs);
}
// VLAN-Soll/Ist je Switch-Port (nur lesend) – meldet halb umgesetzte
// Insight-Aenderungen, bevor eine Kamera tagelang unbemerkt fehlt.
startVlanCheck();
// Folgen/Nahaufnahme, die ein Neustart unterbrochen hat: Kameras zurueckstellen.
void restoreCameraMotion();
// Szenen mit „zurück nach N s“, deren Rückkehr ein Neustart unterbrochen hat.
void restoreSceneReturns().catch((e) => log(`Kamera-Szenen: Rückkehr nach dem Neustart fehlgeschlagen (${e instanceof Error ? e.message : e})`));
setInterval(pollCameras, CAMERA_POLL_INTERVAL_MS);
// Lebenszeichen auf der Platte: Nach einem Neustart ist bekannt, bis wann der
// Vorgaenger lief (fuer das Ende der Ereignisse, die dabei offen blieben).
markAlive();
setInterval(() => markAlive(), ALIVE_INTERVAL_MS);
// Soundweb London: Konfiguration aus der Cloud, dann je Prozessor eine
// DI-Verbindung mit Abonnements. Ohne eingerichtete Geräte ein Leerlauf.
startSoundweb();
void startRooms().then(() => {
  startRules();
  // Klimaverlauf: Fuehler im LAN jede Minute lesen, 5-Minuten-Mittel an die Cloud.
  startClimate();
});
// Mammotion-Maeher: nur mit Zweit-Account in hub/.env (MAMMOTION_EMAIL/-PASSWORD).
startMower();
// Personal aus emp-control (ueber die Cloud): wer ist eingestempelt, wer hat
// heute noch Schicht. Fuer Assistent und Waechter; ohne Monitor-Link ein Leerlauf.
void startStaff();
// Hub-Assistent: lokales Sprachmodell (Ollama) + eigener Telegram-Bot.
// Nur mit HUB_AGENT_TELEGRAM_TOKEN in hub/.env, sonst ein Leerlauf.
// Verlaeufe fuer die Frueherkennung (Aussetzer, Neustarts, Port-Fehler, Platte).
void startHealthTrends();
void startAgent();
// Welche Kameras geprüft werden, steht in der Cloud ("Halteverbot" an der
// Kamera) und ist beim Start noch nicht bekannt – der Takt läuft deshalb
// immer und ist ohne ausgewählte Kamera ein Leerlauf.
log(`Halteverbot-Prüfung: ${noParkingConfigSummary()}`);
setInterval(() => {
  void checkNoParking();
}, NOPARK_INTERVAL_MS);
// Gallery/Whitelist werden von den Pipelines TTL-basiert bei Bedarf geladen;
// das Intervall dient nur als Auffangnetz (statt frueher 60 s Dauer-Polling).
setInterval(() => refreshGallery(true).catch(() => {}), 900_000);
refreshVehicleWhitelist().catch(() => {});
setInterval(() => refreshVehicleWhitelist().catch(() => {}), 300_000);
// STATE.alpr.ready pflegt alpr.ts selbst (true sobald der Daemon „ready“ meldet).
alprWarmup();

// Vor jedem Beenden (Update, Neustart aus der Cloud, Signal, Fehler):
// Maeher-Dienst stoppen und den Diagnose-Stand der Sitzung sichern. Ein vom
// Hub eingeschaltetes Weisslicht meldet sich in cameras.ts selbst an.
onShutdown("maeher", stopMowerSidecar);
onShutdown("diagnose", () => flushImproveSnapshot("exit"));

process.on("SIGTERM", () => {
  log("SIGTERM – Hub beendet sich.");
  exitHub(0);
});
process.on("SIGINT", () => {
  log("SIGINT – Hub beendet sich.");
  exitHub(0);
});
