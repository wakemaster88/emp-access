import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { auth } from "./auth";

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
  const token =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    request.nextUrl.searchParams.get("token");

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

  return { account, db: tenantClient(account.id), device };
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

export async function getSessionWithDb() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const accountId = session.user.accountId;

  if (!isSuperAdmin && !accountId) {
    return { error: NextResponse.json({ error: "No account assigned" }, { status: 403 }) };
  }

  const db: TenantDb = isSuperAdmin ? prisma : tenantClient(accountId!);

  return { session, db, isSuperAdmin, accountId };
}

/**
 * Session oder Account-API-Token. Für Integrations-Endpunkte, die das Dashboard
 * und fremde Systeme (emp-control) gleichermaßen nutzen.
 */
export async function getAccountFromRequest(request: NextRequest): Promise<
  | { error: NextResponse }
  | { db: TenantDb; accountId: number }
> {
  if (hasApiToken(request)) {
    const tokenAuth = await validateApiToken(request);
    if ("error" in tokenAuth) {
      return { error: tokenAuth.error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    return { db: tokenAuth.db, accountId: tokenAuth.account.id };
  }

  const session = await getSessionWithDb();
  if ("error" in session) {
    return { error: session.error ?? NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (session.accountId == null) {
    return { error: NextResponse.json({ error: "No account assigned" }, { status: 403 }) };
  }
  return { db: session.db, accountId: session.accountId };
}
