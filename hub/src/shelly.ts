/**
 * Shelly-Geraete (Gen1 und Gen2+/Pro/Plus) im lokalen Netz: erkennen, Status
 * lesen, Relais schalten. Spricht die lokale HTTP-API direkt an – keine Cloud.
 *
 * Gen1:  GET /shelly, /status, /relay/<n>?turn=on|off|toggle   (Basic-Auth)
 * Gen2+: GET /shelly, /rpc/Shelly.GetStatus, /rpc/Switch.Set    (Digest SHA-256)
 *
 * Passwort (falls in den Shellys gesetzt): HUB_SHELLY_PASSWORD, Benutzer
 * HUB_SHELLY_USER (Gen1, Vorgabe "admin"; Gen2 nutzt immer "admin").
 *
 * Die Generation (Antwort von /shelly) merkt sich der Hub je Geraet eine
 * Stunde und verwirft sie beim ersten Fehler einer Anfrage an dieses Geraet;
 * ein Status oder Schaltbefehl kommt damit ohne die vorherige Abfrage von
 * /shelly aus. Ein Schaltbefehl „an“ oder „aus“ wird nach einem Netzfehler
 * oder einer Zeitueberschreitung genau einmal nach 400 ms wiederholt,
 * Umschalten und Impulse nie (shelly-rules.ts), und auch nicht, wenn
 * inzwischen ein neuerer Befehl fuer denselben Kanal kam.
 */
import { createHash, randomBytes } from "node:crypto";
import { log } from "./config.js";
import { authOutcome, credentialFingerprint } from "./auth-latch.js";
import { authLatches } from "./auth-latch-store.js";
import { improveCount } from "./improve-log.js";
import {
  SHELLY_SWITCH_RETRY_MS,
  genCacheFresh,
  retryable,
  shellyAction,
  shellyErrorKind,
  shellyNotSent,
} from "./shelly-rules.js";

export interface ShellyInfo {
  gen: number;
  model: string | null;
  /** Gen2: App-Name (z. B. "Pro4PM"), Gen1: type (z. B. "SHSW-25"). */
  app: string | null;
  name: string | null;
  fw: string | null;
  auth: boolean;
  /** MAC laut /shelly ("AA:BB:CC:DD:EE:FF"); in gerouteten VLANs die einzige MAC-Quelle. */
  mac?: string | null;
}

/** "A8032ABE54DC" / "a8:03:2a:be:54:dc" -> "A8:03:2A:BE:54:DC"; sonst null. */
function shellyMac(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const hex = v.trim().replace(/[:-]/g, "").toUpperCase();
  return /^[0-9A-F]{12}$/.test(hex) ? hex.match(/../g)!.join(":") : null;
}

export interface ShellyChannel {
  id: number;
  kind: "switch" | "cover" | "light";
  on: boolean | null;
  powerW: number | null;
  /** Cover: Position 0..100 bzw. Zustand. */
  state?: string | null;
}

export interface ShellyStatus {
  host: string;
  info: ShellyInfo;
  channels: ShellyChannel[];
  temperatureC: number | null;
  uptimeS: number | null;
}

const TIMEOUT_MS = 3000;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function password(): string {
  return process.env.HUB_SHELLY_PASSWORD || "";
}

/*
 * Passwort abgelehnt (auth-latch.ts, Zustand in hub/.cache/auth-latch.json):
 * Nach zwei Ablehnungen in Folge schickt der Hub das Passwort nicht mehr an
 * diesen Shelly. Abfragen und Schaltbefehle scheitern dann sofort mit einem
 * klaren Fehlertext, ohne Anfrage an das Geraet. Die Sperre loest sich mit
 * einem geaenderten HUB_SHELLY_PASSWORD (oder HUB_SHELLY_USER, nach dem
 * Neustart des Hubs), mit einem gelungenen Versuch und einmal in 24 Stunden
 * mit einem einzelnen Versuch. Die Frueherkennung (health-trends.ts) erkennt
 * den Fehlertext am Wort „Passwort“.
 */
const shellyAuthKey = (host: string) => `shelly:${host}`;
const shellyAuthFp = () => credentialFingerprint(process.env.HUB_SHELLY_USER || "admin", password());

/** Wirft sofort, solange das Passwort fuer diesen Shelly gesperrt ist. */
async function shellyAuthGate(host: string): Promise<void> {
  await authLatches.ready();
  const g = authLatches.gate(shellyAuthKey(host), shellyAuthFp(), Date.now());
  if (g.released) log(`Shelly ${host}: Sperre des Passworts aufgehoben (HUB_SHELLY_PASSWORD geändert)`);
  if (!g.allow) {
    throw new Error(
      `Shelly-Passwort abgelehnt (${host}) – kein Versuch, bis HUB_SHELLY_PASSWORD geändert wird`
    );
  }
}

