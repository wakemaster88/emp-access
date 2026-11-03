/*
 * Hub-Dashboard: Router, adaptives Polling und Rendering.
 * Kein Framework – die Datenmenge ist klein und bleibt lokal.
 * DOM wird nur angefasst, wenn sich das HTML wirklich aendert (setHTML):
 * so flackert nichts, Hover/Fokus bleiben stehen und Shelly-Knoepfe
 * verschwinden nicht unter dem Finger.
 */

const VIEWS = [
  "lage",
  "systeme",
  "netzwerk",
  "kameras",
  "ereignisse",
  "personen",
  "fahrzeuge",
  "aktionen",
];

const state = {
  view: "lage",
  overview: null,
  events: [],
  eventSeq: 0,
  network: null,
  improve: null,
  online: false,
  failures: 0,
  eventFilter: "alle",
  netFilter: "",
  netVlan: "alle",
  /** Shelly-Status je IP (per SHELLY_STATUS geholt). */
  shelly: {},
  loaded: false,
};

const MAX_CLIENT_EVENTS = 300;

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------- Hilfsmittel */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** innerHTML nur setzen, wenn sich etwas geaendert hat. */
const htmlCache = new Map();
function setHTML(id, html) {
  if (htmlCache.get(id) === html) return;
  htmlCache.set(id, html);
  $(id).innerHTML = html;
}

function icon(name, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function clock(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ago(iso) {
  if (!iso) return "nie";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return "gerade eben";
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
  return `vor ${Math.floor(s / 86400)} d`;
}

function timeTag(iso) {
  if (!iso) return '<span class="t">–</span>';
  return `<time class="t" datetime="${esc(iso)}" title="${esc(new Date(iso).toLocaleString("de-DE"))}">${clock(iso)}</time>`;
}

function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

function badge(kind, text) {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

function empty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function num(v, digits = 2) {
  return typeof v === "number" && isFinite(v) ? v.toFixed(digits) : "–";
}

function bytes(n) {
  if (typeof n !== "number" || !isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function rate(n) {
  return `${bytes(n)}/s`;
}

function loadTone(p) {
  return p >= 90 ? "alert" : p >= 75 ? "warn" : "ok";
}

/** Balken fuer Auslastung – Farbe folgt der Schwelle, Zahl steht daneben. */
function meter(percent) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return `<div class="meter ${loadTone(p)}"><span style="width:${p.toFixed(1)}%"></span></div>`;
}

/** Ring-Anzeige 0–100 %. tone: ok/warn/alert/grad. */
function ring(percent, label, small = "", tone = "ok", size = "") {
  const r = 40;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return `<div class="ring ${tone} ${size}" role="img" aria-label="${esc(`${label} ${small}`)}">
    <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}"/><circle class="bar" cx="50" cy="50" r="${r}" stroke-dasharray="${((p / 100) * c).toFixed(1)} ${c.toFixed(1)}"/></svg>
    <div class="ring-label">${esc(label)}${small ? `<small>${esc(small)}</small>` : ""}</div>
  </div>`;
}

/* Alarmzustand → Farbklasse. */
function stateTone(name) {
  if (name === "PERSON" || name === "DOORBELL") return "alert";
  if (name === "VEHICLE") return "warn";
  return "idle";
}

/** Feste Farbtöne fuer die bekannten VLANs, sonst aus der ID abgeleitet. */
const VLAN_HUES = { 1: 215, 20: 150, 30: 265, 40: 32, 41: 320, 70: 190, 80: 52 };
function vlanHue(id) {
  if (id == null || id === "?") return 220;
  const n = Number(id);
  return VLAN_HUES[n] ?? (n * 47) % 360;
}

const HEALTH_ICONS = {
  hub: "server",
  cloud: "cloud",
  cpu: "cpu",
  memory: "memory",
  disk: "disk",
  cameras: "camera",
  doorbird: "door",
  face: "face",
  alpr: "plate",
  parking: "parking",
  network: "network",
  tasks: "tasks",
  soundweb: "speaker",
  snmp: "switch",
};

const KIND_ICONS = {
  camera: "camera",
  person: "user",
  vehicle: "car",
  doorbird: "door",
  network: "network",
  system: "server",
  task: "tasks",
};

/** Symbol fuer den erkannten Geraetetyp aus dem Scanner. */
function deviceIcon(dev) {
  if (dev.shelly) return "power";
  const t = String(dev.deviceType || "").toLowerCase();
  if (t.includes("kamera")) return "camera";
  if (t.includes("tür")) return "door";
  if (t.includes("audio")) return "speaker";
  if (t.includes("drucker")) return "printer";
  if (t.includes("iphone") || t.includes("ipad")) return "phone";
  if (t.includes("windows") || t.includes("pc")) return "monitor";
  if (t.includes("nas") || t.includes("server") || t.includes("medien")) return "server";
  if (t.includes("switch") || t.includes("router") || t.includes("netzwerk")) return "switch";
  if (t.includes("iot") || t.includes("raspberry")) return "chip";
  if (t.includes("web")) return "globe";
  return "dot";
}

function toast(message, tone = "") {
  const box = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.innerHTML = `${icon(tone === "ok" ? "check" : tone === "err" ? "alert" : "info")}<span></span>`;
  el.lastChild.textContent = message;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }, 5500);
}

/** Bestaetigung als eigener Dialog; faellt auf confirm() zurueck. */
function ask(title, text, okLabel = "OK") {
  const dlg = $("confirmDlg");
  if (!dlg || typeof dlg.showModal !== "function") return Promise.resolve(confirm(`${title}\n${text}`));
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirmOk").textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
  });
}

/* ----------------------------------------------------------------- Routing */

function currentView() {
  const hash = location.hash.replace("#", "");
  if (hash === "live") return "lage";
  return VIEWS.includes(hash) ? hash : "lage";
}

