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
import { deviceAction, liveStates, roomsPayload, syncRooms } from "./rooms.js";
import { controlSmart, listSmartDevices, pairSmart } from "./smart-devices.js";
import { onDeviceSwitched, refreshPlan, rulesStatus } from "./rules.js";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { CONFIG, api, log } from "./config.js";
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
import { handleDetectionApi } from "./detection-settings.js";
import { recentImproveEvents } from "./improve-log.js";
import { lastSwitchSnapshots, snmpConfigured } from "./snmp.js";
import { configuredVlans, routerHost } from "./netmap.js";
import { soundwebSummary } from "./soundweb.js";
import { systemMetrics, type SystemMetrics } from "./system-metrics.js";
import { caDer, loadDashboardTls, type TlsMaterial } from "./dashboard-tls.js";
import { getFrame, startFrameWarmer } from "./frame-cache.js";

let actionCounter = 0;

/** Eigener Ordner, damit dashboard.js nicht mit dashboard.ts kollidiert. */
const ASSET_DIR = path.join(CONFIG.hubDir, "src", "ui");
const ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "dashboard.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "dashboard.html", type: "text/html; charset=utf-8" },
  "/dashboard.css": { file: "dashboard.css", type: "text/css; charset=utf-8" },
  "/dashboard.js": { file: "dashboard.js", type: "text/javascript; charset=utf-8" },
  "/pwa.js": { file: "pwa.js", type: "text/javascript; charset=utf-8" },
  // Home-Bildschirm-App (PWA): Manifest, Service Worker, Icons.
  "/manifest.webmanifest": { file: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8" },
  "/sw.js": { file: "sw.js", type: "text/javascript; charset=utf-8" },
  "/icons/icon.svg": { file: "icons/icon.svg", type: "image/svg+xml" },
  "/icons/icon-192.png": { file: "icons/icon-192.png", type: "image/png" },
  "/icons/icon-512.png": { file: "icons/icon-512.png", type: "image/png" },
  "/icons/icon-maskable-512.png": { file: "icons/icon-maskable-512.png", type: "image/png" },
  "/icons/apple-touch-icon.png": { file: "icons/apple-touch-icon.png", type: "image/png" },
  "/apple-touch-icon.png": { file: "icons/apple-touch-icon.png", type: "image/png" },
  "/apple-touch-icon-precomposed.png": { file: "icons/apple-touch-icon.png", type: "image/png" },
  "/favicon.ico": { file: "icons/icon-192.png", type: "image/png" },
};

/**
 * Ohne Token erreichbar: enthaelt nichts Geheimes, wird aber vom System
 * geholt, bevor ein Cookie da ist (Icon beim "Zum Home-Bildschirm",
 * Manifest auf der Login-Seite, CA-Zertifikat zum Installieren).
 */
const PUBLIC_PATHS = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/ca.crt",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/favicon.ico",
]);
function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/icons/");
}

/** Gesetzt, sobald das lokale Zertifikat geladen ist (siehe dashboard-tls.ts). */
let tls: TlsMaterial | null = null;

