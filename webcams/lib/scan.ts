/**
 * Reolink-Netzwerk-Scanner.
 *
 * Probiert in einem /24-Subnet jede IP per HTTP-Login durch. Gefundene
 * Reolink-Cams werden mit DevInfo zurückgegeben.
 *
 * Performance: Parallel mit Concurrency-Limit; das gesamte Scannen
 * eines /24 dauert ~5-10 s.
 */

import os from "node:os";

interface ScanCandidate {
  ip: string;
  username: string;
  password: string;
}

export interface FoundCam {
  ip: string;
  model: string;
  name: string;
  firmVer: string;
  serial: string;
  channelNum: number;
  type: string;
  exactType?: string;
  hardVer: string;
}

const FETCH_TIMEOUT_MS = 1500;
const CONCURRENCY = 32;

export function detectLocalSubnet(): string | null {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    if (name.startsWith("lo")) continue;
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal && a.address.startsWith("192.168.")) {
        const parts = a.address.split(".");
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
      if (a.family === "IPv4" && !a.internal && (a.address.startsWith("10.") || a.address.startsWith("172."))) {
        const parts = a.address.split(".");
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
    }
  }
  return null;
}

function expandSubnet(cidr: string): string[] {
  const [base] = cidr.split("/");
  const parts = base.split(".").map(Number);
  const ips: string[] = [];
  for (let i = 1; i < 255; i++) {
    ips.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`);
  }
  return ips;
}

async function probeReolink(c: ScanCandidate): Promise<FoundCam | null> {
  const url = `http://${c.ip}/cgi-bin/api.cgi?cmd=Login`;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          cmd: "Login",
          action: 0,
          param: { User: { Version: "0", userName: c.username, password: c.password } },
        },
      ]),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const data = (await r.json()) as Array<{
      code: number;
      value?: { Token: { name: string; leaseTime: number } };
      error?: { detail: string };
    }>;
    if (!Array.isArray(data) || data[0]?.code !== 0 || !data[0].value) {
      return null;
    }
    const token = data[0].value.Token.name;

    const infoUrl = `http://${c.ip}/cgi-bin/api.cgi?cmd=GetDevInfo&token=${token}`;
    const ir = await fetch(infoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ cmd: "GetDevInfo", action: 0, param: {} }]),
      signal: ctl.signal,
    });
    if (!ir.ok) return null;
    const idata = (await ir.json()) as Array<{ code: number; value?: { DevInfo: FoundCam & { exactType?: string } } }>;
    const info = idata[0]?.value?.DevInfo;
    if (!info) return null;

    return {
      ip: c.ip,
      model: info.model,
      name: info.name,
      firmVer: info.firmVer,
      serial: info.serial,
      channelNum: info.channelNum,
      type: info.type,
      exactType: info.exactType,
      hardVer: info.hardVer,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const total = items.length;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
      done++;
      onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export interface ScanOptions {
  subnet: string;
  username: string;
  password: string;
  excludeIps?: Set<string>;
  onProgress?: (done: number, total: number) => void;
}

export async function scanForReolink({
  subnet,
  username,
  password,
  excludeIps,
  onProgress,
}: ScanOptions): Promise<FoundCam[]> {
  const ips = expandSubnet(subnet).filter((ip) => !excludeIps?.has(ip));
  const candidates = ips.map((ip) => ({ ip, username, password }));
  const results = await runWithConcurrency(candidates, probeReolink, CONCURRENCY, onProgress);
  return results.filter((r): r is FoundCam => r !== null);
}

// ---------------------------------------------------------------------------
// Doorbird-Scanner
// ---------------------------------------------------------------------------

export interface FoundDoorbird {
  ip: string;
  realm: string;
  authScheme: "Digest" | "Basic";
  serverHeader?: string;
}

async function probeDoorbird(ip: string): Promise<FoundDoorbird | null> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Schritt 1: /bha-api/info.cgi gibt 401 mit DoorBird-spezifischem Realm
    const r = await fetch(`http://${ip}/bha-api/info.cgi`, {
      method: "GET",
      headers: { "User-Agent": "webcams-doorbird-scan" },
      signal: ctl.signal,
    });
    if (r.status !== 401 && r.status !== 200) return null;

    const auth = r.headers.get("www-authenticate") ?? "";
    const server = r.headers.get("server") ?? "";

    if (!/doorbird/i.test(auth)) {
      // Fallback: Root-Page enthält "<h1>DoorBird</h1>"
      const rr = await fetch(`http://${ip}/`, { signal: ctl.signal });
      const text = await rr.text();
      if (!/doorbird/i.test(text)) return null;
    }

    const realmMatch = auth.match(/realm="([^"]+)"/i);
    const schemeMatch = auth.match(/^(\w+)\s/);
    return {
      ip,
      realm: realmMatch?.[1] ?? "DoorBird",
      authScheme: (schemeMatch?.[1] === "Basic" ? "Basic" : "Digest") as "Digest" | "Basic",
      serverHeader: server || undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scanForDoorbird({
  subnet,
  excludeIps,
  onProgress,
}: {
  subnet: string;
  excludeIps?: Set<string>;
  onProgress?: (done: number, total: number) => void;
}): Promise<FoundDoorbird[]> {
  const ips = expandSubnet(subnet).filter((ip) => !excludeIps?.has(ip));
  const results = await runWithConcurrency(ips, probeDoorbird, CONCURRENCY, onProgress);
  return results.filter((r): r is FoundDoorbird => r !== null);
}
