import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { personSightingsDismissSchema } from "@/lib/validators";

/** POST (Session): unbekannte Sichtungen verwerfen (Fehlerkennung, Passanten). */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => null);
  const parsed = personSightingsDismissSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Nur unzugeordnete: eine schon zugeordnete Sichtung verschwindet hier nie.
  const res = await db.personSighting.deleteMany({
    where: { id: { in: parsed.data.sightingIds }, accountId: accountId!, listedPersonId: null },
  });
  return NextResponse.json({ deleted: res.count });
}
