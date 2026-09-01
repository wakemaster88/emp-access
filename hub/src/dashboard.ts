/**
 * Lokales Hub-Dashboard: kleiner HTTP-Server ohne Abhaengigkeiten.
 *
 * Liefert die Lage des Hubs (Systeme, Netzwerk, Kameras, Ereignisse,
 * Personen, Fahrzeuge) und erlaubt lokale Aktionen (Ping, Netzwerk-Scan,
 * Wake-on-LAN, Snapshot). Oberflaeche liegt in dashboard.html/css/js.
 *
 * Zugriff: ohne HUB_DASHBOARD_TOKEN nur 127.0.0.1. Mit Token bindet der
 * Server ans LAN und verlangt das Token fuer jede Anfrage von aussen.
 */
import http from "node:http";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { CONFIG, log } from "./config.js";
import {
  STATE,
  currentEventSeq,
  hubEventsSince,
  recordTask,
} from "./state.js";
import { executeTask } from "./tasks.js";
import { listCameraStatus } from "./cameras.js";
import { listDoorbirdStatus } from "./doorbird.js";
import { lastParkingSnapshot } from "./parking.js";
import { lastScanResult } from "./scanner.js";
import { listWhitelistPublic } from "./plate.js";
import { recentImproveEvents } from "./improve-log.js";
import { snmpConfigured } from "./snmp.js";
import { systemMetrics, type SystemMetrics } from "./system-metrics.js";

let actionCounter = 0;

/** Eigener Ordner, damit dashboard.js nicht mit dashboard.ts kollidiert. */
const ASSET_DIR = path.join(CONFIG.hubDir, "src", "ui");
const ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "dashboard.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "dashboard.html", type: "text/html; charset=utf-8" },
  "/dashboard.css": { file: "dashboard.css", type: "text/css; charset=utf-8" },
  "/dashboard.js": { file: "dashboard.js", type: "text/javascript; charset=utf-8" },
};

const ALLOWED_ACTIONS = [
  "PING",
  "NETWORK_SCAN",
  "WAKE_ON_LAN",
  "CAMERA_SNAPSHOT",
  "FACE_ENROLL",
];

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------------------------
 * Zugang
 * ------------------------------------------------------------------------- */

const COOKIE_NAME = "hub_dash";

function isLoopback(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/** Laengenunabhaengiger Vergleich ueber Digests. */
function sameToken(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function cookieToken(req: http.IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) return decodeURIComponent(v.join("="));
  }
  return null;
}

