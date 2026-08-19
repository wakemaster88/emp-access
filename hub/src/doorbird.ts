/**
 * DoorBird-Modul: spricht DoorBird-Türstationen über die lokale LAN-API an.
 *
 * - monitor.cgi: Dauerverbindung, meldet Klingel-/Bewegungs-Events sofort
 * - image.cgi:   Schnappschuss (JPEG)
 * - open-door.cgi: Türöffner-Relais (Task DOORBIRD_OPEN aus der Cloud)
 *
 * Klingel/Bewegung → Snapshot → Gesichts-Pipeline (wie Reolink-PERSON).
 */
import { api, log } from "./config.js";
import { embedJpeg, matchEmbedding, refreshGallery } from "./face.js";
import { jpegContainsVehicle } from "./vision.js";
import type { CameraConfig } from "./cameras.js";
import { updateLocalStreams } from "./streams.js";

const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
/** Verbindung neu aufbauen, wenn so lange keine Daten kamen (Keep-Alives kommen ~alle 8 s). */
const IDLE_TIMEOUT_MS = 90_000;
/** Pro Ereignis höchstens alle 20 s eine Snapshot-Pipeline. */
const EVENT_THROTTLE_MS = 20_000;
/**
 * Tor-Öffnungswunsch (Telegram mit "Tor öffnen"-Button): höchstens alle
 * N Sekunden, damit ein wartendes Auto den Chat nicht flutet.
 * Env: HUB_GATE_THROTTLE (Sekunden), HUB_GATE_ON_MOTION = vision|always|off
 */
const GATE_THROTTLE_MS = (() => {
  const n = Number(process.env.HUB_GATE_THROTTLE);
  return (Number.isFinite(n) && n >= 10 ? n : 120) * 1000;
})();
const GATE_ON_MOTION = (process.env.HUB_GATE_ON_MOTION || "vision").toLowerCase();
/** Solange der Monitor verbunden ist: lastSeenAt regelmäßig aktualisieren. */
const SEEN_PING_MS = 120_000;
const SNAP_ATTEMPTS = 4;
const SNAP_RETRY_MS = 1_500;

interface DoorbirdRuntime {
  config: CameraConfig;
  abort: AbortController | null;
  reconnectDelay: number;
  states: Record<string, boolean>;
  lastEventPipelineAt: number;
  lastGateAlertAt: number;
  stopped: boolean;
  unreachableLogged: boolean;
}

const doorbirds = new Map<number, DoorbirdRuntime>();

function baseUrl(c: CameraConfig): string {
  return `${c.https ? "https" : "http"}://${c.host}:${c.httpPort}`;
}

function authHeader(c: CameraConfig): string {
  return "Basic " + Buffer.from(`${c.username}:${c.password}`).toString("base64");
}

