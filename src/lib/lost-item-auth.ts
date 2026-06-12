import { NextRequest, NextResponse } from "next/server";
import { validateApiToken, getSessionWithDb } from "@/lib/api-auth";
import { prisma, tenantClient } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantClient> | typeof prisma;

export type LostItemAuthResult =
  | { error: NextResponse }
  | { error?: never; db: TenantDb; accountId: number; viaToken: boolean };

/**
 * Auth-Auflösung für die Fundsachen-API: wahlweise Dashboard-Session oder
 * Account-API-Token (Bearer-Header bzw. ?token=...) – Letzteres für externe
 * Integrationen wie den E-Mail-Agenten oder den fonio.ai-Telefonassistenten.
 */
export async function resolveLostItemAuth(request: NextRequest): Promise<LostItemAuthResult> {
  const hasToken =
    request.nextUrl.searchParams.has("token") || request.headers.has("authorization");

  if (hasToken) {
    const auth = await validateApiToken(request);
    if (auth.error) return { error: auth.error };
    return { db: auth.db!, accountId: auth.account!.id, viaToken: true };
  }

  const session = await getSessionWithDb();
  if (session.error) return { error: session.error };
  return { db: session.db!, accountId: session.accountId!, viaToken: false };
}
