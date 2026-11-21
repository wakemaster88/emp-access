import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { runDunningForAccount, type DunningRunResult } from "@/lib/dunning";

export const maxDuration = 60;

/**
 * Täglicher Mahnlauf (lib/dunning), morgens nach 9 Uhr Berlin: je Abo mit
 * „Zahlung offen“ höchstens eine Stufe (Erinnerung über anny, 1. Mahnung,
 * letzte Mahnung, bereit für Inkasso). Roher Client, weil Cron über alle Konten.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron dunning] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const configs = await prisma.apiConfig.findMany({
    where: { provider: "ANNY", account: { isActive: true } },
    select: { accountId: true },
  });

  const results: Array<DunningRunResult | { accountId: number; error: string }> = [];
  for (const { accountId } of configs) {
    try {
      const r = await runDunningForAccount(prisma as unknown as PrismaClient, accountId);
      console.log(`[cron dunning] account=${accountId} ${JSON.stringify(r)}`);
      results.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron dunning] account=${accountId} failed:`, msg);
      results.push({ accountId, error: msg });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
