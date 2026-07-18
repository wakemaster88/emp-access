/**
 * Lokales Hub-Dashboard: kleiner HTTP-Server ohne Abhaengigkeiten.
 * Zeigt Status, Heartbeat, Task-Historie und Logs; erlaubt lokale
 * Aktionen (Ping, Netzwerk-Scan, Wake-on-LAN) direkt auf dem Hub.
 */
import http from "node:http";
import { CONFIG, log } from "./config.js";
import { STATE, recordTask } from "./state.js";
import { executeTask } from "./tasks.js";

let actionCounter = 0;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
    tasks: STATE.tasks,
    logs: STATE.logs.slice(-100).reverse(),
    intervals: {
      heartbeatSec: CONFIG.heartbeatIntervalMs / 1000,
      taskSec: CONFIG.taskIntervalMs / 1000,
      updateSec: CONFIG.updateIntervalMs / 1000,
    },
  };
}

export function startDashboard(): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, statusPayload());
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readBody(req);
      const type = String(body.type ?? "");
      if (!["PING", "NETWORK_SCAN", "WAKE_ON_LAN"].includes(type)) {
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

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }

    json(res, 404, { error: "Nicht gefunden" });
  });

  server.on("error", (e) => log(`Dashboard-Server-Fehler: ${e.message}`));
  server.listen(CONFIG.dashboardPort, "127.0.0.1", () => {
    log(`Lokales Dashboard: http://localhost:${CONFIG.dashboardPort}`);
  });
}

