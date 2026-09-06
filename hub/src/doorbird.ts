/**
 * DoorBird-Modul: spricht DoorBird-Türstationen über die lokale LAN-API an.
 *
 * - monitor.cgi: Dauerverbindung, meldet Klingel-/Bewegungs-Events sofort
 * - image.cgi:   Schnappschuss (JPEG)
 * - open-door.cgi: Türöffner-Relais (Task DOORBIRD_OPEN aus der Cloud);
 *   „Tor offen halten“ (Task DOORBIRD_HOLD) löst es bis zum Endzeitpunkt im
 *   Takt erneut aus, weil das Tor sonst ~1 min nach jedem Impuls schließt.
 *
 * Klingel/Bewegung → Snapshot → Gesichts-Pipeline (wie Reolink-PERSON).
 */
import { api, log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { embedJpeg, scoreGallery, refreshGallery } from "./face.js";
import { jpegContainsVehicle } from "./vision.js";
import type { CameraConfig, LastPerson } from "./cameras.js";
import { updateLocalStreams } from "./streams.js";
import { improve } from "./improve-log.js";
import { PERSON_SNAPSHOT_MAX_PX, shrinkJpeg } from "./image.js";

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
/**
 * Tor offen halten: Abstand der Relais-Impulse. Muss unter der Zeit liegen,
 * nach der das Tor von selbst schließt (~60 s), sonst fällt es zwischen zwei
 * Impulsen kurz zu. Env: HUB_GATE_HOLD_PULSE (Sekunden, min. 10).
 */
const HOLD_PULSE_MS = (() => {
  const n = Number(process.env.HUB_GATE_HOLD_PULSE);
  return (Number.isFinite(n) && n >= 10 ? n : 50) * 1000;
})();
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
  /** Laufende Tor-Offenhaltung (Task DOORBIRD_HOLD), null = aus. */
  hold: DoorbirdHold | null;
  /**
   * Endzeitpunkt der zuletzt per Task beendeten Offenhaltung: Eine verspätete
   * Konfig-Antwort mit genau diesem Wert darf sie nicht wieder starten.
   */
  holdStoppedUntil: number | null;
  /* Nur fuer das lokale Dashboard. */
  connected: boolean;
  lastEventAt: string | null;
  lastPerson: LastPerson | null;
}

interface DoorbirdHold {
  /** Endzeitpunkt (ms seit Epoche). */
  until: number;
  relay: number;
  timer: NodeJS.Timeout | null;
  startedAt: number;
  pulses: number;
  failures: number;
  lastPulseAt: number | null;
  lastError: string | null;
  /** Impuls läuft gerade – kein Doppelfeuer, wenn die DoorBird langsam antwortet. */
  busy: boolean;
}

/** Offenhalte-Zustand für Task-Antwort und lokales Dashboard. */
export interface DoorbirdHoldState {
  active: boolean;
  until: string | null;
  pulses: number;
  lastPulseAt: string | null;
  lastError: string | null;
  pulseSec: number;
}

