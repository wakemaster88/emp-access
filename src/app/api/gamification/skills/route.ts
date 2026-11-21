import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { normalizeSkill, skillSchema } from "@/lib/gamification-input";
import { skillDeviceAllowed } from "@/lib/rider-skills";

/** POST: Skill anlegen. */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = skillSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const data = normalizeSkill(parsed.data);
  if (!(await skillDeviceAllowed(db, accountId, data.deviceId))) {
    return NextResponse.json({ error: "Dieses Gerät kann kein Skill schalten." }, { status: 400 });
  }
  const last = await db.riderSkill.findFirst({ where: { accountId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const skill = await db.riderSkill.create({ data: { ...data, sortOrder: (last?.sortOrder ?? 0) + 1, accountId } });
  return NextResponse.json(skill, { status: 201 });
}
