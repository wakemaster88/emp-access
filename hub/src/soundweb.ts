/**
 * Soundweb London (BSS): DSP-Prozessoren über das London-DI-Protokoll steuern.
 *
 * Der Hub hält je Prozessor eine TCP-Verbindung (Port 1023), abonniert beim
 * Verbinden alle in der Cloud eingerichteten State Variables und bekommt so
 * jede Änderung – auch die vom Wandpanel oder aus Audio Architect – sofort
 * gemeldet. Werte und Verbindungszustand gehen gesammelt an die Cloud, Befehle
 * kommen als Tasks (`SOUNDWEB_SET`, `SOUNDWEB_SYNC`) zurück.
 *
 * Welche Regler es gibt, entscheidet allein die Cloud (Audio → Soundweb);
 * dieses Modul kennt keine Adressen aus der Umgebung. Die Konfiguration wird
 * beim Start, nach jedem Sync-Task und alle fünf Minuten neu geholt.
 *
 * Ein Soundweb schickt von sich aus nichts, solange sich kein Wert ändert.
 * Damit eine still gestorbene Verbindung (Neustart des Prozessors, gezogenes
 * Kabel) nicht unbemerkt bleibt, abonniert der Hub alle zwei Minuten eine SV
 * erneut – die Antwort darauf ist der Lebensbeweis.
 */
import net from "node:net";
import { api, CONFIG, log } from "./config.js";
import { improve } from "./improve-log.js";
import { recordHubEvent, STATE } from "./state.js";
import {
  buildPresetRecall,
  buildSvMessage,
  formatAddress,
  FrameParser,
  MSG,
  percentToRaw,
  svKey,
  svKeyWithoutNode,
  type DecodedMessage,
  type SvAddress,
} from "./soundweb-protocol.js";

export type SoundwebControlKind = "GAIN" | "MUTE" | "PERCENT" | "SELECT" | "PRESET";

export interface SoundwebControlConfig {
  id: number;
  name: string;
  kind: SoundwebControlKind;
  /** null = Node des Geräts. */
  node: number | null;
  virtualDevice: number;
  objectId: number;
  stateVariable: number;
  presetId: number | null;
}

export interface SoundwebDeviceConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  node: number;
  controls: SoundwebControlConfig[];
}

function numEnv(key: string, fallback: number, min = 0): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const CONNECT_TIMEOUT_MS = 5_000;
const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
/** Konfiguration aus der Cloud neu holen (Sekunden). */
const CONFIG_INTERVAL_MS = numEnv("HUB_SOUNDWEB_CONFIG_INTERVAL", 300, 30) * 1000;
/** Lebenszeichen: eine SV erneut abonnieren und auf die Antwort warten. */
const PROBE_INTERVAL_MS = numEnv("HUB_SOUNDWEB_PROBE_INTERVAL", 120, 15) * 1000;
const PROBE_TIMEOUT_MS = 5_000;
/**
 * Rate im Abonnement (ms). Für Regler meldet das Gerät bei Änderung, die Rate
 * zählt nur für Meter – 0 ist darum die richtige Vorgabe.
 */
const SUBSCRIBE_RATE_MS = numEnv("HUB_SOUNDWEB_SUBSCRIBE_RATE", 0);
/** Wertänderungen gebündelt melden, statt pro Faderschritt einen Request. */
const REPORT_DEBOUNCE_MS = 400;
/** Vollständiger Zustand im Takt, damit `lastSeenAt` in der Cloud frisch bleibt. */
const REPORT_FULL_MS = 60_000;
/** Nach einem Befehl auf das Echo des Geräts warten. */
const ECHO_WAIT_MS = 1_500;
/** Protokollfehler je Verbindung höchstens einmal pro Minute loggen. */
const ERROR_LOG_EVERY_MS = 60_000;

interface ControlValue {
  raw: number;
  at: string;
}

/* ---------------------------------------------------------------------------
 * Eine Verbindung zu einem Prozessor
 * ------------------------------------------------------------------------- */

