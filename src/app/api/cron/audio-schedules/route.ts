import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runAudioScheduleTick } from "@/lib/audio-schedule-tick";
import { runMusicVoteTick } from "@/lib/music-vote";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron audio-schedules] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  try {
    const tick = await runAudioScheduleTick();
    // Nach den Zeitplänen: die Playlist-Abstimmung der Fahrer (wechselt nur laufende Musik).
    const vote = await runMusicVoteTick().catch((e) => ({
      accounts: 0,
      switched: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    }));
    console.log(
      `[cron audio-schedules] checked=${tick.checked} triggered=${tick.triggered} vote=${vote.switched}`
    );
    return NextResponse.json({ ...tick, vote });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron audio-schedules] failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
