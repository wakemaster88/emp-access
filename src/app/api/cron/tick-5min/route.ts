import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runRuleTick } from "@/lib/room-rules";
import { runIrrigationTick } from "@/lib/irrigation";
import { runOfflineCheckTick } from "@/lib/device-offline";
import { runTelegramReportTick } from "@/lib/telegram-report-tick";

export const maxDuration = 120;

/**
 * Ein Cron alle fuenf Minuten statt vier einzelner: Raumregeln, Bewaesserung,
 * Geraete-Offline-Check und der Telegram-Tagesbericht. Jeder Job laeuft in
 * seinem eigenen try/catch; ein Fehler bremst die anderen nicht.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn("[cron tick-5min] Auth failed:", JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const jobs = {
    roomRules: runRuleTick,
    irrigation: runIrrigationTick,
    deviceOffline: runOfflineCheckTick,
    telegramReport: runTelegramReportTick,
  } as const;

  const entries = Object.entries(jobs) as [keyof typeof jobs, () => Promise<unknown>][];
  const settled = await Promise.allSettled(entries.map(([, run]) => run()));

  const result: Record<string, unknown> = {};
  let failed = 0;
  settled.forEach((s, i) => {
    const name = entries[i][0];
    if (s.status === "fulfilled") {
      result[name] = s.value;
      console.log(`[cron tick-5min] ${name}: ${JSON.stringify(s.value).slice(0, 300)}`);
    } else {
      failed += 1;
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      result[name] = { error: msg };
      console.error(`[cron tick-5min] ${name} failed:`, msg);
    }
  });

  return NextResponse.json({ ok: failed === 0, failed, ...result }, { status: failed === 0 ? 200 : 500 });
}
