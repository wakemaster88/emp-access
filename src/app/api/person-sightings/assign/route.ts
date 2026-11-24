import { NextRequest, NextResponse } from "next/server";
import { adminRoleRequired, getSessionWithDb } from "@/lib/api-auth";
import { personHasOpener } from "@/lib/role-guards";
import { personSightingsBulkAssignSchema } from "@/lib/validators";
import { assignSightings } from "@/lib/unknown-persons";

/**
 * POST (Session): mehrere Sichtungen einer Person zuordnen oder dafuer eine
 * neue Person anlegen. Body: { sightingIds, listedPersonId } oder
 * { sightingIds, newPerson: { name, listType } }.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json().catch(() => null);
  const parsed = personSightingsBulkAssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Eine Sichtung gibt der Person ein weiteres Gesicht. Hat die Person einen
  // automatischen Oeffner, ist das eine dauerhafte Freigabe: nur Verwaltung.
  if (parsed.data.listedPersonId) {
    const target = await session.db.listedPerson.findFirst({
      where: { id: parsed.data.listedPersonId, accountId: session.accountId! },
      select: { triggerOnDetection: true, shellyDeviceId: true },
    });
    if (target && personHasOpener(target)) {
      const denied = adminRoleRequired(session.session.user.role);
      if (denied) return denied;
    }
  }

  try {
    const result = await assignSightings({
      accountId: session.accountId!,
      sightingIds: parsed.data.sightingIds,
      listedPersonId: parsed.data.listedPersonId ?? null,
      newPerson: parsed.data.newPerson ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fehler" },
      { status: 400 }
    );
  }
}