function applyRoute() {
  state.view = currentView();
  for (const view of VIEWS) {
    $(`view-${view}`).hidden = view !== state.view;
  }
  for (const link of document.querySelectorAll(".nav a")) {
    const active = link.dataset.view === state.view;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  render();
  refresh();
}

/* ------------------------------------------------------------------- Daten */

async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function mergeEvents(list) {
  if (!list.length) return;
  state.events = state.events.concat(list);
  if (state.events.length > MAX_CLIENT_EVENTS) {
    state.events = state.events.slice(state.events.length - MAX_CLIENT_EVENTS);
  }
  const newest = list[list.length - 1];
  if (newest && newest.severity === "alert") {
    announce(`${newest.where ? newest.where + ": " : ""}${newest.title}`);
  }
}

let announceTimer = null;
function announce(text) {
  const el = $("connText");
  if (!el) return;
  clearTimeout(announceTimer);
  el.dataset.restore = el.dataset.restore || el.textContent;
  el.textContent = text;
  announceTimer = setTimeout(() => {
    el.textContent = el.dataset.restore || "";
    delete el.dataset.restore;
  }, 4000);
}

let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const wantNet = state.view === "netzwerk";
    const wantImprove = state.view === "systeme";
    const [overview, events, network, improve] = await Promise.all([
      getJson("/api/overview"),
      getJson(`/api/events?since=${state.eventSeq}`),
      wantNet ? getJson("/api/network") : null,
      wantImprove ? getJson("/api/improve?events=0") : null,
    ]);
    state.overview = overview;
    state.eventSeq = events.seq ?? state.eventSeq;
    mergeEvents(events.events ?? []);
    if (network) state.network = network;
    if (improve) state.improve = improve;

    state.online = true;
    state.failures = 0;
    state.loaded = true;
    $("offlineBanner").hidden = true;
  } catch {
    state.online = false;
    state.failures++;
    $("offlineBanner").hidden = state.failures < 2;
  } finally {
    refreshing = false;
    render();
  }
}

function tickInterval() {
  if (state.failures > 0) return Math.min(30000, 2000 * 2 ** state.failures);
  return state.view === "lage" ? 2000 : 5000;
}

let tickTimer = null;
function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(async () => {
    if (!document.hidden) await refresh();
    scheduleTick();
  }, tickInterval());
}

/* --------------------------------------------------------------- Rendering */

function render() {
  const d = state.overview;
  renderTopbar(d);
  if (!d) {
    if (!state.loaded) {
      setHTML("lagePlaces", '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>');
      setHTML("lageHealth", '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>');
    }
    return;
  }
  renderNavCounts(d);

  switch (state.view) {
    case "lage": renderLage(d); break;
    case "systeme": renderSysteme(d); break;
    case "netzwerk": renderNetzwerk(); break;
    case "kameras": renderKameras(d); break;
    case "ereignisse": renderEreignisse(); break;
    case "personen": renderPersonen(d); break;
    case "fahrzeuge": renderFahrzeuge(d); break;
    case "aktionen": renderAktionen(d); break;
  }
}

function renderTopbar(d) {
  const dot = document.querySelector("#connState .dot");
  const text = $("connText");
  if (!state.online) {
    dot.className = "dot alert";
    if (!text.dataset.restore) text.textContent = "Hub nicht erreichbar";
    return;
  }
  const cloudOk = d && d.heartbeat && d.heartbeat.fresh;
  dot.className = `dot ${cloudOk ? "ok" : "warn"}`;
  const label = cloudOk ? "Cloud verbunden" : "Cloud getrennt";
  if (text.dataset.restore) text.dataset.restore = label;
  else text.textContent = label;

  if (d) {
    $("hubName").textContent = d.hub.name;
    $("hubSub").textContent = `${d.hub.hostname} · ${d.hub.version} · seit ${uptime(d.hub.uptimeSec)}`;
  }
}

/** Kleine Zaehler in der Navigation: Warnungen sofort sichtbar. */
function renderNavCounts(d) {
  const set = (view, value, tone = "") => {
    const el = document.querySelector(`.nav-count[data-count="${view}"]`);
    if (!el) return;
    const text = value ? String(value) : "";
    if (el.textContent !== text) el.textContent = text;
    el.className = `nav-count ${tone}`;
  };
  const active = d.cameras.filter((c) => c.activeStates.length).length + d.doorbirds.filter((b) => b.activeStates.length).length;
  set("lage", active, "alert");
  set("systeme", d.health.filter((h) => h.state === "warn").length, "warn");
  set("netzwerk", d.autoScan && d.autoScan.devices ? d.autoScan.devices : "");
  const camDown = d.cameras.filter((c) => !c.reachable).length + d.doorbirds.filter((b) => !b.connected).length;
  set("kameras", camDown, "warn");
  const since = Date.now() - 10 * 60 * 1000;
  const recentAlerts = state.events.filter((e) => e.severity === "alert" && new Date(e.ts).getTime() > since).length;
  set("ereignisse", recentAlerts, "alert");
}

/* ------------------------------------------------------------------- Lage */

function places(d) {
  const cams = d.cameras.map((c) => ({
    name: c.name,
    host: c.host,
    kind: c.kind,
    reachable: c.reachable,
    lastError: c.lastError,
    active: c.activeStates,
    busy: c.busy,
    pendingVehicle: c.pendingVehicle,
    lastEventAt: c.lastEventAt,
    person: c.lastPerson,
    plate: c.lastPlate,
  }));
  const birds = d.doorbirds.map((b) => ({
    name: b.name,
    host: b.host,
    kind: "DOORBIRD",
    reachable: b.connected,
    lastError: b.connected ? null : "Monitor getrennt",
    active: b.activeStates,
    busy: false,
    pendingVehicle: false,
    lastEventAt: b.lastEventAt,
    person: b.lastPerson,
    plate: null,
  }));
  return cams.concat(birds);
}