/**
 * Vor der Abfrage, die keine Zugangsdaten sendet (probeShelly): sofort
 * scheitern, solange gesperrt. Der einzelne Versuch in 24 Stunden bleibt fuer
 * shellyGet, das die Zugangsdaten sendet.
 */
async function shellyAuthCheck(host: string): Promise<void> {
  await authLatches.ready();
  if (authLatches.blocked(shellyAuthKey(host), shellyAuthFp(), Date.now())) {
    throw new Error(`Shelly-Passwort abgelehnt (${host}) – kein Versuch, bis HUB_SHELLY_PASSWORD geändert wird`);
  }
}

function shellyAuthNote(host: string, status: number | null): void {
  const n = authLatches.note(shellyAuthKey(host), shellyAuthFp(), authOutcome(status), Date.now());
  if (n.locked) {
    log(
      `Shelly ${host}: Passwort zweimal in Folge abgelehnt – keine weiteren Versuche, ` +
        "bis HUB_SHELLY_PASSWORD geändert wird; ein einzelner Versuch alle 24 h"
    );
  } else if (n.released) {
    log(`Shelly ${host}: Passwort wieder angenommen, Sperre aufgehoben`);
  }
}

/** Gemerkte Antwort von /shelly je Geraet (Generation, Modell, Name). */
const infoCache = new Map<string, { info: ShellyInfo; at: number }>();

/** /shelly aus dem Merker (eine Stunde) oder frisch; null = kein Shelly. */
async function shellyInfo(host: string): Promise<ShellyInfo | null> {
  const hit = infoCache.get(host);
  if (hit && genCacheFresh(hit, Date.now())) return hit.info;
  const info = await probeShelly(host, TIMEOUT_MS);
  if (info) infoCache.set(host, { info, at: Date.now() });
  else infoCache.delete(host);
  return info;
}

/**
 * GET mit optionaler Authentifizierung: Basic fuer Gen1, Digest (SHA-256 oder
 * MD5, qop=auth) fuer Gen2+, sobald das Geraet 401 antwortet. Jeder Fehler
 * verwirft die gemerkte Generation dieses Geraets.
 */
async function shellyGet(host: string, path: string): Promise<unknown> {
  try {
    return await shellyGetOnce(host, path);
  } catch (e) {
    infoCache.delete(host);
    improveCount("shelly", "fail");
    throw e;
  }
}

