import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { normalizeSkill, skillSchema } from "@/lib/gamification-input";
import { skillDeviceAllowed } from "@/lib/rider-skills";

async function resolve(params: Promise<{ id: string }>) {
  const session = await gamiAdminSession();
  if ("error" in session) return session;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const existing = await session.db.riderSkill.findFirst({ where: { id, accountId: session.accountId }, select: { id: true } });
  if (!existing) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  return { ...session, id };
}

/** Nur die Sperre umschalten (Schalter in der Liste). */
const pauseSchema = z.object({ paused: z.boolean() }).strict();

/** PATCH: Skill ändern oder nur sperren/freigeben (`{ paused }`). Vergebene Nutzungen bleiben. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => null);

  const pause = pauseSchema.safeParse(body);
  if (pause.success) {
    const skill = await ctx.db.riderSkill.update({ where: { id: ctx.id }, data: { paused: pause.data.paused } });
    return NextResponse.json(skill);
  }
  const parsed = skillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const data = normalizeSkill(parsed.data);
  if (!(await skillDeviceAllowed(ctx.db, ctx.accountId, data.deviceId))) {
    return NextResponse.json({ error: "Dieses Gerät kann kein Skill schalten." }, { status: 400 });
  }
  const skill = await ctx.db.riderSkill.update({ where: { id: ctx.id }, data });
  return NextResponse.json(skill);
}

/**
 * DELETE: Skill löschen. Wurde er schon vergeben, wird er nur abgeschaltet,
 * damit Protokoll und Vergaben erhalten bleiben.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  const used = await ctx.db.riderSkillGrant.count({ where: { accountId: ctx.accountId, skillId: ctx.id } });
  if (used > 0) {
    await ctx.db.riderSkill.update({ where: { id: ctx.id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await ctx.db.riderSkill.delete({ where: { id: ctx.id } });
  return NextResponse.json({ ok: true });
}
