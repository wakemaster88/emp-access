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
import { noteTriggeredRules, onCameraEvent } from "./rules.js";
import { kickIfRulesTriggered } from "./task-kick.js";
import { CONFIG, api, log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { embedJpeg, embeddingHeader, noteOtherWay, scoreGallery, refreshGallery } from "./face.js";
import { faceLabel, galleryMargin, sightingQualityNote, sightingQualityParams } from "./face-rules.js";
import { jpegContainsVehicle } from "./vision.js";
import type { CameraConfig, LastPerson } from "./cameras.js";
import { updateLocalStreams } from "./streams.js";
import { findIpByMac, invalidateArpCache, macForIp, macTable, normalizeMac, readRouterArp } from "./netmap.js";
import { improve, improveCount } from "./improve-log.js";
import { afterReport, fastRetrySafe, reportApplies, retryDelayAfter, retryStillDue } from "./hold-rules.js";
import { RELOCATE_MIN_GAP_MS, httpAnswerOutcome, shouldRelocate, type ConnectFailure, type HttpAnswerOutcome } from "./camera-poll-rules.js";
import { PERSON_SNAPSHOT, shrinkJpeg } from "./image.js";
import { authAlertSource, authOutcome, credentialFingerprint, type LatchGate } from "./auth-latch.js";
import { authLatches } from "./auth-latch-store.js";
import { previewUploadAllowed, readLiveMode, type LiveMode } from "./live-mode-rules.js";

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
  /** MAC lernen / per MAC wiederfinden (wie bei den Reolink-Kameras). */
  lastMacLearnAt: number;
  lastRelocateAt: number;
  /** Suche nach neuer Adresse läuft (im Hintergrund, nie zwei zugleich). */
  relocating: boolean;
  /** Verbindungsversuche in Folge, die an einem Netzfehler scheiterten (shouldRelocate). */
  netFailStreak: number;
  /** Beginn der Lücke seit „Monitor getrennt“ (ms), 0 = verbunden. */
  unreachableSince: number;
  /** Beendet die laufende Wartezeit bis zum nächsten Verbindungsversuch. */
  wakeReconnect: (() => void) | null;
  /** Nächster Verbindungsversuch ohne Wartezeit (neue Adresse). */
  wakePending: boolean;
  /** Zugangsdaten abgelehnt: keine Anfragen mit ihnen (auth-latch.ts). */
  authLocked: boolean;
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
  /** Gescheiterte Impulse in Folge seit dem letzten gelungenen (hold-rules.ts retryDelayAfter). */
  failStreak: number;
  /** Geplante Wiederholung eines gescheiterten Impulses. */
  retryTimer: NodeJS.Timeout | null;
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
  /** Livebild und Vorschau (live-mode-rules.ts): Kachel und Livebild in der Zentrale. */
  liveMode: LiveMode;
}

const doorbirds = new Map<number, DoorbirdRuntime>();

function baseUrl(c: CameraConfig): string {
  return `${c.https ? "https" : "http"}://${c.host}:${c.httpPort}`;
}

function authHeader(c: CameraConfig): string {
  return "Basic " + Buffer.from(`${c.username}:${c.password}`).toString("base64");
}

/* ---------------------------------------------------------------------------
 * Zugangsdaten abgelehnt (Regeln in auth-latch.ts, Zustand in
 * hub/.cache/auth-latch.json): Nach zwei Antworten 401/403 der
 * Dauerverbindung (monitor.cgi) in Folge schickt der Hub die Zugangsdaten
 * nicht mehr an diese DoorBird, weder fuer die Dauerverbindung noch fuer
 * Oeffnen oder Bild, und sucht keine neue Adresse. Eine Ablehnung beim
 * Oeffnen oder beim Bild zaehlt nicht: Sie kann an einer fehlenden
 * Berechtigung fuer genau diese Funktion liegen (etwa Relais 2), und die
 * Sperre traefe dann auch Relais 1 und die Klingel. Angenommen beim Oeffnen
 * oder beim Bild loescht eine einzelne Ablehnung der Dauerverbindung.
 * Die Sperre loest sich mit geaenderten Zugangsdaten (oder Adresse) in der
 * Cloud und mit einem gelungenen Versuch; einmal in 24 Stunden gibt es einen
 * einzelnen Versuch. Beim Eintritt und beim Loesen je eine Zeile im Log und
 * ein Hub-Ereignis; der Befund geht an die Cloud (POST /api/hub/alerts, dort
 * Push und Telegram) und wird beim Loesen dort geschlossen.
 * ------------------------------------------------------------------------- */

