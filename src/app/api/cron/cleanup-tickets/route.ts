import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { berlinDayStart } from "@/lib/berlin-day";

export const maxDuration = 60;

/**
 * Cleanup-Cron: setzt abgelaufene DATE_RANGE-Tickets, die noch im Status
 * `VALID` haengen, auf `INVALID`. Greift NUR bei `endDate < heute (Berlin)`.
 *
 * Hintergrund: Der Scan-Endpoint blockt abgelaufene Tickets bereits ueber
 * den `endDate`-Check (`note=expired`), aber der Status bleibt bei
 * unbenutzten Tickets dauerhaft `VALID`. In Dashboards und Ticket-Listen
 * wirkt das so, als waeren die Tickets weiterhin aktiv. Der Wechsel auf
 * `INVALID` ist die bereits etablierte Konvention (ANNY-Sync setzt
 * stornierte Buchungen ebenfalls auf `INVALID`).
 *
 * REDEEMED-Tickets werden absichtlich NICHT angefasst: sie stehen fuer
 * historische Nutzung (z.B. Auswertungen "Tagesgaeste pro Saison") und
 * der Scan-Endpoint blockt sie ohnehin korrekt ueber `endDate`.
 *
 * Schedule: einmal nachts (03:30 Berlin), bevor ANNY- und Email-Crons
 * morgens laufen.
 */
function verifyCronAuth(request: NextRequest): { ok: true } | { ok: false; status: number; body: object } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "CRON_SECRET ist nicht gesetzt",
        hint: "In Vercel: Projekt → Settings → Environment Variables → CRON_SECRET (min. 16 Zeichen). Nach dem Anlegen neu deployen.",
      },
    };
  }
  const auth = request.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer !== secret) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Unauthorized",
        hint: "Vercel sendet Authorization: Bearer <CRON_SECRET>. Wert in Vercel muss exakt mit CRON_SECRET übereinstimmen.",
        hasAuthHeader: !!auth,
      },
    };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron cleanup-tickets] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  // Tagesgrenze in Berlin (DST-sicher): alles, dessen endDate vor
  // "heute 00:00 Berlin" liegt, ist endgueltig abgelaufen.
  const berlinTodayStart = berlinDayStart();

  const result = await prisma.ticket.updateMany({
    where: {
      validityType: "DATE_RANGE",
      status: "VALID",
      endDate: { lt: berlinTodayStart, not: null },
    },
    data: { status: "INVALID" },
  });

  console.log(`[cron cleanup-tickets] Marked ${result.count} stale VALID tickets as INVALID (endDate < ${berlinTodayStart.toISOString()})`);
  return NextResponse.json({
    markedInvalid: result.count,
    cutoff: berlinTodayStart.toISOString(),
  });
}
