/**
 * "Geraete" im Hub: alle steuerbaren Geraete im Netz, automatisch gefunden.
 *
 * Quellen (alles best-effort, einzeln fehlertolerant):
 *  - Netzwerk-Scan (scanner.ts): Shellys (probeShelly), Kandidaten fuer
 *    Hue (MAC-Hersteller Philips/Signify) und Tasmota (Port 80).
 *  - Hersteller-Discovery: discovery.meethue.com (Hue Bridges) und
 *    api.nuki.io/discover/bridges (Nuki Bridges). Liefern die LAN-IP auch
 *    fuer Geraete in VLANs, die der Scan nicht abdeckt.
 *  - Lokale Proben: Hue GET /api/config (ohne Login), Tasmota /cm?cmnd=Status.
 *
 * Steuerung:
 *  - Shelly: shelly.ts (direkt, ohne Kopplung).
 *  - Tasmota: /cm?cmnd=Power (ohne Kopplung, falls kein Web-Passwort).
 *  - Hue: Kopplung per Link-Taste (POST /api), danach Lampen ein/aus.
 *  - Nuki Bridge: Kopplung per Knopf an der Bridge (GET /auth), danach
 *    Schloesser oeffnen/abschliessen.
 *
 * Kopplungsdaten liegen nur auf dem Hub (hub/.cache/smart-pairings.json,
 * nicht im Repo), damit keine lokalen Tokens in der Cloud landen.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { lastScanResult } from "./scanner.js";
import { shellyStatus, shellySwitch, type ShellyStatus } from "./shelly.js";

const TIMEOUT_MS = 3000;
const DISCOVERY_TTL_MS = 10 * 60_000;
const PAIR_FILE = path.join(CONFIG.hubDir, ".cache", "smart-pairings.json");
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

interface Pairings {
  hue: Record<string, { ip: string; username: string }>;
  nuki: Record<string, { ip: string; port: number; token: string }>;
}

let pairings: Pairings = { hue: {}, nuki: {} };
let pairingsLoaded = false;

async function loadPairings(): Promise<void> {
  if (pairingsLoaded) return;
  pairingsLoaded = true;
  try {
    const data = JSON.parse(await fs.readFile(PAIR_FILE, "utf8")) as Partial<Pairings>;
    pairings = { hue: data.hue ?? {}, nuki: data.nuki ?? {} };
  } catch {
    /* noch nichts gekoppelt */
  }
}

async function savePairings(): Promise<void> {
  await fs.mkdir(path.dirname(PAIR_FILE), { recursive: true });
  await fs.writeFile(PAIR_FILE, JSON.stringify(pairings, null, 2), { mode: 0o600 });
}

