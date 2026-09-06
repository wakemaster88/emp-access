/*
 * Hub-Dashboard: Router, adaptives Polling und Rendering.
 * Kein Framework – die Datenmenge ist klein und bleibt lokal.
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

function clock(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ago(iso) {
  if (!iso) return "nie";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
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

/** Balken fuer Auslastung – Farbe folgt der Schwelle, Zahl steht daneben. */
function meter(percent) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const tone = p >= 90 ? "alert" : p >= 75 ? "warn" : "ok";
  return `<div class="meter ${tone}"><span style="width:${p.toFixed(1)}%"></span></div>`;
}

/* Alarmzustand → Farbklasse. */
function stateTone(name) {
  if (name === "PERSON" || name === "DOORBELL") return "alert";
  if (name === "VEHICLE") return "warn";
  return "idle";
}

function toast(message, tone = "") {
  const box = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 6000);
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
    const [overview, events] = await Promise.all([
      getJson("/api/overview"),
      getJson(`/api/events?since=${state.eventSeq}`),
    ]);
    state.overview = overview;
    state.eventSeq = events.seq ?? state.eventSeq;
    mergeEvents(events.events ?? []);

    if (state.view === "netzwerk") state.network = await getJson("/api/network");
    if (state.view === "systeme") state.improve = await getJson("/api/improve");

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
      $("lagePlaces").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
      $("lageHealth").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    }
    return;
  }

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
      p.plate.plate ? `<strong>${esc(p.plate.plate)}</strong>` : "keines erkannt"
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

  return `<article class="card place ${p.active.length ? "is-active" : ""}">
    <div class="place-head"><h3>${esc(p.name)}</h3><span class="host mono">${esc(p.host)}</span></div>
    <div class="chips">${chips || badge("idle", "ruhig")}${warn}</div>
    ${rows.join("")}
    <div class="line"><span class="k">Letztes Signal</span><span class="v muted">${esc(ago(p.lastEventAt))}</span></div>
  </article>`;
}

function renderLage(d) {
  const list = places(d);
  const active = list.filter((p) => p.active.length);

  $("activeStrip").innerHTML = active
    .map((p) => `<span class="pulse"><span class="dot"></span>${esc(p.name)}: ${esc(p.active.join(", "))}</span>`)
    .join("");

  $("lageSub").textContent = active.length
    ? `${active.length} von ${list.length} Orten melden gerade etwas.`
    : `Ruhig – ${list.length} Orte beobachtet.`;

  const sorted = list.slice().sort((a, b) => {
    if (!!b.active.length !== !!a.active.length) return b.active.length - a.active.length;
    return (b.lastEventAt || "").localeCompare(a.lastEventAt || "");
  });
  $("lagePlaces").innerHTML = sorted.length ? sorted.map(placeCard).join("") : empty("Keine Kameras konfiguriert.");

  $("lageTimeline").innerHTML = timelineHtml(state.events.slice(-14).reverse(), "Noch nichts passiert.");
  $("lageHealth").innerHTML = d.health.map(healthCard).join("");
}

function healthCard(h) {
  return `<article class="card health-card">
    <div class="row"><span class="dot ${h.state}"></span><span class="label">${esc(h.label)}</span></div>
    <div class="value">${esc(h.value)}</div>
    <div class="detail">${esc(h.detail)}</div>
  </article>`;
}

function timelineHtml(events, emptyText, big = false) {
  if (!events.length) return `<li class="empty">${esc(emptyText)}</li>`;
  return events
    .map(
      (e) => `<li class="${esc(e.severity)}">
        ${timeTag(e.ts)}
        <div class="body">
          <div class="title">${e.where ? `<span class="where">${esc(e.where)}</span> · ` : ""}${esc(e.title)}</div>
          ${e.detail ? `<div class="detail">${esc(e.detail)}</div>` : ""}
        </div>
      </li>`
    )
    .join("");
}

/* ---------------------------------------------------------------- Systeme */

