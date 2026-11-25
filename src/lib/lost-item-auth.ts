import { NextRequest, NextResponse } from "next/server";
import { validateApiOrIntegrationToken, getSessionWithDb } from "@/lib/api-auth";
import type { IntegrationRoute } from "@/lib/integration-token";
import { prisma, tenantClient } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantClient> | typeof prisma;

export type LostItemAuthResult =
  | { error: NextResponse }
  | { error?: never; db: TenantDb; accountId: number; viaToken: boolean; isSuperAdmin: boolean };

/**
 * Auth-Auflösung für die Fundsachen-API: wahlweise Dashboard-Session oder
 * Account-API-Token (Bearer-Header bzw. ?token=...) – Letzteres für externe
 * Integrationen wie den E-Mail-Agenten oder den fonio.ai-Telefonassistenten.
 * Integrations-Tokens mit Scope `lost-items` gelten nur als Bearer-Header;
 * `route` ist das Pfadmuster der aufrufenden Route.
 */
export async function resolveLostItemAuth(
  request: NextRequest,
  route: Extract<IntegrationRoute, `/api/lost-items${string}`>,
): Promise<LostItemAuthResult> {
  const hasToken =
    request.nextUrl.searchParams.has("token") || request.headers.has("authorization");

  if (hasToken) {
    const auth = await validateApiOrIntegrationToken(request, route);
    if ("error" in auth) return { error: auth.error };
    return { db: auth.db, accountId: auth.account.id, viaToken: true, isSuperAdmin: false };
  }

  const session = await getSessionWithDb();
  if (session.error) return { error: session.error };
  return { db: session.db!, accountId: session.accountId!, viaToken: false, isSuperAdmin: session.isSuperAdmin! };
}
