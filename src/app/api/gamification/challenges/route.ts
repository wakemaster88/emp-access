import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { challengeSchema, normalizeChallenge } from "@/lib/gamification-input";

/** POST: Challenge anlegen. */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = challengeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const challenge = await db.challenge.create({ data: { ...normalizeChallenge(parsed.data), accountId } });
  return NextResponse.json(challenge, { status: 201 });
}
