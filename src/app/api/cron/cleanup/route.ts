import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { berlinDayStart } from "@/lib/berlin-day";
import { purgeAllAccountsRetention } from "@/lib/data-retention";
import { gcOrphanBlobs } from "@/lib/blob-store";

export const maxDuration = 300;

/**
 * Naechtlicher Aufraeum-Cron (ein Job statt zwei):
 *
 * 1. Abgelaufene DATE_RANGE-Tickets, die noch `VALID` sind, auf `INVALID`
 *    setzen (nur `endDate < heute Berlin`). REDEEMED-Tickets bleiben
 *    unangetastet, sie stehen fuer historische Nutzung.
 * 2. Historien-/Log-Daten gemaess Account.dataRetention loeschen, inklusive
 *    der zugehoerigen Bilder im Blob-Speicher.
 * 3. Verwaiste Blobs einsammeln (Bilder, deren Datensatz per Cascade
 *    verschwunden ist).
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn("[cron cleanup] Auth failed:", JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const berlinTodayStart = berlinDayStart();
  const stale = await prisma.ticket.updateMany({
    where: {
      validityType: "DATE_RANGE",
      status: "VALID",
      endDate: { lt: berlinTodayStart, not: null },
    },
    data: { status: "INVALID" },
  });
  console.log(`[cron cleanup] tickets: ${stale.count} abgelaufene VALID-Tickets auf INVALID (endDate < ${berlinTodayStart.toISOString()})`);

  const retention = await purgeAllAccountsRetention();
  const totalDeleted = retention.results.reduce(
    (sum, r) => sum + Object.values(r.deleted).reduce((a, b) => a + (b ?? 0), 0),
    0,
  );
  console.log(`[cron cleanup] retention: accounts=${retention.accounts} purged=${retention.results.length} deleted=${totalDeleted}`);

  let blobGc: Awaited<ReturnType<typeof gcOrphanBlobs>> | { error: string };
  try {
    blobGc = await gcOrphanBlobs();
    console.log(`[cron cleanup] blob-gc: listed=${blobGc.listed} deleted=${blobGc.deleted}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron cleanup] blob-gc failed:", msg);
    blobGc = { error: msg };
  }

  return NextResponse.json({
    tickets: { markedInvalid: stale.count, cutoff: berlinTodayStart.toISOString() },
    retention: { accounts: retention.accounts, purgedAccounts: retention.results.length, totalDeleted, results: retention.results },
    blobGc,
  });
}
