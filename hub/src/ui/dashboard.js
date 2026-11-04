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
  "raeume",
  "geraete",
  "regeln",
  "systeme",
  "netzwerk",
  "kameras",
  "ereignisse",
  "personen",
  "fahrzeuge",
  "aktionen",
  "maeher",
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
  /** Raeume aus der Cloud plus Live-Zustand der Shellys (GET /api/rooms). */
  rooms: null,
  roomBuilding: "alle",
  /** Geraete-IDs, deren Schaltbefehl gerade laeuft. */
  roomBusy: new Set(),
  /** Automatisch gefundene steuerbare Geraete (GET /api/smart). */
  smart: null,
  smartVendor: "alle",
  smartBusy: new Set(),
  /** Regeln aus der Cloud (GET /api/rules -> /api/regeln). */
  rules: null,
  rulesError: null,
  /** Shelly-Status je IP (per SHELLY_STATUS geholt). */
  shelly: {},
  /** Mammotion-Maeher (GET /api/mower) und ihre Karten je Name. */
  mower: null,
  mowerMaps: {},
  mowerMapsAt: 0,
  mowerBusy: new Set(),
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
    const wantRooms = state.view === "raeume";
    const [overview, events, network, improve, rooms] = await Promise.all([
      getJson("/api/overview"),
      getJson(`/api/events?since=${state.eventSeq}`),
      wantNet ? getJson("/api/network") : null,
      wantImprove ? getJson("/api/improve?events=0") : null,
      wantRooms ? getJson("/api/rooms?live=1") : (state.view === "geraete" || state.view === "regeln") && !state.rooms ? getJson("/api/rooms") : null,
    ]);
    if (rooms) state.rooms = rooms;
    if (state.view === "geraete") state.smart = await getJson("/api/smart");
    if (state.view === "maeher") await loadMower();
    // Geraete und Raeume zeigen die Maeher mit, ohne Karte.
    else if (state.view === "geraete" || state.view === "raeume") await loadMowerStatus();
    if (state.view === "regeln" && (!state.rules || Date.now() - (state.rulesAt || 0) > 30000)) await loadRules();
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
    case "raeume": renderRaeume(d); break;
    case "geraete": renderGeraete(); break;
    case "regeln": renderRegeln(d); break;
    case "systeme": renderSysteme(d); break;
    case "netzwerk": renderNetzwerk(); break;
    case "kameras": renderKameras(d); break;
    case "ereignisse": renderEreignisse(); break;
    case "personen": renderPersonen(d); break;
    case "fahrzeuge": renderFahrzeuge(d); break;
    case "aktionen": renderAktionen(d); break;
    case "maeher": renderMaeher(); break;
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
  const roomsOn = state.rooms && state.rooms.live ? Object.values(state.rooms.live).filter((l) => l.on === true).length : 0;
  set("raeume", roomsOn, "ok");
  set("geraete", state.smart ? state.smart.devices.filter((x) => x.needsPairing).length : 0, "warn");
  const mowing = state.mower ? state.mower.mowers.filter((m) => m.active).length : 0;
  const mowerErr = state.mower ? state.mower.mowers.filter((m) => m.errors && m.errors.length).length : 0;
  set("maeher", mowerErr || mowing, mowerErr ? "warn" : "ok");
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

function frameUrl(src, cached = false) {
  return `/api/go2rtc/frame.jpeg?src=${encodeURIComponent(src)}${cached ? "&cached=1" : ""}&t=${Date.now()}`;
}

/*
 * Vorschaubilder. Der Hub haelt pro Stream das letzte gute Bild bereit
 * (cached=1 kommt sofort, auch wenn go2rtc gerade haengt). Hier im
 * Browser bleibt das letzte Bild pro Kamera als Blob-URL, damit neu
 * gebaute Kacheln (Rueckkehr in die App, Tab-Wechsel) sofort ein Bild
 * zeigen statt "Verbinde …". Ein fehlgeschlagener Abruf aendert nichts
 * am angezeigten Bild – kein kaputtes Bild-Symbol mehr.
 */
const frameCache = new Map();

