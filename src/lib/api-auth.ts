import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "./prisma";
import { auth } from "./auth";

export function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

type CachedAccount = { id: number; isActive: boolean };
type CacheEntry = { account: CachedAccount | null; expiresAt: number };

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

function cacheSet(token: string, account: CachedAccount | null) {
  if (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    // Einfaches LRU-Surrogat: aelteste Eintraege rauswerfen.
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(token, {
    account,
    expiresAt: Date.now() + (account ? TOKEN_CACHE_TTL_OK_MS : TOKEN_CACHE_TTL_FAIL_MS),
  });
}

/** Test-Helper, damit Tests den Cache zwischen Faellen leeren koennen. */
export function _clearApiTokenCache() {
  tokenCache.clear();
}

export async function validateApiToken(request: NextRequest) {
  const token =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    request.nextUrl.searchParams.get("token");

  if (!token) {
    return { error: NextResponse.json({ error: "Missing API token" }, { status: 401 }) };
  }

  const cached = cacheGet(token);
  let account: CachedAccount | null;
  if (cached) {
    account = cached.account;
  } else {
    account = await prisma.account.findUnique({
      where: { apiToken: token },
      select: { id: true, isActive: true },
    });
    cacheSet(token, account);
  }

  if (!account || !account.isActive) {
    return { error: NextResponse.json({ error: "Invalid API token" }, { status: 403 }) };
  }

  return { account, db: tenantClient(account.id) };
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

  const db = isSuperAdmin ? prisma : tenantClient(accountId!);

  return { session, db, isSuperAdmin, accountId };
}

/**
 * Session oder Account-API-Token. Für Integrations-Endpunkte, die das Dashboard
 * und fremde Systeme (emp-control) gleichermaßen nutzen.
 */
export async function getAccountFromRequest(request: NextRequest): Promise<
  | { error: NextResponse }
  | { db: ReturnType<typeof tenantClient> | typeof prisma; accountId: number }
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
