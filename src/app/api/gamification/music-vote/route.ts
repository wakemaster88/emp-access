import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { applyMusicVote, loadMusicVoteAdmin } from "@/lib/music-vote";
import { MAX_HOLD_MINUTES, MAX_VOTE_PLAYLISTS, cleanVoteIds } from "@/lib/music-vote-rules";

const schema = z.object({
  enabled: z.boolean(),
  zoneIds: z.array(z.number().int()).max(50),
  playlistIds: z.array(z.number().int()).max(100),
  holdMinutes: z.number().int().min(0).max(MAX_HOLD_MINUTES),
});

/** GET: aktueller Stand (Stimmen, Zonen) für die Karte in den Einstellungen. */
export async function GET() {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  return NextResponse.json({ standing: await loadMusicVoteAdmin(session.accountId) });
}

/** PUT: Playlist-Abstimmung ein-/ausschalten, Zonen und Playlists wählen. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  const [zones, playlists] = await Promise.all([
    db.audioZone.findMany({ where: { accountId }, select: { id: true } }),
    db.audioPlaylist.findMany({ where: { accountId }, select: { id: true } }),
  ]);
  const zoneIds = cleanVoteIds(parsed.data.zoneIds, zones.map((z) => z.id), 50);
  const playlistIds = cleanVoteIds(parsed.data.playlistIds, playlists.map((p) => p.id));
  if (parsed.data.enabled && zoneIds.length === 0) {
    return NextResponse.json({ error: "Wähl mindestens eine Zone." }, { status: 400 });
  }
  if (parsed.data.enabled && playlistIds.length < 2) {
    return NextResponse.json({ error: `Wähl 2 bis ${MAX_VOTE_PLAYLISTS} Playlists zur Abstimmung.` }, { status: 400 });
  }
  const data = {
    musicVoteEnabled: parsed.data.enabled,
    musicVoteZoneIds: zoneIds,
    musicVotePlaylistIds: playlistIds,
    musicVoteHoldMinutes: parsed.data.holdMinutes,
  };
  await db.gamificationConfig.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  if (data.musicVoteEnabled) await applyMusicVote(accountId).catch((e) => console.error("[music-vote] anwenden", e));
  return NextResponse.json({ ok: true, zoneIds, playlistIds, standing: await loadMusicVoteAdmin(accountId) });
}
