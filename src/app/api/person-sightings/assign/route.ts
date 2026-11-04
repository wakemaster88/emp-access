import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
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
