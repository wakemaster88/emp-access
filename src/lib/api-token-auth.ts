/**
 * Token-Pruefung der API (Account-, Geraete- und Integrations-Tokens) samt
 * Cache. Liegt getrennt von `./api-auth`, damit reine Token-Routen (Geraete,
 * Hub, Pi, Audio) nicht die Anmelde-Bibliotheken der Sitzung mitladen.
 * `./api-auth` exportiert diese Namen unveraendert weiter.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { queryTokenLogLine, shouldLogQueryToken } from "./query-token-log";
import {
  bearerToken,
  hashIntegrationToken,
  integrationLastUsedDue,
  integrationScopeAllows,
  looksLikeIntegrationToken,
  type IntegrationRoute,
} from "./integration-token";

export function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

type CachedAccount = { id: number; isActive: boolean };
/** Geraet, wenn das Token ein Geraete-Token ist (Device.apiToken). */
type CachedDevice = { id: number; type: string; isActive: boolean };
type CacheEntry = { account: CachedAccount | null; device: CachedDevice | null; expiresAt: number };

// In-Memory-Cache fuer API-Token-Lookups. Reduziert pro warmer Function-
// Instanz die Anzahl der Account-Lookups massiv (Pi-Heartbeats pollen alle
// paar Sekunden). Negativ-Eintraege (account=null) cachen wir kuerzer, damit
// ein gerade erstellter / reaktivierter Token zuegig sichtbar wird, und um
// auch keine Brute-Force-Versuche unkontrolliert weiter Richtung DB zu lassen.
const TOKEN_CACHE_TTL_OK_MS = 60_000;
const TOKEN_CACHE_TTL_FAIL_MS = 5_000;
const TOKEN_CACHE_MAX_ENTRIES = 1_000;
const tokenCache = new Map<string, CacheEntry>();

function cacheGet(token: string): CacheEntry | null {
  const entry = tokenCache.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tokenCache.delete(token);
    return null;
  }
  return entry;
}