function placeCard(p) {
  const chips = p.active.map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`).join("");
  const rows = [];
  if (p.person) {
    rows.push(`<div class="line"><span class="k">Person</span><span class="v">${
      p.person.matched
        ? `<strong>${esc(p.person.name)}</strong> ${badge("ok", num(p.person.score))}`
        : `unbekannt <span class="muted">(best ${num(p.person.score)} ≥ ${num(p.person.threshold)})</span>`
    } <span class="muted">${esc(ago(p.person.at))}</span></span></div>`);
  }
  if (p.plate) {
    rows.push(`<div class="line"><span class="k">Kennzeichen</span><span class="v">${
      p.plate.plate ? `<strong class="mono">${esc(p.plate.plate)}</strong>` : "keines erkannt"
    } ${p.plate.listed ? badge("ok", "freigegeben") : ""} <span class="muted">${esc(ago(p.plate.at))}</span></span></div>`);
  }
  if (!rows.length) {
    rows.push('<div class="line"><span class="k">Sichtungen</span><span class="v muted">noch keine</span></div>');
  }
  const warn = !p.reachable
    ? badge("warn", "offline")
    : p.busy
      ? badge("idle", "Pipeline läuft")
      : p.pendingVehicle
        ? badge("idle", "Fahrzeug wartet")
        : "";
  const tone = p.active.length ? "alert" : p.reachable ? "accent" : "warn";

  return `<article class="card place ${p.active.length ? "is-active" : ""}">
    <div class="place-head"><span class="tile-ico ${tone}">${icon(p.kind === "DOORBIRD" ? "door" : "camera")}</span><h3>${esc(p.name)}</h3><span class="host mono">${esc(p.host)}</span></div>
    <div class="chips">${chips || badge("idle", "ruhig")}${warn}</div>
    ${rows.join("")}
    <div class="line"><span class="k">Letztes Signal</span><span class="v muted">${esc(ago(p.lastEventAt))}</span></div>
  </article>`;
}

function kpi(iconName, value, label, sub, tone = "accent") {
  return `<article class="card stat">
    <div class="head"><span class="tile-ico ${tone}">${icon(iconName)}</span><span class="label top">${esc(label)}</span></div>
    <div class="value">${esc(value)}</div>
    <div class="label">${esc(sub)}</div>
  </article>`;
}

function renderLage(d) {
  const list = places(d);
  const active = list.filter((p) => p.active.length);

  setHTML(
    "activeStrip",
    active.map((p) => `<span class="pulse"><span class="dot"></span>${esc(p.name)}: ${esc(p.active.join(", "))}</span>`).join("")
  );

  $("lageSub").textContent = active.length
    ? `${active.length} von ${list.length} Orten melden gerade etwas.`
    : `Ruhig – ${list.length} Orte beobachtet.`;

  // Status-Hero: Anteil gesunder Systeme (abgeschaltete zaehlen nicht).
  const relevant = d.health.filter((h) => h.state !== "off");
  const ok = relevant.filter((h) => h.state === "ok").length;
  const warnings = relevant.filter((h) => h.state === "warn");
  const pct = relevant.length ? (ok / relevant.length) * 100 : 100;
  const tone = active.length ? "alert" : warnings.length ? "warn" : "ok";
  const headline = active.length
    ? `${active.length} ${active.length === 1 ? "Ort meldet" : "Orte melden"} gerade etwas`
    : warnings.length
      ? `${warnings.length} ${warnings.length === 1 ? "Hinweis" : "Hinweise"}`
      : "Alles im grünen Bereich";
  const detail = warnings.length
    ? warnings.map((w) => `${w.label}: ${w.value}`).join(" · ")
    : `${ok} von ${relevant.length} Systemen laufen sauber.`;

  const camOk = d.cameras.filter((c) => c.reachable).length;
  const scan = d.autoScan || {};
  const cpu = d.system && d.system.cpu.usage != null ? `${Math.round(d.system.cpu.usage)} %` : "–";
  const mem = d.system ? `${Math.round(d.system.memory.usage)} %` : "–";

  setHTML(
    "lageHero",
    `<article class="card hero-status ${tone}">
      ${ring(pct, `${ok}/${relevant.length}`, "OK", tone === "ok" ? "grad" : tone)}
      <div><h2>${esc(headline)}</h2><p>${esc(detail)}</p></div>
    </article>
    <div class="hero-kpis">
      ${kpi("camera", `${camOk}/${d.cameras.length}`, "Kameras", "erreichbar", camOk === d.cameras.length ? "ok" : "warn")}
      ${kpi("network", scan.lastRunAt ? String(scan.devices) : "–", "Netzwerk", scan.lastRunAt ? `Scan ${ago(scan.lastRunAt)}` : "kein Scan", scan.error ? "warn" : "accent")}
      ${kpi("cloud", d.heartbeat && d.heartbeat.fresh ? "online" : "getrennt", "Cloud", `${d.heartbeat?.successCount ?? 0} Heartbeats`, d.heartbeat && d.heartbeat.fresh ? "ok" : "warn")}
      ${kpi("cpu", cpu, "Rechner", `RAM ${mem}`, "accent")}
    </div>`
  );

  const sorted = list.slice().sort((a, b) => {
    if (!!b.active.length !== !!a.active.length) return b.active.length - a.active.length;
    return (b.lastEventAt || "").localeCompare(a.lastEventAt || "");
  });
  setHTML("lagePlaces", sorted.length ? sorted.map(placeCard).join("") : empty("Keine Kameras konfiguriert."));

  setHTML("lageTimeline", timelineHtml(state.events.slice(-14).reverse(), "Noch nichts passiert."));
  setHTML("lageHealth", d.health.map(healthCard).join(""));
}

function healthCard(h) {
  return `<article class="card health-card ${esc(h.state)}">
    <div class="row"><span class="tile-ico">${icon(HEALTH_ICONS[h.id] || "dot")}</span><span class="label">${esc(h.label)}</span><span class="dot ${esc(h.state)}"></span></div>
    <div class="value">${esc(h.value)}</div>
    <div class="detail">${esc(h.detail)}</div>
  </article>`;
}

function timelineHtml(events, emptyText) {
  if (!events.length) return `<li class="empty">${esc(emptyText)}</li>`;
  const now = Date.now();
  return events
    .map((e) => {
      const fresh = now - new Date(e.ts).getTime() < 4000 ? " fresh" : "";
      return `<li class="${esc(e.severity)}${fresh}">
        ${timeTag(e.ts)}
        <span class="node">${icon(KIND_ICONS[e.kind] || "dot")}</span>
        <div class="body">
          <div class="title">${e.where ? `<span class="where">${esc(e.where)}</span> · ` : ""}${esc(e.title)}</div>
          ${e.detail ? `<div class="detail">${esc(e.detail)}</div>` : ""}
        </div>
      </li>`;
    })
    .join("");
}

/* ---------------------------------------------------------------- Systeme */

function renderSysteme(d) {
  $("systemeSub").textContent = `${d.hub.name} · ${d.hub.apiUrl} · Module: ${d.hub.modules.join(", ")}`;
  setHTML("systemeHealth", d.health.map(healthCard).join(""));
  renderLeistung(d.system);

  const imp = state.improve || d.improve;
  const hints = imp.hints || [];
  setHTML(
    "diagBox",
    `<div class="diag">
      <span class="tile-ico ${hints.length ? "warn" : "ok"}">${icon(hints.length ? "alert" : "check")}</span>
      <div>
        <div class="diag-title">${esc(imp.hint || "sammelt …")}</div>
        <div class="muted" style="font-size:0.8rem;margin-top:0.2rem">seit ${esc(clock(imp.since))} · <a href="/api/improve">Rohdaten</a></div>
        ${hints.length ? `<ul class="hints">${hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>`
  );

  const counts = Object.entries(imp.counts || {}).sort(([a], [b]) => a.localeCompare(b));
  setHTML(
    "countsBox",
    counts.length
      ? `<dl class="kv">${counts.map(([k, v]) => `<dt class="mono">${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
      : empty("Noch keine Zähler.")
  );

  setHTML(
    "logsBox",
    d.logs.length
      ? d.logs.map((l) => `<div><span class="ts">${esc(clock(l.ts))}</span><span class="msg">${esc(l.msg)}</span></div>`).join("")
      : empty("Keine Logs.")
  );
}

function renderLeistung(sys) {
  if (!sys) {
    setHTML("perfStats", empty("Keine Leistungsdaten."));
    setHTML("perfDetail", "");
    return;
  }

  const net = sys.network.reduce(
    (acc, i) => ({ rx: acc.rx + i.rxBytesPerSec, tx: acc.tx + i.txBytesPerSec }),
    { rx: 0, tx: 0 }
  );

  const gauge = (label, percent, sub) => {
    const p = percent == null ? null : Math.round(percent);
    return `<article class="card stat gauge">
      ${ring(p ?? 0, p == null ? "–" : `${p}%`, "", p == null ? "ok" : loadTone(p) === "ok" ? "grad" : loadTone(p), "sm")}
      <div class="txt"><span class="label top">${esc(label)}</span><span class="value">${esc(sub)}</span></div>
    </article>`;
  };

  setHTML(
    "perfStats",
    [
      gauge("CPU", sys.cpu.usage, `${sys.cpu.cores} Kerne · Last ${num(sys.cpu.load1)}`),
      gauge("Speicher", sys.memory.usage, `${bytes(sys.memory.usedBytes)} / ${bytes(sys.memory.totalBytes)}`),
      sys.disk
        ? gauge("Platte", sys.disk.usage, `${bytes(sys.disk.totalBytes - sys.disk.usedBytes)} frei`)
        : gauge("Platte", null, "unbekannt"),
      `<article class="card stat gauge">
        <span class="tile-ico accent" style="width:4.4rem;height:4.4rem;border-radius:50%">${icon("activity")}</span>
        <div class="txt"><span class="label top">Netz</span><span class="value">${esc(rate(net.rx + net.tx))}</span><span class="label">↓ ${esc(rate(net.rx))} · ↑ ${esc(rate(net.tx))}</span></div>
      </article>`,
    ].join("")
  );

  const procRows = [
    {
      label: "Hub (Node)",
      pid: sys.hubProcess.pid,
      cpu: sys.hubProcess.cpu,
      rssBytes: sys.hubProcess.rssBytes,
    },
  ].concat(sys.processes);

  setHTML(
    "perfDetail",
    `
    <article class="card">
      <div class="place-head" style="margin-bottom:0.6rem"><span class="tile-ico accent">${icon("server")}</span><h3>Rechner</h3></div>
      <div class="line"><span class="k">Prozessor</span><span class="v">${esc(sys.cpu.model)}</span></div>
      <div class="line"><span class="k">Last</span><span class="v">${num(sys.cpu.load1)} · ${num(sys.cpu.load5)} · ${num(sys.cpu.load15)} <span class="muted">(${num(sys.cpu.loadPerCore)} pro Kern)</span></span></div>
      <div class="line"><span class="k">Komprimiert</span><span class="v">${esc(sys.memory.compressedBytes == null ? "unbekannt" : bytes(sys.memory.compressedBytes))}</span></div>
      <div class="line"><span class="k">Platte</span><span class="v">${sys.disk ? `${esc(bytes(sys.disk.usedBytes))} von ${esc(bytes(sys.disk.totalBytes))} · ${esc(sys.disk.mount)}` : "unbekannt"}</span></div>
      <div class="line"><span class="k">Rechner läuft</span><span class="v">${esc(uptime(sys.hostUptimeSec))}</span></div>
      <div class="line"><span class="k">Hub läuft</span><span class="v">${esc(uptime(sys.hubProcess.uptimeSec))}</span></div>
    </article>
    <article class="card">
      <div class="place-head" style="margin-bottom:0.6rem"><span class="tile-ico accent">${icon("cpu")}</span><h3>Prozesse</h3></div>
      ${procRows
        .map(
          (p) => `<div class="line"><span class="k">${esc(p.label)}</span><span class="v">${
            p.cpu == null ? "–" : `${num(p.cpu, 1)} % CPU`
          } · ${esc(bytes(p.rssBytes))} <span class="muted">PID ${esc(p.pid)}</span></span></div>`
        )
        .join("")}
    </article>
    <article class="card">
      <div class="place-head" style="margin-bottom:0.6rem"><span class="tile-ico accent">${icon("network")}</span><h3>Netzwerkkarten</h3></div>
      ${
        sys.network.length
          ? sys.network
              .map(
                (i) => `<div class="line"><span class="k mono">${esc(i.name)}</span><span class="v">↓ ${esc(rate(i.rxBytesPerSec))} · ↑ ${esc(rate(i.txBytesPerSec))}</span></div>`
              )
              .join("")
          : '<div class="line"><span class="v muted">Kein Durchsatz gemessen.</span></div>'
      }
    </article>`
  );
}

/* --------------------------------------------------------------- Netzwerk */

function vlanPill(dev) {
  if (dev.vlanId == null) return `<span class="vlan-pill" style="--h:220">${esc(dev.subnet || "–")}</span>`;
  return `<span class="vlan-pill" style="--h:${vlanHue(dev.vlanId)}">${esc(dev.vlanId)}${dev.vlanName ? ` · ${esc(dev.vlanName)}` : ""}</span>`;
}

function shellyCell(dev) {
  if (!dev.shelly) return "";
  const st = state.shelly[dev.ip];
  if (!st) {
    return `<div style="margin-top:0.35rem"><button type="button" class="btn small" data-shelly-status="${esc(dev.ip)}">${icon("power")}Status</button></div>`;
  }
  if (st.error) return `<div class="muted">${esc(st.error)}</div>`;
  return `<div class="chips" style="margin-top:0.35rem">${st.channels
    .filter((c) => c.kind === "switch")
    .map(
      (c) => `<button type="button" class="btn small ${c.on ? "on" : ""}" data-shelly-switch="${esc(dev.ip)}" data-channel="${esc(c.id)}" data-on="${c.on ? "false" : "true"}" title="Kanal ${esc(c.id)} ${c.on ? "ausschalten" : "einschalten"}">
          ${icon("power")}K${esc(c.id)}: ${c.on ? "an" : "aus"}${c.powerW != null ? ` · ${esc(Math.round(c.powerW))} W` : ""}
        </button>`
    )
    .join("")}</div>`;
}

function ipKey(ip) {
  return String(ip)
    .split(".")
    .map((n) => n.padStart(3, "0"))
    .join(".");
}

function renderNetzwerk() {
  const n = state.network;
  if (!n) {
    $("netSub").textContent = "Scan-Daten werden geladen …";
    if (!htmlCache.has("netSubnets")) {
      setHTML("netKpis", '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>');
    }
    return;
  }
  const noMac = n.devices.filter((d) => !d.mac).length;
  $("netSub").textContent = n.scanning
    ? "Scan läuft gerade …"
    : n.lastRunAt
      ? `Letzter Scan ${ago(n.lastRunAt)}${n.uploaded ? " · in die Cloud gemeldet" : ""}${noMac ? ` · ${noMac} ohne MAC (geroutet, Router-SNMP fehlt)` : ""}${n.error ? ` · Fehler: ${n.error}` : ""}`
      : "Noch kein Scan gelaufen.";

  const online = n.devices.filter((d) => d.reachable).length;
  const shellys = n.devices.filter((d) => d.shelly).length;
  const cams = n.devices.filter((d) => /kamera/i.test(d.deviceType || "")).length;
  const subnets = n.subnets || [];
  const reachableNets = subnets.filter((s) => s.found > 0).length;
  setHTML(
    "netKpis",
    [
      kpi("network", String(n.devices.length), "Geräte", `${online} antworten`, "accent"),
      kpi("switch", `${reachableNets}/${subnets.length}`, "VLANs", "mit Geräten", reachableNets === subnets.length ? "ok" : "warn"),
      kpi("camera", String(cams), "Kameras", "im Scan erkannt", "accent"),
      kpi("power", String(shellys), "Shellys", "schaltbar", "accent"),
      kpi("info", String(noMac), "ohne MAC", noMac ? "Router-ARP fehlt" : "alle zugeordnet", noMac ? "warn" : "ok"),
    ].join("")
  );

  const maxFound = Math.max(1, ...subnets.map((s) => s.found));
  let subnetHtml = subnets.length
    ? subnets
        .map((s) => {
          const tone = s.mode === "direkt" ? (s.found ? "ok" : "warn") : s.found ? "warn" : "alert";
          const how =
            s.mode === "direkt"
              ? `direkt über ${s.iface}${s.hubIp ? ` (${s.hubIp})` : ""}`
              : "nur geroutet";
          const h = vlanHue(s.vlanId);
          return `<article class="card place vlan-card" style="--h:${h}">
        <div class="place-head">
          <span class="vlan-num">${esc(s.vlanId ?? "–")}</span>
          <div style="min-width:0"><h3>${esc(s.vlanName || (s.vlanId != null ? `VLAN ${s.vlanId}` : s.cidr))}</h3><div class="mono muted">${esc(s.cidr)}</div></div>
          <div class="vlan-count"><strong>${esc(s.found)}</strong><span>Geräte</span></div>
        </div>
        <div class="vlan-bar"><span style="width:${((s.found / maxFound) * 100).toFixed(1)}%"></span></div>
        <div class="chips">${badge(s.mode === "direkt" ? "ok" : "idle", how)}${s.found > s.withMac ? badge("warn", `${s.found - s.withMac} ohne MAC`) : ""}${tone === "alert" ? badge("alert", "nicht erreichbar") : ""}</div>
        ${s.mode !== "direkt" && !s.found ? `<div class="line"><span class="v muted">VLAN-Interface am Hub oder Routing fehlt.</span></div>` : ""}
      </article>`;
        })
        .join("")
    : empty("Keine Subnetze bekannt.");
  if (!n.vlansConfigured) {
    subnetHtml += `<article class="card"><div class="line"><span class="v muted">HUB_VLANS ist nicht gesetzt – es werden nur die eigenen Interfaces gescannt. Siehe hub/.env.example.</span></div></article>`;
  }
  setHTML("netSubnets", subnetHtml);

  const sw = n.switches || [];
  setHTML(
    "netSwitches",
    sw.length
      ? sw
          .map((s) => {
            const p = s.portsTotal ? (s.portsUp / s.portsTotal) * 100 : 0;
            return `<article class="card place">
        <div class="place-head"><span class="tile-ico ${s.error ? "alert" : "accent"}">${icon("switch")}</span><h3>${esc(s.sysName || s.host)}</h3><span class="host mono">${esc(s.host)}</span></div>
        ${s.error ? `<div class="chips">${badge("alert", s.error)}</div>` : `<div class="line"><span class="k">Ports aktiv</span><span class="v"><strong>${esc(s.portsUp)}</strong><span class="muted"> / ${esc(s.portsTotal)}</span></span></div><div class="meter grad"><span style="width:${p.toFixed(1)}%"></span></div>`}
        <div class="line"><span class="k">Laufzeit</span><span class="v">${esc(typeof s.uptimeS === "number" ? uptime(s.uptimeS) : "–")}</span></div>
        <div class="line"><span class="k">MACs</span><span class="v">${esc(s.macs)}</span></div>
        <div class="line"><span class="k">Stand</span><span class="v muted">${esc(ago(s.polledAt))}</span></div>
      </article>`;
          })
          .join("")
      : empty("Keine Switches abgefragt. HUB_SNMP_TARGETS setzen und SNMP in Insight aktivieren.")
  );

  const perVlan = {};
  for (const d of n.devices) {
    const k = d.vlanId != null ? String(d.vlanId) : "?";
    perVlan[k] = (perVlan[k] || 0) + 1;
  }
  const vlans = Object.keys(perVlan).sort((a, b) => Number(a) - Number(b));
  setHTML(
    "netVlanFilter",
    ["alle", ...vlans]
      .map(
        (v) =>
          `<button type="button" data-vlan="${esc(v)}" aria-pressed="${state.netVlan === v}" style="--h:${vlanHue(v)}">${
            v === "alle" ? "" : '<span class="sw"></span>'
          }${esc(v === "alle" ? "Alle" : v === "?" ? "ohne VLAN" : `VLAN ${v}`)}<span class="n">${v === "alle" ? n.devices.length : perVlan[v]}</span></button>`
      )
      .join("")
  );

  const q = state.netFilter.trim().toLowerCase();
  const rows = n.devices
    .filter(
      (dev) =>
        (state.netVlan === "alle" || String(dev.vlanId ?? "?") === state.netVlan) &&
        (!q ||
          [dev.ip, dev.hostname, dev.vendor, dev.deviceType, dev.mac, dev.vlanName, dev.vlanId].some((v) =>
            String(v ?? "").toLowerCase().includes(q)
          ))
    )
    .sort((a, b) => ipKey(a.ip).localeCompare(ipKey(b.ip)));

  setHTML(
    "netRows",
    rows.length
      ? rows
          .map(
            (dev) => `<tr>
        <td data-label="IP"><span class="mono">${esc(dev.ip)}</span></td>
        <td data-label="Name"><div class="dev"><span class="tile-ico ${dev.reachable ? "accent" : ""}">${icon(deviceIcon(dev))}</span><div style="min-width:0"><div class="dev-name">${esc(dev.hostname || (dev.shelly && dev.shelly.name) || "–")}</div><div class="muted mono">${esc(dev.mac || "MAC unbekannt")}${dev.macSource === "router" ? " · via Router" : ""}</div></div></div></td>
        <td data-label="VLAN">${vlanPill(dev)}</td>
        <td data-label="Hersteller"><span>${esc(dev.vendor || "–")}</span></td>
        <td data-label="Typ"><div>${esc(dev.deviceType || "–")}${dev.shelly ? ` <span class="badge outline">Shelly ${esc(dev.shelly.app || dev.shelly.model || "")}</span>` : ""}${shellyCell(dev)}</div></td>
        <td data-label="Ports">${dev.openPorts.length ? `<div class="ports">${dev.openPorts.map((p) => `<span>${esc(p)}</span>`).join("")}</div>` : '<span class="muted">–</span>'}</td>
        <td data-label="Status">${dev.reachable ? `<span class="status"><span class="dot ok"></span>${esc(dev.responseMs ?? "?")} ms</span>` : '<span class="status muted"><span class="dot idle"></span>still</span>'}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="7">${empty(n.devices.length ? "Kein Gerät passt zum Filter." : "Noch keine Geräte erfasst.")}</td></tr>`
  );
}

async function shellyAction(type, payload) {
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function loadShelly(ip) {
  const r = await shellyAction("SHELLY_STATUS", { host: ip });
  state.shelly[ip] = r.success ? r.result : { error: r.error || "Status nicht lesbar" };
  renderNetzwerk();
}

/* ---------------------------------------------------------------- Kameras */

function renderKameras(d) {
  const cams = d.cameras;
  const birds = d.doorbirds;
  const reach = cams.filter((c) => c.reachable).length;
  $("camSub").textContent = `${reach}/${cams.length} Reolink erreichbar · ${birds.filter((b) => b.connected).length}/${birds.length} DoorBird verbunden`;

  const camCards = cams.map((c) => {
    const chips = c.activeStates.map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`).join("");
    const tone = c.activeStates.length ? "alert" : c.reachable ? "accent" : "warn";
    return `<article class="card place ${c.activeStates.length ? "is-active" : ""}">
      <div class="place-head"><span class="tile-ico ${tone}">${icon("camera")}</span><h3>${esc(c.name)}</h3><span class="host mono">${esc(c.host)}</span></div>
      <div class="chips">
        ${c.reachable ? badge("ok", "erreichbar") : badge("warn", "offline")}
        ${c.vehicleDetection ? badge("idle", "Fahrzeuge an") : badge("off", "Fahrzeuge aus")}
        ${chips}
      </div>
      ${c.lastError ? `<div class="line"><span class="k">Fehler</span><span class="v">${esc(c.lastError)}</span></div>` : ""}
      <div class="line"><span class="k">Letztes Bild</span><span class="v muted">${esc(ago(c.lastSnapshotAt))}</span></div>
      <div class="line"><span class="k">Letztes Signal</span><span class="v muted">${esc(ago(c.lastEventAt))}</span></div>
      <div class="card-foot"><button type="button" class="btn small" data-snapshot="${c.id}">${icon("snap")}Schnappschuss</button></div>
    </article>`;
  });

  const birdCards = birds.map(
    (b) => `<article class="card place ${b.activeStates.length ? "is-active" : ""}">
      <div class="place-head"><span class="tile-ico ${b.activeStates.length ? "alert" : b.connected ? "accent" : "warn"}">${icon("door")}</span><h3>${esc(b.name)}</h3><span class="host mono">${esc(b.host)}</span></div>
      <div class="chips">
        ${badge("idle", "DoorBird")}
        ${b.connected ? badge("ok", "Monitor verbunden") : badge("warn", "getrennt")}
        ${b.hold ? badge(b.hold.lastError ? "warn" : "ok", `Offen bis ${clock(b.hold.until)}`) : ""}
        ${b.activeStates.map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`).join("")}
      </div>
      ${b.hold ? `<div class="line"><span class="k">Offen halten</span><span class="v${b.hold.lastError ? "" : " muted"}">${b.hold.pulses} Impulse · letzter ${esc(ago(b.hold.lastPulseAt))}${b.hold.lastError ? ` · Fehler: ${esc(b.hold.lastError)}` : ""}</span></div>` : ""}
      <div class="line"><span class="k">Letztes Signal</span><span class="v muted">${esc(ago(b.lastEventAt))}</span></div>
      <div class="card-foot"><button type="button" class="btn small" data-snapshot="${b.id}">${icon("snap")}Schnappschuss</button></div>
    </article>`
  );

  setHTML("camGrid", camCards.concat(birdCards).join("") || empty("Keine Kameras konfiguriert."));
}

/* ------------------------------------------------------------- Ereignisse */

const EVENT_KINDS = [
  ["alle", "Alle"],
  ["camera", "Kameras"],
  ["person", "Personen"],
  ["vehicle", "Fahrzeuge"],
  ["doorbird", "DoorBird"],
  ["network", "Netzwerk"],
  ["system", "System"],
  ["task", "Aufgaben"],
];

function renderEventFilter() {
  const counts = {};
  for (const e of state.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  setHTML(
    "eventFilter",
    EVENT_KINDS.map(([id, label]) => {
      const n = id === "alle" ? state.events.length : counts[id] || 0;
      return `<button type="button" data-kind="${id}" aria-pressed="${state.eventFilter === id}">${id === "alle" ? "" : icon(KIND_ICONS[id])}${esc(label)}${n ? `<span class="n">${n}</span>` : ""}</button>`;
    }).join("")
  );
}

function renderEreignisse() {
  renderEventFilter();
  const list = state.events.filter((e) => state.eventFilter === "alle" || e.kind === state.eventFilter);
  setHTML("eventTimeline", timelineHtml(list.slice(-120).reverse(), "Noch keine Ereignisse."));
}

/* ---------------------------------------------------------------- Personen */

function statCard(iconName, label, value, sub, tone = "accent") {
  return kpi(iconName, String(value), label, sub, tone);
}

function renderPersonen(d) {
  const c = d.improve.counts || {};
  const match = (c["face.person_match"] || 0) + (c["doorbird.match"] || 0);
  const nomatch = c["face.person_nomatch"] || 0;
  const near = c["face.near_miss"] || 0;
  const noFace = (c["face.skip_no_face"] || 0) + (c["doorbird.no_face"] || 0);

  $("personSub").textContent = d.face.ready
    ? `Gesichtserkennung bereit · ${d.face.gallery} Embeddings in der Gallery`
    : "Gesichtserkennung aus – Sidecar nicht bereit";

  setHTML(
    "personStats",
    [
      statCard("face", "Gallery", d.face.gallery, "Embeddings"),
      statCard("check", "Erkannt", match, "mit Namen", "ok"),
      statCard("user", "Unbekannt", nomatch, "ohne Treffer"),
      statCard("alert", "Knapp", near, "unter Schwelle", near ? "warn" : "accent"),
      statCard("x", "Ohne Gesicht", noFace, "abgebrochen"),
    ].join("")
  );

  const list = state.events.filter((e) => e.kind === "person");
  setHTML("personTimeline", timelineHtml(list.slice(-60).reverse(), "Noch keine Personen gesehen."));
}

/* --------------------------------------------------------------- Fahrzeuge */

function renderFahrzeuge(d) {
  const c = d.improve.counts || {};
  const plates = c["alpr.plate"] || 0;
  const noPlate = c["alpr.upload_noplate"] || 0;
  const deferred = c["alpr.deferred"] || 0;
  const skipped = c["alpr.skip"] || 0;

  $("vehicleSub").textContent = d.alpr.ready
    ? `Kennzeichen-Erkennung bereit · ${d.whitelist.length} freigegebene Fahrzeuge`
    : "Kennzeichen-Erkennung aus (fast-alpr fehlt)";

  setHTML(
    "vehicleStats",
    [
      statCard("plate", "Kennzeichen", plates, "gelesen", "ok"),
      statCard("car", "Ohne Plate", noPlate, "hochgeladen"),
      statCard("user", "Verschoben", deferred, "hinter Person"),
      statCard("x", "Übersprungen", skipped, "kein Fahrzeug"),
    ].join("")
  );

  const list = state.events.filter((e) => e.kind === "vehicle");
  setHTML("vehicleTimeline", timelineHtml(list.slice(-60).reverse(), "Noch keine Fahrzeuge gesehen."));

  setHTML(
    "lotGrid",
    d.parking.lots.length
      ? d.parking.lots
          .map(
            (lot) => `<article class="card place">
        <div class="place-head"><span class="tile-ico accent">${icon("parking")}</span><h3>${esc(lot.name)}</h3><span class="host mono">${esc(lot.ip)}</span></div>
        <div class="stat"><div class="value">${esc(lot.count)}</div><div class="label">Fahrzeuge erkannt</div></div>
        <div class="chips">
          ${d.parking.trackerOnline ? badge("ok", `${num(lot.fps, 1)} fps`) : badge("warn", "Tracker offline")}
          ${lot.lastError ? badge("warn", lot.lastError) : ""}
        </div>
        <div class="line"><span class="k">Stand</span><span class="v muted">${esc(lot.lastUpdate ? ago(new Date(lot.lastUpdate).toISOString()) : "unbekannt")}</span></div>
      </article>`
          )
          .join("")
      : empty("Keine Parkflächen konfiguriert (vehicleGate).")
  );

  setHTML(
    "wlRows",
    d.whitelist.length
      ? d.whitelist
          .map(
            (v) => `<tr>
        <td data-label="Kennzeichen"><span class="mono"><strong>${esc(v.plate)}</strong></span></td>
        <td data-label="Name"><span>${esc(v.name)}</span></td>
        <td data-label="Cooldown"><span>${esc(v.cooldownMinutes)} min</span></td>
        <td data-label="Zuletzt"><span class="muted">${esc(v.lastTriggeredAt ? ago(v.lastTriggeredAt) : "nie")}</span></td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4">${empty("Keine freigegebenen Fahrzeuge.")}</td></tr>`
  );
}

/* ---------------------------------------------------------------- Aktionen */

function renderAktionen(d) {
  const select = $("snapCam");
  const options = d.cameras
    .concat(d.doorbirds.map((b) => ({ id: b.id, name: `${b.name} (DoorBird)` })))
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    .join("");
  if (select.dataset.signature !== options) {
    const previous = select.value;
    select.innerHTML = options;
    if (previous) select.value = previous;
    select.dataset.signature = options;
  }

  setHTML(
    "taskRows",
    d.tasks.length
      ? d.tasks
          .map(
            (t) => `<tr>
        <td data-label="Zeit"><span>${esc(clock(t.ts))}</span></td>
        <td data-label="Aufgabe"><div><strong>${esc(t.type)}</strong><div class="muted mono">#${esc(t.id)}</div></div></td>
        <td data-label="Status">${t.success ? badge("ok", "OK") : badge("alert", "Fehler")}</td>
        <td data-label="Ergebnis">${t.error ? `<span>${esc(t.error)}</span>` : `<span class="muted mono">${esc(JSON.stringify(t.result ?? {}).slice(0, 160))}</span>`}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4">${empty("Noch keine Aufgaben gelaufen.")}</td></tr>`
  );
}

/* ----------------------------------------------------------------- Aktion */

const ACTION_LABELS = {
  PING: "Ping",
  WAKE_ON_LAN: "Wake-on-LAN",
  NETWORK_SCAN: "Netzwerk-Scan",
  SWITCH_SYNC: "Switch-Abfrage",
  CAMERA_SNAPSHOT: "Schnappschuss",
};

async function runAction(type, payload, button) {
  const name = ACTION_LABELS[type] || type;
  if (button) button.disabled = true;
  toast(`${name} läuft …`);
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
    });
    const data = await res.json();
    if (data.success) {
      toast(`${name}: erledigt${data.result ? ` – ${JSON.stringify(data.result).slice(0, 120)}` : ""}`, "ok");
    } else {
      toast(`${name}: ${data.error || "fehlgeschlagen"}`, "err");
    }
  } catch (e) {
    toast(`${name}: ${e.message}`, "err");
  } finally {
    if (button) button.disabled = false;
    refresh();
  }
}

/* ------------------------------------------------------------------ Events */

document.addEventListener("submit", (ev) => {
  const form = ev.target.closest("form[data-action]");
  if (!form) return;
  ev.preventDefault();
  const type = form.dataset.action;
  const data = new FormData(form);
  const payload = {};
  for (const [k, v] of data.entries()) {
    payload[k] = k === "cameraId" ? Number(v) : String(v).trim();
  }
  runAction(type, Object.keys(payload).length ? payload : null, form.querySelector("button"));
});

document.addEventListener("click", async (ev) => {
  const snap = ev.target.closest("[data-snapshot]");
  if (snap) {
    runAction("CAMERA_SNAPSHOT", { cameraId: Number(snap.dataset.snapshot) }, snap);
    return;
  }
  const action = ev.target.closest("button[data-action]");
  if (action) {
    runAction(action.dataset.action, null, action);
    return;
  }
  const shellyStatusBtn = ev.target.closest("[data-shelly-status]");
  if (shellyStatusBtn) {
    shellyStatusBtn.disabled = true;
    loadShelly(shellyStatusBtn.dataset.shellyStatus);
    return;
  }
  const shellySwitchBtn = ev.target.closest("[data-shelly-switch]");
  if (shellySwitchBtn) {
    const ip = shellySwitchBtn.dataset.shellySwitch;
    const on = shellySwitchBtn.dataset.on === "true";
    const channel = shellySwitchBtn.dataset.channel;
    // Shellys schalten auch Anlagen-Stromkreise – nie ohne Rückfrage.
    const ok = await ask(
      `Shelly ${on ? "einschalten" : "ausschalten"}?`,
      `${ip}, Kanal ${channel} wird ${on ? "EIN" : "AUS"}geschaltet. Hängt daran ein Anlagen-Stromkreis, wirkt das sofort.`,
      on ? "Einschalten" : "Ausschalten"
    );
    if (!ok) return;
    shellySwitchBtn.disabled = true;
    shellyAction("SHELLY_SWITCH", { host: ip, channel: Number(channel), on }).then((r) => {
      toast(r.success ? `Shelly ${ip}: ${r.result.on ? "an" : "aus"}` : `Shelly ${ip}: ${r.error}`, r.success ? "ok" : "err");
      loadShelly(ip);
    });
    return;
  }
  const vlanBtn = ev.target.closest("#netVlanFilter button");
  if (vlanBtn) {
    state.netVlan = vlanBtn.dataset.vlan;
    renderNetzwerk();
    return;
  }
  const kind = ev.target.closest("#eventFilter button");
  if (kind) {
    state.eventFilter = kind.dataset.kind;
    renderEreignisse();
  }
});

$("netFilter").addEventListener("input", (ev) => {
  state.netFilter = ev.target.value;
  renderNetzwerk();
});

$("themeBtn").addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  const current = document.documentElement.dataset.theme || "auto";
  const next = order[(order.indexOf(current) + 1) % order.length];
  try {
    if (next === "auto") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem("hub-theme");
    } else {
      document.documentElement.dataset.theme = next;
      localStorage.setItem("hub-theme", next);
    }
  } catch {
    // Privater Modus: Wahl gilt nur fuer diese Sitzung.
  }
  toast(`Design: ${next === "auto" ? "automatisch" : next === "light" ? "hell" : "dunkel"}`);
});

/* Tastatur: 1–8 wechseln die Ansicht, "/" springt in den Gerätefilter. */
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const t = ev.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    if (ev.key === "Escape" && t.id === "netFilter") {
      t.value = "";
      state.netFilter = "";
      t.blur();
      renderNetzwerk();
    }
    return;
  }
  const idx = Number(ev.key) - 1;
  if (idx >= 0 && idx < VIEWS.length) {
    location.hash = VIEWS[idx];
    return;
  }
  if (ev.key === "/") {
    ev.preventDefault();
    if (state.view !== "netzwerk") location.hash = "netzwerk";
    setTimeout(() => $("netFilter").focus(), 0);
  }
});

function tickClock() {
  const el = $("clock");
  const now = new Date();
  el.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  el.dateTime = now.toISOString();
}
setInterval(tickClock, 15000);
tickClock();

window.addEventListener("hashchange", applyRoute);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});

renderEventFilter();
applyRoute();
scheduleTick();
