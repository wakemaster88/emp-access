import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { processAccountEmailRules } from "@/lib/email-automation";

export const maxDuration = 60;

/**
 * Stündlicher Cron-Job: laedt alle Accounts mit aktiver EmailConfig und
 * verarbeitet pro Account die aktiven Regeln. Idempotenz uebernimmt das
 * Cooldown-Fenster + 24h-Trigger-Window in `processAccountEmailRules`.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron email] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const accounts = await prisma.emailConfig.findMany({
    where: { isActive: true, apiKey: { not: null } },
    select: { accountId: true },
  });

  if (accounts.length === 0) {
    return NextResponse.json({ message: "Keine aktiven Email-Konfigurationen", processed: 0 });
  }

  const results = [];
  let totalSent = 0;
  for (const acc of accounts) {
    try {
      const result = await processAccountEmailRules(acc.accountId);
      totalSent += result.totalSent;
      results.push(result);
      console.log(
        `[cron email] account=${acc.accountId} sent=${result.totalSent} rules=${result.ruleStats.length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron email] account=${acc.accountId} failed:`, msg);
      results.push({ accountId: acc.accountId, ok: false, ruleStats: [], totalSent: 0, error: msg });
    }
  }

  return NextResponse.json({
    processed: results.length,
    totalSent,
    results,
  });
}
