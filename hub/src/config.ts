import { config as loadEnv } from "dotenv";
import { pushLog } from "./state.js";
import { execSync } from "node:child_process";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hubDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(hubDir, ".env") });

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[hub] Fehlende Umgebungsvariable ${key} – bitte hub/.env anlegen (siehe .env.example).`);
    process.exit(1);
  }
  return v;
}

function intEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Letzter Commit, der den Hub-Code (hub/) beruehrt hat – nur der zwingt zum Neustart. */
export function gitHubCodeRevision(): string {
  try {
    // Doku und Beispiel-Env unter hub/ zaehlen nicht – sonst startet jeder
    // Eintrag im Verbesserungslog alle Hubs neu.
    return execSync("git rev-list -1 HEAD -- hub ':!hub/IMPROVE.md' ':!hub/README.md' ':!hub/.env.example'", {
      cwd: path.resolve(hubDir, ".."),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Kurzer Git-Commit-Hash des laufenden Codes (fuer Update-Diagnose). */
export function gitVersion(): string {
  try {
    // Repo-Root (Parent von hub/), nicht hubDir – sonst falsche Version bei Submodulen.
    return execSync("git rev-parse --short HEAD", {
      cwd: path.resolve(hubDir, ".."),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

export const CONFIG = {
  hubDir,
  repoDir: path.resolve(hubDir, ".."),
  apiUrl: requireEnv("HUB_API_URL").replace(/\/$/, ""),
  apiToken: requireEnv("HUB_API_TOKEN"),
  name: process.env.HUB_NAME || hostname(),
  hostname: hostname(),
  /** Checkout-Stand; wird nach einem Update ohne Neustart nachgezogen (updater.ts). */
  version: gitVersion(),
  /** Commit, mit dessen hub/-Stand dieser Prozess gestartet wurde. */
  hubCodeRevision: gitHubCodeRevision(),
  // 60 s: Der Heartbeat schreibt jedes Mal in die DB; das Dashboard wertet
  // bis ~5 Minuten ohne Heartbeat als online.
  heartbeatIntervalMs: intEnv("HUB_HEARTBEAT_INTERVAL", 60) * 1000,
  // 5 s Grundtakt (frueher 2 s = 43.000 Aufrufe am Tag). Sobald der
  // Heartbeat offene Tasks meldet, faellt der Takt auf 1 s, damit
  // Tueroeffner und Scan-Schnappschuesse nicht warten. Per HUB_TASK_INTERVAL
  // uebersteuerbar.
  taskIntervalMs: intEnv("HUB_TASK_INTERVAL", 5) * 1000,
  updateIntervalMs: intEnv("HUB_UPDATE_INTERVAL", 300) * 1000,
  dashboardPort: intEnv("HUB_DASHBOARD_PORT", 8787),
  /** Gesetzt = Dashboard darf ins LAN (Zugang nur mit diesem Token). */
  dashboardToken: (process.env.HUB_DASHBOARD_TOKEN || "").trim(),
  /**
   * Ohne Token bleibt das Dashboard strikt lokal – so kann es nie
   * versehentlich offen im Netz stehen.
   */
  dashboardHost:
    process.env.HUB_DASHBOARD_HOST?.trim() ||
    ((process.env.HUB_DASHBOARD_TOKEN || "").trim() ? "0.0.0.0" : "127.0.0.1"),
  // 30 min statt 5 min: Der Auto-Scan (Ping-Sweep + Portscan + Cloud-Upload)
  // erzeugt spuerbare Netz- und DB-Last; Inventardaten aendern sich selten.
  scanIntervalMs: intEnv("HUB_SCAN_INTERVAL", 1800) * 1000,
  modules: [
    "tasks",
    "ping",
    "network-scan",
    "wake-on-lan",
    "auto-scan",
    "cameras",
    "doorbird",
    "face",
    "alpr",
    "parking",
    "vision",
    "snmp",
  ],
};

export async function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CONFIG.apiUrl}${pathname}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.apiToken}`,
      ...init?.headers,
    },
  });
}

export function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
  pushLog(msg);
}