function authorized(
  req: http.IncomingMessage,
  url: URL,
  res: http.ServerResponse
): boolean {
  const expected = CONFIG.dashboardToken;
  if (!expected) return true;
  if (isLoopback(req)) return true;

  const header = req.headers["x-hub-token"];
  const given =
    url.searchParams.get("token") ??
    (typeof header === "string" ? header : null) ??
    cookieToken(req);
  if (!given || !sameToken(given, expected)) return false;

  if (url.searchParams.has("token")) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`
    );
  }
  return true;
}

const LOGIN_PAGE = /* html */ `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EMP-Access Hub</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
    font:15px/1.5 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    background:#0b1020; color:#e6e9f5; }
  form { display:grid; gap:12px; width:min(320px, 88vw); }
  h1 { font-size:17px; margin:0 0 4px; }
  p { margin:0; color:#8b93b5; font-size:13px; }
  input, button { font:inherit; border-radius:10px; padding:12px 14px; min-height:44px; }
  input { background:#141a30; border:1px solid #232b4a; color:inherit; }
  button { border:0; background:#6d5cf7; color:#fff; font-weight:600; }
</style></head>
<body><form method="GET" action="/">
  <h1>EMP-Access Hub</h1>
  <p>Zugang nur mit Token.</p>
  <input type="password" name="token" placeholder="Token" autocomplete="current-password" required autofocus>
  <button>Anmelden</button>
</form></body></html>`;

/* ---------------------------------------------------------------------------
 * Nutzdaten
 * ------------------------------------------------------------------------- */

function statusPayload() {
  return {
    name: CONFIG.name,
    hostname: CONFIG.hostname,
    version: CONFIG.version,
    apiUrl: CONFIG.apiUrl,
    modules: CONFIG.modules,
    startedAt: STATE.startedAt,
    uptimeSec: Math.floor(process.uptime()),
    heartbeat: STATE.heartbeat,
    taskPolls: STATE.taskPolls,
    autoScan: STATE.autoScan,
    cameras: STATE.cameras,
    face: STATE.face,
    alpr: STATE.alpr,
    parking: STATE.parking,
    pendingTasks: STATE.pendingTasks,
    improve: STATE.improve,
    tasks: STATE.tasks,
    logs: STATE.logs.slice(-100).reverse(),
    intervals: {
      heartbeatSec: CONFIG.heartbeatIntervalMs / 1000,
      taskSec: CONFIG.taskIntervalMs / 1000,
      updateSec: CONFIG.updateIntervalMs / 1000,
    },
  };
}

type HealthState = "ok" | "warn" | "off";

interface HealthItem {
  id: string;
  label: string;
  state: HealthState;
  value: string;
  detail: string;
}

function heartbeatFresh(): boolean {
  const last = STATE.heartbeat.lastSuccessAt;
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < CONFIG.heartbeatIntervalMs + 15_000;
}

/** Auslastung ab 75 % auffaellig, ab 90 % kritisch. */
function loadState(percent: number | null): HealthState {
  if (percent == null) return "off";
  if (percent >= 90) return "warn";
  if (percent >= 75) return "warn";
  return "ok";
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function healthItems(
  cameras: ReturnType<typeof listCameraStatus>,
  doorbirds: ReturnType<typeof listDoorbirdStatus>,
  parking: ReturnType<typeof lastParkingSnapshot>,
  metrics: SystemMetrics
): HealthItem[] {
  const scan = STATE.autoScan;
  const cloudOk = heartbeatFresh();
  const camReachable = cameras.filter((c) => c.reachable).length;
  const dbConnected = doorbirds.filter((d) => d.connected).length;

  return [
    {
      id: "hub",
      label: "Hub",
      state: "ok",
      value: "läuft",
      detail: `Version ${CONFIG.version}`,
    },
    {
      id: "cloud",
      label: "Cloud",
      state: cloudOk ? "ok" : "warn",
      value: cloudOk ? "verbunden" : "getrennt",
      detail: STATE.heartbeat.lastError
        ? String(STATE.heartbeat.lastError)
        : `${STATE.heartbeat.successCount} ok / ${STATE.heartbeat.failCount} Fehler`,
    },
    {
      id: "cpu",
      label: "CPU",
      state: loadState(metrics.cpu.usage),
      value: metrics.cpu.usage == null ? "–" : `${Math.round(metrics.cpu.usage)} %`,
      detail: `${metrics.cpu.cores} Kerne · Last ${metrics.cpu.load1.toFixed(2)}`,
    },
    {
      id: "memory",
      label: "Speicher",
      state: loadState(metrics.memory.usage),
      value: `${Math.round(metrics.memory.usage)} %`,
      detail: `${gib(metrics.memory.usedBytes)} von ${gib(metrics.memory.totalBytes)}`,
    },
    {
      id: "disk",
      label: "Platte",
      state: metrics.disk ? loadState(metrics.disk.usage) : "off",
      value: metrics.disk ? `${Math.round(metrics.disk.usage)} %` : "–",
      detail: metrics.disk
        ? `${gib(metrics.disk.totalBytes - metrics.disk.usedBytes)} frei`
        : "unbekannt",
    },
    {
      id: "cameras",
      label: "Kameras",
      state: cameras.length === 0 ? "off" : camReachable === cameras.length ? "ok" : "warn",
      value: `${camReachable}/${cameras.length}`,
      detail: STATE.cameras.error ? String(STATE.cameras.error) : `${STATE.cameras.openEvents} offene Events`,
    },
    {
      id: "doorbird",
      label: "DoorBird",
      state: doorbirds.length === 0 ? "off" : dbConnected === doorbirds.length ? "ok" : "warn",
      value: doorbirds.length ? `${dbConnected}/${doorbirds.length}` : "keine",
      detail: doorbirds.length ? "Monitor-Verbindungen" : "nicht konfiguriert",
    },
    {
      id: "face",
      label: "Gesichter",
      state: STATE.face.ready ? "ok" : "off",
      value: STATE.face.ready ? "bereit" : "aus",
      detail: `${STATE.face.gallery} Embeddings`,
    },
    {
      id: "alpr",
      label: "Kennzeichen",
      state: STATE.alpr.ready ? "ok" : "off",
      value: STATE.alpr.ready ? "bereit" : "aus",
      detail: "fast-alpr + macOS Vision",
    },
    {
      id: "parking",
      label: "Parken",
      state: parking.lots.length === 0 ? "off" : parking.trackerOnline ? "ok" : "warn",
      value: parking.lots.length ? `${parking.lots.length} Zonen` : "keine",
      detail: parking.trackerOnline ? "Tracker online" : "Tracker offline",
    },
    {
      id: "network",
      label: "Netzwerk",
      state: scan.error ? "warn" : scan.lastRunAt ? "ok" : "off",
      value: scan.lastRunAt ? `${scan.devices} Geräte` : "kein Lauf",
      detail: scan.error ? String(scan.error) : scan.uploaded ? "in der Cloud" : "lokal",
    },
    {
      id: "tasks",
      label: "Aufgaben",
      state: STATE.pendingTasks > 0 ? "warn" : "ok",
      value: `${STATE.pendingTasks} offen`,
      detail: `${STATE.taskPolls} Abrufe`,
    },
    {
      id: "snmp",
      label: "SNMP",
      state: snmpConfigured() ? "ok" : "off",
      value: snmpConfigured() ? "aktiv" : "aus",
      detail: snmpConfigured() ? "Switch-Sync" : "HUB_SNMP_TARGETS fehlt",
    },
  ];
}

function overviewPayload() {
  const cameras = listCameraStatus();
  const doorbirds = listDoorbirdStatus();
  const parking = lastParkingSnapshot();
  const metrics = systemMetrics();
  return {
    hub: {
      name: CONFIG.name,
      hostname: CONFIG.hostname,
      version: CONFIG.version,
      apiUrl: CONFIG.apiUrl,
      modules: CONFIG.modules,
      startedAt: STATE.startedAt,
      uptimeSec: Math.floor(process.uptime()),
      intervals: {
        heartbeatSec: CONFIG.heartbeatIntervalMs / 1000,
        taskSec: CONFIG.taskIntervalMs / 1000,
        scanSec: CONFIG.scanIntervalMs / 1000,
      },
    },
    health: healthItems(cameras, doorbirds, parking, metrics),
    system: metrics,
    heartbeat: { ...STATE.heartbeat, fresh: heartbeatFresh() },
    cameras,
    doorbirds,
    parking,
    whitelist: listWhitelistPublic(),
    face: STATE.face,
    alpr: STATE.alpr,
    autoScan: STATE.autoScan,
    pendingTasks: STATE.pendingTasks,
    taskPolls: STATE.taskPolls,
    improve: STATE.improve,
    tasks: STATE.tasks,
    logs: STATE.logs.slice(-80).reverse(),
    eventSeq: currentEventSeq(),
  };
}

/* ---------------------------------------------------------------------------
 * Statische Dateien
 * ------------------------------------------------------------------------- */

async function serveAsset(
  res: http.ServerResponse,
  req: http.IncomingMessage,
  asset: { file: string; type: string }
): Promise<void> {
  try {
    const full = path.join(ASSET_DIR, asset.file);
    const info = await stat(full);
    const etag = `W/"${info.size}-${Math.floor(info.mtimeMs)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-cache",
      ETag: etag,
    });
    res.end(body);
  } catch (e) {
    log(`Dashboard-Datei ${asset.file} fehlt: ${e instanceof Error ? e.message : e}`);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Dashboard-Datei ${asset.file} nicht lesbar.`);
  }
}

/* ---------------------------------------------------------------------------
 * Server
 * ------------------------------------------------------------------------- */

export function startDashboard(): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (!authorized(req, url, res)) {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "Token fehlt" });
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(LOGIN_PAGE);
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, statusPayload());
    }

    if (req.method === "GET" && url.pathname === "/api/overview") {
      return json(res, 200, overviewPayload());
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const since = Number(url.searchParams.get("since")) || 0;
      return json(res, 200, {
        seq: currentEventSeq(),
        events: hubEventsSince(since, {
          kind: url.searchParams.get("kind") ?? undefined,
          where: url.searchParams.get("where") ?? undefined,
          limit: Number(url.searchParams.get("limit")) || undefined,
        }),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/network") {
      return json(res, 200, lastScanResult());
    }

    if (req.method === "GET" && url.pathname === "/api/improve") {
      const wantEvents = url.searchParams.get("events") !== "0";
      return json(res, 200, {
        ...STATE.improve,
        events: wantEvents ? await recentImproveEvents(80) : [],
      });
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readBody(req);
      const type = String(body.type ?? "");
      if (!ALLOWED_ACTIONS.includes(type)) {
        return json(res, 400, { error: "Unbekannte Aktion" });
      }
      const id = --actionCounter; // negative IDs = lokal ausgeloest
      const result = await executeTask({
        id,
        type,
        payload: (body.payload as Record<string, unknown>) ?? null,
      });
      recordTask({ id, type: `${type} (lokal)`, success: result.success, error: result.error, result: result.result });
      return json(res, 200, result);
    }

    const asset = ASSETS[url.pathname];
    if (req.method === "GET" && asset) {
      return serveAsset(res, req, asset);
    }

    json(res, 404, { error: "Nicht gefunden" });
  });

  server.on("error", (e) => log(`Dashboard-Server-Fehler: ${e.message}`));
  server.listen(CONFIG.dashboardPort, CONFIG.dashboardHost, () => {
    const scope =
      CONFIG.dashboardHost === "127.0.0.1"
        ? "nur lokal"
        : CONFIG.dashboardToken
          ? "im LAN, Token nötig"
          : "im LAN OHNE Token";
    log(`Lokales Dashboard: http://localhost:${CONFIG.dashboardPort} (${scope})`);
  });
}
