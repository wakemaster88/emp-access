import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { castMusicVote } from "@/lib/music-vote";

const schema = z.object({ option: z.string().regex(/^[ps][1-9]\d{0,9}$/).nullable() });

/** POST: Stimme für eine Playlist oder ein Webradio abgeben, ändern oder (null) zurücknehmen. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-music-vote", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  const result = await castMusicVote(ctx.profile.accountId, ctx.profile.id, parsed.data.option);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, view: result.view });
}
