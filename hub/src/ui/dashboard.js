/*
 * Hub-Dashboard: Router, adaptives Polling und Rendering.
 * Kein Framework – die Datenmenge ist klein und bleibt lokal.
 * DOM wird nur angefasst, wenn sich das HTML wirklich aendert (setHTML):
 * so flackert nichts, Hover/Fokus bleiben stehen und Shelly-Knoepfe
 * verschwinden nicht unter dem Finger.
 */

const VIEWS = [
  "zentrale",
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
  view: "zentrale",
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
  if (hash === "live") return "zentrale";
  return VIEWS.includes(hash) ? hash : "zentrale";
}

function applyRoute() {
  state.view = currentView();
  if (state.view !== "zentrale") stopLive();
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
  return state.view === "lage" || state.view === "zentrale" ? 2000 : 5000;
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
    case "zentrale": renderZentrale(d); break;
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
  set("zentrale", active, "alert");
  set("systeme", d.health.filter((h) => h.state === "warn").length, "warn");
  set("netzwerk", d.autoScan && d.autoScan.devices ? d.autoScan.devices : "");
  const camDown = d.cameras.filter((c) => !c.reachable).length + d.doorbirds.filter((b) => !b.connected).length;
  set("kameras", camDown, "warn");
  const since = Date.now() - 10 * 60 * 1000;
  const recentAlerts = state.events.filter((e) => e.severity === "alert" && new Date(e.ts).getTime() > since).length;
  set("ereignisse", recentAlerts, "alert");
}

/* --------------------------------------------------------------- Zentrale */

/*
 * Live-Kameras ueber go2rtc auf dem Hub. Signalisierung und Standbilder
 * laufen durch den Dashboard-Proxy (/api/go2rtc/*), das Video selbst per
 * WebRTC direkt von go2rtc. Kacheln nutzen den Sub-Stream, die
 * Grossansicht den Main-Stream. Kacheln werden nur neu gebaut, wenn sich
 * die Kameraliste aendert – sonst wuerden die Videos bei jedem Poll abreissen.
 * Die Steuerung zeigt nur, was die Kamera laut CAMERA_CAPS kann.
 */

function storeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privater Modus
  }
}

const live = {
  /** "auto" oder feste Spaltenzahl. */
  cols: storeGet("hub-live-cols2") || "auto",
  /** null = noch nicht gefragt, sonst ob go2rtc antwortet. */
  go2rtc: null,
  streams: [],
  streamsAt: 0,
  loading: false,
  signature: "",
  /** Kamera-ID -> Stop-Funktion der WebRTC-Verbindung. */
  peers: new Map(),
  focusId: null,
  focusStop: null,
  presets: {},
  /** Kamera-IDs, deren Faehigkeiten schon angefragt wurden. */
  capsAsked: new Set(),
  capsBusy: false,
  /** Kamera-IDs mit Panorama-Bild (aus caps.wide oder Videoformat). */
  wide: new Set(),
  zoom: { scale: 1, x: 50, y: 50 },
  /** Ersatz-Vollbild fuers iPhone (kein Element-Fullscreen in Safari). */
  kiosk: false,
};

/** Finger statt Maus: andere Hinweise, Gesten in der Grossansicht. */
const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const PHONE_MAX = 560;

/*
 * Nur sichtbare Kacheln halten eine WebRTC-Verbindung. Auf dem Telefon
 * passen zwei, drei Reihen auf den Schirm – alle 13 Kameras gleichzeitig zu
 * dekodieren kostet Akku, Daten und bringt iOS ins Stocken. Unsichtbare
 * Kacheln zeigen weiter ihr (seltener aufgefrischtes) Standbild.
 */
const tileObserver =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const tile = e.target;
            tile.dataset.vis = e.isIntersecting ? "1" : "0";
            const id = Number(tile.dataset.live);
            const c = state.overview ? liveCams(state.overview).find((x) => x.id === id) : null;
            if (c) ensureTileStream(tile, c);
          }
        },
        { rootMargin: "120px 0px" }
      )
    : null;

function stopTile(tile, id) {
  const stop = live.peers.get(id);
  if (!stop) return;
  stop();
  live.peers.delete(id);
  tile.classList.remove("is-live");
  tile.dataset.rtc = "";
  // Bisheriges Livebild ist weg; sofort ein frisches Standbild holen.
  tile.dataset.frameAt = "0";
  setTileMode(tile);
}

async function loadStreams(force = false) {
  if (live.loading || (!force && Date.now() - live.streamsAt < 30000)) return;
  live.loading = true;
  try {
    const r = await getJson("/api/go2rtc/streams");
    live.go2rtc = !!r.reachable;
    live.streams = r.streams || [];
  } catch {
    live.go2rtc = false;
    live.streams = [];
  } finally {
    live.streamsAt = Date.now();
    live.loading = false;
    if (state.view === "zentrale" && state.overview) renderZentrale(state.overview);
  }
}