function cacheSet(token: string, account: CachedAccount | null, device: CachedDevice | null) {
  if (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    // Einfaches LRU-Surrogat: aelteste Eintraege rauswerfen.
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(token, {
    account,
    device,
    expiresAt: Date.now() + (account ? TOKEN_CACHE_TTL_OK_MS : TOKEN_CACHE_TTL_FAIL_MS),
  });
}

/** Test-Helper, damit Tests den Cache zwischen Faellen leeren koennen. */
export function _clearApiTokenCache() {
  tokenCache.clear();
}

async function lookupToken(token: string): Promise<{ account: CachedAccount | null; device: CachedDevice | null }> {
  const account = await prisma.account.findUnique({
    where: { apiToken: token },
    select: { id: true, isActive: true },
  });
  if (account) return { account, device: null };

  // Geraete-Token: gilt nur fuer das eine Geraet und nur auf den
  // Geraete-Endpunkten (siehe `allowDevice`). Ein Pi, der abhanden kommt,
  // gibt damit nicht mehr die ganze Account-API preis.
  const device = await prisma.device.findUnique({
    where: { apiToken: token },
    select: { id: true, type: true, isActive: true, account: { select: { id: true, isActive: true } } },
  });
  if (!device) return { account: null, device: null };
  return {
    account: { id: device.account.id, isActive: device.account.isActive },
    device: { id: device.id, type: device.type, isActive: device.isActive },
  };
}

/**
 * Account-API-Token (Bearer oder `?token=`) pruefen.
 *
 * `allowDevice: true` laesst zusaetzlich Geraete-Token zu; der Aufrufer muss
 * dann `device.id` gegen das angesprochene Geraet pruefen. Ohne die Option
 * wird ein Geraete-Token abgewiesen.
 */
export async function validateApiToken(
  request: NextRequest,
  options: { allowDevice?: boolean } = {},
) {
  const headerToken = request.headers.get("authorization")?.replace("Bearer ", "");
  const token = headerToken ?? request.nextUrl.searchParams.get("token");

  if (!token) {
    return { error: NextResponse.json({ error: "Missing API token" }, { status: 401 }) };
  }

  const cached = cacheGet(token);
  let account: CachedAccount | null;
  let device: CachedDevice | null;
  if (cached) {
    account = cached.account;
    device = cached.device;
  } else {
    ({ account, device } = await lookupToken(token));
    cacheSet(token, account, device);
  }

  if (!account || !account.isActive) {
    return { error: NextResponse.json({ error: "Invalid API token" }, { status: 403 }) };
  }

  if (device && !options.allowDevice) {
    return {
      error: NextResponse.json(
        { error: "Geräte-Token gilt nur für die Geräte-Endpunkte (/api/devices/pi, /api/devices/audio)" },
        { status: 403 },
      ),
    };
  }

  if (headerToken == null && shouldLogQueryToken(request.nextUrl.pathname)) {
    console.info(queryTokenLogLine(request.nextUrl.pathname, device ? "device" : "account"));
  }

  return { account, db: tenantClient(account.id), device };
}

/** Angaben zum Integrations-Token, wenn die Anfrage eines benutzt hat. */
export type IntegrationTokenAuth = { id: number; name: string; scopes: string[] };

async function findIntegrationToken(token: string) {
  return prisma.integrationToken.findUnique({
    where: { tokenHash: hashIntegrationToken(token) },
    select: {
      id: true,
      name: true,
      scopes: true,
      accountId: true,
      revokedAt: true,
      lastUsedAt: true,
      account: { select: { id: true, isActive: true } },
    },
  });
}

/**
 * Wie `validateApiToken`, laesst aber zusaetzlich Integrations-Tokens zu
 * (src/lib/integration-token.ts). Diese gelten nur als
 * `Authorization: Bearer`, nur solange sie nicht widerrufen sind und nur,
 * wenn einer ihrer Scopes Methode und Route erlaubt. Account- und
 * Geraete-Tokens laufen unveraendert ueber `validateApiToken`.
 */
export async function validateApiOrIntegrationToken(
  request: NextRequest,
  route: IntegrationRoute,
  options: { allowDevice?: boolean } = {},
): Promise<
  | { error: NextResponse }
  | { account: CachedAccount; db: TenantDb; device: CachedDevice | null; integration: IntegrationTokenAuth | null }
> {
  const bearer = bearerToken(request.headers);
  if (bearer && looksLikeIntegrationToken(bearer)) {
    const row = await findIntegrationToken(bearer);
    if (row) {
      if (row.revokedAt || !row.account.isActive) {
        return { error: NextResponse.json({ error: "Invalid API token" }, { status: 403 }) };
      }
      if (!integrationScopeAllows(row.scopes, request.method, route)) {
        return {
          error: NextResponse.json(
            { error: "Dieses Integrations-Token ist für diese Anfrage nicht freigegeben" },
            { status: 403 },
          ),
        };
      }
      if (integrationLastUsedDue(row.lastUsedAt)) {
        await prisma.integrationToken
          .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
          .catch(() => undefined);
      }
      return {
        account: { id: row.account.id, isActive: row.account.isActive },
        db: tenantClient(row.accountId),
        device: null,
        integration: { id: row.id, name: row.name, scopes: row.scopes },
      };
    }
    // Kein Integrations-Token: weiter wie bisher (Account- oder Geraete-Token).
  }

  const auth = await validateApiToken(request, options);
  if ("error" in auth) {
    // Integrations-Token als ?token=: eigene Meldung, damit der Grund klar ist.
    const queryToken = request.headers.has("authorization") ? null : request.nextUrl.searchParams.get("token");
    if (queryToken && looksLikeIntegrationToken(queryToken) && (await findIntegrationToken(queryToken))) {
      return {
        error: NextResponse.json(
          { error: "Integrations-Token nur im Header „Authorization: Bearer …“ senden" },
          { status: 403 },
        ),
      };
    }
    return { error: auth.error as NextResponse };
  }
  return { account: auth.account, db: auth.db, device: auth.device, integration: null };
}

/**
 * 403, wenn ein Geraete-Token ein anderes Geraet anspricht als sein eigenes;
 * sonst null. Account-Token duerfen alle Geraete des Accounts.
 */
export function deviceTokenMismatch(
  auth: { device: CachedDevice | null },
  deviceId: number,
): NextResponse | null {
  if (auth.device && auth.device.id !== deviceId) {
    return NextResponse.json({ error: "Token gehört zu einem anderen Gerät" }, { status: 403 });
  }
  return null;
}
