import { NextRequest, NextResponse } from "next/server";
import { runRuleTick } from "@/lib/room-rules";

export const maxDuration = 60;

/**
 * Cron fuer die zeitgesteuerten Raumregeln: feste Uhrzeit, Betriebsbeginn und
 * -ende, Sonnenzeiten, Ruhe im Raum. Ereignisregeln (Bewegung, Schaltvorgang,
 * Scan) laufen nicht hier, sondern direkt an ihrer Quelle.
 */
function verifyCronAuth(
  request: NextRequest,
): { ok: true } | { ok: false; status: number; body: object } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "CRON_SECRET ist nicht gesetzt",
        hint: "In Vercel: Projekt → Settings → Environment Variables → CRON_SECRET (min. 16 Zeichen).",
      },
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
    console.warn("[cron room-rules] Auth failed:", JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  try {
    const tick = await runRuleTick();
    console.log(`[cron room-rules] checked=${tick.checked} triggered=${tick.triggered}`);
    return NextResponse.json(tick);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron room-rules] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
