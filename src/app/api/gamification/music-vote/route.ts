import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { applyMusicVote, loadMusicVoteAdmin } from "@/lib/music-vote";
import { MAX_HOLD_MINUTES, MAX_VOTE_OPTIONS, cleanVoteIds, optionKey } from "@/lib/music-vote-rules";

const schema = z.object({
  enabled: z.boolean(),
  zoneIds: z.array(z.number().int()).max(50),
  /** "p<id>" Playlist, "s<id>" Webradio, in App-Reihenfolge. */
  options: z.array(z.string().max(20)).max(100),
  holdMinutes: z.number().int().min(0).max(MAX_HOLD_MINUTES),
});

/** GET: aktueller Stand (Stimmen, Zonen) für die Karte in den Einstellungen. */
export async function GET() {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  return NextResponse.json({ standing: await loadMusicVoteAdmin(session.accountId) });
}

/** PUT: Playlist-Abstimmung ein-/ausschalten, Zonen sowie Playlists und Webradios wählen. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  const [zones, playlists, streams] = await Promise.all([
    db.audioZone.findMany({ where: { accountId }, select: { id: true } }),
    db.audioPlaylist.findMany({ where: { accountId }, select: { id: true } }),
    db.audioStream.findMany({ where: { accountId }, select: { id: true } }),
  ]);
  const zoneIds = cleanVoteIds(parsed.data.zoneIds, zones.map((z) => z.id), 50);
  const options = cleanVoteIds(parsed.data.options, [
    ...playlists.map((p) => optionKey("PLAYLIST", p.id)),
    ...streams.map((s) => optionKey("STREAM", s.id)),
  ]);
  if (parsed.data.enabled && zoneIds.length === 0) {
    return NextResponse.json({ error: "Wähl mindestens eine Zone." }, { status: 400 });
  }
  if (parsed.data.enabled && options.length < 2) {
    return NextResponse.json({ error: `Wähl 2 bis ${MAX_VOTE_OPTIONS} Playlists oder Webradios zur Abstimmung.` }, { status: 400 });
  }
  const data = {
    musicVoteEnabled: parsed.data.enabled,
    musicVoteZoneIds: zoneIds,
    musicVoteOptions: options,
    musicVoteHoldMinutes: parsed.data.holdMinutes,
  };
  await db.gamificationConfig.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  if (data.musicVoteEnabled) await applyMusicVote(accountId).catch((e) => console.error("[music-vote] anwenden", e));
  return NextResponse.json({ ok: true, zoneIds, options, standing: await loadMusicVoteAdmin(accountId) });
}
