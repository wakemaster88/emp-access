import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { cleanNickname } from "@/lib/gamification";
import { riderApiManage } from "@/lib/rider-auth";

const schema = z.object({
  nickname: z.string().max(60).nullable(),
  showInRanking: z.boolean(),
});

/** PATCH: Spitzname und Einwilligung für Ranglisten speichern (selbst oder Eltern für ihr Kind). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-profile", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  const nickname = cleanNickname(parsed.data.nickname);
  // In Ranglisten steht nur der Spitzname, also braucht es einen.
  if (parsed.data.showInRanking && !nickname) {
    return NextResponse.json({ error: "Für die Rangliste brauchst du einen Spitznamen." }, { status: 400 });
  }
  await prisma.riderProfile.update({
    where: { id: ctx.profile.id },
    data: { nickname, showInRanking: parsed.data.showInRanking },
  });
  return NextResponse.json({ ok: true, nickname });
}
