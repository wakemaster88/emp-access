import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { skillRewardAllowed } from "@/lib/rider-skills";
import { milestoneSchema, normalizeMilestone } from "@/lib/gamification-input";

async function resolve(params: Promise<{ id: string }>) {
  const session = await gamiAdminSession();
  if ("error" in session) return session;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const existing = await session.db.milestone.findFirst({
    where: { id, accountId: session.accountId },
    select: { id: true },
  });
  if (!existing) {
    return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  }
  return { ...session, id };
}

/** PATCH: Meilenstein ändern. Bereits vergebene Awards bleiben unberührt. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;

  const parsed = milestoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  if (!(await skillRewardAllowed(ctx.db, ctx.accountId, parsed.data.skillId))) {
    return NextResponse.json({ error: "Unbekannter Skill" }, { status: 400 });
  }
  const milestone = await ctx.db.milestone.update({
    where: { id: ctx.id },
    data: normalizeMilestone(parsed.data),
  });
  return NextResponse.json(milestone);
}

/**
 * DELETE: Meilenstein löschen. Wurde er schon vergeben, wird er nur
 * abgeschaltet – sonst gingen die Awards und der Bezug der Gutscheine verloren.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;

  const awards = await ctx.db.milestoneAward.count({
    where: { milestoneId: ctx.id, accountId: ctx.accountId },
  });
  if (awards > 0) {
    await ctx.db.milestone.update({ where: { id: ctx.id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await ctx.db.milestone.delete({ where: { id: ctx.id } });
  return NextResponse.json({ ok: true, deactivated: false });
}