const ALLOWED_ACTIONS = [
  "PING",
  "NETWORK_SCAN",
  "WAKE_ON_LAN",
  "CAMERA_SNAPSHOT",
  "FACE_ENROLL",
  "SHELLY_STATUS",
  "SHELLY_SWITCH",
  "SWITCH_SYNC",
  // Kamera-Zentrale: dieselben Steuer-Tasks wie aus der Cloud.
  "CAMERA_PTZ",
  "CAMERA_PTZ_PRESETS",
  "CAMERA_CAPS",
  "CAMERA_SPOTLIGHT",
  "CAMERA_IR",
  "CAMERA_SIREN",
  "DOORBIRD_OPEN",
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

async function readRaw(req: http.IncomingMessage, limit = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Body zu gross");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/* ---------------------------------------------------------------------------
 * go2rtc-Proxy fuer die Kamera-Zentrale
 *
 * Der Browser spricht nur mit dem Dashboard (gleicher Origin, gleiche
 * Anmeldung). Nur Signalisierung und Standbilder laufen hier durch; das
 * Video selbst kommt per WebRTC direkt von go2rtc.
 * ------------------------------------------------------------------------- */

const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");

async function proxyGo2rtc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> {
  const sub = url.pathname.slice("/api/go2rtc".length);
  try {
    if (req.method === "GET" && sub === "/streams") {
      // Nur Name + Kamera-Host weitergeben – die RTSP-URLs enthalten Passwoerter.
      const r = await fetch(`${GO2RTC_URL}/api/streams`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return json(res, 200, { reachable: false, streams: [] });
      const data = (await r.json()) as Record<string, { producers?: Array<{ url?: string }> } | null>;
      const streams = Object.entries(data ?? {}).map(([name, info]) => {
        const producer = info?.producers?.[0]?.url ?? "";
        const m = producer.match(/@([^:/@]+)[:/]/) ?? producer.match(/^\w+:\/\/([^:/@]+)[:/]/);
        return { name, host: m ? m[1] : null };
      });
      return json(res, 200, { reachable: true, streams });
    }
    const src = url.searchParams.get("src") ?? "";
    if (!/^[\w.-]{1,80}$/.test(src)) return json(res, 400, { error: "src ungueltig" });
    if (req.method === "POST" && sub === "/webrtc") {
      const offer = await readRaw(req);
      const r = await fetch(`${GO2RTC_URL}/api/webrtc?src=${encodeURIComponent(src)}`, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer,
        signal: AbortSignal.timeout(10_000),
      });
      const answer = await r.text();
      res.writeHead(r.status, { "Content-Type": "application/sdp", "Cache-Control": "no-store" });
      res.end(answer);
      return;
    }
    if (req.method === "GET" && sub === "/frame.jpeg") {
      const got = await getFrame(GO2RTC_URL, src, url.searchParams.get("cached") === "1");
      if (!got) return json(res, 502, { error: "kein Bild" });
      res.writeHead(200, {
        "Content-Type": got.frame.type,
        "Cache-Control": "no-store",
        // Alter in Sekunden; -1 = unbekannt (vom Datentraeger nach Neustart).
        "X-Frame-Age": String(got.frame.at ? Math.round((Date.now() - got.frame.at) / 1000) : -1),
        "X-Frame-Cached": got.cached ? "1" : "0",
      });
      res.end(got.frame.buf);
      return;
    }
    return json(res, 404, { error: "unbekannt" });
  } catch (e) {
    return json(res, 502, { error: `go2rtc nicht erreichbar: ${e instanceof Error ? e.message : e}` });
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

  // Bei jedem Seitenaufruf erneuern (gleitend ein Jahr), damit die
  // Home-Bildschirm-App nicht nach einem Monat wieder nach dem Token fragt.
  // Lax statt Strict: Der Start vom Home-Bildschirm soll das Cookie sicher
  // mitschicken. Kein Secure – das Cookie gilt fuer HTTP und HTTPS.
  if (url.searchParams.has("token") || !url.pathname.startsWith("/api/")) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
    );
  }
  return true;
}

function loginPage(failed: boolean): string {
  return /* html */ `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1020">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Hub">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<title>EMP-Access Hub</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
    padding: env(safe-area-inset-top) 1rem env(safe-area-inset-bottom); box-sizing:border-box;
    font:15px/1.5 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    background:#0b1020; color:#e6e9f5; }
  form { display:grid; gap:12px; width:min(320px, 88vw); }
  h1 { font-size:17px; margin:0 0 4px; }
  p { margin:0; color:#8b93b5; font-size:13px; }
  input, button { font:inherit; border-radius:10px; padding:12px 14px; min-height:44px; }
  input { background:#141a30; border:1px solid #232b4a; color:inherit; font-size:16px; }
  button { border:0; background:#6d5cf7; color:#fff; font-weight:600; }
  .err { color:#fb7185; }
</style></head>
<body><form method="GET" action="/">
  <h1>EMP-Access Hub</h1>
  <p${failed ? ' class="err"' : ""}>${failed ? "Token falsch – bitte erneut eingeben." : "Zugang nur mit Token. Danach bleibt dieses Gerät ein Jahr angemeldet."}</p>
  <input type="password" name="token" placeholder="Token" autocomplete="current-password" required autofocus>
  <button>Anmelden</button>
</form></body></html>`;
}

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
  const soundweb = soundwebSummary();

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
      id: "soundweb",
      label: "Soundweb",
      state: soundweb.devices === 0 ? "off" : soundweb.connected === soundweb.devices ? "ok" : "warn",
      value: soundweb.devices ? `${soundweb.connected}/${soundweb.devices}` : "keine",
      detail: soundweb.lastError ?? (soundweb.devices ? "DI-Verbindungen" : "nicht eingerichtet"),
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
      ...(asset.file === "sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
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

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && isPublic(url.pathname)) {
      if (url.pathname === "/ca.crt") {
        if (!tls) return json(res, 404, { error: "HTTPS ist auf diesem Hub nicht eingerichtet" });
        const der = caDer(tls.ca);
        res.writeHead(200, {
          // So bietet Safari auf iPhone/iPad direkt "Profil laden" an.
          "Content-Type": "application/x-x509-ca-cert",
          "Content-Disposition": 'attachment; filename="EMP-Access-Hub-CA.crt"',
          "Cache-Control": "no-store",
        });
        res.end(der);
        return;
      }
      const pub = ASSETS[url.pathname];
      if (pub) return serveAsset(res, req, pub);
    }

    if (!authorized(req, url, res)) {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "Token fehlt" });
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return void res.end(loginPage(url.searchParams.has("token")));
    }

    // Token aus der Adresse entfernen, sobald das Cookie gesetzt ist: So landet
    // es weder im Verlauf noch als Start-Adresse der Home-Bildschirm-App.
    if (req.method === "GET" && url.searchParams.has("token") && !url.pathname.startsWith("/api/")) {
      url.searchParams.delete("token");
      res.writeHead(303, { Location: `${url.pathname}${url.search}`, "Cache-Control": "no-store" });
      return void res.end();
    }

    if (req.method === "GET" && url.pathname === "/api/pwa") {
      return json(res, 200, {
        https: !!tls,
        secure: !!(req.socket as { encrypted?: boolean }).encrypted,
        port: CONFIG.dashboardPort,
        names: tls?.names ?? [],
      });
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
      return json(res, 200, {
        ...lastScanResult(),
        switches: lastSwitchSnapshots(),
        router: routerHost(),
        vlansConfigured: configuredVlans().length > 0,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/rooms") {
      const live = url.searchParams.get("live") === "1";
      return json(res, 200, {
        ...roomsPayload(),
        rulesStatus: rulesStatus(),
        live: live ? await liveStates(url.searchParams.get("fresh") === "1") : null,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/rooms/sync") {
      const r = await syncRooms();
      return json(res, r.ok ? 200 : 502, r);
    }

    if (req.method === "POST" && url.pathname === "/api/rooms/device") {
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "Ungültige Geräte-ID" });
      const r = await deviceAction(id, String(body.action ?? ""));
      // Lokal geschaltet: Die Cloud bekommt es sonst nicht mit ("Gerät
      // geschaltet"-Regeln). Ueber die Cloud geschaltet startet sie sie selbst.
      if (r.ok && r.via === "lokal") void onDeviceSwitched(id, String(body.action));
      const local = --actionCounter;
      recordTask({
        id: local,
        type: `GERÄT ${String(body.action ?? "")} (${r.via})`,
        success: r.ok,
        error: r.error,
        result: { deviceId: id, on: r.on ?? null },
      });
      return json(res, r.ok ? 200 : 502, r);
    }

    // Regeln bearbeiten: reine Durchreiche an die Cloud (/api/regeln), die
    // Cloud prueft und speichert. Danach Raeume und Notbetrieb-Plan neu laden.
    if (url.pathname === "/api/rules" || url.pathname.startsWith("/api/rules/")) {
      const sub = url.pathname.slice("/api/rules".length);
      if (!/^(\/\d+(\/run)?)?$/.test(sub)) return json(res, 404, { error: "Nicht gefunden" });
      const method = req.method ?? "GET";
      if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return json(res, 405, { error: "Methode nicht erlaubt" });
      try {
        const body = method === "POST" || method === "PUT" ? JSON.stringify(await readBody(req)) : undefined;
        const cloud = await api(`/api/regeln${sub}`, { method, body });
        const data = await cloud.json().catch(() => ({}));
        if (method !== "GET" && cloud.ok) {
          void syncRooms();
          void refreshPlan();
        }
        return json(res, cloud.status, data);
      } catch (e) {
        return json(res, 502, { error: `Cloud nicht erreichbar (${e instanceof Error ? e.message : e}) – Regeln lassen sich nur online ändern.` });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/smart") {
      return json(res, 200, await listSmartDevices(url.searchParams.get("fresh") === "1"));
    }

    if (req.method === "POST" && url.pathname === "/api/smart/control") {
      const body = await readBody(req);
      const r = await controlSmart(
        String(body.key ?? ""),
        body.on === true,
        typeof body.brightness === "number" ? body.brightness : undefined
      );
      return json(res, r.ok ? 200 : 502, r);
    }

    if (req.method === "POST" && url.pathname === "/api/smart/pair") {
      const body = await readBody(req);
      const r = await pairSmart(String(body.id ?? ""));
      return json(res, r.ok ? 200 : 502, r);
    }

    if (req.method === "POST" && url.pathname === "/api/smart/assign") {
      // Raum-Zuordnung gehoert der Cloud – der Hub reicht sie nur durch und
      // laedt danach die Raeume neu.
      const body = await readBody(req);
      try {
        const cloud = await api("/api/hub/devices", { method: "POST", body: JSON.stringify(body) });
        const data = await cloud.json().catch(() => ({}));
        if (cloud.ok) await syncRooms();
        return json(res, cloud.ok ? 200 : cloud.status, data);
      } catch (e) {
        return json(res, 502, { error: `Cloud nicht erreichbar (${e instanceof Error ? e.message : e})` });
      }
    }

    if (url.pathname.startsWith("/api/detection")) {
      await handleDetectionApi(req, res, url, json, readBody);
      return;
    }

    if (url.pathname.startsWith("/api/go2rtc/")) {
      return proxyGo2rtc(req, res, url);
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
}

/**
 * HTTP und HTTPS auf demselben Port: Das erste Byte einer TLS-Verbindung ist
 * 0x16 (Handshake). So bleibt http://…:8787 wie gewohnt erreichbar, und
 * https://…:8787 kommt ohne neue Firewall-Regel zwischen den VLANs dazu.
 */
export async function startDashboard(): Promise<void> {
  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    handle(req, res).catch((e) => {
      log(`Dashboard-Anfrage fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      if (!res.headersSent) json(res, 500, { error: "Interner Fehler" });
      else res.end();
    });
  };
  startFrameWarmer(GO2RTC_URL);
  const httpServer = http.createServer(onRequest);
  httpServer.on("error", (e) => log(`Dashboard-Server-Fehler: ${e.message}`));

  // HTTPS nur, wenn das Dashboard ins LAN darf – lokal braucht es keins.
  tls = CONFIG.dashboardHost === "127.0.0.1" ? null : await loadDashboardTls();
  const httpsServer = tls ? https.createServer({ key: tls.key, cert: tls.cert }, onRequest) : null;
  httpsServer?.on("tlsClientError", () => {
    // Geraete ohne installierte CA brechen den Handshake ab – kein Log-Spam.
  });

  const server = net.createServer((socket) => {
    socket.once("error", () => socket.destroy());
    socket.once("data", (head: Buffer) => {
      socket.pause();
      socket.unshift(head);
      if (head[0] === 0x16 && httpsServer) httpsServer.emit("connection", socket);
      else httpServer.emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
  });

  server.on("error", (e) => log(`Dashboard-Server-Fehler: ${e.message}`));
  server.listen(CONFIG.dashboardPort, CONFIG.dashboardHost, () => {
    const scope =
      CONFIG.dashboardHost === "127.0.0.1"
        ? "nur lokal"
        : CONFIG.dashboardToken
          ? "im LAN, Token nötig"
          : "im LAN OHNE Token";
    log(
      `Lokales Dashboard: http://localhost:${CONFIG.dashboardPort} (${scope})` +
        (tls ? ` · HTTPS auf demselben Port, CA unter /ca.crt` : "")
    );
  });
}