class SoundwebLink {
  connected = false;
  lastError: string | null = null;
  lastSeenAt: string | null = null;
  readonly values = new Map<number, ControlValue>();

  private socket: net.Socket | null = null;
  private parser = new FrameParser();
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private probeDeadline: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastRxAt = 0;
  private lastErrorLogAt = 0;
  /** SV-Schlüssel → Regler, die darauf hören (mit und ohne Node). */
  private readonly byKey = new Map<string, SoundwebControlConfig[]>();
  private readonly byKeyNoNode = new Map<string, SoundwebControlConfig[]>();
  private readonly waiters = new Map<number, Array<(raw: number) => void>>();

  constructor(
    readonly config: SoundwebDeviceConfig,
    private readonly onChange: (link: SoundwebLink, controlIds: number[]) => void
  ) {
    for (const control of config.controls) {
      if (control.kind === "PRESET") continue;
      const address = this.addressFor(control);
      const list = this.byKey.get(svKey(address)) ?? [];
      list.push(control);
      this.byKey.set(svKey(address), list);
      const loose = this.byKeyNoNode.get(svKeyWithoutNode(address)) ?? [];
      loose.push(control);
      this.byKeyNoNode.set(svKeyWithoutNode(address), loose);
    }
  }

  get label(): string {
    return `${this.config.name} (${this.config.host}:${this.config.port})`;
  }