const authKey = (c: CameraConfig) => `doorbird:${c.id}`;
/** Zugangsdaten samt Ziel: Eine neue Adresse in der Cloud loest die Sperre wie ein neues Passwort. */
const authFp = (c: CameraConfig) => credentialFingerprint(c.host, c.httpPort, c.https, c.username, c.password);
const AUTH_BLOCKED = "Zugangsdaten abgelehnt – kein Versuch, bis sie in der Cloud geändert werden";

const berlinTime = (ms: number) =>
  new Date(ms).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function setAuthLocked(rt: DoorbirdRuntime, locked: boolean, why: string): void {
  if (rt.authLocked === locked) return;
  rt.authLocked = locked;
  if (locked) {
    log(
      `DoorBird ${rt.config.name}: Zugangsdaten abgelehnt (${why}) – keine weiteren Versuche, ` +
        "bis sie in der Cloud geändert werden; ein einzelner Versuch alle 24 h"
    );
    improve("doorbird", "auth_locked", { name: rt.config.name, why });
    recordHubEvent({
      kind: "doorbird",
      severity: "warn",
      where: rt.config.name,
      title: "Zugangsdaten abgelehnt",
      detail: "keine weiteren Versuche bis zur Änderung in der Cloud",
    });
  } else {
    log(`DoorBird ${rt.config.name}: Sperre der Zugangsdaten aufgehoben (${why})`);
    improve("doorbird", "auth_released", { name: rt.config.name, why });
    recordHubEvent({ kind: "doorbird", severity: "info", where: rt.config.name, title: "Zugangsdaten wieder freigegeben", detail: why });
    // Die Dauerverbindung wartet womoeglich auf den naechsten einzelnen Versuch.
    wakeMonitor(rt);
  }
  syncAuthAlerts();
}

/**
 * Vor jeder Anfrage mit Zugangsdaten: darf sie hinaus? Oeffnen und Bild
 * (`funktion`) nehmen der Dauerverbindung den einzelnen Versuch je 24 h
 * nicht weg: Waehrend einer Sperre gehen sie nie hinaus.
 */
async function authGate(c: CameraConfig, use: "dauer" | "funktion" = "dauer"): Promise<LatchGate> {
  await authLatches.ready();
  if (use === "funktion" && authLatches.locked(authKey(c), authFp(c))) {
    return { allow: false, entry: null, released: null, single: false, nextTryAt: null };
  }
  const g = authLatches.gate(authKey(c), authFp(c), Date.now());
  const rt = doorbirds.get(c.id);
  if (g.released && rt) {
    setAuthLocked(rt, false, g.released === "zugangsdaten" ? "Zugangsdaten oder Adresse in der Cloud geändert" : "Eintrag in der Cloud neu gespeichert");
  }
  return g;
}

/**
 * HTTP-Antwort werten (camera-poll-rules.ts httpAnswerOutcome) und fuer die
 * Sperre verbuchen. Nach einem DHCP-Wechsel kann unter der alten Adresse ein
 * anderes Geraet antworten: Bei einer Antwort ungleich 2xx und bekannter MAC
 * der DoorBird schlaegt der Hub darum die MAC unter der Adresse frisch nach
 * (peerMac). Antwortet dort ein anderes Geraet, zaehlt das fuer die Sperre
 * wie keine Antwort und fuer die Adresssuche als Netzfehler.
 */
async function noteAnswer(c: CameraConfig, status: number, use: "dauer" | "funktion"): Promise<HttpAnswerOutcome> {
  const own = c.macAddress ? normalizeMac(c.macAddress) : null;
  const peer = own && !(status >= 200 && status < 300) ? await peerMac(c.host, status).catch(() => null) : null;
  const outcome = httpAnswerOutcome({ status, geraeteMac: own, gegenstelleMac: peer });
  if (outcome.fremd) improveCount("doorbird", "foreign_answer");
  authNote(c, outcome.authStatus, use);
  return outcome;
}

/**
 * MAC unter einer Adresse, frisch: die lokale ARP-Tabelle neu gelesen. Kennt
 * nur der Router die Adresse (geroutetes Netz), wird sein Stand bei einer
 * Ablehnung (401/403) ebenfalls neu geholt; sonst gilt sein gemerkter Stand
 * (hoechstens 2 min alt).
 */
async function peerMac(host: string, status: number): Promise<string | null> {
  invalidateArpCache();
  let seen = (await macTable()).get(host);
  if (seen?.source !== "arp" && (status === 401 || status === 403)) {
    await readRouterArp(true);
    seen = (await macTable()).get(host);
  }
  return seen?.mac ?? null;
}

/** Fehlertext einer Antwort ungleich 2xx, mit Hinweis, wenn ein anderes Geraet antwortete. */
function answerError(what: string, c: CameraConfig, status: number, outcome: HttpAnswerOutcome): string {
  return `${what} HTTP ${status}${outcome.fremd ? ` von einem anderen Gerät unter ${c.host}` : ""}`;
}

