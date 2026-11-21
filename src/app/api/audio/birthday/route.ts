import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { birthdayAnnounceSchema, normalizeBirthdayAnnounce } from "@/lib/gamification-input";

/**
 * PUT: Geburtstags-Durchsage einstellen. Scannt ein Geburtstagskind am
 * Start-Drehkreuz, kommt einmal am Tag die Ansage in den gewählten Zonen.
 */
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) return NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 403 });

  const parsed = birthdayAnnounceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const data = normalizeBirthdayAnnounce(parsed.data);
  if (data.announceZoneIds.length > 0) {
    const owned = await db.audioZone.count({ where: { accountId, id: { in: data.announceZoneIds } } });
    if (owned !== data.announceZoneIds.length) return NextResponse.json({ error: "Unbekannte Zone" }, { status: 400 });
  }
  const saved = await db.riderBirthday.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  return NextResponse.json(saved);
}
