import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { skillRewardAllowed } from "@/lib/rider-skills";
import { milestoneSchema, normalizeMilestone } from "@/lib/gamification-input";

/** POST: Meilenstein anlegen. */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = milestoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  if (!(await skillRewardAllowed(db, accountId, parsed.data.skillId))) {
    return NextResponse.json({ error: "Unbekannter Skill" }, { status: 400 });
  }
  const last = await db.milestone.findFirst({
    where: { accountId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const milestone = await db.milestone.create({
    data: { ...normalizeMilestone(parsed.data), sortOrder: (last?.sortOrder ?? 0) + 1, accountId },
  });
  return NextResponse.json(milestone, { status: 201 });
}
