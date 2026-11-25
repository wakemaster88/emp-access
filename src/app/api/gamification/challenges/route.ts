import { after, NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { challengeSchema, normalizeChallenge, pollOptions } from "@/lib/gamification-input";
import { skillRewardAllowed } from "@/lib/rider-skills";
import { runAccountAnnouncements } from "@/lib/rider-announce";

/** Laufzeitlimit der Route auf Vercel in Sekunden (gleicher Wert wie in vercel.json). */
export const maxDuration = 60;

/** POST: Challenge anlegen (bei einer Abstimmung mit Antworten); mit `push` geht eine Meldung an die Kunden. */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = challengeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  if (!(await skillRewardAllowed(db, accountId, parsed.data.skillId))) {
    return NextResponse.json({ error: "Unbekannter Skill" }, { status: 400 });
  }
  const challenge = await db.challenge.create({
    data: { ...normalizeChallenge(parsed.data), pushPlanned: parsed.data.push ?? false, accountId },
  });
  if (challenge.kind === "POLL") {
    await db.challengeOption.createMany({
      data: pollOptions(parsed.data.options).map((label, i) => ({ challengeId: challenge.id, label, sortOrder: i, accountId })),
    });
  }
  if (challenge.pushPlanned) after(() => runAccountAnnouncements(accountId).catch((e) => console.error("[announce]", e)));
  return NextResponse.json(challenge, { status: 201 });
}
