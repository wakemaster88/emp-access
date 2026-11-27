import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import type { TenantDb } from "@/lib/prisma";

/** Verwaltung des Newsletters: nur Admins eines Mandanten. */
export async function newsletterAdmin(): Promise<
  { error: NextResponse } | { accountId: number; db: TenantDb; userEmail: string | null; userName: string | null }
> {
  const s = await getSessionWithDb({ requireAdmin: true });
  if ("error" in s) return { error: s.error ?? NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!s.accountId) {
    return { error: NextResponse.json({ error: "Bitte zuerst einen Mandanten wählen" }, { status: 400 }) };
  }
  return {
    accountId: s.accountId,
    db: s.db,
    userEmail: s.session.user.email ?? null,
    userName: s.session.user.name ?? null,
  };
}

export function idParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