const PAGE = /* html */ `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EMP-Access Hub</title>
<style>
  :root {
    --bg: #0b1020; --card: #141a30; --border: #232b4a;
    --text: #e6e9f5; --muted: #8b93b5;
    --green: #34d399; --red: #f87171; --violet: #a78bfa; --amber: #fbbf24;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; }
  .logo {
    width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
    background: linear-gradient(135deg, #7c3aed, #4f46e5); font-size: 22px;
  }
  h1 { font-size: 20px; margin: 0; }
  .sub { color: var(--muted); font-size: 13px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .online { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .offline { background: var(--red); box-shadow: 0 0 8px var(--red); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
  .card h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .big { font-size: 20px; font-weight: 650; }
  .muted { color: var(--muted); }
  .section { margin-top: 26px; }
  .section h2 { font-size: 15px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .ok { color: var(--green); } .err { color: var(--red); }
  pre.result { margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; color: var(--muted); font-size: 11px; max-height: 120px; overflow: auto; }
  .logs { background: #0d1226; border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; max-height: 320px; overflow: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
  .logs div { padding: 1px 0; }
  .logs .ts { color: var(--violet); margin-right: 8px; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .actions form { display: flex; gap: 8px; align-items: center; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
  input {
    background: #0d1226; border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); padding: 7px 10px; font-size: 13px; width: 170px;
  }
  button {
    background: linear-gradient(135deg, #7c3aed, #4f46e5); border: 0; color: #fff;
    padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  button:hover { filter: brightness(1.15); }
  #actionOut { margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">⚡️</div>
    <div>
      <h1 id="title">EMP-Access Hub</h1>
      <div class="sub" id="subtitle">lädt …</div>
    </div>
    <div style="margin-left:auto" class="sub" id="hbStatus"></div>
  </header>

  <div class="grid" id="cards"></div>

  <div class="section">
    <h2>Lokale Aktionen</h2>
    <div class="actions">
      <form onsubmit="return runAction(event,'PING',{host:this.host.value})">
        <input name="host" placeholder="Host / IP" required>
        <button>Ping</button>
      </form>
      <form onsubmit="return runAction(event,'NETWORK_SCAN',null)">
        <button>Netzwerk-Scan</button>
      </form>
      <form onsubmit="return runAction(event,'WAKE_ON_LAN',{mac:this.mac.value})">
        <input name="mac" placeholder="MAC-Adresse" required>
        <button>Wake-on-LAN</button>
      </form>
    </div>
    <div id="actionOut" class="sub"></div>
  </div>

  <div class="section">
    <h2>Task-Historie</h2>
    <div class="card" style="padding:0">
      <table>
        <thead><tr><th>Zeit</th><th>Task</th><th>Status</th><th>Ergebnis</th></tr></thead>
        <tbody id="taskRows"><tr><td colspan="4" class="muted">Noch keine Tasks.</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>Logs</h2>
    <div class="logs" id="logs"></div>
  </div>
</div>

<script>
const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString("de-DE") : "–";
const ago = (iso) => {
  if (!iso) return "nie";
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? "vor " + s + " s" : "vor " + Math.floor(s / 60) + " min";
};
const uptime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + " h " : "") + m + " min";
};
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function refresh() {
  try {
    const d = await (await fetch("/api/status")).json();
    document.getElementById("title").textContent = "EMP-Access Hub · " + d.name;
    document.getElementById("subtitle").textContent =
      d.hostname + " · Version " + d.version + " · " + d.apiUrl;

    const hbOk = d.heartbeat.lastSuccessAt &&
      (Date.now() - new Date(d.heartbeat.lastSuccessAt)) < (d.intervals.heartbeatSec + 15) * 1000;
    document.getElementById("hbStatus").innerHTML =
      '<span class="dot ' + (hbOk ? "online" : "offline") + '"></span>' +
      (hbOk ? "Mit Cloud verbunden" : "Cloud nicht erreichbar");

    document.getElementById("cards").innerHTML = [
      ["Uptime", uptime(d.uptimeSec), "gestartet " + fmt(d.startedAt)],
      ["Letzter Heartbeat", ago(d.heartbeat.lastSuccessAt),
        d.heartbeat.successCount + " ok / " + d.heartbeat.failCount + " Fehler" +
        (d.heartbeat.lastError ? " · " + esc(d.heartbeat.lastError) : "")],
      ["Task-Polls", d.taskPolls, "alle " + d.intervals.taskSec + " s"],
      ["Auto-Scan", d.autoScan.lastRunAt ? d.autoScan.devices + " Geräte" : "–",
        d.autoScan.error
          ? '<span class="err">' + esc(d.autoScan.error) + "</span>"
          : (d.autoScan.lastRunAt ? ago(d.autoScan.lastRunAt) + (d.autoScan.uploaded ? " · in Cloud" : "") : "noch kein Lauf")],
      ["Module", d.modules.length, esc(d.modules.join(", "))],
    ].map(([t, v, s]) =>
      '<div class="card"><h3>' + t + '</h3><div class="big">' + v + '</div><div class="sub">' + s + "</div></div>"
    ).join("");

    document.getElementById("taskRows").innerHTML = d.tasks.length
      ? d.tasks.map((t) =>
          "<tr><td>" + fmt(t.ts) + "</td><td>#" + t.id + " " + esc(t.type) + "</td>" +
          '<td class="' + (t.success ? "ok" : "err") + '">' + (t.success ? "OK" : "Fehler") + "</td>" +
          "<td>" + (t.error ? '<span class="err">' + esc(t.error) + "</span>" : "") +
          (t.result ? '<pre class="result">' + esc(JSON.stringify(t.result, null, 1)) + "</pre>" : "") +
          "</td></tr>"
        ).join("")
      : '<tr><td colspan="4" class="muted">Noch keine Tasks.</td></tr>';

    document.getElementById("logs").innerHTML = d.logs.map((l) =>
      '<div><span class="ts">' + fmt(l.ts) + "</span>" + esc(l.msg) + "</div>"
    ).join("");
  } catch {
    document.getElementById("hbStatus").innerHTML =
      '<span class="dot offline"></span>Hub-Prozess nicht erreichbar';
  }
}

async function runAction(ev, type, payload) {
  ev.preventDefault();
  const out = document.getElementById("actionOut");
  out.textContent = type + " läuft …";
  try {
    const r = await (await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
    })).json();
    out.textContent = r.success
      ? type + " OK: " + JSON.stringify(r.result ?? {})
      : type + " Fehler: " + (r.error ?? "unbekannt");
  } catch (e) {
    out.textContent = type + " Fehler: " + e;
  }
  refresh();
  return false;
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
