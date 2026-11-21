import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { prisma } from "@/lib/prisma";
import { triggerRiderSkill } from "@/lib/rider-skills";

const schema = z.object({
  skillId: z.number().int().positive(),
  option: z.string().regex(/^[ps][1-9]\d{0,9}$/).nullable().optional(),
});

/** POST: Skill auslösen (Gerät schalten oder Musik-Joker). Grenzen prüft `triggerRiderSkill`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-skill", { limit: 6, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  const { accountId, id: profileId } = ctx.profile;
  const tickets = await prisma.ticket.findMany({ where: { accountId, riderProfileId: profileId }, select: { id: true } });
  const result = await triggerRiderSkill(
    { accountId, profileId, ticketIds: tickets.map((t) => t.id) },
    parsed.data.skillId,
    parsed.data.option ?? null,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, text: result.text, skills: result.skills });
}