async function loadFrame(img, src, cacheKey, cached) {
  if (img.dataset.loading === "1") return false;
  img.dataset.loading = "1";
  try {
    const res = await fetch(frameUrl(src, cached), { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") || "").startsWith("image/")) return false;
    const age = Number(res.headers.get("x-frame-age"));
    const blob = await res.blob();
    if (!blob.size) return false;
    const url = URL.createObjectURL(blob);
    const at = Number.isFinite(age) && age >= 0 ? Date.now() - age * 1000 : 0;
    const prev = img.dataset.blob;
    img.src = url;
    img.dataset.blob = url;
    img.dataset.at = String(at);
    if (cacheKey != null) {
      const old = frameCache.get(cacheKey);
      frameCache.set(cacheKey, { url, at });
      if (old && old.url !== url && old.url !== prev) setTimeout(() => URL.revokeObjectURL(old.url), 5000);
    }
    if (prev && prev !== url && (cacheKey == null || prev !== frameCache.get(cacheKey)?.url)) {
      setTimeout(() => URL.revokeObjectURL(prev), 5000);
    }
    return true;
  } catch {
    return false;
  } finally {
    delete img.dataset.loading;
  }
}

/** "2 min" fuer das Alter eines Standbilds, leer wenn frisch. */
function frameAge(at) {
  if (!at) return "";
  const s = (Date.now() - at) / 1000;
  if (s < 45) return "";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
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
  const pic = frameCache.get(c.id);
  return `<article class="live-tile${live.wide.has(c.id) ? " is-wide" : ""}${pic ? " has-picture" : ""}" data-live="${c.id}" tabindex="0" role="button" aria-label="${esc(c.name)} groß anzeigen">
    <img alt=""${pic ? ` src="${pic.url}" data-blob="${pic.url}" data-at="${pic.at}"` : ""}>
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
  const age = isLive ? "" : frameAge(Number(tile.querySelector("img").dataset.at || 0));
  tag.textContent = isLive ? "LIVE" : age ? `BILD · ${age}` : "BILD";
  tag.title = isLive ? "Livebild" : tile.dataset.rtc === "connecting" ? "Letztes Bild, Livebild verbindet …" : "Standbild";
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
  const img = tile.querySelector("img");
  img.onload = () => {
    tile.classList.add("has-picture");
    setTileMode(tile);
    markWide(c.id, img.naturalWidth, img.naturalHeight);
  };
  if (visible && !live.peers.has(c.id)) {
    const video = tile.querySelector("video");
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
  // Erst das gemerkte Bild vom Hub (sofort), danach frische.
  const last = Number(tile.dataset.frameAt || 0);
  const wait = !visible ? 60000 : tile.dataset.rtc === "error" ? 5000 : 20000;
  if (!tile.classList.contains("is-live") && Date.now() - last > (last ? wait : 0)) {
    tile.dataset.frameAt = String(Date.now());
    loadFrame(img, src, c.id, !last).then((ok) => {
      if (ok) setTileMode(tile);
    });
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
  // Sofort das Kachelbild zeigen, das grosse Bild laedt dahinter nach.
  const pic = frameCache.get(c.id);
  if (img.dataset.blob && img.dataset.blob !== pic?.url) URL.revokeObjectURL(img.dataset.blob);
  delete img.dataset.blob;
  if (pic) img.src = pic.url;
  else img.removeAttribute("src");
  video.style.opacity = "0";
  if (live.focusStop) live.focusStop();
  live.focusStop = null;
  delete dlg.dataset.rtc;
  const src = streamFor(c, "main");
  if (src) {
    const want = c.id;
    // Erst das gemerkte Hauptbild (sofort), dann ein frisches.
    loadFrame(img, src, null, true).then(() => {
      if (live.focusId === want && $("camDlg").dataset.rtc !== "live") loadFrame(img, src, null, false);
    });
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
  const vc = n.vlanCheck || { hosts: [], confirmed: [] };
  const vlanByHost = {};
  for (const h of vc.hosts || []) vlanByHost[h.host] = h;
  const vlanLine = (host) => {
    const h = vlanByHost[host];
    if (!h) return "";
    if (!h.ok) return "";
    if (!h.issues.length) return `<div class="line"><span class="k">VLAN-Prüfung</span><span class="v">${badge("ok", "Soll = Ist")}</span></div>`;
    return `<div class="line"><span class="k">VLAN-Prüfung</span><span class="v">${badge("alert", `${h.issues.length} Befund${h.issues.length === 1 ? "" : "e"}`)}</span></div>${h.issues
      .map((m) => `<div class="line"><span class="v muted">${esc(m)}</span></div>`)
      .join("")}`;
  };
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
        ${vlanLine(s.host)}
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

  renderVehicleSettings();
}

/* -------------------------------------------------- Fahrzeug-Einstellungen */

const veh = {
  loadedAt: 0,
  loading: false,
  det: null,
  detError: null,
  vehicles: null,
  cameras: [],
  shellys: [],
  error: null,
  editing: null,
  zone: null,
};

/** Fehlertext aus Hub/Cloud-Antwort (String oder zod-Fehlerobjekt). */
function errText(body, status) {
  const e = body && body.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const parts = [...(e.formErrors || [])];
    for (const [k, v] of Object.entries(e.fieldErrors || {})) parts.push(`${k}: ${[].concat(v).join(", ")}`);
    if (parts.length) return parts.join(" · ");
  }
  return `HTTP ${status}`;
}

async function sendJson(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errText(data, res.status));
  return data;
}

async function loadVehicleSettings(force = false) {
  if (veh.loading || (!force && Date.now() - veh.loadedAt < 60_000)) return;
  veh.loading = true;
  const [det, list] = await Promise.allSettled([
    getJson("/api/detection"),
    sendJson("GET", "/api/detection/vehicles"),
  ]);
  if (det.status === "fulfilled") {
    veh.det = det.value;
    veh.detError = null;
  } else veh.detError = det.reason.message;
  if (list.status === "fulfilled") {
    veh.vehicles = list.value.vehicles || [];
    veh.cameras = list.value.cameras || [];
    veh.shellys = list.value.shellys || [];
    veh.error = null;
  } else veh.error = list.reason.message;
  veh.loadedAt = Date.now();
  veh.loading = false;
  if (state.view === "fahrzeuge") renderVehicleSettings();
}

function vehicleActionText(v) {
  const parts = [];
  if (v.doorbird) parts.push(`Tor ${v.doorbird.name}`);
  if (v.shellyDevice) {
    const verb = { ON: "an", OFF: "aus", TOGGLE: "umschalten" }[v.shellyAction] || v.shellyAction;
    parts.push(`${v.shellyDevice.name} ${verb}${v.timerSeconds ? ` (${v.timerSeconds} s)` : ""}`);
  }
  return parts.length ? parts.join(" + ") : "nur melden";
}

function envValue(key) {
  const row = veh.det?.env?.find((e) => e.key === key);
  return row ? row.value : null;
}

function zoneButton(field, zone) {
  const n = Array.isArray(zone) ? zone.length : 0;
  return `<button type="button" class="btn small" data-det-zone="${field}">${icon("target")}${n ? `${n} Punkte` : "keine"}</button>`;
}

function detCardHtml(c) {
  const envArea = Number(envValue("HUB_VEHICLE_MIN_AREA"));
  const defArea = Number.isFinite(envArea) && envValue("HUB_VEHICLE_MIN_AREA") !== null ? envArea : 0.02;
  const area = c.vehicleMinArea == null ? "" : String(Math.round(c.vehicleMinArea * 1000) / 10);
  const defMin = envValue("HUB_NOPARK_MINUTES") || "2";
  return `<article class="card det-card" data-det="${c.id}">
    <div class="det-head"><span class="tile-ico accent">${icon("camera")}</span><h3 title="${esc(c.name)}">${esc(c.name)}</h3></div>
    <div class="det-block ${c.vehicleDetection ? "" : "is-off"}">
      <div class="det-row"><label class="tgl"><input type="checkbox" data-det-field="vehicleDetection" ${c.vehicleDetection ? "checked" : ""}><span class="knob"></span>Fahrzeugerkennung</label></div>
      <div class="det-row"><span class="k">Mindestgröße</span><span class="unit"><input class="field" type="number" inputmode="decimal" min="0" max="50" step="0.5" data-det-field="vehicleMinArea" value="${esc(area)}" placeholder="${esc(Math.round(defArea * 1000) / 10)}" aria-label="Mindestgröße in Prozent">%</span></div>
      <div class="det-row"><span class="k">Einfahrtszone</span>${zoneButton("vehicleZone", c.vehicleZone)}</div>
    </div>
    <div class="det-block ${c.deliveryMode ? "" : "is-off"}">
      <div class="det-row"><span class="k">Lieferdienste</span><select class="field" data-det-field="deliveryMode" aria-label="Lieferdienste">${[["", "Aus"], ["NOTIFY", "Melden"], ["OPEN", "Tor öffnen"]]
        .map(([v, l]) => `<option value="${v}"${(c.deliveryMode || "") === v ? " selected" : ""}>${l}</option>`)
        .join("")}</select></div>
      <div class="det-row"><span class="k">Öffnen von–bis</span><span class="unit"><input class="field" type="time" data-det-field="deliveryFrom" value="${esc(c.deliveryFrom || "")}" aria-label="Öffnen ab"><input class="field" type="time" data-det-field="deliveryTo" value="${esc(c.deliveryTo || "")}" aria-label="Öffnen bis"></span></div>
    </div>
    <div class="det-block ${c.noParkDetection ? "" : "is-off"}">
      <div class="det-row"><label class="tgl"><input type="checkbox" data-det-field="noParkDetection" ${c.noParkDetection ? "checked" : ""}><span class="knob"></span>Halteverbot</label></div>
      <div class="det-row"><span class="k">Standzeit</span><span class="unit"><input class="field" type="number" inputmode="decimal" min="0.25" max="240" step="0.25" data-det-field="noParkMinutes" value="${esc(c.noParkMinutes ?? "")}" placeholder="${esc(defMin)}" aria-label="Standzeit in Minuten">min</span></div>
      <div class="det-row"><span class="k">Gesperrte Fläche</span>${zoneButton("noParkZone", c.noParkZone)}</div>
    </div>
  </article>`;
}

function renderVehicleSettings() {
  loadVehicleSettings();

  $("vehAdd").disabled = !veh.vehicles;
  $("vehHint").textContent = veh.error
    ? `Cloud nicht erreichbar (${veh.error}). Die Liste zeigt den zuletzt geladenen Stand.`
    : "Erkannte Kennzeichen öffnen das Tor oder schalten einen Shelly.";

  if (veh.vehicles) {
    setHTML(
      "wlRows",
      veh.vehicles.length
        ? veh.vehicles
            .map(
              (v) => `<tr class="${v.isActive ? "" : "is-off"}">
        <td data-label="Kennzeichen"><span class="mono"><strong>${esc(v.plate)}</strong></span>${v.isActive ? "" : ` ${badge("off", "inaktiv")}`}</td>
        <td data-label="Name"><div>${esc(v.name)}${v.notes ? `<div class="muted">${esc(v.notes)}</div>` : ""}</div></td>
        <td data-label="Aktion"><span>${esc(vehicleActionText(v))}</span></td>
        <td data-label="Kamera"><span class="muted">${esc(v.camera ? v.camera.name : "alle")}</span></td>
        <td data-label="Cooldown"><span>${esc(v.cooldownMinutes)} min</span></td>
        <td data-label="Zuletzt"><span class="muted">${esc(v.lastTriggeredAt ? ago(v.lastTriggeredAt) : "nie")}</span></td>
        <td data-label=""><div class="row-btns"><button type="button" class="btn small" data-veh-edit="${v.id}">Bearbeiten</button></div></td>
      </tr>`
            )
            .join("")
        : `<tr><td colspan="7">${empty("Noch keine freigegebenen Fahrzeuge.")}</td></tr>`
    );
  } else {
    setHTML(
      "wlRows",
      `<tr><td colspan="7">${empty(veh.error ? `Cloud nicht erreichbar: ${veh.error}` : "Lade Fahrzeuge …")}</td></tr>`
    );
  }

  const cams = veh.det?.cameras || [];
  setHTML(
    "detGrid",
    cams.length
      ? cams.map(detCardHtml).join("")
      : empty(veh.detError ? `Einstellungen nicht lesbar: ${veh.detError}` : "Keine Kameras konfiguriert.")
  );

  setHTML(
    "envRows",
    (veh.det?.env || [])
      .map(
        (e) => `<div class="env-row"><span class="k">${esc(e.label)}<small>${esc(e.key)}</small></span>${
          e.value === null
            ? `<span class="v default">${esc(e.fallback)}</span>`
            : `<span class="v mono">${esc(e.value)}</span>`
        }</div>`
      )
      .join("")
  );
}

async function saveDetection(camId, patch, input) {
  const cam = veh.det?.cameras.find((c) => c.id === camId);
  if (!cam) return;
  try {
    const saved = await sendJson("PATCH", `/api/detection/cameras/${camId}`, patch);
    for (const k of Object.keys(saved)) if (k in cam) cam[k] = saved[k];
    toast(`${cam.name}: gespeichert`, "ok");
  } catch (e) {
    toast(`${cam.name}: ${e.message}`, "err");
    if (input && input.type === "checkbox") input.checked = !input.checked;
  }
  htmlCache.delete("detGrid");
  renderVehicleSettings();
}

$("detGrid").addEventListener("change", (ev) => {
  const input = ev.target.closest("[data-det-field]");
  const card = ev.target.closest("[data-det]");
  if (!input || !card) return;
  const field = input.dataset.detField;
  let value;
  if (input.type === "checkbox") value = input.checked;
  else if (input.value.trim() === "") value = null;
  else if (input.tagName === "SELECT" || input.type === "time") value = input.value;
  else {
    value = Number(input.value.replace(",", "."));
    if (!Number.isFinite(value)) return toast("Bitte eine Zahl eingeben", "err");
    if (field === "vehicleMinArea") value = Math.round(value * 10) / 1000;
  }
  saveDetection(Number(card.dataset.det), { [field]: value }, input);
});

$("detGrid").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-det-zone]");
  const card = ev.target.closest("[data-det]");
  if (btn && card) openZone(Number(card.dataset.det), btn.dataset.detZone);
});

/* Zonen-Editor: Punkte aufs Kamerabild klicken, normiert 0..1. */

function drawZone() {
  const z = veh.zone;
  if (!z) return;
  const pts = z.points;
  $("zoneSvg").innerHTML = pts.length >= 2 ? `<polygon points="${pts.map((p) => p.join(",")).join(" ")}"/>` : "";
  const stage = $("zoneStage");
  stage.querySelectorAll(".zone-pt").forEach((el) => el.remove());
  for (const [x, y] of pts) {
    const dot = document.createElement("span");
    dot.className = "zone-pt";
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
    stage.appendChild(dot);
  }
  $("zoneUndo").disabled = !z.history.length;
  $("zoneMsg").textContent = z.imgError
    ? `Kein Kamerabild (${z.imgError}). Punkte lassen sich trotzdem setzen.`
    : pts.length < 3
      ? `${pts.length} von mindestens 3 Punkten gesetzt`
      : `${pts.length} Punkte`;
}

function openZone(camId, field) {
  const cam = veh.det?.cameras.find((c) => c.id === camId);
  if (!cam) return;
  const nopark = field === "noParkZone";
  veh.zone = { camId, field, points: (cam[field] || []).map((p) => [p[0], p[1]]), history: [], imgError: null };
  $("zoneDlgTitle").textContent = `${cam.name}: ${nopark ? "Gesperrte Fläche" : "Einfahrtszone"}`;
  $("zoneDlgHint").textContent = nopark
    ? "Klicke die Ecken der Halteverbot-Fläche ins Bild. Gezählt wird, wo das Fahrzeug auf dem Boden steht."
    : "Klicke die Ecken der Einfahrt ins Bild. Es zählen nur Fahrzeuge, deren Mitte in der Zone liegt. Ohne Zone zählt das ganze Bild.";
  const stage = $("zoneStage");
  stage.classList.toggle("nopark", nopark);
  stage.style.aspectRatio = "16 / 9";
  const img = $("zoneImg");
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight) stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    veh.zone && (veh.zone.imgError = null);
    drawZone();
  };
  img.onerror = () => {
    if (veh.zone) veh.zone.imgError = "Kamera antwortet nicht";
    drawZone();
  };
  img.src = `/api/detection/cameras/${camId}/snapshot.jpg?t=${Date.now()}`;
  drawZone();
  $("zoneDlg").showModal();
}

$("zoneStage").addEventListener("click", (ev) => {
  const z = veh.zone;
  if (!z) return;
  if (z.points.length >= 32) return toast("Höchstens 32 Punkte", "err");
  const r = $("zoneStage").getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
  const pt = [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  // Ab drei Punkten an der Kante einfügen, die den Umfang am wenigsten
  // verlängert – so entsteht beim Nachbessern kein verdrehtes Polygon.
  const pts = z.points;
  z.history.push(pts.map((p) => [...p]));
  if (pts.length >= 3) {
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let best = pts.length;
    let cost = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const c = dist(a, pt) + dist(pt, b) - dist(a, b);
      if (c < cost) {
        cost = c;
        best = i + 1;
      }
    }
    pts.splice(best, 0, pt);
  } else pts.push(pt);
  drawZone();
});
$("zoneUndo").addEventListener("click", () => {
  if (veh.zone?.history.length) veh.zone.points = veh.zone.history.pop();
  drawZone();
});
$("zoneClear").addEventListener("click", () => {
  if (!veh.zone || !veh.zone.points.length) return;
  veh.zone.history.push(veh.zone.points);
  veh.zone.points = [];
  drawZone();
});
$("zoneCancel").addEventListener("click", () => $("zoneDlg").close());
$("zoneDlg").addEventListener("close", () => {
  veh.zone = null;
  $("zoneImg").removeAttribute("src");
});
$("zoneSave").addEventListener("click", async () => {
  const z = veh.zone;
  if (!z) return;
  if (z.points.length > 0 && z.points.length < 3) return toast("Eine Zone braucht mindestens 3 Punkte", "err");
  const patch = { [z.field]: z.points.length ? z.points : null };
  // Ohne Fläche kann das Halteverbot nicht prüfen – dann mit ausschalten.
  if (z.field === "noParkZone" && !z.points.length) patch.noParkDetection = false;
  const btn = $("zoneSave");
  btn.disabled = true;
  await saveDetection(z.camId, patch);
  btn.disabled = false;
  $("zoneDlg").close();
});

/* Fahrzeug anlegen / bearbeiten */

function fillSelect(sel, items, emptyLabel, value) {
  sel.innerHTML =
    `<option value="">${esc(emptyLabel)}</option>` +
    items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  sel.value = value == null ? "" : String(value);
}

function openVehicle(v) {
  veh.editing = v ? v.id : null;
  const f = $("vehForm");
  f.reset();
  $("vehDlgTitle").textContent = v ? `${v.plate} bearbeiten` : "Fahrzeug hinzufügen";
  $("vehErr").hidden = true;
  $("vehDelete").hidden = !v;
  const cams = veh.cameras.filter((c) => c.kind !== "DOORBIRD");
  const birds = veh.cameras.filter((c) => c.kind === "DOORBIRD");
  fillSelect(f.elements.cameraId, cams, "Alle Kameras", v?.cameraId);
  fillSelect(f.elements.doorbirdCameraId, birds, "Kein Tor", v?.doorbirdCameraId);
  fillSelect(f.elements.shellyDeviceId, veh.shellys, "Kein Shelly", v?.shellyDeviceId);
  f.elements.plate.value = v?.plate || "";
  f.elements.name.value = v?.name || "";
  f.elements.shellyAction.value = v?.shellyAction || "ON";
  f.elements.timerSeconds.value = v?.timerSeconds ?? "";
  f.elements.cooldownMinutes.value = v?.cooldownMinutes ?? 2;
  f.elements.notes.value = v?.notes || "";
  f.elements.isActive.checked = v ? v.isActive : true;
  f.elements.notifyOnDetection.checked = v ? v.notifyOnDetection : false;
  $("vehDlg").showModal();
  f.elements.plate.focus();
}

$("vehAdd").addEventListener("click", () => openVehicle(null));
$("wlRows").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-veh-edit]");
  if (!btn) return;
  const v = veh.vehicles?.find((x) => x.id === Number(btn.dataset.vehEdit));
  if (v) openVehicle(v);
});

$("vehCancel").addEventListener("click", () => $("vehDlg").close());
$("vehForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const idOrNull = (el) => (el.value ? Number(el.value) : null);
  const payload = {
    plate: f.elements.plate.value.trim(),
    name: f.elements.name.value.trim(),
    cameraId: idOrNull(f.elements.cameraId),
    doorbirdCameraId: idOrNull(f.elements.doorbirdCameraId),
    shellyDeviceId: idOrNull(f.elements.shellyDeviceId),
    shellyAction: f.elements.shellyAction.value,
    timerSeconds: f.elements.timerSeconds.value ? Number(f.elements.timerSeconds.value) : null,
    cooldownMinutes: Number(f.elements.cooldownMinutes.value) || 2,
    notes: f.elements.notes.value.trim() || null,
    isActive: f.elements.isActive.checked,
    notifyOnDetection: f.elements.notifyOnDetection.checked,
  };
  const btn = $("vehSave");
  btn.disabled = true;
  try {
    if (veh.editing) await sendJson("PUT", `/api/detection/vehicles/${veh.editing}`, payload);
    else await sendJson("POST", "/api/detection/vehicles", payload);
    $("vehDlg").close();
    toast(`${payload.plate} gespeichert`, "ok");
    await loadVehicleSettings(true);
  } catch (e) {
    $("vehErr").textContent = e.message;
    $("vehErr").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$("vehDelete").addEventListener("click", async () => {
  const v = veh.vehicles?.find((x) => x.id === veh.editing);
  if (!v) return;
  if (!(await ask(`${v.plate} löschen?`, `${v.name} wird nicht mehr erkannt und öffnet nichts mehr.`, "Löschen"))) return;
  try {
    await sendJson("DELETE", `/api/detection/vehicles/${v.id}`);
    $("vehDlg").close();
    toast(`${v.plate} gelöscht`, "ok");
    await loadVehicleSettings(true);
  } catch (e) {
    $("vehErr").textContent = e.message;
    $("vehErr").hidden = false;
  }
});

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

/* ------------------------------------------------------------------ Raeume */

/*
 * Raum-Steuerung: Stand kommt aus der Cloud (Raeume, Geraete, Regeln), der
 * Hub schaltet Shellys direkt im LAN und reicht den Rest an die Cloud weiter
 * (rooms.ts). Jede Kachel zeigt nur die Knoepfe, die das Geraet versteht.
 */

const TRIGGER_LABELS = {
  TIME: "Uhrzeit",
  OPENING: "Betriebsbeginn",
  CLOSING: "Betriebsende",
  SUNRISE: "Sonnenaufgang",
  SUNSET: "Sonnenuntergang",
  MOTION: "Bewegung",
  DEVICE_SWITCHED: "Gerät geschaltet",
  SCAN: "Zutritt",
  IDLE: "Keine Bewegung",
};

const CATEGORY_LABELS = {
  DREHKREUZ: "Drehkreuz",
  TUER: "Tür",
  SENSOR: "Sensor",
  SCHALTER: "Schalter",
  BELEUCHTUNG: "Licht",
  AUDIO: "Audio",
  MARKISE: "Markise",
  ROLLTOR: "Rolltor",
  TASTER: "Taster",
};

const TYPE_LABELS = {
  SHELLY: "Shelly",
  NUKI_SMARTLOCK: "Nuki",
  LOQED_SMARTLOCK: "LOQED",
  HUE_LIGHT: "Philips Hue",
  MAMMOTION_MOWER: "Mammotion",
  GARDENA_VALVE: "Gardena",
  AUDIO_PLAYER: "Audio-Player",
  RASPBERRY_PI: "Scanner-Pi",
};

/** Bedienart eines Geraets – entscheidet Knoepfe, Icon und Rueckfrage. */
function devKind(dev) {
  const cat = dev.category || "";
  if (dev.type === "MAMMOTION_MOWER") return "mower";
  if (dev.type === "NUKI_SMARTLOCK" || dev.type === "LOQED_SMARTLOCK") return "lock";
  if (dev.type === "GARDENA_VALVE") return "valve";
  if (dev.type === "HUE_LIGHT") return "toggle";
  if (dev.type === "AUDIO_PLAYER" || cat === "AUDIO") return "audio";
  if (cat === "MARKISE" || cat === "ROLLTOR") return "cover";
  if (cat === "SENSOR") return "sensor";
  if (dev.type === "SHELLY" && cat === "TASTER") return "pulse";
  if (dev.type === "SHELLY" && (cat === "SCHALTER" || cat === "BELEUCHTUNG")) return "toggle";
  return "door";
}

const KIND_ICON = {
  lock: "lock",
  valve: "drop",
  audio: "speaker",
  cover: "blinds",
  sensor: "activity",
  pulse: "zap",
  toggle: "bulb",
  door: "door",
  mower: "leaf",
};

function devButtons(dev, kind, live) {
  const b = (action, label, cls = "") =>
    `<button type="button" class="btn small ${cls}" data-dev="${dev.id}" data-dev-action="${action}"${state.roomBusy.has(dev.id) ? " disabled" : ""}>${esc(label)}</button>`;
  switch (kind) {
    case "toggle":
      return live && live.on ? b("deactivate", "Ausschalten", "on") : b("open", "Einschalten", "primary");
    case "pulse":
      return b("open", `Auslösen (${dev.pulseSeconds || 30} s)`, "primary");
    case "cover":
      return b("open", "Auf") + b("stop", "Stopp") + b("close", "Zu");
    case "lock":
      return b("open", "Öffnen", "primary") + b("deactivate", "Abschließen");
    case "valve":
      return b("open", "Bewässern", "primary") + b("deactivate", "Stoppen");
    case "audio":
      return b("open", "Abspielen", "primary") + b("stop", "Stopp");
    case "sensor":
      return "";
    case "mower":
      return `<a class="btn small" href="#maeher">Steuern</a>`;
    default:
      return b("open", "Öffnen", "primary");
  }
}

function devTile(dev, liveMap) {
  const kind = devKind(dev);
  const live = liveMap ? liveMap[dev.id] : null;
  const what = [CATEGORY_LABELS[dev.category] || null, TYPE_LABELS[dev.type] || dev.type].filter(Boolean).join(" · ");
  let status = "";
  if (dev.local && live) {
    if (!live.reachable) status = badge("warn", "nicht erreichbar");
    else if (live.on === true) status = badge("ok", live.powerW != null && live.powerW > 0 ? `an · ${num(live.powerW, 0)} W` : "an");
    else if (live.on === false) status = badge("idle", "aus");
  }
  const via = dev.local ? badge("outline", "LAN") : badge("outline", "Cloud");
  if (kind === "mower") {
    const m = state.mower && state.mower.mowers ? state.mower.mowers.find((x) => x.name === dev.mowerName) : null;
    if (m) status = mowerChips(m);
  }
  const on = kind === "mower" ? !!(state.mower && state.mower.mowers && state.mower.mowers.some((x) => x.name === dev.mowerName && x.active)) : live && live.on === true;
  return `<div class="dev ${on ? "is-on" : ""}">
    <span class="tile-ico ${on ? "ok" : "accent"}">${icon(KIND_ICON[kind] || "dot")}</span>
    <div class="dev-main">
      <div class="dev-name">${esc(dev.name)}</div>
      <div class="dev-meta"><span class="muted">${esc(what)}</span>${status}${via}</div>
    </div>
    <div class="dev-actions">${devButtons(dev, kind, live)}</div>
  </div>`;
}

function roomCard(room, liveMap, camIds) {
  const head = [room.number, room.floor ? `Etage ${room.floor}` : null].filter(Boolean).join(" · ");
  const op = room.operating
    ? badge(room.operating.open ? "ok" : "idle", room.operating.open ? `geöffnet · ${room.operating.name}` : `geschlossen · ${room.operating.name}`)
    : "";
  const devices = room.devices.length
    ? room.devices.map((dev) => devTile(dev, liveMap)).join("")
    : '<div class="muted small-note">Keine Geräte zugeordnet.</div>';
  const cams = room.cameras.length
    ? `<div class="chips">${room.cameras
        .map((c) =>
          camIds.has(c.id)
            ? `<button type="button" class="btn small" data-room-cam="${c.id}">${icon("camera")}${esc(c.name)}</button>`
            : `<span class="badge outline">${esc(c.name)}</span>`
        )
        .join("")}</div>`
    : "";
  const zones = room.audioZones.length
    ? `<div class="line"><span class="k">Beschallung</span><span class="v">${room.audioZones.map((z) => esc(z.name)).join(", ")}</span></div>`
    : "";
  const activeRules = room.rules.filter((r) => r.isActive).length;
  const rules = room.rules.length
    ? `<details class="rules"><summary>${icon("zap")}${room.rules.length} Regel${room.rules.length === 1 ? "" : "n"}${
        activeRules < room.rules.length ? ` <span class="muted">(${activeRules} aktiv)</span>` : ""
      }</summary><ul>${room.rules
        .map(
          (r) =>
            `<li><span class="${r.isActive ? "" : "muted"}">${esc(r.name)}</span><span class="muted">${esc(TRIGGER_LABELS[r.trigger] || r.trigger)}${
              r.lastRunAt ? ` · zuletzt ${esc(ago(r.lastRunAt))}` : ""
            }</span></li>`
        )
        .join("")}</ul></details>`
    : "";
  const cl = room.climate;
  const fmtC = (v) => (v == null ? "–" : `${num(v, 1)} °C`);
  const climate = cl
    ? `<div class="climate${cl.lastError ? " err" : cl.heating ? " on" : ""}">
        <span class="climate-temp">${fmtC(cl.lastTempC)}</span>
        <span class="muted">${
          !cl.isActive
            ? "Regelung pausiert"
            : `Soll ${cl.currentTargetC == null ? "aus" : fmtC(cl.currentTargetC)} · ${cl.heating ? "heizt" : "Heizung aus"}`
        }${cl.lastReadAt ? ` · gemessen ${esc(ago(cl.lastReadAt))}` : ""}</span>
        ${cl.lastError ? `<span class="climate-err">${esc(cl.lastError)}</span>` : ""}
      </div>`
    : "";
  return `<article class="card room">
    <div class="place-head"><span class="tile-ico accent">${icon("home")}</span><h3>${esc(room.name)}</h3>${head ? `<span class="host">${esc(head)}</span>` : ""}</div>
    ${op ? `<div class="chips">${op}</div>` : ""}
    ${climate}
    <div class="devs">${devices}</div>
    ${cams}${zones}${rules}
  </article>`;
}

/** Wer fuehrt die Regeln gerade aus: Cloud (normal) oder Hub (Notbetrieb). */
function ruleStatusHtml(st) {
  if (!st) return "";
  const recent = (st.recent || [])
    .slice(0, 5)
    .map((x) => `<li><span>${esc(x.rule)}</span><span class="muted">${esc(clock(x.at))} · ${x.success ? "ok" : esc(x.error || "Fehler")}</span></li>`)
    .join("");
  if (st.mode === "hub") {
    return `<div class="banner" role="status">${icon("alert")}<div><strong>Notbetrieb:</strong> Die Cloud ist nicht erreichbar${
      st.offlineSince ? ` (seit ${esc(clock(st.offlineSince))})` : ""
    }, der Hub führt ${st.rules} Regeln selbst aus. Er schaltet nur Geräte im LAN; Benachrichtigungen und Audio holt er nicht nach.${
      st.planExpired ? " Achtung: Der Regel-Plan ist abgelaufen, Zeitregeln greifen nicht mehr." : ""
    }${recent ? `<ul class="rule-log">${recent}</ul>` : ""}</div></div>`;
  }
  const plan = st.planAt
    ? `Regeln laufen online. Fällt das Internet aus, übernimmt der Hub ${st.rules} Regeln (Plan bis ${esc(new Date(st.planValidUntil).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" }))}).`
    : `Regeln laufen online. Noch kein Regel-Plan für den Notbetrieb${st.planError ? ` (${esc(st.planError)})` : ""}.`;
  const pend = st.pending ? ` ${st.pending} Läufe aus dem Notbetrieb warten auf Übertragung.` : "";
  return `<p class="muted small-note rule-note">${icon("zap")}${plan}${pend}</p>`;
}

function renderRaeume(d) {
  const r = state.rooms;
  if (!r) {
    setHTML("roomGrid", '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>');
    return;
  }
  const sub = !r.syncedAt
    ? `Noch kein Stand aus der Cloud${r.syncError ? ` (${r.syncError})` : ""}.`
    : `Stand aus der Cloud ${ago(r.syncedAt)}${r.fromCache ? " (gespeichert, Cloud nicht erreichbar)" : ""}${
        r.syncError && !r.fromCache ? ` · letzter Abgleich fehlgeschlagen: ${r.syncError}` : ""
      }. Räume und Regeln pflegst du online.`;
  if ($("roomSub").textContent !== sub) $("roomSub").textContent = sub;

  setHTML("ruleStatus", ruleStatusHtml(r.rulesStatus));

  const buildings = [...new Set(r.rooms.map((x) => x.building || "Ohne Gebäude"))];
  if (buildings.length > 1) {
    if (state.roomBuilding !== "alle" && !buildings.includes(state.roomBuilding)) state.roomBuilding = "alle";
    setHTML(
      "roomFilter",
      ["alle", ...buildings]
        .map(
          (bld) =>
            `<button type="button" data-building="${esc(bld)}" aria-pressed="${state.roomBuilding === bld}">${esc(bld === "alle" ? "Alle" : bld)}</button>`
        )
        .join("")
    );
  } else {
    setHTML("roomFilter", "");
  }

  const camIds = new Set(d ? liveCams(d).map((c) => c.id) : []);
  const list = r.rooms.filter((x) => state.roomBuilding === "alle" || (x.building || "Ohne Gebäude") === state.roomBuilding);
  const cards = list.map((room) => roomCard(room, r.live, camIds));
  if (r.unassigned.length && state.roomBuilding === "alle") {
    cards.push(
      roomCard(
        { id: 0, name: "Ohne Raum", number: null, floor: null, building: null, devices: r.unassigned, cameras: [], audioZones: [], rules: [], operating: null },
        r.live,
        camIds
      )
    );
  }
  setHTML(
    "roomGrid",
    cards.length ? cards.join("") : empty("Noch keine Räume. Lege sie online unter Räume an und ordne Geräte, Kameras und Regeln zu.")
  );
}

/** Schalten, die eine Rueckfrage brauchen: Antriebe, Schloesser, Tueroeffner. */
function devConfirm(dev, action) {
  const kind = devKind(dev);
  if (kind === "cover" && action !== "stop") {
    return { title: `${dev.name} ${action === "open" ? "auffahren" : "zufahren"}?`, text: "Der Antrieb fährt sofort los. Achte darauf, dass niemand im Weg steht.", ok: action === "open" ? "Auf" : "Zu" };
  }
  if (kind === "lock") {
    return action === "open"
      ? { title: `${dev.name} öffnen?`, text: "Das Schloss öffnet sofort.", ok: "Öffnen" }
      : { title: `${dev.name} abschließen?`, text: "Das Schloss schließt sofort ab.", ok: "Abschließen" };
  }
  if (kind === "door") {
    return { title: `${dev.name} öffnen?`, text: "Der Öffner zieht kurz an.", ok: "Öffnen" };
  }
  return null;
}

function findRoomDevice(id) {
  const r = state.rooms;
  if (!r) return null;
  return r.rooms.flatMap((x) => x.devices).concat(r.unassigned).find((dev) => dev.id === id) || null;
}

async function roomDeviceAction(button) {
  const id = Number(button.dataset.dev);
  const action = button.dataset.devAction;
  const dev = findRoomDevice(id);
  if (!dev) return;
  const c = devConfirm(dev, action);
  if (c && !(await ask(c.title, c.text, c.ok))) return;
  state.roomBusy.add(id);
  renderRaeume(state.overview);
  try {
    const res = await fetch("/api/rooms/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) toast(`${dev.name}: erledigt (${data.via === "lokal" ? "im LAN" : "über die Cloud"})`, "ok");
    else toast(`${dev.name}: ${data.error || "fehlgeschlagen"}`, "err");
  } catch (e) {
    toast(`${dev.name}: ${e.message}`, "err");
  } finally {
    state.roomBusy.delete(id);
    try {
      state.rooms = await getJson("/api/rooms?live=1&fresh=1");
    } catch {
      /* naechster Poll holt es */
    }
    renderRaeume(state.overview);
  }
}

$("roomSync").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch("/api/rooms/sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    toast(data.ok ? "Räume aus der Cloud geladen" : `Abgleich fehlgeschlagen: ${data.error || res.status}`, data.ok ? "ok" : "err");
    state.rooms = await getJson("/api/rooms?live=1&fresh=1");
    renderRaeume(state.overview);
  } catch (e) {
    toast(`Abgleich fehlgeschlagen: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
});

$("roomFilter").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-building]");
  if (!b) return;
  state.roomBuilding = b.dataset.building;
  renderRaeume(state.overview);
});

$("roomGrid").addEventListener("click", (ev) => {
  const devBtn = ev.target.closest("button[data-dev-action]");
  if (devBtn) {
    roomDeviceAction(devBtn);
    return;
  }
  const cam = ev.target.closest("button[data-room-cam]");
  if (cam) openFocus(Number(cam.dataset.roomCam));
});

/* ----------------------------------------------------------------- Geraete */

/*
 * Alles Steuerbare im Netz: Shelly und Tasmota direkt, Hue und Nuki nach
 * einmaliger Kopplung. Shelly-Kanaele lassen sich einem Raum zuordnen; die
 * Zuordnung speichert die Cloud, danach erscheinen sie unter "Raeume".
 */

const VENDOR_ICON = { Shelly: "power", "Philips Hue": "bulb", Nuki: "lock", Tasmota: "power", Mammotion: "leaf" };

/** Cloud-Geraet zu einem Maeher (gleicher Geraetename bei Mammotion). */
function cloudMowerFor(name) {
  const r = state.rooms;
  if (!r) return null;
  const all = r.rooms.flatMap((room) => room.devices.map((dev) => ({ dev, room }))).concat(r.unassigned.map((dev) => ({ dev, room: null })));
  return all.find(({ dev }) => dev.type === "MAMMOTION_MOWER" && dev.mowerName === name) || null;
}

/** Status, Akku und Zone eines Maehers als Chips. */
function mowerChips(m) {
  const tone = m.errors.length ? "warn" : !m.online ? "off" : m.active ? "ok" : "idle";
  const batt = Number.isFinite(m.battery) ? m.battery : null;
  return [
    badge(tone, m.online ? m.statusLabel : "Offline"),
    batt != null ? badge(batt < 20 ? "warn" : "outline", `Akku ${batt} %${m.charging ? " ⚡" : ""}`) : "",
    m.active && m.progress != null ? badge("outline", `${m.progress} %${m.currentZone ? ` · ${m.currentZone}` : ""}`) : "",
  ].join("");
}

/** Maeher unter Geraete: Kurzstatus, Raum-Zuordnung (Cloud), Sprung zur Steuerung. */
function mowerDeviceCard(m) {
  const hit = cloudMowerFor(m.name);
  const r = state.rooms;
  let room = "";
  if (r && hit) {
    const current = hit.room ? hit.room.id : "";
    const opts = [`<option value="">Kein Raum</option>`]
      .concat(r.rooms.map((x) => `<option value="${x.id}"${x.id === current ? " selected" : ""}>${esc(x.name)}</option>`))
      .join("");
    room = `<select class="field small-select" aria-label="Raum für ${esc(m.label)}" data-assign="mower:${esc(m.name)}" data-device-id="${hit.dev.id}">${opts}</select>`;
  } else if (r) {
    room = `<span class="muted small-note">erscheint in wenigen Minuten in der Cloud</span>`;
  }
  const meta = [m.model, m.name, m.firmware ? `FW ${m.firmware}` : ""].filter(Boolean).join(" · ");
  const tasks = m.tasks.filter((t) => t.enabled).length;
  return `<article class="card room">
    <div class="place-head"><span class="tile-ico ${m.active ? "ok" : "accent"}">${icon("leaf")}</span><h3>${esc(m.label)}</h3><span class="host">Mammotion</span></div>
    <div class="muted small-note mono">${esc(meta)}</div>
    <div class="devs"><div class="dev ${m.active ? "is-on" : ""}">
      <span class="tile-ico ${m.active ? "ok" : "accent"}">${icon("leaf")}</span>
      <div class="dev-main"><div class="dev-name">${m.zones ? m.zones.length : 0} Zonen · ${tasks === 1 ? "1 Aufgabe" : `${tasks} Aufgaben`}</div><div class="dev-meta">${mowerChips(m)}${room}</div></div>
      <div class="dev-actions"><a class="btn small primary" href="#maeher">Steuern</a></div>
    </div></div>
  </article>`;
}

/** Cloud-Geraet zu einem Shelly-Kanal (gleiche IP, gleicher Kanal). */
function cloudDeviceFor(ip, channel) {
  const r = state.rooms;
  if (!r) return null;
  const all = r.rooms.flatMap((room) => room.devices.map((dev) => ({ dev, room }))).concat(r.unassigned.map((dev) => ({ dev, room: null })));
  return (
    all.find(({ dev }) => {
      if (dev.type !== "SHELLY" || dev.ipAddress !== ip) return false;
      const suffix = dev.shellyId && dev.shellyId.includes("_") ? Number(dev.shellyId.split("_").pop()) : 0;
      return (suffix > 0 ? suffix - 1 : 0) === channel;
    }) || null
  );
}

/** Cloud-Geraet zu einer Hue-Lampe (Schluessel hue:<bridge>:<lampe>). */
function cloudHueFor(key) {
  const r = state.rooms;
  if (!r) return null;
  const [, bridgeId, lightId] = key.split(":");
  const all = r.rooms.flatMap((room) => room.devices.map((dev) => ({ dev, room }))).concat(r.unassigned.map((dev) => ({ dev, room: null })));
  return all.find(({ dev }) => dev.type === "HUE_LIGHT" && dev.hueBridgeId === bridgeId && dev.hueLightId === lightId) || null;
}

function roomSelect(dev, ctl) {
  const r = state.rooms;
  if (!r || (dev.vendor !== "Shelly" && dev.vendor !== "Philips Hue")) return "";
  const hit = dev.vendor === "Philips Hue" ? cloudHueFor(ctl.key) : cloudDeviceFor(dev.ip, ctl.channel ?? 0);
  const current = hit && hit.room ? hit.room.id : "";
  const opts = [`<option value="">${hit ? "Kein Raum" : "Raum zuordnen …"}</option>`]
    .concat(r.rooms.map((room) => `<option value="${room.id}"${room.id === current ? " selected" : ""}>${esc(room.name)}</option>`))
    .join("");
  return `<select class="field small-select" aria-label="Raum für ${esc(ctl.name)}" data-assign="${esc(ctl.key)}" data-ip="${esc(dev.ip)}" data-mac="${esc(dev.mac || "")}" data-channel="${ctl.channel ?? 0}" data-name="${esc(dev.vendor === "Philips Hue" ? ctl.name : dev.name + (dev.controls.length > 1 ? ` ${ctl.name}` : ""))}"${hit ? ` data-device-id="${hit.dev.id}"` : ""}>${opts}</select>`;
}

function smartControl(dev, ctl) {
  const busy = state.smartBusy.has(ctl.key);
  let status;
  if (!ctl.reachable) status = badge("warn", "nicht erreichbar");
  else if (ctl.kind === "lock") status = badge(ctl.on ? "ok" : "idle", ctl.stateText || "?");
  else if (ctl.on === true)
    status = badge("ok", ctl.powerW ? `an · ${num(ctl.powerW, 0)} W` : ctl.brightness != null ? `an · ${ctl.brightness} %` : "an");
  else if (ctl.on === false) status = badge("idle", "aus");
  else status = "";
  const btn =
    ctl.kind === "lock"
      ? `<button type="button" class="btn small primary" data-smart="${esc(ctl.key)}" data-on="true"${busy ? " disabled" : ""}>Öffnen</button><button type="button" class="btn small" data-smart="${esc(ctl.key)}" data-on="false"${busy ? " disabled" : ""}>Abschließen</button>`
      : ctl.on
        ? `<button type="button" class="btn small on" data-smart="${esc(ctl.key)}" data-on="false"${busy ? " disabled" : ""}>Ausschalten</button>`
        : `<button type="button" class="btn small primary" data-smart="${esc(ctl.key)}" data-on="true"${busy ? " disabled" : ""}>Einschalten</button>`;
  return `<div class="dev ${ctl.on && ctl.kind !== "lock" ? "is-on" : ""}">
    <span class="tile-ico ${ctl.on ? "ok" : "accent"}">${icon(ctl.kind === "lock" ? "lock" : ctl.kind === "light" ? "bulb" : "power")}</span>
    <div class="dev-main"><div class="dev-name">${esc(ctl.name)}</div><div class="dev-meta">${status}${roomSelect(dev, ctl)}</div></div>
    <div class="dev-actions">${btn}</div>
  </div>`;
}

function smartCard(dev) {
  const meta = [dev.model, dev.ip, dev.vlanName].filter(Boolean).join(" · ");
  const pairing = dev.needsPairing
    ? `<div class="pair-hint">${icon("info")}<span>${esc(dev.pairingHint || "Kopplung nötig")}</span></div>
       <div class="card-foot"><button type="button" class="btn small primary" data-pair="${esc(dev.id)}"${state.smartBusy.has(dev.id) ? " disabled" : ""}>${icon("unlock")}Koppeln</button></div>`
    : "";
  const controls = dev.controls.length
    ? dev.controls.map((ctl) => smartControl(dev, ctl)).join("")
    : dev.needsPairing
      ? ""
      : '<div class="muted small-note">Keine steuerbaren Kanäle gemeldet.</div>';
  return `<article class="card room">
    <div class="place-head"><span class="tile-ico accent">${icon(VENDOR_ICON[dev.vendor] || "chip")}</span><h3>${esc(dev.name)}</h3><span class="host">${esc(dev.vendor)}</span></div>
    <div class="muted small-note mono">${esc(meta)}</div>
    ${dev.error && !dev.needsPairing ? `<div class="chips">${badge("warn", dev.error)}</div>` : ""}
    ${pairing}
    <div class="devs">${controls}</div>
  </article>`;
}

function renderGeraete() {
  const sm = state.smart;
  if (!sm) {
    setHTML("smartGrid", '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>');
    return;
  }
  const mowers = state.mower && Array.isArray(state.mower.mowers) ? state.mower.mowers : [];
  const total = sm.devices.length + mowers.length;
  const sub = `${total === 1 ? "1 steuerbares Gerät" : `${total} steuerbare Geräte`}${mowers.length ? ` (davon ${mowers.length} Mäher)` : ""}${sm.scannedAt ? ` · letzter Netz-Scan ${ago(sm.scannedAt)}` : " · noch kein Netz-Scan"}. Shelly-Kanäle, Hue-Lampen und Mäher kannst du einem Raum zuordnen.`;
  if ($("smartSub").textContent !== sub) $("smartSub").textContent = sub;

  const vendors = [...new Set(sm.devices.map((dev) => dev.vendor).concat(mowers.length ? ["Mammotion"] : []))];
  if (vendors.length > 1) {
    if (state.smartVendor !== "alle" && !vendors.includes(state.smartVendor)) state.smartVendor = "alle";
    setHTML(
      "smartFilter",
      ["alle", ...vendors]
        .map((v) => {
          const n = v === "alle" ? total : v === "Mammotion" ? mowers.length : sm.devices.filter((dev) => dev.vendor === v).length;
          return `<button type="button" data-vendor="${esc(v)}" aria-pressed="${state.smartVendor === v}">${esc(v === "alle" ? "Alle" : v)} <span class="n">${n}</span></button>`;
        })
        .join("")
    );
  } else {
    setHTML("smartFilter", "");
  }
  const list = sm.devices.filter((dev) => state.smartVendor === "alle" || dev.vendor === state.smartVendor);
  const mowerList = state.smartVendor === "alle" || state.smartVendor === "Mammotion" ? mowers : [];
  setHTML(
    "smartGrid",
    list.length + mowerList.length
      ? mowerList.map(mowerDeviceCard).join("") + list.map(smartCard).join("")
      : empty("Noch keine steuerbaren Geräte gefunden. Starte einen Netz-Scan, oder prüfe, ob der Hub das VLAN der Geräte erreicht.")
  );
}

async function reloadSmart() {
  try {
    state.smart = await getJson("/api/smart?fresh=1");
  } catch {
    /* naechster Poll */
  }
  renderGeraete();
}

async function postJson(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, data };
}

$("smartGrid").addEventListener("click", async (ev) => {
  const ctlBtn = ev.target.closest("button[data-smart]");
  if (ctlBtn) {
    const key = ctlBtn.dataset.smart;
    const on = ctlBtn.dataset.on === "true";
    if (key.startsWith("nuki:")) {
      const ok = await ask(on ? "Tür öffnen?" : "Schloss abschließen?", on ? "Das Schloss zieht sofort die Falle." : "Das Schloss schließt sofort ab.", on ? "Öffnen" : "Abschließen");
      if (!ok) return;
    }
    state.smartBusy.add(key);
    renderGeraete();
    const r = await postJson("/api/smart/control", { key, on });
    state.smartBusy.delete(key);
    toast(r.ok ? "Erledigt" : `Fehlgeschlagen: ${r.data.error || "?"}`, r.ok ? "ok" : "err");
    reloadSmart();
    return;
  }
  const pairBtn = ev.target.closest("button[data-pair]");
  if (pairBtn) {
    const id = pairBtn.dataset.pair;
    state.smartBusy.add(id);
    renderGeraete();
    toast(id.startsWith("nuki:") ? "Jetzt den Knopf an der Nuki Bridge drücken …" : "Kopple mit der Hue Bridge …");
    const r = await postJson("/api/smart/pair", { id });
    state.smartBusy.delete(id);
    toast(r.ok ? "Gekoppelt" : `Kopplung fehlgeschlagen: ${r.data.error || "?"}`, r.ok ? "ok" : "err");
    reloadSmart();
  }
});

$("smartGrid").addEventListener("change", async (ev) => {
  const sel = ev.target.closest("select[data-assign]");
  if (!sel) return;
  const roomId = sel.value ? Number(sel.value) : null;
  const key = sel.dataset.assign || "";
  const body = sel.dataset.deviceId
    ? { deviceId: Number(sel.dataset.deviceId), roomId }
    : key.startsWith("hue:")
      ? { hue: { bridgeId: key.split(":")[1], lightId: key.split(":")[2] }, name: sel.dataset.name, roomId }
      : { ip: sel.dataset.ip, mac: sel.dataset.mac, channel: Number(sel.dataset.channel), name: sel.dataset.name, roomId };
  if (!body.deviceId && roomId === null) return;
  sel.disabled = true;
  const r = await postJson("/api/smart/assign", body);
  toast(
    r.ok ? (r.data.created ? `${r.data.device.name} angelegt und zugeordnet` : "Raum gespeichert") : `Zuordnung fehlgeschlagen: ${r.data.error || "?"}`,
    r.ok ? "ok" : "err"
  );
  try {
    state.rooms = await getJson("/api/rooms");
  } catch {
    /* naechster Poll */
  }
  sel.disabled = false;
  renderGeraete();
});

$("smartFilter").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-vendor]");
  if (!b) return;
  state.smartVendor = b.dataset.vendor;
  renderGeraete();
});

/* ------------------------------------------------------------------ Maeher */

/*
 * Mammotion-Maeher ueber den Maeher-Dienst des Hubs (hub/mower, PyMammotion).
 * Status alle paar Sekunden, die Karte nur jede Minute: sie aendert sich selten.
 */
const MOWER_STATE_TEXT = {
  no_credentials: "Noch kein Mammotion-Account eingetragen.",
  installing: "Der Hub richtet den Mäher-Dienst ein, das dauert beim ersten Mal ein paar Minuten …",
  starting: "Der Mäher-Dienst startet …",
  logging_in: "Melde mich bei Mammotion an …",
  retrying: "Mammotion-Cloud gerade nicht erreichbar, neuer Versuch in 15 Minuten.",
  rejected: "Mammotion hat die Anmeldung abgelehnt.",
  error: "Der Mäher-Dienst hat ein Problem.",
};

async function loadMowerStatus() {
  if (state.mower && !state.mower.configured) return;
  try {
    state.mower = await getJson("/api/mower");
  } catch {
    /* naechster Poll */
  }
}

async function loadMower() {
  try {
    state.mower = await getJson("/api/mower");
  } catch {
    return;
  }
  const names = state.mower.mowers.map((m) => m.name);
  if (names.length && Date.now() - state.mowerMapsAt > 60_000) {
    state.mowerMapsAt = Date.now();
    await Promise.all(
      names.map(async (name) => {
        try {
          state.mowerMaps[name] = await getJson(`/api/mower/map?mower=${encodeURIComponent(name)}`);
        } catch {
          /* Karte kommt beim naechsten Mal */
        }
      })
    );
  }
}

/** Alle [lon, lat]-Paare einer GeoJSON-Geometrie. */
function geoPoints(geom, out = []) {
  if (!geom) return out;
  const walk = (c) => {
    if (typeof c[0] === "number") out.push(c);
    else for (const x of c) walk(x);
  };
  if (geom.coordinates) walk(geom.coordinates);
  return out;
}

/** Karte als SVG: Zonen, Hindernisse, Wege, Station und Maeher. */
function mowerMapSvg(map, mower) {
  const feats = (map && map.areas && map.areas.features) || [];
  const progress = (map && map.mowPath && map.mowPath.features) || [];
  const pts = [];
  for (const f of feats) geoPoints(f.geometry, pts);
  if (map && map.mower) pts.push([map.mower.lon, map.mower.lat]);
  if (map && map.dock) pts.push([map.dock.lon, map.dock.lat]);
  if (pts.length < 3) {
    return `<div class="mower-map empty-map muted small-note">${map ? "Noch keine Karte vom Mäher geladen." : "Karte wird geladen …"}</div>`;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  for (const [lon, lat] of pts) {
    const x = lon * kx;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
  }
  const W = 320, H = 220, pad = 10;
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const scale = Math.min((W - 2 * pad) / (maxX - minX || span), (H - 2 * pad) / (maxY - minY || span));
  const offX = (W - (maxX - minX) * scale) / 2;
  const offY = (H - (maxY - minY) * scale) / 2;
  const P = ([lon, lat]) => `${(offX + (lon * kx - minX) * scale).toFixed(1)},${(H - offY - (lat - minY) * scale).toFixed(1)}`;
  const ring = (r) => r.map(P).join(" ");
  const shapes = [];
  const labels = [];
  for (const f of feats) {
    const g = f.geometry || {};
    const t = (f.properties && f.properties.type_name) || "";
    if (g.type === "Polygon" && g.coordinates && g.coordinates[0]) {
      const cls = t === "obstacle" || t.includes("no_go") ? "mm-obstacle" : t === "area" ? "mm-area" : "mm-zone";
      shapes.push(`<polygon class="${cls}" points="${ring(g.coordinates[0])}"><title>${esc((f.properties && f.properties.title) || t)}</title></polygon>`);
      if (t === "area" && f.properties.title) {
        const c = g.coordinates[0];
        const cx = c.reduce((a, p) => a + p[0], 0) / c.length;
        const cy = c.reduce((a, p) => a + p[1], 0) / c.length;
        const [x, y] = P([cx, cy]).split(",");
        labels.push(`<text class="mm-label" x="${x}" y="${y}">${esc(f.properties.title)}</text>`);
      }
    } else if (g.type === "LineString" && g.coordinates) {
      shapes.push(`<polyline class="mm-path" points="${ring(g.coordinates)}"/>`);
    }
  }
  for (const f of progress) {
    const g = f.geometry || {};
    if (g.type === "LineString" && g.coordinates) shapes.push(`<polyline class="mm-done" points="${ring(g.coordinates)}"/>`);
  }
  if (map.dock) {
    const [x, y] = P([map.dock.lon, map.dock.lat]).split(",");
    shapes.push(`<rect class="mm-dock" x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2"><title>Station</title></rect>`);
  }
  if (map.mower) {
    const [x, y] = P([map.mower.lon, map.mower.lat]).split(",");
    shapes.push(`<circle class="mm-mower${mower.active ? " is-active" : ""}" cx="${x}" cy="${y}" r="6"><title>${esc(mower.label)}</title></circle>`);
  }
  return `<svg class="mower-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Karte ${esc(mower.label)}">${shapes.join("")}${labels.join("")}</svg>`;
}

function mowerButtons(m) {
  const busy = state.mowerBusy.has(m.name);
  const dis = busy || !m.online ? " disabled" : "";
  const btn = (action, label, ico, cls = "") =>
    `<button type="button" class="btn small ${cls}" data-mower="${esc(m.name)}" data-mower-act="${action}"${dis}>${icon(ico)}${label}</button>`;
  const out = [];
  if (m.status === "MODE_WORKING") out.push(btn("pause", "Pause", "minus"));
  if (m.status === "MODE_PAUSE" || m.status === "MODE_CHARGING_PAUSE") out.push(btn("resume", "Fortsetzen", "zap", "primary"));
  if (m.active) out.push(btn("stop", "Auftrag beenden", "x"));
  if (!m.charging) out.push(btn("dock", "Zur Station", "home"));
  return out.join("");
}

function mowerTaskRow(m, t) {
  const busy = state.mowerBusy.has(m.name);
  const when = [t.weekdays.length === 7 ? "täglich" : t.weekdays.join(" "), t.startTime].filter(Boolean).join(" · ");
  const meta = [when, t.zones.length ? t.zones.join(", ") : "", t.bladeHeightMm ? `${t.bladeHeightMm} mm` : ""].filter(Boolean).join(" · ");
  const canStart = !m.active && m.online && !busy;
  return `<div class="dev${t.running ? " is-on" : ""}">
    <span class="tile-ico ${t.running ? "accent" : ""}">${icon("tasks")}</span>
    <div class="dev-main"><div class="dev-name">${esc(t.name)}</div>
      <div class="dev-meta muted">${t.running ? badge("ok", "läuft") : ""}${t.enabled ? "" : badge("off", "Zeitplan aus")}<span>${esc(meta || "kein Zeitplan")}</span></div></div>
    <div class="dev-actions">
      <label class="switch" title="Zeitplan ${t.enabled ? "an" : "aus"}"><input type="checkbox" data-mower="${esc(m.name)}" data-mower-plan="${esc(t.id)}"${t.enabled ? " checked" : ""}${busy ? " disabled" : ""} aria-label="Zeitplan ${esc(t.name)}"><span></span></label>
      <button type="button" class="btn small primary" data-mower="${esc(m.name)}" data-mower-act="start_task" data-plan="${esc(t.id)}"${canStart ? "" : " disabled"}>Jetzt mähen</button>
    </div>
  </div>`;
}

function mowerCard(m) {
  const tone = m.errors.length ? "warn" : !m.online ? "off" : m.active ? "ok" : "idle";
  const batt = Number.isFinite(m.battery) ? m.battery : null;
  const chips = [
    badge(tone, m.online ? m.statusLabel : "Offline"),
    batt != null ? badge(batt < 20 ? "warn" : "outline", `Akku ${batt} %${m.charging ? " ⚡" : ""}`) : "",
    m.currentZone && m.active ? badge("outline", m.currentZone) : "",
  ].join("");
  const progress =
    m.progress != null
      ? `<div class="mower-progress"><div class="meter grad"><span style="width:${Math.max(0, Math.min(100, m.progress))}%"></span></div><span class="muted small-note">${m.progress} % gemäht</span></div>`
      : "";
  const errors = m.errors.length
    ? `<div class="pair-hint">${icon("alert")}<span>${m.errors.map((e) => esc(e.text || `Fehlercode ${e.code}`)).join("<br>")}</span></div>`
    : "";
  const tasks = m.tasks.length
    ? m.tasks.map((t) => mowerTaskRow(m, t)).join("")
    : '<div class="muted small-note">Noch keine Aufgaben geladen. Aufgaben legst du in der Mammotion-App an.</div>';
  return `<article class="card room mower">
    <div class="place-head"><span class="tile-ico accent">${icon("leaf")}</span><h3>${esc(m.label)}</h3>${m.label !== m.model ? `<span class="host">${esc(m.model)}</span>` : ""}</div>
    <div class="chips">${chips}</div>
    ${progress}
    ${errors}
    ${mowerMapSvg(state.mowerMaps[m.name], m)}
    <div class="card-foot">${mowerButtons(m)}</div>
    <div class="devs">${tasks}</div>
  </article>`;
}

function renderMaeher() {
  const st = state.mower;
  if (!st) {
    setHTML("mowerGrid", '<div class="skeleton"></div><div class="skeleton"></div>');
    return;
  }
  const n = st.mowers.length;
  const sub =
    st.state === "ready"
      ? `${n === 1 ? "1 Mäher" : `${n} Mäher`} über den Account ${st.account || ""}${st.lastPollAt ? ` · zuletzt abgefragt ${ago(new Date(st.lastPollAt * 1000).toISOString())}` : ""}`
      : "Mammotion-Mäher: Status, Aufgaben und Karte.";
  if ($("mowerSub").textContent !== sub) $("mowerSub").textContent = sub;

  let note = "";
  if (st.state !== "ready") {
    const text = MOWER_STATE_TEXT[st.state] || st.state;
    const howto =
      st.state === "no_credentials" || st.state === "rejected"
        ? " Trag in hub/.env einen eigenen Zweit-Account ein, mit dem du die Mäher in der App geteilt hast: MAMMOTION_EMAIL und MAMMOTION_PASSWORD. Danach den Hub neu starten."
        : "";
    note = `<div class="banner${st.state === "rejected" || st.state === "error" ? " alert" : ""}" role="status">${icon("info")}<span>${esc(text + howto)}${st.error && st.state !== "no_credentials" ? `<br><span class="muted small-note">${esc(st.error)}</span>` : ""}</span></div>`;
  }
  setHTML("mowerNote", note);
  setHTML(
    "mowerGrid",
    n ? st.mowers.map(mowerCard).join("") : st.state === "ready" ? empty("Der Account sieht keine Mäher. Sind sie in der App mit diesem Account geteilt?") : ""
  );
}

const MOWER_CONFIRM = {
  stop: ["Auftrag beenden?", "Der Mäher hält an und der laufende Auftrag wird abgebrochen.", "Beenden"],
  dock: ["Zur Station schicken?", "Der Mäher unterbricht und fährt zur Ladestation.", "Zur Station"],
  start_task: ["Jetzt mähen?", "Der Mäher startet diese Aufgabe sofort.", "Starten"],
};

async function mowerCommand(body, okText) {
  state.mowerBusy.add(body.mower);
  renderMaeher();
  const r = await postJson("/api/mower/action", body);
  state.mowerBusy.delete(body.mower);
  toast(r.ok ? okText : `Fehlgeschlagen: ${r.data.error || "?"}`, r.ok ? "ok" : "err");
  state.mowerMapsAt = 0;
  await loadMower();
  renderMaeher();
}

$("mowerGrid").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-mower-act]");
  if (!btn) return;
  const action = btn.dataset.mowerAct;
  const c = MOWER_CONFIRM[action];
  if (c && !(await ask(c[0], c[1], c[2]))) return;
  await mowerCommand({ mower: btn.dataset.mower, action, planId: btn.dataset.plan }, "Befehl gesendet");
});

$("mowerGrid").addEventListener("change", async (ev) => {
  const box = ev.target.closest("input[data-mower-plan]");
  if (!box) return;
  await mowerCommand(
    { mower: box.dataset.mower, action: "enable_task", planId: box.dataset.mowerPlan, enabled: box.checked },
    box.checked ? "Zeitplan an" : "Zeitplan aus"
  );
});

$("mowerRefresh").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  const names = state.mower ? state.mower.mowers.map((m) => m.name) : [];
  await Promise.all(names.map((mower) => postJson("/api/mower/action", { mower, action: "refresh" })));
  state.mowerMapsAt = 0;
  await loadMower();
  renderMaeher();
  btn.disabled = false;
});

$("smartScan").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  toast("Netz-Scan läuft, das dauert ein bis zwei Minuten …");
  try {
    await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "NETWORK_SCAN", payload: null }) });
    toast("Netz-Scan fertig", "ok");
  } catch (e) {
    toast(`Netz-Scan fehlgeschlagen: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
    reloadSmart();
  }
});

/* ------------------------------------------------------------------ Regeln */

/*
 * Regeln bearbeiten wie online: Der Hub reicht alles an /api/regeln der Cloud
 * durch (dashboard.ts). Audio-Aktionen lassen sich hier nicht anlegen, bleiben
 * beim Speichern aber unveraendert erhalten.
 */

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
let ruleDraft = { id: null, actions: [] };

async function loadRules() {
  try {
    const res = await fetch("/api/rules", { headers: { Accept: "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
    state.rules = Array.isArray(data) ? data : [];
    state.rulesError = null;
  } catch (e) {
    state.rulesError = e.message;
  }
  state.rulesAt = Date.now();
}

function allRoomDevices() {
  const r = state.rooms;
  if (!r) return [];
  return r.rooms.flatMap((room) => room.devices.map((dev) => ({ ...dev, roomName: room.name }))).concat(r.unassigned.map((dev) => ({ ...dev, roomName: null })));
}

function allCameras(d) {
  const map = new Map();
  if (state.rooms) for (const room of state.rooms.rooms) for (const c of room.cameras) map.set(c.id, { id: c.id, name: c.name, roomId: room.id });
  if (d) for (const c of liveCams(d)) if (!map.has(c.id)) map.set(c.id, { id: c.id, name: c.name, roomId: null });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function ruleSummary(rule) {
  const t = TRIGGER_LABELS[rule.trigger] || rule.trigger;
  const off = rule.offsetMinutes ? ` ${rule.offsetMinutes > 0 ? "+" : "−"}${Math.abs(rule.offsetMinutes)} min` : "";
  let what = t;
  if (rule.trigger === "TIME") what = `um ${rule.timeOfDay || "?"}`;
  else if (["OPENING", "CLOSING", "SUNRISE", "SUNSET"].includes(rule.trigger)) what = `${t}${off}`;
  else if (rule.trigger === "MOTION") what = `${rule.eventType ? { PERSON: "Person", VEHICLE: "Fahrzeug", MOTION: "Bewegung", DOORBELL: "Klingel" }[rule.eventType] : "Bewegung"}${rule.camera ? ` an ${rule.camera.name}` : " im Raum"}`;
  else if (rule.trigger === "DEVICE_SWITCHED") what = `${rule.triggerDevice ? rule.triggerDevice.name : "Gerät"} geschaltet`;
  else if (rule.trigger === "IDLE") what = `${rule.idleMinutes} min ohne Bewegung`;
  const days = rule.daysOfWeek === 127 ? "" : ` · ${DAY_NAMES.filter((_, i) => (rule.daysOfWeek >> i) & 1).join(", ")}`;
  const cond = [
    rule.operating === "OPEN" ? "nur geöffnet" : rule.operating === "CLOSED" ? "nur geschlossen" : null,
    rule.windowStart && rule.windowEnd ? `${rule.windowStart}–${rule.windowEnd}` : null,
    rule.onlyWhenDark ? "nur dunkel" : null,
  ].filter(Boolean);
  const acts = (rule.actions || []).map((a) => {
    if (a.kind === "DEVICE") return `${a.device ? a.device.name : "Gerät"}: ${ACTION_LABEL[a.deviceAction] || a.deviceAction}`;
    if (a.kind === "NOTIFY") return `${a.channel === "TELEGRAM" ? "Telegram" : a.channel === "BOTH" ? "Push + Telegram" : "Push"}`;
    if (a.kind === "CAMERA") {
      const parts = [a.ptzPresetId != null ? `Preset ${a.ptzPresetId}` : null, a.autoTrack == null ? null : a.autoTrack ? "folgen" : "folgen aus"].filter(Boolean);
      return `${a.targetCamera ? a.targetCamera.name : "Kamera"}: ${parts.join(", ")}`;
    }
    return `Audio${a.audioZone ? ` ${a.audioZone.name}` : ""}`;
  });
  return { what: `${what}${days}${cond.length ? ` · ${cond.join(", ")}` : ""}`, acts: acts.join(" → ") || "keine Aktion" };
}

const ACTION_LABEL = { open: "ein / öffnen", deactivate: "aus / abschließen", close: "zu", stop: "stopp", reset: "Ruhe", emergency: "Not-Auf" };

function renderRegeln(d) {
  if (state.rulesError && !state.rules) {
    setHTML("ruleGrid", empty(`Regeln konnten nicht geladen werden: ${state.rulesError}`));
    return;
  }
  if (!state.rules) {
    setHTML("ruleGrid", '<div class="skeleton"></div><div class="skeleton"></div>');
    return;
  }
  const groups = new Map();
  for (const rule of state.rules) {
    const key = rule.room ? rule.room.name : "Betriebsweit";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rule);
  }
  const html = [...groups.entries()]
    .sort((a, b) => (a[0] === "Betriebsweit" ? 1 : b[0] === "Betriebsweit" ? -1 : a[0].localeCompare(b[0], "de")))
    .map(([room, list]) => `<h2 class="sec">${esc(room)}</h2><div class="grid rooms">${list
      .map((rule) => {
        const sum = ruleSummary(rule);
        return `<article class="card room rule-card ${rule.isActive ? "" : "is-off"}">
          <div class="place-head"><span class="tile-ico ${rule.isActive ? "accent" : ""}">${icon("zap")}</span><h3>${esc(rule.name)}</h3>
            <label class="switch" title="${rule.isActive ? "Aktiv" : "Inaktiv"}"><input type="checkbox" data-rule-toggle="${rule.id}"${rule.isActive ? " checked" : ""} aria-label="Regel ${esc(rule.name)} aktiv"><span></span></label></div>
          <div class="line"><span class="k">Wenn</span><span class="v">${esc(sum.what)}</span></div>
          <div class="line"><span class="k">Dann</span><span class="v">${esc(sum.acts)}</span></div>
          <div class="line"><span class="k">Zuletzt</span><span class="v muted">${rule.lastRunAt ? esc(ago(rule.lastRunAt)) : "noch nie"}</span></div>
          <div class="card-foot"><button type="button" class="btn small" data-rule-edit="${rule.id}">Bearbeiten</button><button type="button" class="btn small" data-rule-run="${rule.id}">Jetzt ausführen</button></div>
        </article>`;
      })
      .join("")}</div>`)
    .join("");
  setHTML("ruleGrid", html || empty("Noch keine Regeln. Lege mit „Neue Regel“ die erste an."));
  const sub = `${state.rules.length} Regeln, ${state.rules.filter((r) => r.isActive).length} aktiv. Gespeichert wird online, der Hub springt bei Internetausfall ein.`;
  if ($("ruleSub").textContent !== sub) $("ruleSub").textContent = sub;
}

function deviceActionOptions(dev) {
  const kind = dev ? devKind(dev) : "door";
  const opts = {
    toggle: [["open", "Einschalten"], ["deactivate", "Ausschalten"]],
    pulse: [["open", "Auslösen"], ["deactivate", "Ausschalten"]],
    cover: [["open", "Auf"], ["close", "Zu"], ["stop", "Stopp"]],
    lock: [["open", "Öffnen"], ["deactivate", "Abschließen"], ["reset", "Tagverriegelung"]],
    valve: [["open", "Bewässern"], ["deactivate", "Stoppen"]],
    audio: [["open", "Abspielen"], ["stop", "Stopp"]],
    sensor: [["open", "Ein"], ["deactivate", "Aus"]],
    door: [["open", "Öffnen"], ["deactivate", "Sperren"]],
  };
  return opts[kind] || opts.door;
}

function renderRuleActions() {
  const devices = allRoomDevices();
  const rows = ruleDraft.actions.map((a, i) => {
    let body;
    if (a.kind === "DEVICE") {
      const dev = devices.find((x) => x.id === a.deviceId);
      body = `<select class="field" data-act="${i}" data-field="deviceId" aria-label="Gerät"><option value="">Gerät wählen …</option>${devices
        .map((x) => `<option value="${x.id}"${x.id === a.deviceId ? " selected" : ""}>${esc(x.name)}${x.roomName ? ` (${esc(x.roomName)})` : ""}</option>`)
        .join("")}</select><select class="field" data-act="${i}" data-field="deviceAction" aria-label="Aktion">${deviceActionOptions(dev)
        .map(([v, l]) => `<option value="${v}"${v === a.deviceAction ? " selected" : ""}>${l}</option>`)
        .join("")}</select>`;
    } else if (a.kind === "NOTIFY") {
      body = `<select class="field" data-act="${i}" data-field="channel" aria-label="Kanal">${[["PUSH", "Push"], ["TELEGRAM", "Telegram"], ["BOTH", "Push + Telegram"]]
        .map(([v, l]) => `<option value="${v}"${v === (a.channel || "PUSH") ? " selected" : ""}>${l}</option>`)
        .join("")}</select><input class="field" data-act="${i}" data-field="message" maxlength="500" placeholder="Text (leer = Regelname)" value="${esc(a.message || "")}">`;
    } else if (a.kind === "CAMERA") {
      const presets = a.targetCameraId ? live.presets[a.targetCameraId] : null;
      const cams = allCameras(state.overview);
      const presetField = presets && presets.length
        ? `<select class="field" data-act="${i}" data-field="ptzPresetId" aria-label="Position"><option value="">nicht bewegen</option>${presets
            .map((p) => `<option value="${p.id}"${p.id === a.ptzPresetId ? " selected" : ""}>${esc(p.name)} (#${p.id})</option>`)
            .join("")}</select>`
        : `<input class="field" type="number" min="0" data-act="${i}" data-field="ptzPresetId" placeholder="Preset-Nr." value="${a.ptzPresetId == null ? "" : a.ptzPresetId}"><button type="button" class="btn small" data-act-presets="${i}"${a.targetCameraId ? "" : " disabled"}>Positionen laden</button>`;
      body = `<select class="field" data-act="${i}" data-field="targetCameraId" aria-label="Kamera"><option value="">Kamera wählen …</option>${cams
        .map((c) => `<option value="${c.id}"${c.id === a.targetCameraId ? " selected" : ""}>${esc(c.name)}</option>`)
        .join("")}</select>${presetField}<select class="field" data-act="${i}" data-field="autoTrack" aria-label="Automatisch folgen">${[["on", "folgen an"], ["off", "folgen aus"], ["", "folgen unverändert"]]
        .map(([v, l]) => `<option value="${v}"${v === (a.autoTrack == null ? "" : a.autoTrack ? "on" : "off") ? " selected" : ""}>${l}</option>`)
        .join("")}</select><input class="field" type="number" min="5" max="3600" data-act="${i}" data-field="returnAfterSeconds" placeholder="zurück nach Sek. (optional)" value="${a.returnAfterSeconds == null ? "" : a.returnAfterSeconds}">`;
    } else {
      body = `<span class="muted">Audio${a.audioZone ? ` · ${esc(a.audioZone.name)}` : ""}${a.audioAnnouncement ? ` · ${esc(a.audioAnnouncement.name)}` : a.audioPlaylist ? ` · ${esc(a.audioPlaylist.name)}` : ""} (online bearbeiten)</span>`;
    }
    return `<div class="rule-act"><span class="rule-act-n">${i + 1}</span><div class="rule-act-body">${body}</div><button type="button" class="icon-btn small" data-act-del="${i}" aria-label="Aktion entfernen">${icon("x")}</button></div>`;
  });
  $("ruleActions").innerHTML = rows.join("") || '<p class="muted small-note">Noch keine Aktion.</p>';
}

function syncTriggerFields() {
  const f = $("ruleForm");
  const t = f.trigger.value;
  for (const el of f.querySelectorAll("[data-for]")) el.hidden = !el.dataset.for.split(" ").includes(t);
}

function openRuleEditor(rule) {
  const f = $("ruleForm");
  const d = state.overview;
  f.reset();
  $("ruleErr").hidden = true;
  $("ruleDlgTitle").textContent = rule ? `${rule.name} bearbeiten` : "Neue Regel";
  $("ruleDelete").hidden = !rule;
  const rooms = state.rooms ? state.rooms.rooms : [];
  f.roomId.innerHTML = `<option value="">Betriebsweit (kein Raum)</option>${rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}`;
  f.cameraId.innerHTML = `<option value="">Jede Kamera im Raum</option>${allCameras(d).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}`;
  f.triggerDeviceId.innerHTML = `<option value="">Gerät wählen …</option>${allRoomDevices().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}`;
  const days = rule ? rule.daysOfWeek : 127;
  $("ruleDays").innerHTML = DAY_NAMES.map((n, i) => `<label class="day"><input type="checkbox" value="${i}"${(days >> i) & 1 ? " checked" : ""}><span>${n}</span></label>`).join("");

  const v = (x) => (x == null ? "" : String(x));
  f.name.value = rule ? rule.name : "";
  f.roomId.value = v(rule ? rule.roomId : rooms[0] ? rooms[0].id : "");
  f.trigger.value = rule ? rule.trigger : "MOTION";
  f.timeOfDay.value = rule ? v(rule.timeOfDay) : "";
  f.offsetMinutes.value = rule ? rule.offsetMinutes : 0;
  f.cameraId.value = rule ? v(rule.cameraId) : "";
  f.eventType.value = rule ? v(rule.eventType) : "";
  f.triggerDeviceId.value = rule ? v(rule.triggerDeviceId) : "";
  f.triggerAction.value = rule ? v(rule.triggerAction) : "";
  f.idleMinutes.value = rule && rule.idleMinutes ? rule.idleMinutes : 15;
  f.scanDirection.value = rule ? v(rule.scanDirection) : "";
  f.operating.value = rule ? rule.operating : "ANY";
  f.cooldownSeconds.value = rule ? rule.cooldownSeconds : 60;
  f.windowStart.value = rule ? v(rule.windowStart) : "";
  f.windowEnd.value = rule ? v(rule.windowEnd) : "";
  f.onlyWhenDark.checked = rule ? rule.onlyWhenDark : false;
  f.isActive.checked = rule ? rule.isActive : true;
  ruleDraft = {
    id: rule ? rule.id : null,
    actions: rule ? rule.actions.map((a) => ({ ...a })) : [{ kind: "DEVICE", deviceId: null, deviceAction: "open" }],
  };
  syncTriggerFields();
  renderRuleActions();
  $("ruleDlg").showModal();
}

function ruleFormPayload() {
  const f = $("ruleForm");
  const t = f.trigger.value;
  const num = (x) => (x === "" || x == null ? null : Number(x));
  let days = 0;
  for (const c of $("ruleDays").querySelectorAll("input:checked")) days |= 1 << Number(c.value);
  return {
    name: f.name.value.trim(),
    roomId: num(f.roomId.value),
    isActive: f.isActive.checked,
    trigger: t,
    daysOfWeek: days,
    ...(t === "TIME" ? { timeOfDay: f.timeOfDay.value } : {}),
    offsetMinutes: ["OPENING", "CLOSING", "SUNRISE", "SUNSET"].includes(t) ? Number(f.offsetMinutes.value) || 0 : 0,
    cameraId: t === "MOTION" ? num(f.cameraId.value) : null,
    eventType: t === "MOTION" ? f.eventType.value || null : null,
    triggerDeviceId: t === "DEVICE_SWITCHED" ? num(f.triggerDeviceId.value) : null,
    triggerAction: t === "DEVICE_SWITCHED" ? f.triggerAction.value || null : null,
    idleMinutes: t === "IDLE" ? num(f.idleMinutes.value) : null,
    scanDirection: t === "SCAN" ? f.scanDirection.value || null : null,
    operating: f.operating.value,
    cooldownSeconds: Number(f.cooldownSeconds.value) || 0,
    windowStart: f.windowStart.value || null,
    windowEnd: f.windowEnd.value || null,
    onlyWhenDark: f.onlyWhenDark.checked,
    actions: ruleDraft.actions.map((a, i) => ({
      kind: a.kind,
      sortOrder: i,
      deviceId: a.kind === "DEVICE" ? a.deviceId : null,
      deviceAction: a.kind === "DEVICE" ? a.deviceAction : null,
      timerSeconds: a.kind === "DEVICE" ? a.timerSeconds ?? null : null,
      channel: a.kind === "NOTIFY" ? a.channel || "PUSH" : null,
      message: a.kind === "NOTIFY" ? a.message || null : null,
      audioZoneId: a.kind === "AUDIO" ? a.audioZoneId : null,
      audioAnnouncementId: a.kind === "AUDIO" ? a.audioAnnouncementId ?? null : null,
      audioPlaylistId: a.kind === "AUDIO" ? a.audioPlaylistId ?? null : null,
      targetCameraId: a.kind === "CAMERA" ? a.targetCameraId ?? null : null,
      ptzPresetId: a.kind === "CAMERA" ? a.ptzPresetId ?? null : null,
      autoTrack: a.kind === "CAMERA" ? a.autoTrack ?? null : null,
      returnAfterSeconds: a.kind === "CAMERA" ? a.returnAfterSeconds ?? null : null,
    })),
  };
}

function ruleError(data, status) {
  if (typeof data.error === "string") return data.error;
  if (data.error && data.error.fieldErrors) {
    const first = Object.entries(data.error.fieldErrors)[0];
    if (first) return `${first[0]}: ${first[1][0]}`;
  }
  if (data.error && data.error.formErrors && data.error.formErrors.length) return data.error.formErrors[0];
  return `Speichern fehlgeschlagen (HTTP ${status})`;
}

async function ruleRequest(method, path, body) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

$("ruleNew").addEventListener("click", () => openRuleEditor(null));
$("ruleCancel").addEventListener("click", () => $("ruleDlg").close());
$("ruleForm").trigger.addEventListener("change", syncTriggerFields);

$("ruleActions").addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const a = ruleDraft.actions[Number(el.dataset.act)];
  const field = el.dataset.field;
  if (["deviceId", "targetCameraId", "ptzPresetId", "returnAfterSeconds"].includes(field)) a[field] = el.value === "" ? null : Number(el.value);
  else if (field === "autoTrack") a[field] = el.value === "" ? null : el.value === "on";
  else a[field] = el.value;
  if (field === "targetCameraId") {
    a.ptzPresetId = null;
    renderRuleActions();
  }
  if (field === "deviceId") {
    const dev = allRoomDevices().find((x) => x.id === a.deviceId);
    const opts = deviceActionOptions(dev).map(([v]) => v);
    if (!opts.includes(a.deviceAction)) a.deviceAction = opts[0];
    renderRuleActions();
  }
});
$("ruleActions").addEventListener("input", (ev) => {
  const el = ev.target.closest("input[data-act]");
  if (!el) return;
  const numeric = el.type === "number";
  ruleDraft.actions[Number(el.dataset.act)][el.dataset.field] = numeric ? (el.value === "" ? null : Number(el.value)) : el.value;
});
$("ruleActions").addEventListener("click", async (ev) => {
  const load = ev.target.closest("[data-act-presets]");
  if (load) {
    const a = ruleDraft.actions[Number(load.dataset.actPresets)];
    if (!a || !a.targetCameraId) return;
    load.disabled = true;
    const r = await shellyAction("CAMERA_PTZ_PRESETS", { cameraId: a.targetCameraId });
    live.presets[a.targetCameraId] = r.success ? r.result.presets || [] : [];
    if (!r.success) toast(`Positionen nicht lesbar: ${r.error || "Fehler"}`, "err");
    else if (!live.presets[a.targetCameraId].length) toast("Diese Kamera hat keine gespeicherten Positionen.", "err");
    renderRuleActions();
    return;
  }
  const del = ev.target.closest("[data-act-del]");
  if (!del) return;
  ruleDraft.actions.splice(Number(del.dataset.actDel), 1);
  renderRuleActions();
});
document.querySelector("#ruleDlg").addEventListener("click", (ev) => {
  const add = ev.target.closest("[data-add-action]");
  if (!add) return;
  const kind = add.dataset.addAction;
  ruleDraft.actions.push(
    kind === "DEVICE"
      ? { kind: "DEVICE", deviceId: null, deviceAction: "open" }
      : kind === "CAMERA"
        ? { kind: "CAMERA", targetCameraId: null, ptzPresetId: null, autoTrack: true, returnAfterSeconds: null }
        : { kind: "NOTIFY", channel: "PUSH", message: "" }
  );
  renderRuleActions();
});

$("ruleForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const body = ruleFormPayload();
  const err = $("ruleErr");
  if (!body.actions.length) {
    err.textContent = "Mindestens eine Aktion anlegen.";
    err.hidden = false;
    return;
  }
  if (body.actions.some((a) => a.kind === "CAMERA" && (!a.targetCameraId || (a.ptzPresetId == null && a.autoTrack == null)))) {
    err.textContent = "Bei „Kamera steuern“ eine Kamera und Position oder Folgen wählen.";
    err.hidden = false;
    return;
  }
  if (body.actions.some((a) => a.kind === "DEVICE" && !a.deviceId)) {
    err.textContent = "Bei jeder Geräte-Aktion ein Gerät wählen.";
    err.hidden = false;
    return;
  }
  if (!body.daysOfWeek) {
    err.textContent = "Mindestens einen Wochentag wählen.";
    err.hidden = false;
    return;
  }
  $("ruleSave").disabled = true;
  const r = ruleDraft.id ? await ruleRequest("PUT", `/api/rules/${ruleDraft.id}`, body) : await ruleRequest("POST", "/api/rules", body);
  $("ruleSave").disabled = false;
  if (!r.ok) {
    err.textContent = ruleError(r.data, r.status);
    err.hidden = false;
    return;
  }
  $("ruleDlg").close();
  toast(ruleDraft.id ? "Regel gespeichert" : "Regel angelegt", "ok");
  await loadRules();
  renderRegeln(state.overview);
});

$("ruleDelete").addEventListener("click", async () => {
  if (!ruleDraft.id) return;
  $("ruleDlg").close();
  const ok = await ask("Regel löschen?", "Die Regel wird online gelöscht. Der Verlauf bleibt erhalten.", "Löschen");
  if (!ok) return;
  const r = await ruleRequest("DELETE", `/api/rules/${ruleDraft.id}`);
  toast(r.ok ? "Regel gelöscht" : ruleError(r.data, r.status), r.ok ? "ok" : "err");
  await loadRules();
  renderRegeln(state.overview);
});

$("ruleGrid").addEventListener("click", async (ev) => {
  const edit = ev.target.closest("[data-rule-edit]");
  if (edit) {
    const rule = (state.rules || []).find((x) => x.id === Number(edit.dataset.ruleEdit));
    if (rule) openRuleEditor(rule);
    return;
  }
  const run = ev.target.closest("[data-rule-run]");
  if (run) {
    const rule = (state.rules || []).find((x) => x.id === Number(run.dataset.ruleRun));
    if (!rule || !(await ask(`„${rule.name}“ jetzt ausführen?`, "Die Aktionen laufen sofort, ohne Bedingungen und Sperrzeit.", "Ausführen"))) return;
    run.disabled = true;
    const r = await ruleRequest("POST", `/api/rules/${rule.id}/run`);
    run.disabled = false;
    const failed = r.data && Array.isArray(r.data.actions) ? r.data.actions.filter((a) => !a.ok) : [];
    toast(r.ok ? "Regel ausgeführt" : failed.length ? `Teilweise fehlgeschlagen: ${failed.map((a) => `${a.target}: ${a.error}`).join("; ")}` : ruleError(r.data, r.status), r.ok ? "ok" : "err");
    await loadRules();
    renderRegeln(state.overview);
  }
});

$("ruleGrid").addEventListener("change", async (ev) => {
  const t = ev.target.closest("[data-rule-toggle]");
  if (!t) return;
  t.disabled = true;
  const r = await ruleRequest("PUT", `/api/rules/${t.dataset.ruleToggle}`, { isActive: t.checked });
  t.disabled = false;
  toast(r.ok ? (t.checked ? "Regel aktiviert" : "Regel pausiert") : ruleError(r.data, r.status), r.ok ? "ok" : "err");
  await loadRules();
  renderRegeln(state.overview);
});

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