/** Faehigkeiten nacheinander abfragen (Hub cached sie 6 h). */
async function loadCaps(cams) {
  if (live.capsBusy) return;
  const next = cams.find((c) => c.kind === "REOLINK" && c.reachable && !c.caps && !live.capsAsked.has(c.id));
  if (!next) return;
  live.capsBusy = true;
  live.capsAsked.add(next.id);
  try {
    await shellyAction("CAMERA_CAPS", { cameraId: next.id });
  } finally {
    live.capsBusy = false;
  }
  // Ergebnis kommt mit dem naechsten /api/overview; gleich weitermachen.
  setTimeout(() => state.overview && loadCaps(liveCams(state.overview)), 300);
}

/** Passenden go2rtc-Stream finden: per Kamera-Host aus der RTSP-URL. */
function streamFor(cam, quality) {
  const names = live.streams.filter((s) => s.host === cam.host).map((s) => s.name);
  if (!names.length && cam.kind === "DOORBIRD" && live.streams.some((s) => s.name === "doorbird")) {
    return "doorbird";
  }
  if (!names.length) return null;
  return names.find((n) => n.endsWith(`_${quality}`)) || names.find((n) => !/_(main|sub)$/.test(n)) || names[0];
}

function liveCams(d) {
  return d.cameras
    .map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      kind: "REOLINK",
      reachable: c.reachable,
      states: c.activeStates,
      lastEventAt: c.lastEventAt,
      caps: c.caps || null,
    }))
    .concat(
      d.doorbirds.map((b) => ({
        id: b.id,
        name: b.name,
        host: b.host,
        kind: "DOORBIRD",
        reachable: b.connected,
        states: b.activeStates,
        lastEventAt: b.lastEventAt,
        hold: b.hold,
        caps: null,
      }))
    );
}

