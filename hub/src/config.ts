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

/** Kurzer Git-Commit-Hash des laufenden Codes (fuer Update-Diagnose). */
function gitVersion(): string {
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
  version: gitVersion(),
  heartbeatIntervalMs: intEnv("HUB_HEARTBEAT_INTERVAL", 30) * 1000,
  // 2 s statt 5 s: Scan-Schnappschuesse (SCAN_SNAPSHOT) sollen moeglichst
  // nah am Scan-Zeitpunkt entstehen; auch PTZ/Tueroeffner reagieren dadurch
  // schneller. Per HUB_TASK_INTERVAL uebersteuerbar.
  taskIntervalMs: intEnv("HUB_TASK_INTERVAL", 2) * 1000,
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