/**
 * Nach der Antwort (status null = keine Antwort). Fuer die Sperre zaehlt
 * bei Oeffnen und Bild (`funktion`) nur „angenommen“.
 */
function authNote(c: CameraConfig, status: number | null, use: "dauer" | "funktion"): void {
  const outcome = authOutcome(status);
  if (outcome === "abgelehnt") improveCount("doorbird", use === "dauer" ? "auth_rejected" : "auth_rejected_function");
  const counted = use === "dauer" || outcome === "ok" ? outcome : "keine";
  const n = authLatches.note(authKey(c), authFp(c), counted, Date.now());
  const rt = doorbirds.get(c.id);
  // Inzwischen andere Zugangsdaten: Die Antwort sagt ueber sie nichts.
  if (!rt || authFp(rt.config) !== authFp(c)) return;
  if (n.locked) setAuthLocked(rt, true, `HTTP ${status}, zweimal in Folge`);
  else if (n.released) setAuthLocked(rt, false, "Zugangsdaten angenommen");
}

const AUTH_ALERT_SOURCE = authAlertSource(CONFIG.name);
const AUTH_ALERT_RETRY_MS = 5 * 60_000;
/** Was die Cloud zuletzt bestaetigt hat (Liste der Befunde als JSON), null = unbekannt. */
let authAlertReported: string | null = null;
let authAlertBusy = false;
let authAlertAgain = false;
let authAlertTimer: NodeJS.Timeout | null = null;

/**
 * Befunde „Zugangsdaten abgelehnt“ an die Cloud: immer die ganze Liste dieses
 * Hubs (was fehlt, schliesst die Cloud). Nur bei Aenderung; nach dem Start
 * einmal vorsorglich; nach einem Fehlschlag in 5 min erneut.
 */
