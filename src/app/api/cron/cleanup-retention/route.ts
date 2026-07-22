import { NextRequest, NextResponse } from "next/server";
import { purgeAllAccountsRetention } from "@/lib/data-retention";

export const maxDuration = 60;

/**
 * Nachtlicher Cron: löscht Historien-/Log-Daten gemäß Account.dataRetention.
 * Schedule: täglich nach cleanup-tickets.
 */
function verifyCronAuth(request: NextRequest): { ok: true } | { ok: false; status: number; body: object } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: { error: "CRON_SECRET ist nicht gesetzt" },
    };
  }
  const auth = request.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer !== secret) {
    return { ok: false, status: 401, body: { error: "Unauthorized" } };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const result = await purgeAllAccountsRetention();
  const totalDeleted = result.results.reduce(
    (sum, r) => sum + Object.values(r.deleted).reduce((a, b) => a + (b ?? 0), 0),
    0
  );

  console.log(
    `[cron cleanup-retention] accounts=${result.accounts} purgedAccounts=${result.results.length} deleted=${totalDeleted}`
  );

  return NextResponse.json({
    accounts: result.accounts,
    purgedAccounts: result.results.length,
    totalDeleted,
    results: result.results,
  });
}
