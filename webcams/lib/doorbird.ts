import crypto from "node:crypto";
import type { DoorbirdConfig } from "./types";

/**
 * Doorbird HTTP-Client mit Auth-Aushandlung.
 *
 * Doorbird-Geräte unterstützen Basic- ODER Digest-Auth, neuere Firmwares
 * verlangen Digest. Wir versuchen Basic zuerst (1 Request), bei 401 mit
 * Digest-Realm folgt automatisch der Digest-Roundtrip.
 */

interface DigestParams {
  realm: string;
  nonce: string;
  qop?: string;
  algorithm?: string;
  opaque?: string;
}

function md5(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}

function parseDigest(header: string): DigestParams | null {
  if (!/^digest/i.test(header)) return null;
  const parts: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    parts[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  if (!parts.realm || !parts.nonce) return null;
  return {
    realm: parts.realm,
    nonce: parts.nonce,
    qop: parts.qop,
    algorithm: parts.algorithm,
    opaque: parts.opaque,
  };
}

function buildDigestHeader(
  user: string,
  pass: string,
  method: string,
  uri: string,
  d: DigestParams,
): string {
  const ha1 = md5(`${user}:${d.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const qop = d.qop?.split(",")[0]?.trim() || "auth";
  const response = md5(`${ha1}:${d.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const fields: string[] = [
    `username="${user}"`,
    `realm="${d.realm}"`,
    `nonce="${d.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${d.algorithm ?? "MD5"}`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ];
  if (d.opaque) fields.push(`opaque="${d.opaque}"`);
  return `Digest ${fields.join(", ")}`;
}

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

interface FetchOpts {
  signal?: AbortSignal;
  method?: string;
}

async function authedFetch(
  db: DoorbirdConfig,
  path: string,
  { signal, method = "GET" }: FetchOpts = {},
): Promise<Response> {
  if (!db.ip) throw new Error("doorbird ip not configured");
  if (!db.username || !db.password) throw new Error("doorbird credentials missing");

  const url = `http://${db.ip}${path}`;

  // Versuch 1 – Basic-Auth (klein, schnell)
  const r1 = await fetch(url, {
    method,
    headers: { Authorization: basicHeader(db.username, db.password) },
    signal,
  });
  if (r1.status !== 401) return r1;

  // Versuch 2 – Digest-Auth basierend auf 401-Header
  const wwwAuth = r1.headers.get("www-authenticate") ?? "";
  const digest = parseDigest(wwwAuth);
  if (!digest) return r1; // kein Digest-Realm, dann ist's halt 401

  const r2 = await fetch(url, {
    method,
    headers: {
      Authorization: buildDigestHeader(db.username, db.password, method, path, digest),
    },
    signal,
  });
  return r2;
}

export async function doorbirdInfo(db: DoorbirdConfig, signal?: AbortSignal) {
  const r = await authedFetch(db, "/bha-api/info.cgi", { signal });
  if (!r.ok) throw new Error(`Doorbird info HTTP ${r.status}`);
  return await r.json();
}

export async function doorbirdOpenDoor(db: DoorbirdConfig, signal?: AbortSignal) {
  const r = await authedFetch(db, `/bha-api/open-door.cgi?r=${encodeURIComponent(db.relayId)}`, {
    signal,
  });
  if (!r.ok) throw new Error(`open-door HTTP ${r.status}`);
  return true;
}

export async function doorbirdLightOn(db: DoorbirdConfig, signal?: AbortSignal) {
  const r = await authedFetch(db, "/bha-api/light-on.cgi", { signal });
  if (!r.ok) throw new Error(`light-on HTTP ${r.status}`);
  return true;
}

export async function doorbirdSnapshot(db: DoorbirdConfig, signal?: AbortSignal): Promise<Buffer> {
  const r = await authedFetch(db, "/bha-api/image.cgi", { signal });
  if (!r.ok) throw new Error(`snapshot HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
