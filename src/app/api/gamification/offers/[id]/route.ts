import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { offerSchema, normalizeOffer } from "@/lib/gamification-input";

async function resolve(params: Promise<{ id: string }>) {
  const session = await gamiAdminSession();
  if ("error" in session) return session;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const existing = await session.db.riderOffer.findFirst({
    where: { id, accountId: session.accountId },
    select: { id: true },
  });
  if (!existing) {
    return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  }
  return { ...session, id };
}

/** PATCH: Angebot ändern. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;

  const parsed = offerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const offer = await ctx.db.riderOffer.update({ where: { id: ctx.id }, data: normalizeOffer(parsed.data) });
  return NextResponse.json(offer);
}

/** DELETE: Angebot löschen. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  await ctx.db.riderOffer.delete({ where: { id: ctx.id } });
  return NextResponse.json({ ok: true });
}