async function getJson(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* --------------------------------------------------------------- Discovery */

interface Bridge {
  id: string;
  ip: string;
  port?: number;
}

let hueCloud: { at: number; list: Bridge[] } = { at: 0, list: [] };
let nukiCloud: { at: number; list: Bridge[] } = { at: 0, list: [] };

async function hueDiscovery(): Promise<Bridge[]> {
  if (Date.now() - hueCloud.at < DISCOVERY_TTL_MS) return hueCloud.list;
  try {
    const list = (await getJson("https://discovery.meethue.com/", undefined, 5000)) as {
      id: string;
      internalipaddress: string;
    }[];
    hueCloud = {
      at: Date.now(),
      list: list.filter((b) => IPV4_RE.test(b.internalipaddress)).map((b) => ({ id: b.id.toLowerCase(), ip: b.internalipaddress })),
    };
  } catch {
    hueCloud = { at: Date.now(), list: hueCloud.list };
  }
  return hueCloud.list;
}

async function nukiDiscovery(): Promise<Bridge[]> {
  if (Date.now() - nukiCloud.at < DISCOVERY_TTL_MS) return nukiCloud.list;
  try {
    const data = (await getJson("https://api.nuki.io/discover/bridges", undefined, 5000)) as {
      bridges?: { bridgeId: number; ip: string; port: number }[];
    };
    nukiCloud = {
      at: Date.now(),
      list: (data.bridges ?? [])
        .filter((b) => IPV4_RE.test(b.ip) && b.ip !== "0.0.0.0")
        .map((b) => ({ id: String(b.bridgeId), ip: b.ip, port: b.port || 8080 })),
    };
  } catch {
    nukiCloud = { at: Date.now(), list: nukiCloud.list };
  }
  return nukiCloud.list;
}

/** Hue Bridge lokal erkennen: /api/config antwortet auch ohne Login. */
async function probeHue(ip: string): Promise<{ id: string; name: string | null; model: string | null } | null> {
  try {
    const c = (await getJson(`http://${ip}/api/config`)) as Record<string, unknown>;
    if (typeof c.bridgeid !== "string") return null;
    return {
      id: c.bridgeid.toLowerCase(),
      name: typeof c.name === "string" ? c.name : null,
      model: typeof c.modelid === "string" ? c.modelid : null,
    };
  } catch {
    return null;
  }
}

/** Tasmota: /cm?cmnd=Status liefert ein Status-Objekt mit FriendlyName. */
async function probeTasmota(ip: string): Promise<{ name: string | null } | null> {
  try {
    const s = (await getJson(`http://${ip}/cm?cmnd=Status`)) as { Status?: { FriendlyName?: string[]; DeviceName?: string } };
    if (!s.Status) return null;
    return { name: s.Status.DeviceName ?? s.Status.FriendlyName?.[0] ?? null };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- Liste */

export interface SmartControl {
  /** Eindeutig innerhalb der Liste, z. B. "shelly:192.168.40.12:0". */
  key: string;
  name: string;
  kind: "switch" | "light" | "lock";
  on: boolean | null;
  /** Nur Lampen: Helligkeit 0..100. */
  brightness?: number | null;
  powerW?: number | null;
  /** Nur Schloesser: Zustand als Text. */
  stateText?: string | null;
  reachable: boolean;
  /** Shelly-Kanal (fuer die Raum-Zuordnung). */
  channel?: number;
}

export interface SmartDevice {
  id: string;
  vendor: "Shelly" | "Philips Hue" | "Nuki" | "Tasmota";
  name: string;
  ip: string;
  mac: string | null;
  model: string | null;
  vlanName: string | null;
  /** Kopplung noetig (Hue/Nuki), bevor gesteuert werden kann. */
  needsPairing: boolean;
  pairingHint: string | null;
  controls: SmartControl[];
  error: string | null;
}

let cache: { at: number; list: SmartDevice[] } | null = null;
let building: Promise<SmartDevice[]> | null = null;
const LIST_TTL_MS = 5_000;
const probeCache = new Map<string, { at: number; hue: Awaited<ReturnType<typeof probeHue>>; tasmota: Awaited<ReturnType<typeof probeTasmota>> }>();
const PROBE_TTL_MS = 15 * 60_000;

function shellyControls(ip: string, st: ShellyStatus | null): SmartControl[] {
  if (!st) return [{ key: `shelly:${ip}:0`, name: "Kanal 1", kind: "switch", on: null, reachable: false, channel: 0 }];
  return st.channels
    .filter((c) => c.kind !== "cover")
    .map((c) => ({
      key: `shelly:${ip}:${c.id}`,
      name: st.channels.length > 1 ? `Kanal ${c.id + 1}` : "Relais",
      kind: c.kind === "light" ? ("light" as const) : ("switch" as const),
      on: c.on,
      powerW: c.powerW,
      reachable: true,
      channel: c.id,
    }));
}

async function hueDevice(bridge: { id: string; ip: string; name: string | null; model: string | null }): Promise<SmartDevice> {
  const pair = pairings.hue[bridge.id];
  const base: SmartDevice = {
    id: `hue:${bridge.id}`,
    vendor: "Philips Hue",
    name: bridge.name ?? "Hue Bridge",
    ip: bridge.ip,
    mac: null,
    model: bridge.model,
    vlanName: null,
    needsPairing: !pair,
    pairingHint: pair ? null : "Link-Taste auf der Bridge drücken, dann innerhalb von 30 s „Koppeln“ tippen.",
    controls: [],
    error: null,
  };
  if (!pair) return base;
  if (pair.ip !== bridge.ip) {
    pair.ip = bridge.ip;
    void savePairings().catch(() => {});
  }
  try {
    const lights = (await getJson(`http://${bridge.ip}/api/${pair.username}/lights`)) as
      | Record<string, { name: string; state: { on: boolean; bri?: number; reachable?: boolean } }>
      | { error: { type: number; description: string } }[];
    if (Array.isArray(lights)) {
      const err = lights[0]?.error;
      if (err?.type === 1) {
        // Kopplung wurde in der Hue-App geloescht.
        delete pairings.hue[bridge.id];
        void savePairings().catch(() => {});
        return { ...base, needsPairing: true, pairingHint: "Kopplung ungültig – neu koppeln." };
      }
      return { ...base, error: err?.description ?? "Unbekannte Antwort" };
    }
    base.controls = Object.entries(lights).map(([id, l]) => ({
      key: `hue:${bridge.id}:${id}`,
      name: l.name,
      kind: "light" as const,
      on: l.state.on,
      brightness: typeof l.state.bri === "number" ? Math.round((l.state.bri / 254) * 100) : null,
      reachable: l.state.reachable !== false,
    }));
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

const NUKI_STATE: Record<number, string> = {
  0: "nicht kalibriert",
  1: "abgeschlossen",
  2: "schließt auf …",
  3: "offen",
  4: "schließt ab …",
  5: "Falle gezogen",
  6: "Lock 'n' Go",
  7: "zieht Falle …",
  254: "Motor blockiert",
  255: "unbekannt",
};

async function nukiDevice(bridge: Bridge): Promise<SmartDevice> {
  const pair = pairings.nuki[bridge.id];
  const port = bridge.port ?? 8080;
  const base: SmartDevice = {
    id: `nuki:${bridge.id}`,
    vendor: "Nuki",
    name: "Nuki Bridge",
    ip: bridge.ip,
    mac: null,
    model: "Bridge",
    vlanName: null,
    needsPairing: !pair,
    pairingHint: pair
      ? null
      : "„Koppeln“ tippen, dann innerhalb von 30 s den Knopf an der Bridge drücken (HTTP-API muss in der Nuki-App aktiv sein).",
    controls: [],
    error: null,
  };
  if (!pair) return base;
  try {
    const list = (await getJson(`http://${bridge.ip}:${port}/list?token=${encodeURIComponent(pair.token)}`, undefined, 5000)) as {
      nukiId: number;
      deviceType: number;
      name: string;
      lastKnownState?: { state?: number; batteryCritical?: boolean };
    }[];
    base.controls = list.map((l) => {
      const state = l.lastKnownState?.state ?? 255;
      return {
        key: `nuki:${bridge.id}:${l.nukiId}:${l.deviceType}`,
        name: l.name,
        kind: "lock" as const,
        on: state === 3 || state === 5 ? true : state === 1 ? false : null,
        stateText: `${NUKI_STATE[state] ?? "unbekannt"}${l.lastKnownState?.batteryCritical ? " · Batterie schwach" : ""}`,
        reachable: state !== 255,
      };
    });
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

async function tasmotaPower(ip: string): Promise<boolean | null> {
  try {
    const r = (await getJson(`http://${ip}/cm?cmnd=Power`)) as Record<string, string>;
    const v = r.POWER ?? r.POWER1;
    return v === "ON" ? true : v === "OFF" ? false : null;
  } catch {
    return null;
  }
}

async function buildList(): Promise<SmartDevice[]> {
  await loadPairings();
  const scan = lastScanResult().devices;
  const out: SmartDevice[] = [];

  // Shellys aus dem Scan.
  const shellies = scan.filter((d) => d.shelly);
  const shellyStates = await Promise.all(shellies.map((d) => shellyStatus(d.ip).catch(() => null)));
  shellies.forEach((d, i) => {
    const st = shellyStates[i];
    out.push({
      id: `shelly:${d.ip}`,
      vendor: "Shelly",
      name: d.shelly?.name || d.hostname || `Shelly ${d.ip}`,
      ip: d.ip,
      mac: d.mac,
      model: d.shelly?.app ?? d.shelly?.model ?? null,
      vlanName: d.vlanName,
      needsPairing: false,
      pairingHint: null,
      controls: shellyControls(d.ip, st),
      error: st ? null : "nicht erreichbar",
    });
  });

  // Kandidaten fuer Hue/Tasmota einmal pro Viertelstunde proben.
  const candidates = scan.filter((d) => !d.shelly && d.openPorts.includes(80));
  const now = Date.now();
  await Promise.all(
    candidates.map(async (d) => {
      const hit = probeCache.get(d.ip);
      if (hit && now - hit.at < PROBE_TTL_MS) return;
      const isHueVendor = /philips|signify|hue/i.test(d.vendor ?? "");
      const hue = isHueVendor || /hue/i.test(d.hostname ?? "") ? await probeHue(d.ip) : null;
      const tasmota = hue ? null : await probeTasmota(d.ip);
      probeCache.set(d.ip, { at: now, hue, tasmota });
    })
  );

  // Hue: Scan-Treffer plus Cloud-Discovery, je Bridge-ID einmal.
  const hueBridges = new Map<string, { id: string; ip: string; name: string | null; model: string | null }>();
  for (const d of candidates) {
    const h = probeCache.get(d.ip)?.hue;
    if (h) hueBridges.set(h.id, { id: h.id, ip: d.ip, name: h.name, model: h.model });
  }
  for (const b of await hueDiscovery()) {
    if (hueBridges.has(b.id)) continue;
    const h = await probeHue(b.ip);
    if (h) hueBridges.set(h.id, { id: h.id, ip: b.ip, name: h.name, model: h.model });
  }
  for (const [id, p] of Object.entries(pairings.hue)) {
    if (hueBridges.has(id)) continue;
    const h = await probeHue(p.ip);
    hueBridges.set(id, { id, ip: p.ip, name: h?.name ?? null, model: h?.model ?? null });
  }
  out.push(...(await Promise.all([...hueBridges.values()].map(hueDevice))));

  // Nuki Bridges.
  const nukiBridges = new Map<string, Bridge>();
  for (const b of await nukiDiscovery()) nukiBridges.set(b.id, b);
  for (const [id, p] of Object.entries(pairings.nuki)) {
    if (!nukiBridges.has(id)) nukiBridges.set(id, { id, ip: p.ip, port: p.port });
  }
  out.push(...(await Promise.all([...nukiBridges.values()].map(nukiDevice))));

  // Tasmota.
  const tasmotas = candidates.filter((d) => probeCache.get(d.ip)?.tasmota);
  const powers = await Promise.all(tasmotas.map((d) => tasmotaPower(d.ip)));
  tasmotas.forEach((d, i) => {
    out.push({
      id: `tasmota:${d.ip}`,
      vendor: "Tasmota",
      name: probeCache.get(d.ip)?.tasmota?.name || d.hostname || `Tasmota ${d.ip}`,
      ip: d.ip,
      mac: d.mac,
      model: null,
      vlanName: d.vlanName,
      needsPairing: false,
      pairingHint: null,
      controls: [{ key: `tasmota:${d.ip}`, name: "Relais", kind: "switch", on: powers[i], reachable: powers[i] !== null }],
      error: powers[i] === null ? "nicht erreichbar" : null,
    });
  });

  // VLAN-Namen fuer Bridges aus dem Scan nachtragen.
  for (const dev of out) {
    if (dev.vlanName) continue;
    const s = scan.find((d) => d.ip === dev.ip);
    if (s) {
      dev.vlanName = s.vlanName;
      dev.mac = dev.mac ?? s.mac;
    }
  }
  return out;
}

export async function listSmartDevices(fresh = false): Promise<{ scannedAt: string | null; devices: SmartDevice[] }> {
  const scannedAt = lastScanResult().lastRunAt;
  if (!fresh && cache && Date.now() - cache.at < LIST_TTL_MS) return { scannedAt, devices: cache.list };
  if (!building) {
    building = buildList()
      .then((list) => {
        cache = { at: Date.now(), list };
        return list;
      })
      .finally(() => {
        building = null;
      });
  }
  return { scannedAt, devices: await building };
}

/* --------------------------------------------------------------- Steuern */

export async function controlSmart(key: string, on: boolean, brightness?: number): Promise<{ ok: boolean; error?: string }> {
  await loadPairings();
  const parts = key.split(":");
  try {
    if (parts[0] === "shelly") {
      const [, ip, ch] = parts;
      if (!IPV4_RE.test(ip)) throw new Error("Ungültige IP");
      await shellySwitch(ip, Number(ch) || 0, on);
    } else if (parts[0] === "tasmota") {
      const ip = parts[1];
      if (!IPV4_RE.test(ip)) throw new Error("Ungültige IP");
      await getJson(`http://${ip}/cm?cmnd=${encodeURIComponent(`Power ${on ? "On" : "Off"}`)}`);
    } else if (parts[0] === "hue") {
      const [, bridgeId, lightId] = parts;
      const pair = pairings.hue[bridgeId];
      if (!pair) throw new Error("Hue Bridge nicht gekoppelt");
      if (!/^\d+$/.test(lightId)) throw new Error("Ungültige Lampe");
      const state: Record<string, unknown> = { on };
      if (on && typeof brightness === "number" && brightness > 0) {
        state.bri = Math.max(1, Math.min(254, Math.round((brightness / 100) * 254)));
      }
      const r = (await getJson(`http://${pair.ip}/api/${pair.username}/lights/${lightId}/state`, {
        method: "PUT",
        body: JSON.stringify(state),
      })) as { error?: { description: string } }[];
      const err = r.find((x) => x.error)?.error;
      if (err) throw new Error(err.description);
    } else if (parts[0] === "nuki") {
      const [, bridgeId, nukiId, deviceType] = parts;
      const pair = pairings.nuki[bridgeId];
      if (!pair) throw new Error("Nuki Bridge nicht gekoppelt");
      if (!/^\d+$/.test(nukiId) || !/^\d+$/.test(deviceType)) throw new Error("Ungültiges Schloss");
      // 3 = Falle ziehen (Tuer oeffnen), 2 = abschliessen.
      const action = on ? 3 : 2;
      const r = (await getJson(
        `http://${pair.ip}:${pair.port}/lockAction?nukiId=${nukiId}&deviceType=${deviceType}&action=${action}&token=${encodeURIComponent(pair.token)}`,
        undefined,
        30_000
      )) as { success?: boolean };
      if (!r.success) throw new Error("Bridge meldet Fehler");
    } else {
      throw new Error("Unbekanntes Gerät");
    }
    cache = null;
    log(`Geräte: ${key} ${on ? "ein/öffnen" : "aus/abschließen"}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* --------------------------------------------------------------- Koppeln */

export async function pairSmart(id: string): Promise<{ ok: boolean; error?: string }> {
  await loadPairings();
  const [vendor, bridgeId] = id.split(":");
  const list = cache?.list ?? (await listSmartDevices()).devices;
  const dev = list.find((d) => d.id === id);
  if (!dev) return { ok: false, error: "Gerät nicht gefunden" };
  try {
    if (vendor === "hue") {
      const r = (await getJson(`http://${dev.ip}/api`, {
        method: "POST",
        body: JSON.stringify({ devicetype: `emp-hub#${CONFIG.name}`.slice(0, 40) }),
      })) as { success?: { username: string }; error?: { type: number; description: string } }[];
      const ok = r.find((x) => x.success)?.success;
      if (!ok) {
        const err = r.find((x) => x.error)?.error;
        return { ok: false, error: err?.type === 101 ? "Link-Taste nicht gedrückt – erst Taste drücken, dann koppeln." : err?.description ?? "Kopplung abgelehnt" };
      }
      pairings.hue[bridgeId] = { ip: dev.ip, username: ok.username };
    } else if (vendor === "nuki") {
      const bridge = nukiCloud.list.find((b) => b.id === bridgeId);
      const port = bridge?.port ?? pairings.nuki[bridgeId]?.port ?? 8080;
      // Die Bridge wartet bis zu 30 s auf den Knopfdruck.
      const r = (await getJson(`http://${dev.ip}:${port}/auth`, undefined, 35_000)) as { token?: string; success?: boolean };
      if (!r.success || !r.token) return { ok: false, error: "Kein Knopfdruck an der Bridge erkannt" };
      pairings.nuki[bridgeId] = { ip: dev.ip, port, token: r.token };
    } else {
      return { ok: false, error: "Dieses Gerät braucht keine Kopplung" };
    }
    await savePairings();
    cache = null;
    log(`Geräte: ${dev.vendor} ${dev.ip} gekoppelt`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------- Hue fuer Raeume */

/** Zustand aller Lampen einer gekoppelten Bridge; null = nicht gekoppelt/erreichbar. */
export async function hueLightStates(
  bridgeId: string
): Promise<Record<string, { on: boolean; reachable: boolean; brightness: number | null }> | null> {
  await loadPairings();
  const pair = pairings.hue[bridgeId];
  if (!pair) return null;
  try {
    const lights = (await getJson(`http://${pair.ip}/api/${pair.username}/lights`)) as
      | Record<string, { state: { on: boolean; bri?: number; reachable?: boolean } }>
      | unknown[];
    if (Array.isArray(lights)) return null;
    const out: Record<string, { on: boolean; reachable: boolean; brightness: number | null }> = {};
    for (const [id, l] of Object.entries(lights)) {
      out[id] = {
        on: l.state.on,
        reachable: l.state.reachable !== false,
        brightness: typeof l.state.bri === "number" ? Math.round((l.state.bri / 254) * 100) : null,
      };
    }
    return out;
  } catch {
    return null;
  }
}
