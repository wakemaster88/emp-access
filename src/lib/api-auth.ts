import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { auth, markedCrossSite } from "./auth";
import { hasApiToken, validateApiToken } from "./api-token-auth";

// Token-Pruefung liegt in ./api-token-auth (ohne ./auth); hier nur
// weitergereicht, damit bestehende Importe unveraendert funktionieren.
export {
  _clearApiTokenCache,
  deviceTokenMismatch,
  hasApiToken,
  validateApiOrIntegrationToken,
  validateApiToken,
  type IntegrationTokenAuth,
} from "./api-token-auth";

/**
 * Mandanten-Rollen: USER darf bedienen (Tickets, Check-in, Tueren oeffnen),
 * aber weder Zugangsdaten/Schnittstellen noch Regeln und Betriebszeiten
 * aendern. Das Dashboard blendet diese Teile fuer USER aus bzw. zeigt sie
 * schreibgeschuetzt; ohne Pruefung am Server waere das nur Kosmetik.
 */
export function isTenantAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/** 403-Antwort, wenn die Rolle keine Verwaltungsrechte hat; sonst null. */
export function adminRoleRequired(role: string | null | undefined): NextResponse | null {
  if (isTenantAdminRole(role)) return null;
  return NextResponse.json(
    { error: "Keine Berechtigung – dafür ist ein Admin-Zugang nötig." },
    { status: 403 },
  );
}

export async function getSessionWithDb(options: { requireAdmin?: boolean } = {}) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  // Sitzungs-Cookie plus schreibende Anfrage einer fremden Seite: ablehnen.
  // Gilt nur hier im Sitzungs-Zweig; Token-Zugaenge pruefen das nicht.
  if (await markedCrossSite()) {
    return {
      error: NextResponse.json({ error: "Anfrage von einer fremden Seite abgelehnt" }, { status: 403 }),
    };
  }
  if (options.requireAdmin) {
    const denied = adminRoleRequired(session.user.role);
    if (denied) return { error: denied };
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

/**
 * Sitzung (Web-App) oder Account-Token (Hub). Fuer Verwaltungs-Endpunkte, die
 * auch der Hub bedienen darf – etwa die Regeln, die das Hub-Dashboard
 * bearbeitet. Mit `Authorization`-Header zaehlt nur das Token.
 */
export async function getSessionOrApiToken(
  request: NextRequest,
  options: { requireAdmin?: boolean } = {},
): Promise<{ error: NextResponse } | { db: TenantDb; accountId: number | null | undefined }> {
  if (request.headers.has("authorization")) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return { error: auth.error as NextResponse };
    return { db: auth.db, accountId: auth.account.id };
  }
  // `requireAdmin` betrifft nur die Sitzung: das Account-Token ist ohnehin
  // ein Verwaltungs-Zugang (Hub).
  const session = await getSessionWithDb(options);
  if ("error" in session) return { error: session.error as NextResponse };
  return { db: session.db, accountId: session.accountId };
}