/** Schnappschuss (JPEG) von der DoorBird holen. */
async function captureSnap(c: CameraConfig): Promise<Buffer> {
  const res = await fetch(`${baseUrl(c)}/bha-api/image.cgi`, {
    headers: { Authorization: authHeader(c) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`image.cgi HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Türöffner-Relais schalten (Task DOORBIRD_OPEN). */
export async function openDoorbirdDoor(
  cameraId: number,
  relay = 1
): Promise<{ ok: boolean; error?: string }> {
  const rt = doorbirds.get(cameraId);
  if (!rt) return { ok: false, error: `DoorBird ${cameraId} nicht konfiguriert` };
  try {
    const res = await fetch(
      `${baseUrl(rt.config)}/bha-api/open-door.cgi?r=${encodeURIComponent(relay)}`,
      { headers: { Authorization: authHeader(rt.config) }, signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return { ok: false, error: `open-door.cgi HTTP ${res.status}` };
    log(`DoorBird ${rt.config.name}: Tür geöffnet (Relais ${relay})`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ist die Kamera als DoorBird beim Hub registriert? */
export function isDoorbird(cameraId: number): boolean {
  return doorbirds.has(cameraId);
}

/** IDs der lokal verbundenen DoorBirds (für Fahrzeug-Aktoren). */
export function listDoorbirdIds(): number[] {
  return [...doorbirds.keys()];
}

/** JPEG von der DoorBird holen (ohne Upload) – z. B. fuer Scan-Schnappschuesse. */
export async function captureDoorbirdSnapshot(cameraId: number): Promise<Buffer> {
  const rt = doorbirds.get(cameraId);
  if (!rt) throw new Error(`DoorBird ${cameraId} nicht konfiguriert`);
  return captureSnap(rt.config);
}

/** Schnappschuss holen und als Kamera-Snapshot in die Cloud laden (Task CAMERA_SNAPSHOT). */
export async function uploadDoorbirdSnapshot(cameraId: number): Promise<{ bytes: number }> {
  const rt = doorbirds.get(cameraId);
  if (!rt) throw new Error(`DoorBird ${cameraId} nicht konfiguriert`);
  const buf = await captureSnap(rt.config);
  const upload = await api(`/api/hub/cameras/${cameraId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) throw new Error(`Snapshot-Upload fehlgeschlagen: HTTP ${upload.status}`);
  return { bytes: buf.length };
}

/** Event an die Cloud melden (DOORBELL/MOTION start/end). */
async function reportEvent(
  cameraId: number,
  type: string,
  phase: "start" | "end"
): Promise<void> {
  try {
    await api("/api/hub/camera-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seen: [cameraId],
        events: [{ cameraId, type, phase, at: new Date().toISOString() }],
      }),
    });
  } catch (e) {
    log(`DoorBird Event-Meldung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Öffnungswunsch ans Tor melden: Snapshot → Cloud → Telegram-Foto mit
 * "Tor öffnen"-Button. DOORBELL immer; MOTION nur wenn der Vision-Check
 * ein Fahrzeug sieht (bzw. immer bei HUB_GATE_ON_MOTION=always).
 * Vision nicht erreichbar (null) → im Zweifel senden, Throttle fängt Spam.
 */
async function maybeSendGateAlert(
  rt: DoorbirdRuntime,
  trigger: "DOORBELL" | "MOTION",
  buf: Buffer
): Promise<void> {
  const now = Date.now();
  if (now - rt.lastGateAlertAt < GATE_THROTTLE_MS) return;

  if (trigger === "MOTION") {
    if (GATE_ON_MOTION === "off") return;
    if (GATE_ON_MOTION !== "always") {
      const vehicle = await jpegContainsVehicle(buf, { quick: true });
      if (vehicle === false) {
        log(`DoorBird ${rt.config.name}: MOTION ohne Fahrzeug – kein Öffnungswunsch`);
        return;
      }
    }
  }

  rt.lastGateAlertAt = Date.now();
  try {
    const res = await api(
      `/api/hub/doorbird-gate?cameraId=${rt.config.id}&trigger=${trigger}`,
      {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { sent?: number };
    log(
      `DoorBird ${rt.config.name}: Öffnungswunsch (${trigger}) → Telegram (${data.sent ?? 0} Chats)`
    );
  } catch (e) {
    log(
      `DoorBird ${rt.config.name}: Öffnungswunsch fehlgeschlagen: ${e instanceof Error ? e.message : e}`
    );
  }
}

/**
 * Klingel/Bewegung: Snapshot-Versuche mit Gesichts-Pipeline; bei Klingeln
 * wird das Bild auch ohne Gesicht als Kamera-Schnappschuss hochgeladen.
 */
async function runSnapshotPipeline(rt: DoorbirdRuntime, trigger: "DOORBELL" | "MOTION") {
  const now = Date.now();
  if (now - rt.lastEventPipelineAt < EVENT_THROTTLE_MS) return;
  rt.lastEventPipelineAt = now;

  const c = rt.config;
  let buf: Buffer | null = null;
  let face: Awaited<ReturnType<typeof embedJpeg>> = null;

  for (let attempt = 1; attempt <= SNAP_ATTEMPTS; attempt++) {
    try {
      buf = await captureSnap(c);
    } catch (e) {
      log(`DoorBird ${c.name}: Snapshot fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      return;
    }
    face = await embedJpeg(buf);
    if (face) break;
    if (attempt < SNAP_ATTEMPTS) await new Promise((r) => setTimeout(r, SNAP_RETRY_MS));
  }
  if (!buf) return;

  // Öffnungswunsch parallel zur Gesichts-Pipeline (blockiert sie nicht).
  void maybeSendGateAlert(rt, trigger, buf);

  // Klingeln: Schnappschuss immer in die Cloud (UI-Kachel), auch ohne Gesicht.
  if (trigger === "DOORBELL") {
    try {
      await api(`/api/hub/cameras/${c.id}/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      // Sighting-Upload unten ist wichtiger.
    }
  }

  if (!face) {
    log(`DoorBird ${c.name}: ${trigger} ohne erkennbares Gesicht (${SNAP_ATTEMPTS} Versuche)`);
    return;
  }

  await refreshGallery();
  const match = matchEmbedding(face.embedding);
  const qs = new URLSearchParams({ cameraId: String(c.id) });
  if (match) {
    qs.set("listedPersonId", String(match.listedPersonId));
    qs.set("matchScore", match.score.toFixed(4));
    qs.set("matchMethod", "FACE_EMBEDDING");
    log(`DoorBird ${c.name}: Match „${match.name}“ score=${match.score.toFixed(3)}`);
  } else {
    log(`DoorBird ${c.name}: klares Gesicht (det=${face.detScore.toFixed(2)}), kein Gallery-Match`);
  }

  try {
    const upload = await api(`/api/hub/person-sightings?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) throw new Error(`HTTP ${upload.status}`);
    log(`DoorBird ${c.name}: Personen-Sichtung hochgeladen (${buf.length} bytes)`);
  } catch (e) {
    log(`DoorBird ${c.name}: Sichtungs-Upload fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}

/** Zustandszeile aus monitor.cgi verarbeiten ("doorbell:H", "motionsensor:L" …). */
function handleMonitorLine(rt: DoorbirdRuntime, line: string): void {
  const m = line.trim().match(/^(doorbell|motionsensor):([HL])$/);
  if (!m) return;
  const key = m[1];
  const active = m[2] === "H";
  const prev = rt.states[key] ?? false;
  if (active === prev) return;
  rt.states[key] = active;

  const type = key === "doorbell" ? "DOORBELL" : "MOTION";
  log(`DoorBird ${rt.config.name}: ${type} ${active ? "aktiv" : "ende"}`);
  void reportEvent(rt.config.id, type, active ? "start" : "end");
  if (active) {
    void runSnapshotPipeline(rt, type as "DOORBELL" | "MOTION");
  }
}

/** monitor.cgi Dauerverbindung mit Reconnect + Idle-Watchdog. */
async function monitorLoop(rt: DoorbirdRuntime): Promise<void> {
  while (!rt.stopped) {
    const abort = new AbortController();
    rt.abort = abort;
    let idleTimer: NodeJS.Timeout | null = null;
    let seenTimer: NodeJS.Timeout | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort.abort(new Error("idle")), IDLE_TIMEOUT_MS);
    };

    try {
      const res = await fetch(
        `${baseUrl(rt.config)}/bha-api/monitor.cgi?ring=doorbell,motionsensor`,
        { headers: { Authorization: authHeader(rt.config) }, signal: abort.signal }
      );
      if (!res.ok || !res.body) throw new Error(`monitor.cgi HTTP ${res.status}`);
      if (rt.unreachableLogged) {
        log(`DoorBird ${rt.config.name}: wieder erreichbar`);
        rt.unreachableLogged = false;
      }
      rt.reconnectDelay = RECONNECT_MIN_MS;
      resetIdle();

      // Erreichbarkeit melden (UI-Online-Status), solange verbunden.
      const seenPing = () =>
        api("/api/hub/camera-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seen: [rt.config.id], events: [] }),
        }).catch(() => undefined);
      void seenPing();
      seenTimer = setInterval(seenPing, SEEN_PING_MS);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handleMonitorLine(rt, line);
        }
        if (buffer.length > 4096) buffer = buffer.slice(-1024);
      }
    } catch (e) {
      if (!rt.stopped && !rt.unreachableLogged) {
        log(
          `DoorBird ${rt.config.name}: Monitor getrennt (${e instanceof Error ? e.message : e}) – Reconnect …`
        );
        rt.unreachableLogged = true;
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (seenTimer) clearInterval(seenTimer);
      rt.abort = null;
    }

    if (rt.stopped) break;
    await new Promise((r) => setTimeout(r, rt.reconnectDelay));
    rt.reconnectDelay = Math.min(rt.reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}

/**
 * DoorBird-Konfigurationen synchronisieren (wird vom Kamera-Refresh gerufen).
 * Startet/stoppt Monitor-Verbindungen entsprechend.
 */
export function syncDoorbirds(configs: CameraConfig[]): void {
  const ids = new Set(configs.map((c) => c.id));
  for (const [id, rt] of doorbirds) {
    if (!ids.has(id)) {
      rt.stopped = true;
      rt.abort?.abort(new Error("removed"));
      doorbirds.delete(id);
      log(`DoorBird ${rt.config.name}: entfernt`);
    }
  }
  for (const config of configs) {
    const existing = doorbirds.get(config.id);
    if (existing) {
      // Host-Wechsel (z. B. VLAN-Umzug): lokale Stream-Konfiguration
      // (go2rtc.yaml + Kiosk-config.json) nachziehen und Monitor neu verbinden.
      const oldHost = existing.config.host;
      if (oldHost && config.host && oldHost !== config.host) {
        log(`DoorBird ${config.name}: Host ${oldHost} → ${config.host} (Cloud) – Streams werden umgestellt`);
        void updateLocalStreams(oldHost, config.host).catch(() => {});
        existing.config = config;
        existing.abort?.abort(new Error("host-changed"));
        continue;
      }
      existing.config = config;
      continue;
    }
    const rt: DoorbirdRuntime = {
      config,
      abort: null,
      reconnectDelay: RECONNECT_MIN_MS,
      states: {},
      lastEventPipelineAt: 0,
      lastGateAlertAt: 0,
      stopped: false,
      unreachableLogged: false,
    };
    doorbirds.set(config.id, rt);
    log(`DoorBird ${config.name}: Monitor startet (${config.host})`);
    void monitorLoop(rt);
  }
}