export interface DoorbirdStatus {
  id: number;
  name: string;
  host: string;
  connected: boolean;
  activeStates: string[];
  lastEventAt: string | null;
  lastPerson: LastPerson | null;
  hold: DoorbirdHoldState | null;
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

/** Türöffner-Relais schalten (Task DOORBIRD_OPEN, Offenhalte-Impulse). */
export async function openDoorbirdDoor(
  cameraId: number,
  relay = 1,
  opts: { quiet?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
  const rt = doorbirds.get(cameraId);
  if (!rt) return { ok: false, error: `DoorBird ${cameraId} nicht konfiguriert` };
  try {
    const res = await fetch(
      `${baseUrl(rt.config)}/bha-api/open-door.cgi?r=${encodeURIComponent(relay)}`,
      { headers: { Authorization: authHeader(rt.config) }, signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return { ok: false, error: `open-door.cgi HTTP ${res.status}` };
    // Offenhalte-Impulse kommen alle 50 s – die würden das Log fluten.
    if (!opts.quiet) log(`DoorBird ${rt.config.name}: Tür geöffnet (Relais ${relay})`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------------------------------------------------------------------
 * Tor offen halten (Task DOORBIRD_HOLD)
 *
 * Zielzustand ist Camera.doorHoldUntil in der Cloud. Start/Verlängern/Beenden
 * kommen als Task (sofort); nach einem Neustart nimmt syncDoorbirds eine
 * laufende Offenhaltung aus der Kamera-Konfiguration wieder auf. Jeder Impuls
 * wird an die Cloud gemeldet (UI zeigt „Impuls vor n s“ bzw. den Fehler).
 * ------------------------------------------------------------------------- */

const EMPTY_HOLD: DoorbirdHoldState = {
  active: false,
  until: null,
  pulses: 0,
  lastPulseAt: null,
  lastError: null,
  pulseSec: HOLD_PULSE_MS / 1000,
};

function holdState(rt: DoorbirdRuntime): DoorbirdHoldState {
  const h = rt.hold;
  if (!h) return EMPTY_HOLD;
  return {
    active: true,
    until: new Date(h.until).toISOString(),
    pulses: h.pulses,
    lastPulseAt: h.lastPulseAt ? new Date(h.lastPulseAt).toISOString() : null,
    lastError: h.lastError,
    pulseSec: HOLD_PULSE_MS / 1000,
  };
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Impuls-Ergebnis an die Cloud melden (doorHoldPulseAt / doorHoldError). */
async function reportHoldPulse(rt: DoorbirdRuntime, ok: boolean, error?: string): Promise<void> {
  try {
    const res = await api(`/api/hub/cameras/${rt.config.id}/door-hold`, {
      method: "POST",
      body: JSON.stringify({ pulsedAt: new Date().toISOString(), ok, error }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    log(`DoorBird ${rt.config.name}: Offenhalte-Meldung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}

function endHold(rt: DoorbirdRuntime, reason: "beendet" | "abgelaufen" | "entfernt"): void {
  const h = rt.hold;
  if (!h) return;
  if (h.timer) clearInterval(h.timer);
  rt.hold = null;
  rt.holdStoppedUntil = h.until;
  const minutes = Math.round((Date.now() - h.startedAt) / 60_000);
  log(
    `DoorBird ${rt.config.name}: Offen halten ${reason} (${h.pulses} Impulse, ${h.failures} Fehler, ${minutes} min)`
  );
  recordHubEvent({
    kind: "doorbird",
    severity: "info",
    where: rt.config.name,
    title: `Offen halten ${reason}`,
    detail: `${h.pulses} Impulse · ${minutes} min`,
  });
  improve("doorbird", "hold_end", { name: rt.config.name, reason, pulses: h.pulses, failures: h.failures });
}

/** Ein Relais-Impuls der laufenden Offenhaltung; beendet sie am Endzeitpunkt. */
async function holdPulse(rt: DoorbirdRuntime): Promise<{ ok: boolean; error?: string }> {
  const h = rt.hold;
  if (!h) return { ok: false, error: "keine Offenhaltung aktiv" };
  if (Date.now() >= h.until) {
    endHold(rt, "abgelaufen");
    return { ok: true };
  }
  if (h.busy) return { ok: true };
  h.busy = true;
  try {
    const r = await openDoorbirdDoor(rt.config.id, h.relay, { quiet: true });
    // Inzwischen beendet oder ersetzt: nichts mehr verbuchen.
    if (rt.hold !== h) return r;
    if (r.ok) {
      h.pulses++;
      h.lastPulseAt = Date.now();
      if (h.lastError) {
        log(`DoorBird ${rt.config.name}: Offenhalte-Impuls wieder erfolgreich`);
        recordHubEvent({
          kind: "doorbird",
          severity: "info",
          where: rt.config.name,
          title: "Offen halten: Impuls wieder erfolgreich",
        });
      }
      h.lastError = null;
    } else {
      h.failures++;
      const first = h.lastError === null;
      h.lastError = r.error ?? "Impuls fehlgeschlagen";
      log(`DoorBird ${rt.config.name}: Offenhalte-Impuls fehlgeschlagen: ${h.lastError}`);
      if (first) {
        recordHubEvent({
          kind: "doorbird",
          severity: "warn",
          where: rt.config.name,
          title: "Offen halten: Impuls fehlgeschlagen",
          detail: h.lastError,
        });
      }
      improve("doorbird", "hold_pulse_fail", { name: rt.config.name, error: h.lastError });
    }
    void reportHoldPulse(rt, r.ok, r.error);
    return r;
  } finally {
    h.busy = false;
  }
}

/**
 * Offenhaltung setzen: `untilIso` in der Zukunft = starten bzw. Endzeitpunkt
 * übernehmen (Verlängern/Verkürzen ohne Taktbruch), null/vergangen = beenden.
 * Schlägt nur fehl, wenn die DoorBird hier unbekannt ist; ein fehlgeschlagener
 * erster Impuls steht in `state.lastError`, der Takt versucht es weiter.
 */
export async function setDoorbirdHold(
  cameraId: number,
  untilIso: string | null,
  opts: { relay?: number; source: "task" | "config" }
): Promise<{ ok: boolean; error?: string; state: DoorbirdHoldState }> {
  const rt = doorbirds.get(cameraId);
  if (!rt) {
    return { ok: false, error: `DoorBird ${cameraId} nicht konfiguriert`, state: EMPTY_HOLD };
  }
  const untilMs = untilIso ? Date.parse(untilIso) : NaN;
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
    if (rt.hold) endHold(rt, "beendet");
    return { ok: true, state: holdState(rt) };
  }
  const relay = opts.relay && opts.relay > 0 ? opts.relay : 1;

  if (rt.hold) {
    if (rt.hold.until !== untilMs) {
      rt.hold.until = untilMs;
      rt.hold.relay = relay;
      log(`DoorBird ${rt.config.name}: Offen halten jetzt bis ${fmtClock(untilMs)} (${opts.source})`);
    }
    return { ok: true, state: holdState(rt) };
  }

  const hold: DoorbirdHold = {
    until: untilMs,
    relay,
    timer: null,
    startedAt: Date.now(),
    pulses: 0,
    failures: 0,
    lastPulseAt: null,
    lastError: null,
    busy: false,
  };
  rt.hold = hold;
  rt.holdStoppedUntil = null;
  log(
    `DoorBird ${rt.config.name}: Offen halten bis ${fmtClock(untilMs)} – Impuls alle ${HOLD_PULSE_MS / 1000} s (${opts.source})`
  );
  recordHubEvent({
    kind: "doorbird",
    severity: "info",
    where: rt.config.name,
    title: "Offen halten gestartet",
    detail: `bis ${fmtClock(untilMs)} Uhr · Impuls alle ${HOLD_PULSE_MS / 1000} s`,
  });
  improve("doorbird", "hold_start", {
    name: rt.config.name,
    source: opts.source,
    minutes: Math.round((untilMs - Date.now()) / 60_000),
  });
  hold.timer = setInterval(() => {
    void holdPulse(rt);
  }, HOLD_PULSE_MS);
  // Erster Impuls sofort – das Ergebnis geht mit in die Task-Antwort.
  const first = await holdPulse(rt);
  return { ok: true, error: first.ok ? undefined : first.error, state: holdState(rt) };
}

/**
 * Zielzustand aus der Cloud-Konfiguration übernehmen (Neustart, Verlängerung
 * ohne Task). Beenden nur per Task: Eine verspätete, veraltete Konfig-Antwort
 * darf eine frische Offenhaltung nicht stoppen und eine eben beendete nicht
 * neu starten (holdStoppedUntil).
 */
function applyConfigHold(rt: DoorbirdRuntime): void {
  const iso = rt.config.doorHoldUntil;
  if (!iso) return;
  const untilMs = Date.parse(iso);
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return;
  if (rt.holdStoppedUntil === untilMs) return;
  if (rt.hold?.until === untilMs) return;
  void setDoorbirdHold(rt.config.id, iso, { source: "config" });
}

/** Ist die Kamera als DoorBird beim Hub registriert? */
export function isDoorbird(cameraId: number): boolean {
  return doorbirds.has(cameraId);
}

/** IDs der lokal verbundenen DoorBirds (für Fahrzeug-Aktoren). */
export function listDoorbirdIds(): number[] {
  return [...doorbirds.keys()];
}

/** DoorBird-Lage fuer das lokale Dashboard (ohne Zugangsdaten). */
export function listDoorbirdStatus(): DoorbirdStatus[] {
  return [...doorbirds.values()]
    .map((rt) => ({
      id: rt.config.id,
      name: rt.config.name,
      host: rt.config.host,
      connected: rt.connected,
      activeStates: Object.entries(rt.states)
        .filter(([, active]) => active)
        .map(([key]) => (key === "doorbell" ? "DOORBELL" : "MOTION")),
      lastEventAt: rt.lastEventAt,
      lastPerson: rt.lastPerson,
      hold: rt.hold ? holdState(rt) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
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
      // Nahaufnahme an der Tür: keine Größenschwelle, jede Fahrzeug-Box zählt.
      const vehicle = await jpegContainsVehicle(buf, { quick: true, minArea: 0, label: rt.config.name });
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
    improve("doorbird", "no_face", { name: c.name, trigger });
    return;
  }

  await refreshGallery();
  const scored = scoreGallery(face.embedding, { upscaled: face.upscaled });
  const match = scored.match;
  const qs = new URLSearchParams({ cameraId: String(c.id) });
  if (match) {
    qs.set("listedPersonId", String(match.listedPersonId));
    qs.set("matchScore", match.score.toFixed(4));
    qs.set("matchMethod", "FACE_EMBEDDING");
    log(`DoorBird ${c.name}: Match „${match.name}“ score=${match.score.toFixed(3)}`);
  } else {
    const near = scored.nearest;
    log(
      `DoorBird ${c.name}: klares Gesicht (det=${face.detScore.toFixed(2)}), kein Gallery-Match` +
        (near
          ? ` (best ${near.score.toFixed(3)} „${near.name}“, n=${scored.gallery}, ≥${scored.threshold.toFixed(2)})`
          : ` (Gallery leer)`)
    );
  }
  improve("doorbird", match ? "match" : "face", {
    name: c.name,
    score: match?.score ?? scored.nearest?.score,
    threshold: scored.threshold,
    gallery: scored.gallery,
    upscaled: face.upscaled,
  });
  rt.lastPerson = {
    at: new Date().toISOString(),
    name: match?.name ?? scored.nearest?.name ?? null,
    score: match?.score ?? scored.nearest?.score ?? null,
    threshold: scored.threshold,
    matched: !!match,
  };
  recordHubEvent({
    kind: "person",
    severity: match ? "alert" : "info",
    where: c.name,
    title: match ? `Person erkannt: ${match.name}` : "Person unbekannt",
    detail: match
      ? undefined
      : scored.nearest
        ? `best ${scored.nearest.score.toFixed(3)} „${scored.nearest.name}“ (n=${scored.gallery}, ≥${scored.threshold.toFixed(2)})`
        : "Gallery leer",
    score: match?.score ?? scored.nearest?.score,
  });

  try {
    const uploadBuf = await shrinkJpeg(buf, PERSON_SNAPSHOT_MAX_PX);
    const upload = await api(`/api/hub/person-sightings?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(uploadBuf),
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
  rt.lastEventAt = new Date().toISOString();
  recordHubEvent({
    kind: "doorbird",
    severity: active && type === "DOORBELL" ? "alert" : "info",
    where: rt.config.name,
    title: `${type === "DOORBELL" ? "Klingel" : "Bewegung"} ${active ? "aktiv" : "ende"}`,
  });
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
        improve("doorbird", "monitor_ok", { name: rt.config.name });
        recordHubEvent({
          kind: "doorbird",
          severity: "info",
          where: rt.config.name,
          title: "Monitor wieder verbunden",
        });
      }
      rt.connected = true;
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
        improve("doorbird", "monitor_drop", {
          name: rt.config.name,
          error: e instanceof Error ? e.message : String(e),
        });
        recordHubEvent({
          kind: "doorbird",
          severity: "warn",
          where: rt.config.name,
          title: "Monitor getrennt",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      rt.connected = false;
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
      endHold(rt, "entfernt");
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
        applyConfigHold(existing);
        continue;
      }
      existing.config = config;
      applyConfigHold(existing);
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
      hold: null,
      holdStoppedUntil: null,
      connected: false,
      lastEventAt: null,
      lastPerson: null,
    };
    doorbirds.set(config.id, rt);
    log(`DoorBird ${config.name}: Monitor startet (${config.host})`);
    improve("doorbird", "monitor_start", { name: config.name, host: config.host });
    void monitorLoop(rt);
    // Laufende Offenhaltung (z. B. nach Hub-Neustart) wieder aufnehmen.
    applyConfigHold(rt);
  }
}
