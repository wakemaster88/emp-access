import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { berlinYmd } from "@/lib/berlin-day";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiSession } from "@/lib/rider-auth";
import { castVote } from "@/lib/challenge-voting";

const schema = z.object({
  entryId: z.number().int().positive().nullable().optional(),
  optionId: z.number().int().positive().nullable().optional(),
});

/**
 * POST: Stimme abgeben, ändern oder (beides leer) zurücknehmen. Nur die
 * angemeldete Person selbst: Eltern stimmen nicht für ihre Kinder mit.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: rawId } = await params;
  const limited = publicRateLimit(token, "rider-challenge-vote", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiSession(token);
  if ("error" in ctx) return ctx.error;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Ungültige Challenge" }, { status: 400 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.entryId != null && parsed.data.optionId != null)) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  const result = await castVote(ctx.profile.accountId, id, ctx.profile.id, parsed.data, berlinYmd(new Date()));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
