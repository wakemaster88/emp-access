import { after, NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { offerSchema, normalizeOffer, pushPlanPatch } from "@/lib/gamification-input";
import { runAccountAnnouncements } from "@/lib/rider-announce";

async function resolve(params: Promise<{ id: string }>) {
  const session = await gamiAdminSession();
  if ("error" in session) return session;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const existing = await session.db.riderOffer.findFirst({
    where: { id, accountId: session.accountId },
    select: { id: true, pushedAt: true },
  });
  if (!existing) {
    return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  }
  return { ...session, id, pushedAt: existing.pushedAt };
}

/** PATCH: Angebot ändern. Mit `push` lässt sich ein noch nicht gesendeter Push planen oder abbestellen. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;

  const parsed = offerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const offer = await ctx.db.riderOffer.update({
    where: { id: ctx.id },
    data: { ...normalizeOffer(parsed.data), ...pushPlanPatch(parsed.data.push, ctx.pushedAt) },
  });
  // Bearbeiten allein meldet nichts; nur ein geplanter, noch offener Push geht jetzt raus.
  if (offer.pushPlanned && !offer.pushedAt) {
    const accountId = ctx.accountId;
    after(() => runAccountAnnouncements(accountId).catch((e) => console.error("[announce]", e)));
  }
  return NextResponse.json(offer);
}

/** DELETE: Angebot löschen. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  await ctx.db.riderOffer.delete({ where: { id: ctx.id } });
  return NextResponse.json({ ok: true });
}