function renderSysteme(d) {
  $("systemeSub").textContent = `${d.hub.name} · ${d.hub.apiUrl} · Module: ${d.hub.modules.join(", ")}`;
  $("systemeHealth").innerHTML = d.health.map(healthCard).join("");
  renderLeistung(d.system);

  const imp = state.improve || d.improve;
  const hints = imp.hints || [];
  $("diagBox").innerHTML = `
    <div class="value" style="font-size:1rem;font-weight:620">${esc(imp.hint || "sammelt …")}</div>
    <div class="muted" style="font-size:0.8rem;margin-top:0.25rem">seit ${esc(clock(imp.since))} · <a href="/api/improve">Rohdaten</a></div>
    ${hints.length ? `<ul class="hints">${hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}`;

  const counts = Object.entries(imp.counts || {});
  $("countsBox").innerHTML = counts.length
    ? `<dl class="kv">${counts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
    : empty("Noch keine Zähler.");

  $("logsBox").innerHTML = d.logs.length
    ? d.logs.map((l) => `<div><span class="ts">${esc(clock(l.ts))}</span><span class="msg">${esc(l.msg)}</span></div>`).join("")
    : empty("Keine Logs.");
}

function renderLeistung(sys) {
  if (!sys) {
    $("perfStats").innerHTML = empty("Keine Leistungsdaten.");
    $("perfDetail").innerHTML = "";
    return;
  }

  const net = sys.network.reduce(
    (acc, i) => ({ rx: acc.rx + i.rxBytesPerSec, tx: acc.tx + i.txBytesPerSec }),
    { rx: 0, tx: 0 }
  );

  $("perfStats").innerHTML = [
    {
      label: "CPU",
      value: sys.cpu.usage == null ? "–" : `${Math.round(sys.cpu.usage)} %`,
      sub: `${sys.cpu.cores} Kerne`,
      percent: sys.cpu.usage,
    },
    {
      label: "Speicher",
      value: `${Math.round(sys.memory.usage)} %`,
      sub: `${bytes(sys.memory.usedBytes)} von ${bytes(sys.memory.totalBytes)}`,
      percent: sys.memory.usage,
    },
    sys.disk
      ? {
          label: "Platte",
          value: `${Math.round(sys.disk.usage)} %`,
          sub: `${bytes(sys.disk.totalBytes - sys.disk.usedBytes)} frei`,
          percent: sys.disk.usage,
        }
      : { label: "Platte", value: "–", sub: "unbekannt", percent: null },
    {
      label: "Netz",
      value: rate(net.rx + net.tx),
      sub: `↓ ${rate(net.rx)} · ↑ ${rate(net.tx)}`,
      percent: null,
    },
  ]
    .map(
      (s) => `<article class="card stat">
        <div class="value">${esc(s.value)}</div>
        <div class="label">${esc(s.label)}</div>
        ${s.percent == null ? "" : meter(s.percent)}
        <div class="label">${esc(s.sub)}</div>
      </article>`
    )
    .join("");

  const procRows = [
    {
      label: "Hub (Node)",
      pid: sys.hubProcess.pid,
      cpu: sys.hubProcess.cpu,
      rssBytes: sys.hubProcess.rssBytes,
    },
  ].concat(sys.processes);

  $("perfDetail").innerHTML = `
    <article class="card">
      <h3 style="font-size:0.95rem;margin-bottom:0.5rem">Rechner</h3>
      <div class="line"><span class="k">Prozessor</span><span class="v">${esc(sys.cpu.model)}</span></div>
      <div class="line"><span class="k">Last</span><span class="v">${num(sys.cpu.load1)} · ${num(sys.cpu.load5)} · ${num(sys.cpu.load15)} <span class="muted">(${num(sys.cpu.loadPerCore)} pro Kern)</span></span></div>
      <div class="line"><span class="k">Komprimiert</span><span class="v">${esc(sys.memory.compressedBytes == null ? "unbekannt" : bytes(sys.memory.compressedBytes))}</span></div>
      <div class="line"><span class="k">Platte</span><span class="v">${sys.disk ? `${esc(bytes(sys.disk.usedBytes))} von ${esc(bytes(sys.disk.totalBytes))} · ${esc(sys.disk.mount)}` : "unbekannt"}</span></div>
      <div class="line"><span class="k">Rechner läuft</span><span class="v">${esc(uptime(sys.hostUptimeSec))}</span></div>
      <div class="line"><span class="k">Hub läuft</span><span class="v">${esc(uptime(sys.hubProcess.uptimeSec))}</span></div>
    </article>
    <article class="card">
      <h3 style="font-size:0.95rem;margin-bottom:0.5rem">Prozesse</h3>
      ${procRows
        .map(
          (p) => `<div class="line"><span class="k">${esc(p.label)}</span><span class="v">${
            p.cpu == null ? "–" : `${num(p.cpu, 1)} % CPU`
          } · ${esc(bytes(p.rssBytes))} <span class="muted">PID ${esc(p.pid)}</span></span></div>`
        )
        .join("")}
    </article>
    <article class="card">
      <h3 style="font-size:0.95rem;margin-bottom:0.5rem">Netzwerkkarten</h3>
      ${
        sys.network.length
          ? sys.network
              .map(
                (i) => `<div class="line"><span class="k">${esc(i.name)}</span><span class="v">↓ ${esc(rate(i.rxBytesPerSec))} · ↑ ${esc(rate(i.txBytesPerSec))}</span></div>`
              )
              .join("")
          : '<div class="line"><span class="v muted">Kein Durchsatz gemessen.</span></div>'
      }
    </article>`;
}

/* --------------------------------------------------------------- Netzwerk */

function renderNetzwerk() {
  const n = state.network;
  if (!n) {
    $("netSub").textContent = "Scan-Daten werden geladen …";
    return;
  }
  $("netSub").textContent = n.scanning
    ? "Scan läuft gerade …"
    : n.lastRunAt
      ? `${n.devices.length} Geräte · ${ago(n.lastRunAt)}${n.uploaded ? " · in die Cloud gemeldet" : ""}${n.error ? ` · Fehler: ${n.error}` : ""}`
      : "Noch kein Scan gelaufen.";

  const q = state.netFilter.trim().toLowerCase();
  const rows = n.devices.filter((dev) =>
    !q ||
    [dev.ip, dev.hostname, dev.vendor, dev.deviceType, dev.mac].some((v) => String(v ?? "").toLowerCase().includes(q))
  );

  $("netRows").innerHTML = rows.length
    ? rows
        .map(
          (dev) => `<tr>
        <td data-label="IP"><span class="mono">${esc(dev.ip)}</span></td>
        <td data-label="Name"><div>${esc(dev.hostname || "–")}<div class="muted mono">${esc(dev.mac)}</div></div></td>
        <td data-label="Hersteller"><span>${esc(dev.vendor || "–")}</span></td>
        <td data-label="Typ"><span>${esc(dev.deviceType || "–")}</span></td>
        <td data-label="Ports"><span class="mono">${esc(dev.openPorts.join(", ") || "–")}</span></td>
        <td data-label="Status">${dev.reachable ? badge("ok", `${dev.responseMs ?? "?"} ms`) : badge("idle", "still")}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="6">${empty(n.devices.length ? "Kein Gerät passt zum Filter." : "Noch keine Geräte erfasst.")}</td></tr>`;
}

/* ---------------------------------------------------------------- Kameras */

function renderKameras(d) {
  const cams = d.cameras;
  const birds = d.doorbirds;
  const reach = cams.filter((c) => c.reachable).length;
  $("camSub").textContent = `${reach}/${cams.length} Reolink erreichbar · ${birds.filter((b) => b.connected).length}/${birds.length} DoorBird verbunden`;

  const camCards = cams.map((c) => {
    const chips = c.activeStates.map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`).join("");
    return `<article class="card place ${c.activeStates.length ? "is-active" : ""}">
      <div class="place-head"><h3>${esc(c.name)}</h3><span class="host mono">${esc(c.host)}</span></div>
      <div class="chips">
        ${c.reachable ? badge("ok", "erreichbar") : badge("warn", "offline")}
        ${c.vehicleDetection ? badge("idle", "Fahrzeuge an") : badge("off", "Fahrzeuge aus")}
        ${chips}
      </div>
      ${c.lastError ? `<div class="line"><span class="k">Fehler</span><span class="v">${esc(c.lastError)}</span></div>` : ""}
      <div class="line"><span class="k">Letztes Bild</span><span class="v muted">${esc(ago(c.lastSnapshotAt))}</span></div>
      <div class="line"><span class="k">Letztes Signal</span><span class="v muted">${esc(ago(c.lastEventAt))}</span></div>
      <div><button type="button" class="btn small" data-snapshot="${c.id}">Schnappschuss</button></div>
    </article>`;
  });

  const birdCards = birds.map(
    (b) => `<article class="card place ${b.activeStates.length ? "is-active" : ""}">
      <div class="place-head"><h3>${esc(b.name)}</h3><span class="host mono">${esc(b.host)}</span></div>
      <div class="chips">
        ${badge("idle", "DoorBird")}
        ${b.connected ? badge("ok", "Monitor verbunden") : badge("warn", "getrennt")}
        ${b.hold ? badge(b.hold.lastError ? "warn" : "ok", `Offen bis ${clock(b.hold.until)}`) : ""}
        ${b.activeStates.map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`).join("")}
      </div>
      ${b.hold ? `<div class="line"><span class="k">Offen halten</span><span class="v${b.hold.lastError ? "" : " muted"}">${b.hold.pulses} Impulse · letzter ${esc(ago(b.hold.lastPulseAt))}${b.hold.lastError ? ` · Fehler: ${esc(b.hold.lastError)}` : ""}</span></div>` : ""}
      <div class="line"><span class="k">Letztes Signal</span><span class="v muted">${esc(ago(b.lastEventAt))}</span></div>
      <div><button type="button" class="btn small" data-snapshot="${b.id}">Schnappschuss</button></div>
    </article>`
  );

  $("camGrid").innerHTML = camCards.concat(birdCards).join("") || empty("Keine Kameras konfiguriert.");
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
  $("eventFilter").innerHTML = EVENT_KINDS.map(
    ([id, label]) =>
      `<button type="button" data-kind="${id}" aria-pressed="${state.eventFilter === id}">${esc(label)}</button>`
  ).join("");
}

function renderEreignisse() {
  renderEventFilter();
  const list = state.events.filter((e) => state.eventFilter === "alle" || e.kind === state.eventFilter);
  $("eventTimeline").innerHTML = timelineHtml(list.slice(-120).reverse(), "Noch keine Ereignisse.");
}

/* ---------------------------------------------------------------- Personen */

function renderPersonen(d) {
  const c = d.improve.counts || {};
  const match = (c["face.person_match"] || 0) + (c["doorbird.match"] || 0);
  const nomatch = c["face.person_nomatch"] || 0;
  const near = c["face.near_miss"] || 0;
  const noFace = (c["face.skip_no_face"] || 0) + (c["doorbird.no_face"] || 0);

  $("personSub").textContent = d.face.ready
    ? `Gesichtserkennung bereit · ${d.face.gallery} Embeddings in der Gallery`
    : "Gesichtserkennung aus – Sidecar nicht bereit";

  $("personStats").innerHTML = [
    ["Gallery", d.face.gallery, "Embeddings"],
    ["Erkannt", match, "mit Namen"],
    ["Unbekannt", nomatch, "ohne Treffer"],
    ["Knapp", near, "unter Schwelle"],
    ["Ohne Gesicht", noFace, "abgebrochen"],
  ]
    .map(([label, value, sub]) => `<article class="card stat"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div><div class="label">${esc(sub)}</div></article>`)
    .join("");

  const list = state.events.filter((e) => e.kind === "person");
  $("personTimeline").innerHTML = timelineHtml(list.slice(-60).reverse(), "Noch keine Personen gesehen.");
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

  $("vehicleStats").innerHTML = [
    ["Kennzeichen", plates, "gelesen"],
    ["Ohne Plate", noPlate, "hochgeladen"],
    ["Verschoben", deferred, "hinter Person"],
    ["Übersprungen", skipped, "kein Fahrzeug"],
  ]
    .map(([label, value, sub]) => `<article class="card stat"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div><div class="label">${esc(sub)}</div></article>`)
    .join("");

  const list = state.events.filter((e) => e.kind === "vehicle");
  $("vehicleTimeline").innerHTML = timelineHtml(list.slice(-60).reverse(), "Noch keine Fahrzeuge gesehen.");

  $("lotGrid").innerHTML = d.parking.lots.length
    ? d.parking.lots
        .map(
          (lot) => `<article class="card place">
        <div class="place-head"><h3>${esc(lot.name)}</h3><span class="host mono">${esc(lot.ip)}</span></div>
        <div class="value" style="font-size:1.75rem;font-weight:650">${esc(lot.count)}</div>
        <div class="chips">
          ${d.parking.trackerOnline ? badge("ok", `${num(lot.fps, 1)} fps`) : badge("warn", "Tracker offline")}
          ${lot.lastError ? badge("warn", lot.lastError) : ""}
        </div>
        <div class="line"><span class="k">Stand</span><span class="v muted">${esc(lot.lastUpdate ? ago(new Date(lot.lastUpdate).toISOString()) : "unbekannt")}</span></div>
      </article>`
        )
        .join("")
    : empty("Keine Parkflächen konfiguriert (vehicleGate).");

  $("wlRows").innerHTML = d.whitelist.length
    ? d.whitelist
        .map(
          (v) => `<tr>
        <td data-label="Kennzeichen"><span class="mono">${esc(v.plate)}</span></td>
        <td data-label="Name"><span>${esc(v.name)}</span></td>
        <td data-label="Cooldown"><span>${esc(v.cooldownMinutes)} min</span></td>
        <td data-label="Zuletzt"><span>${esc(v.lastTriggeredAt ? ago(v.lastTriggeredAt) : "nie")}</span></td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4">${empty("Keine freigegebenen Fahrzeuge.")}</td></tr>`;
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

  $("taskRows").innerHTML = d.tasks.length
    ? d.tasks
        .map(
          (t) => `<tr>
        <td data-label="Zeit"><span>${esc(clock(t.ts))}</span></td>
        <td data-label="Aufgabe"><div>${esc(t.type)}<div class="muted">#${esc(t.id)}</div></div></td>
        <td data-label="Status">${t.success ? badge("ok", "OK") : badge("alert", "Fehler")}</td>
        <td data-label="Ergebnis">${t.error ? `<span>${esc(t.error)}</span>` : `<span class="muted mono">${esc(JSON.stringify(t.result ?? {}).slice(0, 160))}</span>`}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4">${empty("Noch keine Aufgaben gelaufen.")}</td></tr>`;
}

/* ----------------------------------------------------------------- Aktion */

async function runAction(type, payload, button) {
  if (button) button.disabled = true;
  toast(`${type} läuft …`);
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
    });
    const data = await res.json();
    if (data.success) {
      toast(`${type}: erledigt${data.result ? ` – ${JSON.stringify(data.result).slice(0, 120)}` : ""}`, "ok");
    } else {
      toast(`${type}: ${data.error || "fehlgeschlagen"}`, "err");
    }
  } catch (e) {
    toast(`${type}: ${e.message}`, "err");
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

document.addEventListener("click", (ev) => {
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
  if (next === "auto") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem("hub-theme");
  } else {
    document.documentElement.dataset.theme = next;
    localStorage.setItem("hub-theme", next);
  }
  toast(`Design: ${next === "auto" ? "automatisch" : next === "light" ? "hell" : "dunkel"}`);
});

window.addEventListener("hashchange", applyRoute);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});

renderEventFilter();
applyRoute();
scheduleTick();
