import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runAudioScheduleTick } from "@/lib/audio-schedule-tick";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron audio-schedules] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  try {
    const tick = await runAudioScheduleTick();
    console.log(
      `[cron audio-schedules] checked=${tick.checked} triggered=${tick.triggered}`
    );
    return NextResponse.json(tick);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron audio-schedules] failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