/** Minimaler WebRTC-Client fuer go2rtc; verbindet bei Abbruch neu. */
function startRtc(video, src, onState) {
  if (typeof RTCPeerConnection === "undefined") {
    onState("error");
    return () => {};
  }
  let pc = null;
  let stopped = false;
  let timer = null;
  let attempts = 0;

  const cleanup = () => {
    if (!pc) return;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      // schon zu
    }
    pc = null;
  };
  const retry = () => {
    if (stopped) return;
    attempts++;
    onState("error");
    cleanup();
    clearTimeout(timer);
    timer = setTimeout(connect, Math.min(15000, 2000 * 2 ** Math.min(3, attempts - 1)));
  };

  async function connect() {
    if (stopped) return;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (ev) => {
        if (ev.streams[0] && video.srcObject !== ev.streams[0]) {
          video.srcObject = ev.streams[0];
          video.play().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        const st = pc.connectionState;
        if (st === "connected") {
          attempts = 0;
          onState("live");
        } else if (st === "failed" || st === "disconnected" || st === "closed") {
          retry();
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch(`/api/go2rtc/webrtc?src=${encodeURIComponent(src)}`, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp || "",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const answer = await res.text();
      if (stopped || !pc) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch {
      retry();
    }
  }

  onState("connecting");
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    cleanup();
    video.srcObject = null;
  };
}

function frameUrl(src) {
  return `/api/go2rtc/frame.jpeg?src=${encodeURIComponent(src)}&t=${Date.now()}`;
}

/** Kleine Symbole fuer das, was die Kamera kann. */
function capIcons(c) {
  const k = c.caps;
  if (!k) return "";
  const list = [
    [k.pan, "target", "Schwenkbar"],
    [k.zoom, "plus", "Optischer Zoom"],
    [k.spotlight, "bulb", "Scheinwerfer"],
    [k.siren, "siren", "Sirene"],
  ].filter(([on]) => on);
  return list.map(([, ic, title]) => `<span class="cap" title="${esc(title)}">${icon(ic)}</span>`).join("");
}

function tileHtml(c) {
  const src = streamFor(c, "sub");
  return `<article class="live-tile${live.wide.has(c.id) ? " is-wide" : ""}" data-live="${c.id}" tabindex="0" role="button" aria-label="${esc(c.name)} groß anzeigen">
    <img alt="">
    <video autoplay muted playsinline></video>
    <div class="live-empty">${icon(c.kind === "DOORBIRD" ? "door" : "camera")}<span>${
      src ? "Verbinde …" : live.go2rtc === false ? "go2rtc nicht erreichbar" : live.go2rtc === null ? "Lade Streams …" : "Kein Stream in go2rtc"
    }</span></div>
    <div class="live-top">
      <span class="live-tag mode" hidden></span>
      <span class="live-name">${esc(c.name)}</span>
      <span class="live-states"></span>
    </div>
    <div class="live-bottom">
      <span class="live-tag off" hidden>OFFLINE</span>
      <span class="live-caps"></span>
      <span class="grow live-ago"></span>
    </div>
  </article>`;
}

function setTileMode(tile) {
  const tag = tile.querySelector(".live-tag.mode");
  const isLive = tile.classList.contains("is-live");
  const hasPic = tile.classList.contains("has-picture");
  tag.hidden = !isLive && !hasPic;
  tag.className = `live-tag mode ${isLive ? "live" : "snap"}`;
  tag.textContent = isLive ? "LIVE" : "BILD";
}

/** Panorama-Kameras (Duo) bekommen eine doppelt breite Kachel. */
function markWide(id, w, h) {
  if (!w || !h || w / h < 2.4 || live.wide.has(id)) return;
  live.wide.add(id);
  const tile = document.querySelector(`[data-live="${id}"]`);
  if (tile) tile.classList.add("is-wide");
  layoutGrid();
}

function ensureTileStream(tile, c) {
  const src = streamFor(c, "sub");
  if (!src) return;
  const visible = tile.dataset.vis !== "0";
  if (!visible) stopTile(tile, c.id);
  if (visible && !live.peers.has(c.id)) {
    const video = tile.querySelector("video");
    const img = tile.querySelector("img");
    img.onload = () => {
      tile.classList.add("has-picture");
      setTileMode(tile);
      markWide(c.id, img.naturalWidth, img.naturalHeight);
    };
    video.onloadedmetadata = () => markWide(c.id, video.videoWidth, video.videoHeight);
    const stop = startRtc(video, src, (st) => {
      tile.dataset.rtc = st;
      tile.classList.toggle("is-live", st === "live");
      if (st === "live") tile.classList.add("has-picture");
      setTileMode(tile);
    });
    live.peers.set(c.id, stop);
  }
  // Standbild als Vorschau und als Ersatz, solange WebRTC nicht steht.
  const img = tile.querySelector("img");
  const last = Number(tile.dataset.frameAt || 0);
  const wait = !visible ? 60000 : tile.dataset.rtc === "error" ? 5000 : 20000;
  if (!tile.classList.contains("is-live") && Date.now() - last > (last ? wait : 0)) {
    tile.dataset.frameAt = String(Date.now());
    img.src = frameUrl(src);
  }
}

function stopTiles() {
  for (const stop of live.peers.values()) stop();
  live.peers.clear();
}

function stopLive() {
  stopTiles();
  live.signature = "";
  if ($("camDlg") && $("camDlg").open) $("camDlg").close();
}

/**
 * Spalten: fest gewaehlt oder "Auto". Auto sucht die Spaltenzahl, bei der
 * alle Kacheln ohne Scrollen auf den Bildschirm passen und dabei moeglichst
 * gross sind; bei sehr vielen Kameras mindestens ~300 px breit.
 */
function layoutGrid() {
  const grid = $("liveGrid");
  if (!grid || !grid.offsetParent) return;
  const width = grid.clientWidth;
  const units = [...grid.querySelectorAll(".live-tile")].reduce((n, t) => n + (t.classList.contains("is-wide") ? 2 : 1), 0) || 1;
  let cols;
  if (window.innerWidth < PHONE_MAX) {
    // Telefon hochkant: Auto = zwei Spalten ab drei Kameras, wahlweise 1 oder 2.
    cols = live.cols === "1" ? 1 : live.cols === "auto" && units <= 2 ? 1 : 2;
  } else if (live.cols !== "auto") cols = Number(live.cols);
  else {
    const top = grid.getBoundingClientRect().top + window.scrollY;
    const fullscreen = isFullscreen();
    const avail = window.innerHeight - (fullscreen ? 12 : Math.min(top, 220)) - 16;
    const gap = 10;
    const maxCols = Math.max(1, Math.floor((width + gap) / (300 + gap)));
    cols = maxCols;
    for (let c = 1; c <= Math.max(1, maxCols); c++) {
      const tileW = (width - gap * (c - 1)) / c;
      const rows = Math.ceil(units / c);
      if (rows * (tileW * 9) / 16 + gap * (rows - 1) <= avail) {
        cols = c;
        break;
      }
    }
  }
  grid.style.setProperty("--cols", String(Math.max(1, cols)));
  grid.dataset.cols = String(Math.max(1, cols));
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || live.kiosk);
}

/**
 * Vollbild der Zentrale. iPad/Mac koennen echtes Element-Vollbild, das
 * iPhone nicht – dort blendet der Kiosk-Modus Kopf- und Tab-Leiste aus
 * (als Home-Bildschirm-App ist das praktisch Vollbild).
 */
function toggleLiveFullscreen() {
  const el = $("view-zentrale");
  if (live.kiosk) return setKiosk(false);
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
  if (document.webkitFullscreenElement) return void document.webkitExitFullscreen?.();
  if (el.requestFullscreen) return void el.requestFullscreen().catch(() => setKiosk(true));
  if (el.webkitRequestFullscreen) return void el.webkitRequestFullscreen();
  setKiosk(true);
}

function setKiosk(on) {
  live.kiosk = on;
  document.body.classList.toggle("is-kiosk", on);
  $("kioskExit").hidden = !on;
  window.scrollTo(0, 0);
  setTimeout(layoutGrid, 50);
}

function renderZentrale(d) {
  loadStreams();
  const cams = liveCams(d);
  loadCaps(cams);
  for (const c of cams) if (c.caps && c.caps.wide) live.wide.add(c.id);
  const grid = $("liveGrid");
  for (const b of document.querySelectorAll("#liveCols button")) {
    b.setAttribute("aria-pressed", String(b.dataset.cols === String(live.cols)));
  }

  const sig = `${live.go2rtc}|${cams.map((c) => `${c.id}:${c.host}:${streamFor(c, "sub")}`).join("|")}`;
  if (sig !== live.signature) {
    live.signature = sig;
    stopTiles();
    tileObserver?.disconnect();
    grid.innerHTML = cams.length ? cams.map(tileHtml).join("") : empty("Keine Kameras konfiguriert.");
    if (tileObserver) for (const t of grid.querySelectorAll(".live-tile")) tileObserver.observe(t);
  }
  layoutGrid();

  for (const c of cams) {
    const tile = grid.querySelector(`[data-live="${c.id}"]`);
    if (!tile) continue;
    tile.classList.toggle("is-active", c.states.length > 0);
    tile.classList.toggle("is-offline", !c.reachable);
    const st = tile.querySelector(".live-states");
    const html = c.states.map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`).join("");
    if (st.dataset.h !== html) {
      st.innerHTML = html;
      st.dataset.h = html;
    }
    const capsEl = tile.querySelector(".live-caps");
    const capsHtml = capIcons(c);
    if (capsEl.dataset.h !== capsHtml) {
      capsEl.innerHTML = capsHtml;
      capsEl.dataset.h = capsHtml;
    }
    tile.querySelector(".live-tag.off").hidden = c.reachable;
    tile.querySelector(".live-ago").textContent = c.lastEventAt ? `Signal ${ago(c.lastEventAt)}` : "";
    ensureTileStream(tile, c);
  }

  const liveCount = grid.querySelectorAll(".live-tile.is-live").length;
  const active = cams.filter((c) => c.states.length);
  $("liveSub").textContent =
    live.go2rtc === false
      ? `go2rtc auf dem Hub antwortet nicht – ${cams.length} Kameras ohne Livebild.`
      : `${liveCount} von ${cams.length} live${active.length ? ` · ${active.map((c) => `${c.name}: ${c.states.join(", ")}`).join(" · ")}` : ""}`;

  if ($("camDlg").open) {
    renderFocusState(d);
    // Faehigkeiten kamen nach dem Oeffnen an: Steuerung nachziehen.
    const c = focusCam();
    const box = $("camDlgControls");
    if (c && box.dataset.caps !== capsKey(c)) {
      box.innerHTML = controlsHtml(c);
      box.dataset.caps = capsKey(c);
      $("camDlgHost").textContent = focusSubtitle(c);
    }
  }
}

/* Grossansicht */

function focusCam() {
  return state.overview ? liveCams(state.overview).find((c) => c.id === live.focusId) : null;
}

function capsKey(c) {
  return c.caps ? JSON.stringify(c.caps) : "none";
}

function focusSubtitle(c) {
  if (c.kind === "DOORBIRD") return `${c.host} · DoorBird`;
  const k = c.caps;
  return `${c.host} · ${k && k.model ? `Reolink ${k.model}` : "Reolink"}${k && k.firmware ? ` · FW ${k.firmware}` : ""}`;
}

function setZoom(scale, x = live.zoom.x, y = live.zoom.y) {
  live.zoom = { scale: Math.max(1, Math.min(4, scale)), x, y };
  const t = live.zoom.scale === 1 ? "" : `scale(${live.zoom.scale})`;
  for (const el of [$("camDlgVideo"), $("camDlgImg")]) {
    el.style.transformOrigin = `${live.zoom.x}% ${live.zoom.y}%`;
    el.style.transform = t;
  }
  const lbl = $("camZoomLabel");
  if (lbl) lbl.textContent = `${live.zoom.scale.toFixed(1)}×`;
}

function openFocus(id) {
  live.focusId = id;
  const c = focusCam();
  if (!c) return;
  const dlg = $("camDlg");
  $("camDlgTitle").textContent = c.name;
  $("camDlgHost").textContent = focusSubtitle(c);
  const box = $("camDlgControls");
  box.innerHTML = controlsHtml(c);
  box.dataset.caps = capsKey(c);
  setZoom(1, 50, 50);
  dlg.classList.toggle("is-wide", live.wide.has(c.id));

  const video = $("camDlgVideo");
  const img = $("camDlgImg");
  img.removeAttribute("src");
  video.style.opacity = "0";
  if (live.focusStop) live.focusStop();
  live.focusStop = null;
  delete dlg.dataset.rtc;
  const src = streamFor(c, "main");
  if (src) {
    img.src = frameUrl(src);
    live.focusStop = startRtc(video, src, (st) => {
      video.style.opacity = st === "live" ? "1" : "0";
      $("camDlg").dataset.rtc = st;
      renderFocusState(state.overview);
    });
  }
  if (!dlg.open) {
    dlg.showModal();
    // showModal fokussiert den ersten Knopf und scrollt dorthin – auf dem
    // Telefon soll die Ansicht oben mit Name und Schliessen beginnen.
    dlg.querySelector(".cam-dlg-body").scrollTop = 0;
  }
  renderFocusState(state.overview);
  if (c.kind === "REOLINK" && !c.caps && c.reachable) {
    shellyAction("CAMERA_CAPS", { cameraId: c.id }).then(() => refresh());
  }
}

/** Naechste/vorige Kamera in der Grossansicht. */
function stepFocus(dir) {
  if (!state.overview) return;
  const cams = liveCams(state.overview);
  const i = cams.findIndex((c) => c.id === live.focusId);
  if (i < 0) return;
  openFocus(cams[(i + dir + cams.length) % cams.length].id);
}

function renderFocusState(d) {
  const c = d && focusCam();
  if (!c) return;
  const rtc = $("camDlg").dataset.rtc;
  const html = `${rtc === "live" ? '<span class="live-tag live">LIVE</span>' : !streamFor(c, "main") ? '<span class="live-tag off">KEIN STREAM</span>' : rtc === "error" ? '<span class="live-tag snap">STANDBILD</span>' : '<span class="live-tag snap">VERBINDE …</span>'}${c.states
    .map((s) => `<span class="badge ${stateTone(s)}">${esc(s)}</span>`)
    .join("")}`;
  const el = $("camDlgState");
  if (el.dataset.h !== html) {
    el.innerHTML = html;
    el.dataset.h = html;
  }
}

function controlsHtml(c) {
  const digital = `<div class="ctl-group">
      <span class="ctl-label">Bild vergrößern</span>
      <div class="ctl-row">
        <button type="button" class="btn small" data-dzoom="-1" aria-label="Bild verkleinern">${icon("minus")}</button>
        <span class="ctl-value" id="camZoomLabel">${live.zoom.scale.toFixed(1)}×</span>
        <button type="button" class="btn small" data-dzoom="1" aria-label="Bild vergrößern">${icon("plus")}</button>
        <button type="button" class="btn small" data-dzoom="0">Zurück</button>
      </div>
      <span class="ctl-hint">${
        TOUCH
          ? "Mit zwei Fingern aufziehen, Doppeltipp vergrößert. Vergrößert mit einem Finger verschieben, sonst wischen für die nächste Kamera."
          : "Digital im Browser, auch mit dem Mausrad an der Stelle, auf die du zeigst. Vergrößert per Ziehen verschieben."
      }</span>
    </div>`;
  const snap = `<div class="ctl-group"><span class="ctl-label">Bild</span><div class="ctl-row"><button type="button" class="btn small" data-cam="CAMERA_SNAPSHOT">${icon("snap")}Schnappschuss in die Cloud</button></div></div>`;

  if (c.kind === "DOORBIRD") {
    return `<div class="ctl-group"><span class="ctl-label">Tür</span><div class="ctl-row"><button type="button" class="btn primary" data-cam="DOORBIRD_OPEN">${icon("unlock")}Tür öffnen</button></div>
      ${c.hold ? `<span class="ctl-hint">Wird offen gehalten bis ${esc(clock(c.hold.until))}</span>` : ""}</div>${digital}${snap}`;
  }

  const k = c.caps;
  if (!k) {
    return `<div class="ctl-group"><span class="ctl-label">Steuerung</span><div class="ctl-loading"><div class="skeleton"></div><span class="ctl-hint">${
      c.reachable ? "Frage ab, was diese Kamera kann …" : "Kamera ist offline – Funktionen unbekannt."
    }</span></div></div>${digital}${snap}`;
  }

  const groups = [];
  if (k.pan || k.zoom) {
    groups.push(`<div class="ctl-group">
      <span class="ctl-label">${k.pan ? "Schwenken" : "Optischer Zoom"}</span>
      ${
        k.pan
          ? `<div class="dpad">
        <button type="button" class="btn" data-ptz="Up" aria-label="hoch">${icon("chev")}</button>
        <button type="button" class="btn" data-ptz="Left" aria-label="links">${icon("chev")}</button>
        <span class="center">${icon("target")}</span>
        <button type="button" class="btn" data-ptz="Right" aria-label="rechts">${icon("chev")}</button>
        <button type="button" class="btn" data-ptz="Down" aria-label="runter">${icon("chev")}</button>
      </div>`
          : ""
      }
      ${
        k.zoom
          ? `<div class="ctl-row">
        <button type="button" class="btn small" data-ptz="ZoomDec">${icon("minus")}Weit</button>
        <button type="button" class="btn small" data-ptz="ZoomInc">${icon("plus")}Nah</button>
      </div>`
          : ""
      }
      <span class="ctl-hint">Gedrückt halten fährt, loslassen stoppt.${k.pan ? " Pfeiltasten gehen auch." : ""}</span>
    </div>`);
  }
  if (k.presets || k.pan) {
    const presets = live.presets[c.id];
    groups.push(`<div class="ctl-group">
      <span class="ctl-label">Positionen</span>
      <div class="ctl-row" id="presetRow">${
        presets
          ? presets.length
            ? presets.map((p) => `<button type="button" class="btn small" data-preset="${esc(p.id)}">${esc(p.name)}</button>`).join("")
            : '<span class="ctl-hint">Keine Positionen gespeichert.</span>'
          : `<button type="button" class="btn small" data-presets-load>${icon("target")}Positionen laden</button>`
      }</div>
    </div>`);
  }
  const light = [];
  if (k.spotlight) {
    light.push(`<div class="ctl-row">
        <button type="button" class="btn small" data-cam="CAMERA_SPOTLIGHT" data-on="true">${icon("bulb")}Scheinwerfer an</button>
        <button type="button" class="btn small" data-cam="CAMERA_SPOTLIGHT" data-on="false">aus</button>
      </div>`);
  }
  if (k.ir) {
    light.push(`<div class="ctl-row">
        <button type="button" class="btn small" data-cam="CAMERA_IR" data-state="Auto">${icon("moon")}Infrarot auto</button>
        <button type="button" class="btn small" data-cam="CAMERA_IR" data-state="On">an</button>
        <button type="button" class="btn small" data-cam="CAMERA_IR" data-state="Off">aus</button>
      </div>`);
  }
  if (light.length) groups.push(`<div class="ctl-group"><span class="ctl-label">Licht</span>${light.join("")}</div>`);
  if (k.siren) {
    groups.push(`<div class="ctl-group">
      <span class="ctl-label">Sirene</span>
      <div class="ctl-row">
        <button type="button" class="btn small danger" data-cam="CAMERA_SIREN" data-on="true">${icon("siren")}Sirene auslösen</button>
        <button type="button" class="btn small" data-cam="CAMERA_SIREN" data-on="false">Stopp</button>
      </div>
    </div>`);
  }
  if (!groups.length) {
    groups.push(`<div class="ctl-group"><span class="ctl-label">Steuerung</span><span class="ctl-hint">Feste Kamera ohne Schwenken, Zoom, Scheinwerfer oder Sirene.</span></div>`);
  }
  if (k.source === "model") {
    groups.push(`<span class="ctl-hint">Funktionen aus der Modellliste geschätzt – die Kamera hat ihre Fähigkeiten nicht gemeldet.</span>`);
  }
  return groups.join("") + digital + snap;
}

async function camAction(type, payload, label, button) {
  if (button) button.disabled = true;
  try {
    const r = await shellyAction(type, payload);
    if (r.success) toast(`${label}: erledigt`, "ok");
    else toast(`${label}: ${r.error || "fehlgeschlagen"}`, "err");
    return r;
  } finally {
    if (button) button.disabled = false;
  }
}

/** Fahrimpuls; mit hold=true faehrt die Kamera bis ptzStop() (max. 5 s). */
function ptz(op, hold = false) {
  const c = focusCam();
  if (!c || c.kind === "DOORBIRD") return;
  const k = c.caps;
  const isZoom = op.startsWith("Zoom");
  if (k && ((isZoom && !k.zoom) || (!isZoom && !k.pan))) return;
  shellyAction("CAMERA_PTZ", {
    cameraId: c.id,
    op,
    speed: isZoom ? 16 : 32,
    durationMs: hold ? 5000 : isZoom ? 400 : 700,
  }).then((r) => {
    if (!r.success && !/Stop/.test(r.error || "")) toast(`${c.name}: ${r.error || "Schwenken fehlgeschlagen"}`, "err");
  });
}

function ptzStop() {
  const c = focusCam();
  if (!c || c.kind === "DOORBIRD") return;
  shellyAction("CAMERA_PTZ", { cameraId: c.id, op: "Stop" });
}

async function onCamControl(el) {
  const c = focusCam();
  if (!c) return;
  if (el.dataset.dzoom != null) {
    const step = Number(el.dataset.dzoom);
    return setZoom(step === 0 ? 1 : live.zoom.scale + step * 0.5);
  }
  if (el.dataset.preset) {
    return camAction("CAMERA_PTZ", { cameraId: c.id, op: "ToPos", presetId: Number(el.dataset.preset), speed: 32 }, `${c.name}: ${el.textContent.trim()}`, el);
  }
  if (el.hasAttribute("data-presets-load")) {
    el.disabled = true;
    const r = await shellyAction("CAMERA_PTZ_PRESETS", { cameraId: c.id });
    live.presets[c.id] = r.success ? r.result.presets || [] : [];
    if (!r.success) toast(`${c.name}: ${r.error || "Positionen nicht lesbar"}`, "err");
    $("camDlgControls").innerHTML = controlsHtml(c);
    return;
  }
  const type = el.dataset.cam;
  if (!type) return;
  if (type === "DOORBIRD_OPEN") {
    const ok = await ask("Tür öffnen?", `${c.name} löst das Türrelais sofort aus.`, "Öffnen");
    if (ok) camAction(type, { cameraId: c.id }, c.name, el);
    return;
  }
  if (type === "CAMERA_SIREN" && el.dataset.on === "true") {
    const ok = await ask("Sirene auslösen?", `Die Sirene von ${c.name} heult sofort laut los.`, "Auslösen");
    if (!ok) return;
  }
  const payload = { cameraId: c.id };
  if (el.dataset.on) payload.on = el.dataset.on === "true";
  if (el.dataset.state) payload.state = el.dataset.state;
  const label = { CAMERA_SPOTLIGHT: "Scheinwerfer", CAMERA_IR: "Infrarot", CAMERA_SIREN: "Sirene", CAMERA_SNAPSHOT: "Schnappschuss" }[type] || type;
  camAction(type, payload, `${c.name}: ${label}`, el);
}

$("liveGrid").addEventListener("click", (ev) => {
  const tile = ev.target.closest("[data-live]");
  if (tile) openFocus(Number(tile.dataset.live));
});
$("liveGrid").addEventListener("keydown", (ev) => {
  const tile = ev.target.closest("[data-live]");
  if (tile && (ev.key === "Enter" || ev.key === " ")) {
    ev.preventDefault();
    openFocus(Number(tile.dataset.live));
  }
});
$("liveCols").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-cols]");
  if (!b) return;
  live.cols = b.dataset.cols;
  storeSet("hub-live-cols2", live.cols);
  if (state.overview) renderZentrale(state.overview);
});
$("liveFull").addEventListener("click", toggleLiveFullscreen);
$("kioskExit").addEventListener("click", () => setKiosk(false));
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && live.kiosk && !$("camDlg").open) setKiosk(false);
});
window.addEventListener("resize", layoutGrid);
window.addEventListener("orientationchange", () => setTimeout(layoutGrid, 250));
document.addEventListener("fullscreenchange", () => setTimeout(layoutGrid, 50));
document.addEventListener("webkitfullscreenchange", () => setTimeout(layoutGrid, 50));

/* PTZ: gedrueckt halten faehrt, loslassen stoppt. */
let ptzHeld = null;
$("camDlgControls").addEventListener("pointerdown", (ev) => {
  const el = ev.target.closest("[data-ptz]");
  if (!el || ev.button > 0) return;
  ev.preventDefault();
  el.setPointerCapture?.(ev.pointerId);
  ptzHeld = { el, at: Date.now() };
  el.classList.add("is-on");
  ptz(el.dataset.ptz, true);
});
function endPtzHold() {
  if (!ptzHeld) return;
  const { el, at } = ptzHeld;
  ptzHeld = null;
  el.classList.remove("is-on");
  // Kurzer Tipp: ein Stueck fahren lassen, sonst sofort anhalten.
  setTimeout(ptzStop, Math.max(0, 450 - (Date.now() - at)));
}
$("camDlgControls").addEventListener("pointerup", endPtzHold);
$("camDlgControls").addEventListener("pointercancel", endPtzHold);
// Langes Druecken auf dem Telefon: kein Kontextmenue, keine Textauswahl.
$("camDlgControls").addEventListener("contextmenu", (ev) => {
  if (ev.target.closest("[data-ptz]")) ev.preventDefault();
});
$("camDlgControls").addEventListener("click", (ev) => {
  const el = ev.target.closest("button");
  if (el && !el.dataset.ptz) onCamControl(el);
});

/* Digitaler Zoom per Mausrad auf dem Bild. */
document.querySelector(".cam-stage").addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * 100;
    const y = ((ev.clientY - r.top) / r.height) * 100;
    setZoom(live.zoom.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), x, y);
  },
  { passive: false }
);

/*
 * Gesten auf dem Bild: zwei Finger zoomen, ein Finger verschiebt das
 * vergroesserte Bild (Maus: ziehen), Doppeltipp schaltet 1× ↔ 2,5×,
 * Wischen nach links/rechts wechselt die Kamera, solange nicht gezoomt ist.
 */
const gesture = { pts: new Map(), start: null, lastTap: 0, type: "mouse" };

function stagePoint(stage, ev) {
  const r = stage.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100, w: r.width, h: r.height };
}

function gestureSnapshot() {
  const p = [...gesture.pts.values()];
  const mid = p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : { x: p[0].x, y: p[0].y };
  const dist = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
  return { n: p.length, mid, dist, scale: live.zoom.scale, ox: live.zoom.x, oy: live.zoom.y, at: Date.now() };
}

const stageEl = document.querySelector(".cam-stage");
stageEl.addEventListener("pointerdown", (ev) => {
  if (ev.pointerType === "mouse" && ev.button > 0) return;
  gesture.type = ev.pointerType;
  stageEl.setPointerCapture?.(ev.pointerId);
  stageEl.classList.add("is-gesture");
  gesture.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  gesture.start = gestureSnapshot();
  gesture.start.first = { x: ev.clientX, y: ev.clientY };
  if (gesture.pts.size === 2 && live.zoom.scale === 1) {
    // Erstes Aufziehen: dort hineinzoomen, wo die Finger sind.
    const p = stagePoint(stageEl, { clientX: gesture.start.mid.x, clientY: gesture.start.mid.y });
    gesture.start.ox = Math.max(0, Math.min(100, p.x));
    gesture.start.oy = Math.max(0, Math.min(100, p.y));
  }
});
stageEl.addEventListener("pointermove", (ev) => {
  if (!gesture.pts.has(ev.pointerId) || !gesture.start) return;
  gesture.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const now = gestureSnapshot();
  const s = gesture.start;
  if (now.n >= 2 && s.n >= 2 && s.dist > 0) {
    setZoom(s.scale * (now.dist / s.dist), s.ox, s.oy);
    return;
  }
  if (now.n === 1 && s.n === 1 && live.zoom.scale > 1) {
    const r = stageEl.getBoundingClientRect();
    const k = live.zoom.scale - 1;
    const x = s.ox - ((now.mid.x - s.mid.x) / (r.width * k)) * 100;
    const y = s.oy - ((now.mid.y - s.mid.y) / (r.height * k)) * 100;
    setZoom(live.zoom.scale, Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
  }
});
function endGesture(ev) {
  if (!gesture.pts.has(ev.pointerId)) return;
  const s = gesture.start;
  gesture.pts.delete(ev.pointerId);
  if (gesture.pts.size) {
    // Ein Finger bleibt liegen: von hier aus weiter verschieben.
    gesture.start = gestureSnapshot();
    return;
  }
  gesture.start = null;
  stageEl.classList.remove("is-gesture");
  if (!s || s.n !== 1 || ev.type === "pointercancel") return;
  const dx = ev.clientX - s.first.x;
  const dy = ev.clientY - s.first.y;
  const quick = Date.now() - s.at < 600;
  if (live.zoom.scale === 1 && ev.pointerType !== "mouse" && quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    stepFocus(dx < 0 ? 1 : -1);
    return;
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && ev.pointerType !== "mouse") {
    const now = Date.now();
    if (now - gesture.lastTap < 300) {
      gesture.lastTap = 0;
      const p = stagePoint(stageEl, ev);
      if (live.zoom.scale > 1) setZoom(1, 50, 50);
      else setZoom(2.5, Math.max(0, Math.min(100, p.x)), Math.max(0, Math.min(100, p.y)));
    } else gesture.lastTap = now;
  }
}
stageEl.addEventListener("pointerup", endGesture);
stageEl.addEventListener("pointercancel", endGesture);
stageEl.addEventListener("dblclick", (ev) => {
  if (gesture.type !== "mouse") return; // Finger: Doppeltipp oben erledigt
  const p = stagePoint(stageEl, ev);
  if (live.zoom.scale > 1) setZoom(1, 50, 50);
  else setZoom(2.5, p.x, p.y);
});
stageEl.addEventListener("contextmenu", (ev) => ev.preventDefault());

$("camDlgPrev").addEventListener("click", () => stepFocus(-1));
$("camDlgNext").addEventListener("click", () => stepFocus(1));
$("camDlgClose").addEventListener("click", () => $("camDlg").close());
$("camDlg").addEventListener("close", () => {
  if (live.focusStop) live.focusStop();
  live.focusStop = null;
  live.focusId = null;
  delete $("camDlg").dataset.rtc;
  $("camDlgVideo").style.opacity = "0";
  setZoom(1, 50, 50);
});

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

/* Tastatur: 1–9 wechseln die Ansicht, "/" springt in den Gerätefilter. */
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if ($("camDlg").open) {
    if (ev.target && ev.target.closest && ev.target.closest("#confirmDlg")) return;
    const c = focusCam();
    const k = c && c.caps;
    if (ev.key === "PageDown" || ((ev.key === "ArrowRight" || ev.key === "ArrowLeft") && !(k && k.pan))) {
      ev.preventDefault();
      if (!ev.repeat) stepFocus(ev.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (ev.key === "PageUp") {
      ev.preventDefault();
      if (!ev.repeat) stepFocus(-1);
      return;
    }
    const dir = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", "+": "ZoomInc", "-": "ZoomDec" }[ev.key];
    if (dir) {
      ev.preventDefault();
      if (!ev.repeat) {
        ptzKey = ev.key;
        ptz(dir, true);
      }
    }
    return;
  }
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

let ptzKey = null;
document.addEventListener("keyup", (ev) => {
  if (ptzKey && ev.key === ptzKey) {
    ptzKey = null;
    ptzStop();
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
  if (document.hidden) {
    // Hintergrund-Tab: keine Videoverbindungen offen halten.
    stopLive();
  } else {
    refresh();
  }
});

renderEventFilter();
applyRoute();
scheduleTick();
