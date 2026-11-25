import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { berlinDayStart } from "@/lib/berlin-day";
import { purgeAllAccountsRetention } from "@/lib/data-retention";
import { gcOrphanBlobs } from "@/lib/blob-store";
import { ensureTelegramWebhook } from "@/lib/telegram-webhook";

export const maxDuration = 300;

/** Telegram-Webhook-Pruefung: hoechstens so viele Configs je Lauf … */
const TELEGRAM_WEBHOOK_MAX_CONFIGS = 20;
/** … und nach dieser Zeit keine weitere Config mehr anfangen. Eine Config
 *  braucht hoechstens drei Telegram-Aufrufe mit je 5 s Zeitlimit, der Schritt
 *  dauert also hoechstens 45 s + 15 s = 60 s. */
const TELEGRAM_WEBHOOK_BUDGET_MS = 45_000;

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
 * 4. Live-Durchsagen vom Vortag samt Ton loeschen. Der Verlauf steht an den
 *    Jobs; der Ton wird nur fuer die Sekunden gebraucht, in denen die Pis ihn
 *    abholen.
 * 5. Telegram-Webhooks aktiver Bots pruefen und eine alte Registrierung mit
 *    Bot-Token in der URL auf die id-Form umstellen (gleicher Host).
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

  const liveSessions = await prisma.audioLiveSession.deleteMany({
    where: { startedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  console.log(`[cron cleanup] audio-live: ${liveSessions.count} Live-Durchsagen geloescht`);

  const telegramWebhooks = { checked: 0, converted: 0, foreign: 0, failed: 0 };
  try {
    const configs = await prisma.telegramConfig.findMany({
      where: { isActive: true },
      select: { id: true, botToken: true },
      orderBy: { id: "asc" },
      take: TELEGRAM_WEBHOOK_MAX_CONFIGS,
    });
    const started = Date.now();
    for (const config of configs) {
      if (Date.now() - started > TELEGRAM_WEBHOOK_BUDGET_MS) break;
      const res = await ensureTelegramWebhook(config);
      telegramWebhooks.checked++;
      if (res.status === "converted") telegramWebhooks.converted++;
      else if (res.status === "foreign") telegramWebhooks.foreign++;
      else if (res.status === "failed") telegramWebhooks.failed++;
    }
    console.log(
      `[cron cleanup] telegram-webhook: checked=${telegramWebhooks.checked} converted=${telegramWebhooks.converted} foreign=${telegramWebhooks.foreign} failed=${telegramWebhooks.failed}`,
    );
  } catch (err) {
    console.error("[cron cleanup] telegram-webhook failed:", err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({
    tickets: { markedInvalid: stale.count, cutoff: berlinTodayStart.toISOString() },
    retention: { accounts: retention.accounts, purgedAccounts: retention.results.length, totalDeleted, results: retention.results },
    blobGc,
    liveSessions: liveSessions.count,
    telegramWebhooks,
  });
}
