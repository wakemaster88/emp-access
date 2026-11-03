/**
 * Shelly-Geraete (Gen1 und Gen2+/Pro/Plus) im lokalen Netz: erkennen, Status
 * lesen, Relais schalten. Spricht die lokale HTTP-API direkt an – keine Cloud.
 *
 * Gen1:  GET /shelly, /status, /relay/<n>?turn=on|off|toggle   (Basic-Auth)
 * Gen2+: GET /shelly, /rpc/Shelly.GetStatus, /rpc/Switch.Set    (Digest SHA-256)
 *
 * Passwort (falls in den Shellys gesetzt): HUB_SHELLY_PASSWORD, Benutzer
 * HUB_SHELLY_USER (Gen1, Vorgabe "admin"; Gen2 nutzt immer "admin").
 */
import { createHash, randomBytes } from "node:crypto";

export interface ShellyInfo {
  gen: number;
  model: string | null;
  /** Gen2: App-Name (z. B. "Pro4PM"), Gen1: type (z. B. "SHSW-25"). */
  app: string | null;
  name: string | null;
  fw: string | null;
  auth: boolean;
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

/**
 * GET mit optionaler Authentifizierung: Basic fuer Gen1, Digest (SHA-256 oder
 * MD5, qop=auth) fuer Gen2+, sobald das Geraet 401 antwortet.
 */
async function shellyGet(host: string, path: string): Promise<unknown> {
  const url = `http://${host}${path}`;
  const first = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (first.status !== 401) {
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
  const res = await fetch(url, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
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
  const info = await probeShelly(host, TIMEOUT_MS);
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

/** Relais schalten: on = true/false, oder "toggle". Liefert den neuen Zustand. */
export async function shellySwitch(
  host: string,
  channel: number,
  on: boolean | "toggle"
): Promise<{ on: boolean | null }> {
  const info = await probeShelly(host, TIMEOUT_MS);
  if (!info) throw new Error(`${host} ist kein erreichbarer Shelly`);
  if (info.gen >= 2) {
    const path =
      on === "toggle"
        ? `/rpc/Switch.Toggle?id=${channel}`
        : `/rpc/Switch.Set?id=${channel}&on=${on ? "true" : "false"}`;
    await shellyGet(host, path);
    const st = (await shellyGet(host, `/rpc/Switch.GetStatus?id=${channel}`)) as Record<string, unknown>;
    return { on: typeof st.output === "boolean" ? st.output : null };
  }
  const turn = on === "toggle" ? "toggle" : on ? "on" : "off";
  const r = (await shellyGet(host, `/relay/${channel}?turn=${turn}`)) as Record<string, unknown>;
  return { on: typeof r.ison === "boolean" ? r.ison : null };
}
