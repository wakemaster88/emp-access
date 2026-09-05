import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { syncAnnyForAccount } from "@/lib/anny-sync";

// Ein Voll-Sync liest ~11.500 Buchungen (24 API-Seiten) plus Rechnungen und
// schreibt mehrere Tausend Tickets. Bei 60s lief das regelmaessig ins Timeout,
// wodurch der Sync mitten im Ticket-Upsert abbrach.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron anny-sync] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const configs = await prisma.apiConfig.findMany({
    where: { provider: "ANNY" },
    select: { accountId: true },
  });

  if (configs.length === 0) {
    return NextResponse.json({ message: "Keine ANNY-Integrationen konfiguriert" });
  }

  // Accounts parallel syncen - jeder Sync ist account-isoliert (eigener
  // Anny-Token, eigene DB-Eintraege).
  const results = await Promise.all(
    configs.map(async (config) => {
      try {
        console.log(`[cron anny-sync] Starting sync for account ${config.accountId}`);
        // "auto": stuendlich der schnelle Fensterlauf, einmal taeglich der
        // Volllauf ueber das ganze 60-Tage-Fenster inkl. Aufraeumen.
        const result = await syncAnnyForAccount(config.accountId, { mode: "auto" });
        console.log(`[cron anny-sync] Account ${config.accountId}: mode=${result.mode} created=${result.created} updated=${result.updated} errors=${result.errors}`);
        return {
          accountId: config.accountId,
          ok: true as const,
          mode: result.mode,
          created: result.created,
          updated: result.updated,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron anny-sync] Account ${config.accountId} failed:`, msg);
        return { accountId: config.accountId, ok: false as const, error: msg };
      }
    }),
  );

  console.log(`[cron anny-sync] Done: ${results.filter((r) => r.ok).length}/${results.length} ok`);
  return NextResponse.json({ synced: results.length, results });
}
