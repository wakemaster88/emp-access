import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runNewsletterTick } from "@/lib/newsletter/service";

/**
 * Jede Minute: offene Bestätigungsmails nachholen und gestartete
 * Aussendungen in Raten über SES verschicken (höchstens 10 Mails je
 * Sekunde, so viel SES erlaubt). Ohne SES-Zugangsdaten tut der Lauf nichts.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) return NextResponse.json(authResult.body, { status: authResult.status });
  try {
    const summary = await runNewsletterTick(45_000);
    if (summary.sent || summary.confirmMails || summary.failed || summary.stopped.length) {
      console.log(`[cron newsletter] ${JSON.stringify(summary).slice(0, 500)}`);
    }
    return NextResponse.json({ ok: summary.stopped.length === 0, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron newsletter] fehlgeschlagen:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