  addressFor(control: SoundwebControlConfig): SvAddress {
    return {
      node: control.node ?? this.config.node,
      virtualDevice: control.virtualDevice,
      objectId: control.objectId,
      stateVariable: control.stateVariable,
    };
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopProbe();
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = net.createConnection({ host: this.config.host, port: this.config.port });
    this.socket = socket;
    this.parser = new FrameParser();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.once("timeout", () => {
      // Nur der Verbindungsaufbau hat ein Timeout; danach darf es still sein.
      if (!this.connected) socket.destroy(new Error("Verbindungsaufbau: Zeitüberschreitung"));
    });
    socket.once("connect", () => {
      socket.setTimeout(0);
      this.connected = true;
      this.lastError = null;
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.touch();
      log(`Soundweb ${this.label}: verbunden, ${this.byKey.size} SVs abonnieren`);
      recordHubEvent({
        kind: "system",
        severity: "info",
        where: this.config.name,
        title: "Soundweb verbunden",
        detail: `${this.config.host}:${this.config.port}`,
      });
      improve("soundweb", "connect", { device: this.config.id });
      this.subscribeAll();
      this.startProbe();
      this.onChange(this, []);
    });
    socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    socket.on("error", (err: Error) => {
      this.lastError = err.message;
    });
    socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.stopProbe();
      if (this.socket === socket) this.socket = null;
      if (wasConnected) {
        if (!this.lastError) this.lastError = "Verbindung vom Gerät geschlossen";
        log(`Soundweb ${this.label}: Verbindung getrennt (${this.lastError})`);
        recordHubEvent({
          kind: "system",
          severity: "warn",
          where: this.config.name,
          title: "Soundweb getrennt",
          detail: this.lastError ?? undefined,
        });
        improve("soundweb", "disconnect", { device: this.config.id, error: this.lastError });
        this.onChange(this, []);
      } else if (!this.lastError) {
        this.lastError = "Verbindung abgelehnt";
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    // Erster Fehlversuch wird geloggt, danach nur noch bei Wechsel des Grunds.
    if (delay === RECONNECT_MIN_MS) {
      log(`Soundweb ${this.label}: nicht erreichbar (${this.lastError ?? "unbekannt"}), neuer Versuch in ${delay / 1000} s`);
      this.onChange(this, []);
    }
  }

  private touch(): void {
    this.lastRxAt = Date.now();
    this.lastSeenAt = new Date().toISOString();
  }

  private write(frame: Buffer): boolean {
    if (!this.socket || !this.connected) return false;
    this.socket.write(frame);
    return true;
  }

  private subscribeMessage(control: SoundwebControlConfig): Buffer {
    const type = control.kind === "PERCENT" ? MSG.SUBSCRIBESVPERCENT : MSG.SUBSCRIBESV;
    return buildSvMessage(type, this.addressFor(control), SUBSCRIBE_RATE_MS);
  }

  private subscribeAll(): void {
    // Je SV nur einmal abonnieren, auch wenn mehrere Regler darauf zeigen –
    // aber getrennt nach Roh- und Prozentabonnement.
    const sent = new Set<string>();
    for (const control of this.config.controls) {
      if (control.kind === "PRESET") continue;
      const key = `${control.kind === "PERCENT" ? "%" : "#"}${svKey(this.addressFor(control))}`;
      if (sent.has(key)) continue;
      sent.add(key);
      this.write(this.subscribeMessage(control));
    }
  }

  private startProbe(): void {
    this.stopProbe();
    const probe = this.config.controls.find((c) => c.kind !== "PRESET");
    if (!probe) return;
    this.probeTimer = setInterval(() => {
      if (!this.connected) return;
      // Kam zwischendurch ohnehin etwas an, ist die Leitung offensichtlich lebendig.
      if (Date.now() - this.lastRxAt < PROBE_INTERVAL_MS / 2) return;
      const sentAt = Date.now();
      this.write(this.subscribeMessage(probe));
      if (this.probeDeadline) clearTimeout(this.probeDeadline);
      this.probeDeadline = setTimeout(() => {
        this.probeDeadline = null;
        if (this.connected && this.lastRxAt < sentAt) {
          this.lastError = "Keine Antwort auf Abonnement – Verbindung wird neu aufgebaut";
          log(`Soundweb ${this.label}: ${this.lastError}`);
          this.socket?.destroy();
        }
      }, PROBE_TIMEOUT_MS);
    }, PROBE_INTERVAL_MS);
  }

  private stopProbe(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
    if (this.probeDeadline) clearTimeout(this.probeDeadline);
    this.probeDeadline = null;
  }

  private handleData(chunk: Buffer): void {
    this.touch();
    const { messages, errors } = this.parser.push(chunk);
    if (errors.length > 0 && Date.now() - this.lastErrorLogAt > ERROR_LOG_EVERY_MS) {
      this.lastErrorLogAt = Date.now();
      log(`Soundweb ${this.label}: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1})` : ""}`);
      improve("soundweb", "protocol_error", { device: this.config.id, error: errors[0] });
    }
    const changed: number[] = [];
    for (const message of messages) {
      for (const id of this.applyMessage(message)) changed.push(id);
    }
    if (changed.length > 0) this.onChange(this, changed);
  }

  /** Wert einer eingehenden SET-Nachricht den passenden Reglern zuordnen. */
  private applyMessage(message: DecodedMessage): number[] {
    if (!message.address) return [];
    if (message.type !== MSG.SETSV && message.type !== MSG.SETSVPERCENT) return [];
    const percent = message.type === MSG.SETSVPERCENT;
    const targets =
      this.byKey.get(svKey(message.address)) ??
      this.byKeyNoNode.get(svKeyWithoutNode(message.address)) ??
      [];
    const at = new Date().toISOString();
    const changed: number[] = [];
    for (const control of targets) {
      // Prozentantworten gehören zu Prozentreglern, Rohwerte zu allen anderen.
      if ((control.kind === "PERCENT") !== percent) continue;
      const previous = this.values.get(control.id);
      this.values.set(control.id, { raw: message.data, at });
      if (!previous || previous.raw !== message.data) changed.push(control.id);
      const waiting = this.waiters.get(control.id);
      if (waiting) {
        this.waiters.delete(control.id);
        for (const resolve of waiting) resolve(message.data);
      }
    }
    if (targets.length === 0) {
      improve("soundweb", "unknown_sv", { device: this.config.id, address: formatAddress(message.address) });
    }
    return changed;
  }

  /** Auf das Echo des Geräts warten – null, wenn es ausbleibt. */
  waitForValue(controlId: number, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      const list = this.waiters.get(controlId) ?? [];
      const timer = setTimeout(() => {
        const current = this.waiters.get(controlId);
        if (current) {
          const rest = current.filter((fn) => fn !== done);
          if (rest.length > 0) this.waiters.set(controlId, rest);
          else this.waiters.delete(controlId);
        }
        resolve(null);
      }, timeoutMs);
      const done = (raw: number) => {
        clearTimeout(timer);
        resolve(raw);
      };
      list.push(done);
      this.waiters.set(controlId, list);
    });
  }

  setRaw(control: SoundwebControlConfig, raw: number): boolean {
    return this.write(buildSvMessage(MSG.SETSV, this.addressFor(control), raw));
  }

  setPercent(control: SoundwebControlConfig, percent: number): boolean {
    return this.write(buildSvMessage(MSG.SETSVPERCENT, this.addressFor(control), percentToRaw(percent)));
  }

  recallPreset(presetId: number): boolean {
    return this.write(buildPresetRecall(MSG.PARAM_PRESET_RECALL, presetId));
  }

  /** Nach einem eigenen Befehl den Wert merken, falls das Gerät nicht echot. */
  rememberValue(controlId: number, raw: number): void {
    this.values.set(controlId, { raw, at: new Date().toISOString() });
  }
}

/* ---------------------------------------------------------------------------
 * Verwaltung aller Verbindungen und Meldung an die Cloud
 * ------------------------------------------------------------------------- */

const links = new Map<number, SoundwebLink>();
const signatures = new Map<number, string>();
let configLoading: Promise<void> | null = null;
let configEverLoaded = false;

const dirtyDevices = new Set<number>();
const dirtyValues = new Map<number, ControlValue>();
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let reportBusy = false;

function updateState(): void {
  const all = [...links.values()];
  const failing = all.find((l) => !l.connected && l.lastError);
  STATE.soundweb = {
    devices: all.length,
    connected: all.filter((l) => l.connected).length,
    lastError: failing ? `${failing.config.name}: ${failing.lastError}` : null,
    lastConfigAt: STATE.soundweb?.lastConfigAt ?? null,
  };
}

function onLinkChange(link: SoundwebLink, controlIds: number[]): void {
  dirtyDevices.add(link.config.id);
  for (const id of controlIds) {
    const value = link.values.get(id);
    if (value) dirtyValues.set(id, value);
  }
  updateState();
  scheduleReport();
}

function scheduleReport(): void {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    void flushReport(false);
  }, REPORT_DEBOUNCE_MS);
}

async function flushReport(full: boolean): Promise<void> {
  if (reportBusy) {
    scheduleReport();
    return;
  }
  const deviceIds = full ? [...links.keys()] : [...dirtyDevices];
  const values: Array<{ controlId: number; value: number; at: string }> = [];
  if (full) {
    for (const link of links.values()) {
      for (const [controlId, v] of link.values) values.push({ controlId, value: v.raw, at: v.at });
    }
  } else {
    for (const [controlId, v] of dirtyValues) values.push({ controlId, value: v.raw, at: v.at });
  }
  if (deviceIds.length === 0 && values.length === 0) return;
  dirtyDevices.clear();
  dirtyValues.clear();
  reportBusy = true;
  try {
    const res = await api("/api/hub/soundweb/state", {
      method: "POST",
      body: JSON.stringify({
        hub: CONFIG.name,
        devices: deviceIds
          .map((id) => links.get(id))
          .filter((l): l is SoundwebLink => !!l)
          .map((l) => ({
            id: l.config.id,
            connected: l.connected,
            error: l.connected ? null : l.lastError,
            at: l.lastSeenAt,
          })),
        values,
      }),
    });
    if (!res.ok) log(`Soundweb: Zustandsmeldung fehlgeschlagen: HTTP ${res.status}`);
  } catch (e) {
    log(`Soundweb: Zustandsmeldung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    // Beim nächsten Durchlauf erneut mitnehmen.
    for (const id of deviceIds) dirtyDevices.add(id);
    for (const v of values) dirtyValues.set(v.controlId, { raw: v.value, at: v.at });
  } finally {
    reportBusy = false;
  }
}

function parseConfig(raw: unknown): SoundwebDeviceConfig[] {
  const list = (raw as { devices?: unknown })?.devices;
  if (!Array.isArray(list)) return [];
  const out: SoundwebDeviceConfig[] = [];
  for (const item of list) {
    const d = item as Partial<SoundwebDeviceConfig>;
    if (!Number.isInteger(d.id) || typeof d.host !== "string" || !d.host) continue;
    out.push({
      id: d.id as number,
      name: String(d.name ?? `Soundweb ${d.id}`),
      host: d.host,
      port: Number.isInteger(d.port) && (d.port as number) > 0 ? (d.port as number) : 1023,
      node: Number.isInteger(d.node) ? (d.node as number) : 0,
      controls: (Array.isArray(d.controls) ? d.controls : [])
        .map((c) => c as Partial<SoundwebControlConfig>)
        .filter((c) => Number.isInteger(c.id) && typeof c.kind === "string")
        .map((c) => ({
          id: c.id as number,
          name: String(c.name ?? ""),
          kind: c.kind as SoundwebControlKind,
          node: Number.isInteger(c.node) ? (c.node as number) : null,
          virtualDevice: Number.isInteger(c.virtualDevice) ? (c.virtualDevice as number) : 3,
          objectId: Number.isInteger(c.objectId) ? (c.objectId as number) : 0,
          stateVariable: Number.isInteger(c.stateVariable) ? (c.stateVariable as number) : 0,
          presetId: Number.isInteger(c.presetId) ? (c.presetId as number) : null,
        })),
    });
  }
  return out;
}

/**
 * Konfiguration aus der Cloud holen und Verbindungen angleichen. Eine
 * Verbindung wird nur neu aufgebaut, wenn sich an ihrem Gerät etwas geändert
 * hat – sonst würde jede Aktualisierung alle Abonnements kurz unterbrechen.
 */
export async function loadSoundwebConfig(reason = "Takt"): Promise<void> {
  if (configLoading) return configLoading;
  configLoading = (async () => {
    try {
      const res = await api("/api/hub/soundweb");
      if (!res.ok) {
        log(`Soundweb: Konfiguration nicht geladen (HTTP ${res.status})`);
        return;
      }
      const devices = parseConfig(await res.json());
      const seen = new Set<number>();
      let changed = 0;
      for (const device of devices) {
        seen.add(device.id);
        const signature = JSON.stringify(device);
        if (signatures.get(device.id) === signature) continue;
        changed++;
        const old = links.get(device.id);
        old?.stop();
        const link = new SoundwebLink(device, onLinkChange);
        // Bereits bekannte Werte übernehmen, damit die Karte nicht kurz leer wird.
        if (old) for (const [id, v] of old.values) link.values.set(id, v);
        links.set(device.id, link);
        signatures.set(device.id, signature);
        link.start();
      }
      for (const [id, link] of links) {
        if (seen.has(id)) continue;
        link.stop();
        links.delete(id);
        signatures.delete(id);
        changed++;
      }
      configEverLoaded = true;
      STATE.soundweb = { ...(STATE.soundweb ?? { devices: 0, connected: 0, lastError: null }), lastConfigAt: new Date().toISOString() };
      updateState();
      if (changed > 0 || reason !== "Takt") {
        log(
          `Soundweb-Konfiguration (${reason}): ${devices.length} Gerät(e), ` +
            `${devices.reduce((n, d) => n + d.controls.length, 0)} Regler, ${changed} Verbindung(en) neu`
        );
      }
    } catch (e) {
      log(`Soundweb: Konfiguration fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    } finally {
      configLoading = null;
    }
  })();
  return configLoading;
}

export function startSoundweb(): void {
  void loadSoundwebConfig("Start");
  setInterval(() => void loadSoundwebConfig(), CONFIG_INTERVAL_MS);
  setInterval(() => void flushReport(true), REPORT_FULL_MS);
}

export function soundwebSummary(): { devices: number; connected: number; lastError: string | null } {
  const all = [...links.values()];
  const failing = all.find((l) => !l.connected && l.lastError);
  return {
    devices: all.length,
    connected: all.filter((l) => l.connected).length,
    lastError: failing ? `${failing.config.name}: ${failing.lastError}` : null,
  };
}

function findControl(controlId: number): { link: SoundwebLink; control: SoundwebControlConfig } | null {
  for (const link of links.values()) {
    const control = link.config.controls.find((c) => c.id === controlId);
    if (control) return { link, control };
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Tasks aus der Cloud
 * ------------------------------------------------------------------------- */

export interface SoundwebTaskResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export async function runSoundwebTask(
  type: string,
  payload: Record<string, unknown> | null
): Promise<SoundwebTaskResult> {
  if (type === "SOUNDWEB_SYNC") {
    await loadSoundwebConfig("Sync-Task");
    // Frischen Zustand gleich mitmelden, die Karte wartet darauf.
    await flushReport(true);
    return { success: true, result: soundwebSummary() };
  }
  if (type !== "SOUNDWEB_SET") return { success: false, error: `Unbekannter Soundweb-Task: ${type}` };

  const controlId = Number(payload?.controlId);
  if (!Number.isInteger(controlId)) return { success: false, error: "controlId fehlt" };

  let found = findControl(controlId);
  if (!found) {
    // Regler gerade erst angelegt? Konfiguration nachziehen und noch einmal suchen.
    await loadSoundwebConfig(configEverLoaded ? "unbekannter Regler" : "Start");
    found = findControl(controlId);
  }
  if (!found) return { success: false, error: "Regler ist dem Hub nicht bekannt – Konfiguration prüfen" };
  const { link, control } = found;

  if (!link.connected) {
    return {
      success: false,
      error: `${link.config.name} nicht verbunden${link.lastError ? `: ${link.lastError}` : ""}`,
    };
  }

  if (control.kind === "PRESET") {
    const presetId = Number(payload?.presetId ?? control.presetId);
    if (!Number.isInteger(presetId)) return { success: false, error: "Preset-ID fehlt" };
    if (!link.recallPreset(presetId)) return { success: false, error: "Senden fehlgeschlagen" };
    log(`Soundweb ${link.config.name}: Preset ${presetId} abgerufen („${control.name}“)`);
    improve("soundweb", "preset", { device: link.config.id, presetId });
    return { success: true, result: { controlId, presetId } };
  }

  const echo = link.waitForValue(controlId, ECHO_WAIT_MS);
  let sentRaw: number;
  if (control.kind === "PERCENT") {
    const percent = Number(payload?.percent);
    if (!Number.isFinite(percent)) return { success: false, error: "Prozentwert fehlt" };
    sentRaw = percentToRaw(percent);
    if (!link.setPercent(control, percent)) return { success: false, error: "Senden fehlgeschlagen" };
  } else {
    const raw = Number(payload?.raw);
    if (!Number.isInteger(raw)) return { success: false, error: "Rohwert fehlt" };
    sentRaw = raw;
    if (!link.setRaw(control, raw)) return { success: false, error: "Senden fehlgeschlagen" };
  }

  const echoed = await echo;
  const value = echoed ?? sentRaw;
  if (echoed === null) {
    // Ohne Echo gilt der gesendete Wert – TCP hat ihn zugestellt.
    link.rememberValue(controlId, sentRaw);
    onLinkChange(link, [controlId]);
  }
  improve("soundweb", echoed === null ? "set_no_echo" : "set", { device: link.config.id, kind: control.kind });
  return { success: true, result: { controlId, value, echoed: echoed !== null } };
}