function syncAuthAlerts(): void {
  if (authAlertBusy) {
    authAlertAgain = true;
    return;
  }
  const alerts = [...doorbirds.values()]
    .filter((rt) => authLatches.locked(authKey(rt.config), authFp(rt.config)))
    .sort((a, b) => a.config.id - b.config.id)
    .map((rt) => ({
      key: `${AUTH_ALERT_SOURCE}:doorbird-${rt.config.id}`,
      title: `DoorBird ${rt.config.name}: Zugangsdaten abgelehnt`,
      detail:
        "Die DoorBird lehnt Benutzer oder Passwort ab. Der Hub versucht es nicht weiter, bis die " +
        "Zugangsdaten in der Cloud geändert werden (ein einzelner Versuch alle 24 Stunden).",
      severity: "warn",
    }));
  const content = JSON.stringify(alerts);
  if (content === authAlertReported) return;
  authAlertBusy = true;
  api("/api/hub/alerts", {
    method: "POST",
    body: JSON.stringify({ hubName: CONFIG.name, source: AUTH_ALERT_SOURCE, alerts }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      authAlertReported = content;
    })
    .catch(() => {
      authAlertReported = null;
      if (!authAlertTimer) {
        authAlertTimer = setTimeout(() => {
          authAlertTimer = null;
          syncAuthAlerts();
        }, AUTH_ALERT_RETRY_MS);
        authAlertTimer.unref?.();
      }
    })
    .finally(() => {
      authAlertBusy = false;
      if (authAlertAgain) {
        authAlertAgain = false;
        syncAuthAlerts();
      }
    });
}

/** Schnappschuss (JPEG) von der DoorBird holen. */
async function captureSnap(c: CameraConfig): Promise<Buffer> {
  if (!(await authGate(c, "funktion")).allow) throw new Error(AUTH_BLOCKED);
  let res: Response;
  try {
    res = await fetch(`${baseUrl(c)}/bha-api/image.cgi`, {
      headers: { Authorization: authHeader(c) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    authNote(c, null, "funktion");
    throw e;
  }
  if (!res.ok) await res.body?.cancel().catch(() => undefined);
  const outcome = await noteAnswer(c, res.status, "funktion");
  if (!res.ok) throw new Error(answerError("image.cgi", c, res.status, outcome));
  return Buffer.from(await res.arrayBuffer());
}

/** Türöffner-Relais schalten (Task DOORBIRD_OPEN, Offenhalte-Impulse). */
export async function openDoorbirdDoor(
  cameraId: number,
  relay = 1,
  opts: { quiet?: boolean } = {}
): Promise<{ ok: boolean; error?: string; retrySafe?: boolean }> {
  const rt = doorbirds.get(cameraId);
  // Ohne Anfrage an die DoorBird (nicht eingerichtet, gesperrt): keine schnelle Wiederholung, kein „offen“.
  if (!rt) return { ok: false, error: `DoorBird ${cameraId} nicht konfiguriert` };
  const c = rt.config;
  if (!(await authGate(c, "funktion")).allow) return { ok: false, error: AUTH_BLOCKED };
  try {
    let res: Response;
    try {
      res = await fetch(`${baseUrl(c)}/bha-api/open-door.cgi?r=${encodeURIComponent(relay)}`, {
        headers: { Authorization: authHeader(c) },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (e) {
      authNote(c, null, "funktion");
      throw e;
    }
    if (!res.ok) await res.body?.cancel().catch(() => undefined);
    const outcome = await noteAnswer(c, res.status, "funktion");
    if (!res.ok) {
      return {
        ok: false,
        error: answerError("open-door.cgi", c, res.status, outcome),
        retrySafe: fastRetrySafe({ httpStatus: res.status }),
      };
    }
    // Offenhalte-Impulse kommen alle 50 s – die würden das Log fluten.
    if (!opts.quiet) log(`DoorBird ${rt.config.name}: Tür geöffnet (Relais ${relay})`);
    return { ok: true };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } } | null;
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      retrySafe: fastRetrySafe({ errorName: err?.name ?? null, causeCode: err?.cause?.code ?? null }),
    };
  }
}

/* ---------------------------------------------------------------------------
 * Tor offen halten (Task DOORBIRD_HOLD)
 *
 * Zielzustand ist Camera.doorHoldUntil in der Cloud. Start/Verlängern/Beenden
 * kommen als Task (sofort); nach einem Neustart nimmt syncDoorbirds eine
 * laufende Offenhaltung aus der Kamera-Konfiguration wieder auf. Jeder Impuls
 * wird an die Cloud gemeldet (UI zeigt „Impuls vor n s“ bzw. den Fehler). Die
 * Antwort nennt den Zielzustand: Kennt die Cloud kein Offenhalten mehr, endet
 * es nach diesem Impuls, auch ohne Task; ein anderer Endzeitpunkt wird
 * übernommen (hold-rules.ts afterReport). Ohne Antwort läuft der Takt bis zum
 * lokal bekannten Ende weiter. Ein gescheiterter Impuls wird nach 3, 8 und
 * 20 s wiederholt, danach geht es im normalen Takt weiter.
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

/**
 * Impuls-Ergebnis an die Cloud melden (doorHoldPulseAt / doorHoldError) und
 * den Zielzustand aus der Antwort übernehmen: beenden, anderer Endzeitpunkt
 * oder weiter wie bisher. Die Antwort gilt nur für die Offenhaltung `h`, und
 * nur wenn sich ihr Ende während der Meldung nicht geändert hat.
 */
async function reportHoldPulse(rt: DoorbirdRuntime, h: DoorbirdHold, ok: boolean, error?: string): Promise<void> {
  const untilAtSend = h.until;
  let cloudUntil: unknown;
  try {
    const res = await api(`/api/hub/cameras/${rt.config.id}/door-hold`, {
      method: "POST",
      body: JSON.stringify({ pulsedAt: new Date().toISOString(), ok, error }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { until?: unknown } | null;
    // Eine Cloud ohne das Feld liefert undefined: weiter bis zum lokalen Ende.
    cloudUntil = body !== null && typeof body === "object" ? body.until : undefined;
  } catch (e) {
    log(`DoorBird ${rt.config.name}: Offenhalte-Meldung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!reportApplies({ sameHold: rt.hold === h, untilAtSend, untilNow: h.until })) return;
  const now = Date.now();
  const next = afterReport(untilAtSend, cloudUntil, now);
  if (next.action === "stop") {
    endHold(rt, now >= h.until ? "abgelaufen" : "in der Cloud beendet");
  } else if (next.action === "adopt") {
    h.until = next.until;
    log(`DoorBird ${rt.config.name}: Offen halten jetzt bis ${fmtClock(next.until)} (Zielzustand der Cloud)`);
    improveCount("doorbird", "hold_adopt");
  }
}

function endHold(rt: DoorbirdRuntime, reason: "beendet" | "abgelaufen" | "entfernt" | "in der Cloud beendet"): void {
  const h = rt.hold;
  if (!h) return;
  if (h.timer) clearInterval(h.timer);
  if (h.retryTimer) clearTimeout(h.retryTimer);
  h.retryTimer = null;
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
      // Gelungen nach einem gescheiterten Impuls (etwa die Wiederholung nach
      // 20 s): Der Takt beginnt ab hier neu, sonst kaeme der naechste Impuls
      // womoeglich schon Sekunden spaeter, waehrend das Tor noch faehrt.
      if (h.failStreak > 0) startHoldTimer(rt, h);
      h.failStreak = 0;
      if (h.retryTimer) clearTimeout(h.retryTimer);
      h.retryTimer = null;
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
      h.failStreak++;
      const first = h.lastError === null;
      h.lastError = r.error ?? "Impuls fehlgeschlagen";
      // Schnelle Wiederholung nur, wenn das Relais sicher nicht geschaltet hat
      // (hold-rules.ts fastRetrySafe); sonst im normalen Takt.
      const retryIn = r.retrySafe === true ? scheduleHoldRetry(rt, h) : null;
      log(
        `DoorBird ${rt.config.name}: Offenhalte-Impuls fehlgeschlagen: ${h.lastError}` +
          (retryIn !== null
            ? ` – neuer Versuch in ${retryIn / 1000} s`
            : r.retrySafe === false
              ? " – ob er angekommen ist, ist offen; nächster Impuls im normalen Takt"
              : "")
      );
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
    void reportHoldPulse(rt, h, r.ok, r.error).catch(() => undefined);
    return r;
  } finally {
    h.busy = false;
  }
}

/** Takt der Offenhaltung (alle HOLD_PULSE_MS) ab jetzt, ein laufender Takt endet. */
function startHoldTimer(rt: DoorbirdRuntime, h: DoorbirdHold): void {
  if (h.timer) clearInterval(h.timer);
  h.timer = setInterval(() => {
    holdPulse(rt).catch((e) => log(`DoorBird ${rt.config.name}: Offenhalte-Impuls: ${e instanceof Error ? e.message : e}`));
  }, HOLD_PULSE_MS);
}

/**
 * Wiederholung eines gescheiterten Impulses planen (3, 8, 20 s; hold-rules.ts).
 * Höchstens eine geplante Wiederholung zur Zeit; sie entfällt, sobald die
 * Offenhaltung endet oder ersetzt ist. Liefert die Wartezeit, null = keine.
 */
function scheduleHoldRetry(rt: DoorbirdRuntime, h: DoorbirdHold): number | null {
  if (h.retryTimer) return null;
  const delay = retryDelayAfter(h.failStreak);
  if (delay === null) return null;
  improveCount("doorbird", "hold_retry");
  h.retryTimer = setTimeout(() => {
    h.retryTimer = null;
    if (!retryStillDue({ sameHold: rt.hold === h, now: Date.now(), until: h.until })) return;
    holdPulse(rt).catch((e) => log(`DoorBird ${rt.config.name}: Offenhalte-Impuls: ${e instanceof Error ? e.message : e}`));
  }, delay);
  return delay;
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
    failStreak: 0,
    retryTimer: null,
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
  startHoldTimer(rt, hold);
  // Erster Impuls sofort – das Ergebnis geht mit in die Task-Antwort.
  const first = await holdPulse(rt);
  return { ok: true, error: first.ok ? undefined : first.error, state: holdState(rt) };
}

/**
 * Zielzustand aus der Cloud-Konfiguration übernehmen (Neustart, Verlängerung
 * ohne Task). Beenden per Task oder über die Antwort auf die Impuls-Meldung
 * (reportHoldPulse), nicht hier: Eine verspätete, veraltete Konfig-Antwort
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
      liveMode: readLiveMode(rt.config.liveMode),
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
export async function uploadDoorbirdSnapshot(cameraId: number): Promise<{ bytes: number; skipped?: "liveMode" }> {
  const rt = doorbirds.get(cameraId);
  if (!rt) throw new Error(`DoorBird ${cameraId} nicht konfiguriert`);
  // Livebild und Vorschau „nur auf Tippen“ oder „aus“: kein Vorschaubild in die Cloud.
  if (!previewUploadAllowed(rt.config.liveMode)) return { bytes: 0, skipped: "liveMode" };
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

/**
 * Ein Ende, dessen Meldung scheitert, noch dreimal versuchen. Ohne das Ende
 * bleibt das Ereignis in der Cloud offen und gilt dort als laufend. Ein
 * Beginn wird nicht wiederholt: Er loest Regeln und den Klingel-Push aus,
 * und die sollen nicht Minuten spaeter kommen.
 */
const END_RETRY_MS = [10_000, 60_000, 300_000];

/** Event an die Cloud melden (DOORBELL/MOTION start/end). */
async function reportEvent(
  cameraId: number,
  type: string,
  phase: "start" | "end",
  at = new Date().toISOString(),
  attempt = 0
): Promise<void> {
  // DoorBird: Bewegungs-Regeln schaltet die Cloud (source), der Hub nur im Notbetrieb.
  if (phase === "start" && attempt === 0) onCameraEvent(cameraId, type, { source: "doorbird" });
  try {
    const sentAt = performance.now();
    const res = await api("/api/hub/camera-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Erreichbar war die DoorBird zum Zeitpunkt des Ereignisses, nicht der Wiederholung.
        ...(attempt === 0 ? { seen: [cameraId] } : {}),
        events: [{ cameraId, type, phase, at }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Regel ausgelöst (z. B. Klingel → Kamera auf Preset): Tasks sofort holen.
    const body = await kickIfRulesTriggered(res);
    // Je ausgelöster Regel eine Log-Zeile mit Antwortzeit der Cloud.
    noteTriggeredRules(body, performance.now() - sentAt);
  } catch (e) {
    const retryIn = phase === "end" ? END_RETRY_MS[attempt] : undefined;
    log(
      `DoorBird Event-Meldung fehlgeschlagen: ${e instanceof Error ? e.message : e}` +
        (retryIn ? ` – Ende wird in ${Math.round(retryIn / 1000)} s noch einmal gemeldet` : "")
    );
    if (retryIn) {
      setTimeout(() => void reportEvent(cameraId, type, phase, at, attempt + 1), retryIn);
    }
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

  // Klingeln: Schnappschuss immer in die Cloud (UI-Kachel), auch ohne Gesicht;
  // nicht bei Livebild und Vorschau „nur auf Tippen“ oder „aus“.
  if (trigger === "DOORBELL" && previewUploadAllowed(c.liveMode)) {
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
  // Wie bei den Kameras: in Stufe on bleibt ein Sperrlisten-Treffer, den nur
  // das bisherige Merkmal liefert (noteOtherWay); dann geht dessen Merkmal hoch.
  const applied = noteOtherWay(`DoorBird ${c.name}`, face, scoreGallery(face.embedding, { upscaled: face.upscaled }));
  const scored = applied.scored;
  if (applied.embedding !== face.embedding) face = { ...face, embedding: applied.embedding };
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
      `DoorBird ${c.name}: ${faceLabel(face)}, kein Gallery-Match` +
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

  // Guete des Gesichts wie bei den Kameras (face-rules.ts sightingQualityParams):
  // Die Cloud lernt nur aus klaren, nicht hochgerechneten Treffern dazu.
  const quality = sightingQualityParams(face, galleryMargin(scored));
  for (const [k, v] of Object.entries(quality)) qs.set(k, v);
  try {
    const uploadBuf = await shrinkJpeg(buf, PERSON_SNAPSHOT.maxPx, PERSON_SNAPSHOT.quality);
    const upload = await api(`/api/hub/person-sightings?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Face-Embedding": embeddingHeader(face.embedding) },
      body: new Uint8Array(uploadBuf),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) throw new Error(`HTTP ${upload.status}`);
    log(
      `DoorBird ${c.name}: Personen-Sichtung hochgeladen (${uploadBuf.length} bytes` +
        (uploadBuf.length !== buf.length ? `, Original ${buf.length}` : "") +
        `, Gesicht ${sightingQualityNote(quality)})`
    );
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

/* ---------------------------------------------------------------------------
 * MAC-basiertes Wiederfinden: Die DoorBird (Tor!) haengt bisher an der festen
 * IP 192.168.1.191. Der Hub lernt ihre MAC, solange sie erreichbar ist, und
 * sucht sie per MAC unter neuer IP (lokale ARP-Tabelle, Router-ARP per SNMP,
 * notfalls Ping-Sweep der direkt angeschlossenen Netze). Nach einem Abbruch
 * verbindet er zuerst neu; gesucht wird erst nach zwei Netzfehlern in Folge
 * und dann im Hintergrund (camera-poll-rules.ts shouldRelocate). Antwortet
 * unter der Adresse ein Geraet mit anderer MAC, zaehlt das als Netzfehler
 * (noteAnswer).
 * ------------------------------------------------------------------------- */

const DOORBIRD_MAC_LEARN_MS = 3_600_000;

async function reportDoorbirdNetwork(
  id: number,
  data: { macAddress?: string; host?: string }
): Promise<boolean> {
  const res = await api(`/api/hub/cameras/${id}/network`, {
    method: "POST",
    body: JSON.stringify(data),
  }).catch(() => null);
  return !!res?.ok;
}

async function learnDoorbirdMac(rt: DoorbirdRuntime): Promise<void> {
  if (Date.now() - rt.lastMacLearnAt < DOORBIRD_MAC_LEARN_MS) return;
  rt.lastMacLearnAt = Date.now();
  try {
    const mac = await macForIp(rt.config.host);
    if (!mac || mac === rt.config.macAddress) return;
    if (await reportDoorbirdNetwork(rt.config.id, { macAddress: mac })) {
      rt.config.macAddress = mac;
      log(`DoorBird ${rt.config.name}: MAC ${mac} gelernt (${rt.config.host})`);
    }
  } catch {
    // Best-effort
  }
}

/**
 * Suche nach neuer IP per MAC, im Hintergrund neben dem Neuverbinden. Findet
 * sie die DoorBird, endet die laufende Wartezeit (und ein Verbindungsversuch
 * an die alte Adresse), damit der Monitor sofort dort neu verbindet.
 */
async function relocateDoorbird(rt: DoorbirdRuntime): Promise<boolean> {
  if (!rt.config.macAddress || rt.relocating || rt.stopped) return false;
  rt.relocating = true;
  rt.lastRelocateAt = Date.now();
  try {
    const oldHost = rt.config.host;
    const ip = await findIpByMac(rt.config.macAddress, { sweep: true, exclude: oldHost });
    // Inzwischen entfernt, wieder verbunden oder von der Cloud umgestellt.
    if (!ip || rt.stopped || rt.connected || rt.config.host !== oldHost) return false;
    // Erst die Cloud umstellen, sonst setzt der naechste Konfig-Abgleich die
    // alte IP wieder.
    const ok = await reportDoorbirdNetwork(rt.config.id, { host: ip });
    if (rt.stopped || rt.config.host !== oldHost) return false;
    rt.config.host = ip;
    rt.reconnectDelay = RECONNECT_MIN_MS;
    rt.abort?.abort(new Error("host-changed"));
    wakeMonitor(rt);
    log(`DoorBird ${rt.config.name}: per MAC unter neuer IP gefunden (${oldHost} → ${ip})${ok ? "" : " – Cloud-Update fehlgeschlagen"}`);
    recordHubEvent({
      kind: "doorbird",
      severity: "warn",
      where: rt.config.name,
      title: "Neue IP-Adresse",
      detail: `${oldHost} → ${ip}`,
    });
    void updateLocalStreams(oldHost, ip).catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    rt.relocating = false;
  }
}

/** Dauer einer Lücke fürs Log: „4.2 s“, „3 min“. */
function gapText(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Wartezeit bis zum nächsten Verbindungsversuch; wakeMonitor beendet sie früher. */
function waitReconnect(rt: DoorbirdRuntime, ms: number): Promise<void> {
  if (rt.wakePending) {
    rt.wakePending = false;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (rt.wakeReconnect === done) rt.wakeReconnect = null;
      rt.wakePending = false;
      resolve();
    };
    const timer = setTimeout(done, ms);
    rt.wakeReconnect = done;
  });
}

/** Neue Adresse oder entfernt: sofort neu verbinden bzw. die Schleife beenden. */
function wakeMonitor(rt: DoorbirdRuntime): void {
  rt.wakePending = true;
  rt.wakeReconnect?.();
}

/** monitor.cgi Dauerverbindung mit Reconnect + Idle-Watchdog. */
async function monitorLoop(rt: DoorbirdRuntime): Promise<void> {
  while (!rt.stopped) {
    // Zugangsdaten abgelehnt: nicht neu verbinden und keine Adresse suchen,
    // bis sich die Sperre loest (wakeMonitor) oder der einzelne Versuch faellig ist.
    const c = rt.config;
    const gate = await authGate(c);
    if (rt.stopped) break;
    if (!gate.allow) {
      if (!rt.authLocked) {
        // Sperre aus der Zeit vor dem Neustart.
        rt.authLocked = true;
        log(
          `DoorBird ${rt.config.name}: Zugangsdaten seit ${berlinTime(gate.entry?.lockedAt ?? Date.now())} abgelehnt – ` +
            `kein Versuch, bis sie in der Cloud geändert werden (nächster einzelner Versuch ${berlinTime(gate.nextTryAt ?? Date.now())})`
        );
        syncAuthAlerts();
      }
      await waitReconnect(rt, Math.max(1_000, (gate.nextTryAt ?? Date.now()) - Date.now()));
      continue;
    }
    const abort = new AbortController();
    rt.abort = abort;
    let idleTimer: NodeJS.Timeout | null = null;
    let seenTimer: NodeJS.Timeout | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort.abort(new Error("idle")), IDLE_TIMEOUT_MS);
    };
    /** Ausgang dieses Versuchs: null = Verbindung stand (oder vom Hub selbst abgebrochen). */
    const attempt: { failure: ConnectFailure | null } = { failure: null };

    try {
      let res: Response;
      try {
        res = await fetch(`${baseUrl(c)}/bha-api/monitor.cgi?ring=doorbell,motionsensor`, {
          headers: { Authorization: authHeader(c) },
          signal: abort.signal,
        });
      } catch (e) {
        // Keine Antwort: Netzfehler. Ein Abbruch durch den Hub selbst
        // (Adresse geändert, entfernt) zählt nicht als Fehlversuch.
        if (!abort.signal.aborted) {
          attempt.failure = "netz";
          authNote(c, null, "dauer");
        }
        throw e;
      }
      if (!res.ok) await res.body?.cancel().catch(() => undefined);
      // Antwortet unter der Adresse ein anderes Geraet (DHCP-Wechsel), zaehlt
      // das wie ein Netzfehler: Nach zweien in Folge sucht der Hub die DoorBird.
      const outcome = await noteAnswer(c, res.status, "dauer");
      if (!res.ok || !res.body) {
        if (!abort.signal.aborted) attempt.failure = outcome.fehlerArt ?? "http";
        await res.body?.cancel().catch(() => undefined);
        throw new Error(answerError("monitor.cgi", c, res.status, outcome));
      }
      if (rt.unreachableLogged) {
        const gapMs = rt.unreachableSince > 0 ? Date.now() - rt.unreachableSince : 0;
        log(`DoorBird ${rt.config.name}: wieder erreichbar nach ${gapText(gapMs)}`);
        rt.unreachableLogged = false;
        rt.unreachableSince = 0;
        improve("doorbird", "monitor_ok", { name: rt.config.name, gapMs });
        improveCount("doorbird", "monitor_gap_ms", gapMs);
        recordHubEvent({
          kind: "doorbird",
          severity: "info",
          where: rt.config.name,
          title: "Monitor wieder verbunden",
        });
      }
      rt.connected = true;
      // Ein Weckruf (wakeMonitor) aus der Zeit vor dieser Verbindung ist
      // erfuellt; sonst verbaende der Hub nach dem naechsten Abbruch ohne Pause.
      rt.wakePending = false;
      rt.reconnectDelay = RECONNECT_MIN_MS;
      void learnDoorbirdMac(rt);
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
        rt.unreachableSince = Date.now();
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
    rt.netFailStreak = attempt.failure === "netz" ? rt.netFailStreak + 1 : 0;
    // Neue IP nach VLAN-Umzug/DHCP-Wechsel? Erst nach zwei Netzfehlern in
    // Folge suchen, im Hintergrund: Das Neuverbinden wartet nicht darauf.
    // Waehrend einer Sperre gibt es nur den einzelnen Versuch je 24 h:
    // Antwortet dabei niemand oder ein anderes Geraet, sucht der Hub sofort.
    // Findet er die DoorBird unter neuer Adresse, loest sich die Sperre.
    const singleMissed = gate.single && attempt.failure === "netz";
    if (
      (singleMissed && Date.now() - rt.lastRelocateAt >= RELOCATE_MIN_GAP_MS) ||
      shouldRelocate({
        fehlversucheInFolge: rt.netFailStreak,
        fehlerArt: attempt.failure,
        msSeitLetzterSuche: Date.now() - rt.lastRelocateAt,
      })
    ) {
      relocateDoorbird(rt).catch((e) => log(`DoorBird ${rt.config.name}: Adresssuche: ${e instanceof Error ? e.message : e}`));
    }
    await waitReconnect(rt, rt.reconnectDelay);
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
      wakeMonitor(rt);
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
        existing.reconnectDelay = RECONNECT_MIN_MS;
        existing.abort?.abort(new Error("host-changed"));
        wakeMonitor(existing);
        applyConfigHold(existing);
        continue;
      }
      const oldFp = authFp(existing.config);
      existing.config = config;
      // Gesperrt und die Zugangsdaten sind neu: gleich mit ihnen verbinden.
      if (existing.authLocked && authFp(config) !== oldFp) wakeMonitor(existing);
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
      lastMacLearnAt: 0,
      lastRelocateAt: 0,
      relocating: false,
      netFailStreak: 0,
      unreachableSince: 0,
      wakeReconnect: null,
      wakePending: false,
      authLocked: false,
    };
    doorbirds.set(config.id, rt);
    log(`DoorBird ${config.name}: Monitor startet (${config.host})`);
    improve("doorbird", "monitor_start", { name: config.name, host: config.host });
    monitorLoop(rt).catch((e) => log(`DoorBird ${config.name}: Monitor beendet (${e instanceof Error ? e.message : e})`));
    // Laufende Offenhaltung (z. B. nach Hub-Neustart) wieder aufnehmen.
    applyConfigHold(rt);
  }
  // Befunde „Zugangsdaten abgelehnt“: entfernte DoorBirds fallen heraus,
  // nach dem Start geht die Liste einmal vorsorglich an die Cloud.
  authLatches
    .ready()
    .then(syncAuthAlerts)
    .catch(() => undefined);
}