async function shellyGetOnce(host: string, path: string): Promise<unknown> {
  await shellyAuthGate(host);
  const url = `http://${host}${path}`;
  const first = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (first.status !== 401) {
    // Ohne Anmeldung angenommen: Eine Sperre fuer diesen Shelly gilt nicht mehr.
    if (first.ok) shellyAuthNote(host, first.status);
    if (!first.ok) throw new Error(`HTTP ${first.status}`);
    return first.json();
  }
  const pass = password();
  if (!pass) throw new Error("Shelly verlangt ein Passwort (HUB_SHELLY_PASSWORD fehlt)");

  const challenge = first.headers.get("www-authenticate") || "";
  let authorization: string;
  if (/^digest/i.test(challenge)) {
    const param = (k: string) => challenge.match(new RegExp(`${k}="?([^",]+)"?`, "i"))?.[1] ?? "";
    const realm = param("realm");
    const nonce = param("nonce");
    const algo = /sha-?256/i.test(param("algorithm")) ? "SHA-256" : "MD5";
    const h = algo === "SHA-256" ? sha256 : md5;
    const user = "admin";
    const cnonce = randomBytes(8).toString("hex");
    const nc = "00000001";
    const ha1 = h(`${user}:${realm}:${pass}`);
    const ha2 = h(`GET:${path}`);
    const response = h(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    authorization =
      `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${path}", ` +
      `algorithm=${algo}, qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  } else {
    const user = process.env.HUB_SHELLY_USER || "admin";
    authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    shellyAuthNote(host, null);
    throw e;
  }
  shellyAuthNote(host, res.status);
  if (!res.ok) throw new Error(res.status === 401 ? "Shelly-Passwort falsch" : `HTTP ${res.status}`);
  return res.json();
}

/** /shelly ist bei allen Generationen ohne Login lesbar. null = kein Shelly. */
export async function probeShelly(host: string, timeoutMs = 1500): Promise<ShellyInfo | null> {
  try {
    const res = await fetch(`http://${host}/shelly`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    if (typeof d.gen === "number" && d.gen >= 2) {
      return {
        gen: d.gen,
        model: typeof d.model === "string" ? d.model : null,
        app: typeof d.app === "string" ? d.app : null,
        name: typeof d.name === "string" ? d.name : null,
        fw: typeof d.ver === "string" ? d.ver : null,
        auth: d.auth_en === true,
        mac: shellyMac(d.mac),
      };
    }
    if (typeof d.type === "string" && typeof d.mac === "string") {
      return {
        gen: 1,
        model: d.type,
        app: d.type,
        name: null,
        fw: typeof d.fw === "string" ? d.fw : null,
        auth: d.auth === true,
        mac: shellyMac(d.mac),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Status inkl. aller Kanaele (Relais, Rolllaeden, Dimmer). */
export async function shellyStatus(host: string): Promise<ShellyStatus> {
  await shellyAuthCheck(host);
  const info = await shellyInfo(host);
  if (!info) throw new Error(`${host} ist kein erreichbarer Shelly`);
  const channels: ShellyChannel[] = [];
  let temperatureC: number | null = null;
  let uptimeS: number | null = null;

  if (info.gen >= 2) {
    const s = (await shellyGet(host, "/rpc/Shelly.GetStatus")) as Record<string, Record<string, unknown>>;
    for (const [key, v] of Object.entries(s)) {
      const m = key.match(/^(switch|cover|light):(\d+)$/);
      if (!m || !v) continue;
      const kind = m[1] as ShellyChannel["kind"];
      channels.push({
        id: Number(m[2]),
        kind,
        on: typeof v.output === "boolean" ? v.output : null,
        powerW: num(v.apower),
        state: kind === "cover" ? (typeof v.state === "string" ? v.state : null) : undefined,
      });
      const t = (v.temperature as Record<string, unknown> | undefined)?.tC;
      if (temperatureC === null) temperatureC = num(t);
    }
    uptimeS = num(s.sys?.uptime);
  } else {
    const s = (await shellyGet(host, "/status")) as Record<string, unknown>;
    const relays = Array.isArray(s.relays) ? (s.relays as Record<string, unknown>[]) : [];
    const meters = Array.isArray(s.meters) ? (s.meters as Record<string, unknown>[]) : [];
    relays.forEach((r, i) =>
      channels.push({
        id: i,
        kind: "switch",
        on: typeof r.ison === "boolean" ? r.ison : null,
        powerW: num(meters[i]?.power),
      })
    );
    temperatureC = num(s.temperature) ?? num((s.tmp as Record<string, unknown> | undefined)?.tC);
    uptimeS = num(s.uptime);
  }
  channels.sort((a, b) => a.id - b.id);
  return { host, info, channels, temperatureC, uptimeS };
}

export interface ShellyEnvironment {
  tC: number | null;
  rh: number | null;
}

/**
 * Temperatur und Luftfeuchte eines Shelly-Fuehlers (H&T, Plus Add-on, BLU
 * ueber Gateway): Gen2+ aus den Komponenten `temperature:N` / `humidity:N`
 * (kleinste Nummer), Gen1 aus `tmp` / `hum`. Wirft, wenn das Geraet nicht
 * antwortet – Batterie-Fuehler schlafen zwischen zwei Meldungen.
 */
export async function shellyEnvironment(host: string): Promise<ShellyEnvironment> {
  await shellyAuthCheck(host);
  const info = await shellyInfo(host);
  if (!info) throw new Error(`${host} ist kein erreichbarer Shelly`);
  if (info.gen >= 2) {
    const s = (await shellyGet(host, "/rpc/Shelly.GetStatus")) as Record<string, Record<string, unknown>>;
    const lowest = (prefix: string): Record<string, unknown> | null => {
      let best: number | null = null;
      for (const key of Object.keys(s)) {
        if (!key.startsWith(`${prefix}:`)) continue;
        const id = Number(key.slice(prefix.length + 1));
        if (Number.isInteger(id) && (best === null || id < best)) best = id;
      }
      return best === null ? null : s[`${prefix}:${best}`] ?? null;
    };
    return { tC: num(lowest("temperature")?.tC), rh: num(lowest("humidity")?.rh) };
  }
  const s = (await shellyGet(host, "/status")) as Record<string, Record<string, unknown>>;
  return { tC: num(s.tmp?.tC), rh: num(s.hum?.value) };
}

/**
 * Vollstaendiger Status eines Shellys im LAN (Gen2+: `Shelly.GetStatus`,
 * Gen1: `/status`), mit Anmeldung wie `shellyGet`. null = keine Antwort.
 * Fuer Antriebe: Das Profil (Cover oder zwei Relais) steht nur hier.
 */
export async function shellyStatusMap(host: string): Promise<Record<string, unknown> | null> {
  if (await shellyAuthCheck(host).then(() => false, () => true)) return null;
  const info = await shellyInfo(host);
  if (!info) return null;
  try {
    const st = await shellyGet(host, info.gen >= 2 ? "/rpc/Shelly.GetStatus" : "/status");
    return st && typeof st === "object" && !Array.isArray(st) ? (st as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Antrieb im Cover-Profil zufahren (Gen2+: `Cover.Close`, Gen1: `/roller/N?go=close`). Wirft bei Fehler. */
export async function shellyCoverClose(host: string, coverId: number): Promise<void> {
  await shellyAuthCheck(host);
  const info = await shellyInfo(host);
  if (!info) throw new Error(`${host} ist kein erreichbarer Shelly`);
  await shellyGet(host, info.gen >= 2 ? `/rpc/Cover.Close?id=${coverId}` : `/roller/${coverId}?go=close`);
}

/**
 * Relais schalten: on = true/false, oder "toggle". Liefert den neuen Zustand.
 *
 * `autoOffSec` (nur beim Einschalten): Der Shelly faellt nach so vielen
 * Sekunden von selbst wieder ab – der Timer laeuft im Geraet, nicht im Hub.
 * Gleiche Logik wie `shellyAutoOffSec` in der Cloud (Taster, Tueroeffner).
 *
 * Wiederholt wird nur der Schaltbefehl selbst (retryable), nie die
 * Statusabfrage danach: Scheitert nur diese, war der Befehl schon da.
 */
export async function shellySwitch(
  host: string,
  channel: number,
  on: boolean | "toggle",
  autoOffSec?: number
): Promise<{ on: boolean | null }> {
  await shellyAuthCheck(host);
  const info = await shellyInfo(host);
  if (!info) throw new Error(`${host} ist kein erreichbarer Shelly`);
  const timer = on === true && autoOffSec && autoOffSec > 0 ? Math.round(autoOffSec) : 0;
  const action = shellyAction(on, timer);
  if (info.gen >= 2) {
    const path =
      on === "toggle"
        ? `/rpc/Switch.Toggle?id=${channel}`
        : `/rpc/Switch.Set?id=${channel}&on=${on ? "true" : "false"}${timer ? `&toggle_after=${timer}` : ""}`;
    await switchOnce(host, channel, path, action);
    const st = (await shellyGet(host, `/rpc/Switch.GetStatus?id=${channel}`)) as Record<string, unknown>;
    return { on: typeof st.output === "boolean" ? st.output : null };
  }
  const turn = on === "toggle" ? "toggle" : on ? "on" : "off";
  const r = (await switchOnce(host, channel, `/relay/${channel}?turn=${turn}${timer ? `&timer=${timer}` : ""}`, action)) as Record<
    string,
    unknown
  >;
  return { on: typeof r.ison === "boolean" ? r.ison : null };
}

/**
 * Laufende Nummer des letzten Schaltbefehls je Kanal. Kommt waehrend des
 * ersten Versuchs oder der Pause ein neuerer Befehl fuer denselben Kanal,
 * entfaellt die Wiederholung des aelteren: Sie wuerde den neueren
 * ueberschreiben (etwa ein „an“ nach einem spaeteren „aus“).
 */
const switchSeq = new Map<string, number>();

/** Schaltbefehl senden; nach Netzfehler oder Zeitlimit einmal wiederholen, wenn erlaubt. */
async function switchOnce(host: string, channel: number, path: string, action: ReturnType<typeof shellyAction>): Promise<unknown> {
  const key = `${host}#${channel}`;
  const seq = (switchSeq.get(key) ?? 0) + 1;
  switchSeq.set(key, seq);
  const latest = () => switchSeq.get(key) === seq;
  try {
    return await shellyGet(host, path);
  } catch (e) {
    const kind = shellyErrorKind(e);
    if (!retryable(action, kind, shellyNotSent(e)) || !latest()) throw e;
    await new Promise((r) => setTimeout(r, SHELLY_SWITCH_RETRY_MS));
    if (!latest()) throw e;
    improveCount("shelly", "switch_retry");
    log(
      `Shelly ${host} Kanal ${channel}: Schaltbefehl „${action === "on" ? "an" : "aus"}“ ohne Antwort ` +
        `(${kind === "timeout" ? "Zeitlimit" : "Netzfehler"}), einmal wiederholt`
    );
    const r = await shellyGet(host, path);
    improveCount("shelly", "switch_retry_ok");
    return r;
  }
}
