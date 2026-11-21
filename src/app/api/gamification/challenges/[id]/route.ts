import { after, NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { challengeSchema, normalizeChallenge, pushPlanPatch } from "@/lib/gamification-input";
import { skillRewardAllowed } from "@/lib/rider-skills";
import { runAccountAnnouncements } from "@/lib/rider-announce";

async function resolve(params: Promise<{ id: string }>) {
  const session = await gamiAdminSession();
  if ("error" in session) return session;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const existing = await session.db.challenge.findFirst({
    where: { id, accountId: session.accountId },
    select: { id: true, settledAt: true, pushedAt: true },
  });
  if (!existing) {
    return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  }
  return { ...session, id, settledAt: existing.settledAt, pushedAt: existing.pushedAt };
}

/**
 * PATCH: Challenge ändern. Nach der Auswertung lassen sich nur noch Name,
 * Beschreibung und der Schalter ändern – die Gewinner stehen fest.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;

  const parsed = challengeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  if (!(await skillRewardAllowed(ctx.db, ctx.accountId, parsed.data.skillId))) {
    return NextResponse.json({ error: "Unbekannter Skill" }, { status: 400 });
  }
  const data = normalizeChallenge(parsed.data);
  const challenge = await ctx.db.challenge.update({
    where: { id: ctx.id },
    data: ctx.settledAt
      ? { name: data.name, description: data.description, active: data.active }
      : { ...data, ...pushPlanPatch(parsed.data.push, ctx.pushedAt) },
  });
  // Bearbeiten allein meldet nichts; nur ein geplanter, noch offener Push geht jetzt raus.
  if (challenge.pushPlanned && !challenge.pushedAt) {
    const accountId = ctx.accountId;
    after(() => runAccountAnnouncements(accountId).catch((e) => console.error("[announce]", e)));
  }
  return NextResponse.json(challenge);
}

/** DELETE: Challenge löschen. Gibt es schon Gewinner, wird sie nur abgeschaltet. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;

  const awards = await ctx.db.challengeAward.count({
    where: { challengeId: ctx.id, accountId: ctx.accountId },
  });
  if (awards > 0) {
    await ctx.db.challenge.update({ where: { id: ctx.id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await ctx.db.challenge.delete({ where: { id: ctx.id } });
  return NextResponse.json({ ok: true, deactivated: false });
}
