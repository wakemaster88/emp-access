import { NextResponse } from "next/server";
import { getSessionWithDb } from "./api-auth";
import type { TenantDb } from "./prisma";

/**
 * Sitzung für die Gamification-Verwaltung: Admin-Rolle und ein fester Mandant.
 * Ein Super-Admin ohne Mandant bekommt 403, weil alle Einstellungen je Mandant gelten.
 */
export async function gamiAdminSession(): Promise<
  { error: NextResponse } | { db: TenantDb; accountId: number }
> {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return { error: session.error as NextResponse };
  if (session.accountId == null) {
    return { error: NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 403 }) };
  }
  return { db: session.db, accountId: session.accountId };
}
