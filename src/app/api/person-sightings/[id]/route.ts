import { NextRequest, NextResponse } from "next/server";
import { adminRoleRequired, getSessionWithDb } from "@/lib/api-auth";
import { personHasOpener } from "@/lib/role-guards";
import { personSightingAssignSchema } from "@/lib/validators";
import { assignPersonToSighting } from "@/lib/persons";

/** PATCH (Session): Sichtung einer ListedPerson zuordnen. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const id = Number((await params).id);
  if (isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = personSightingAssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Wie bei der Sammel-Zuordnung: Ein weiteres Gesicht fuer eine Person mit
  // automatischem Oeffner ist eine dauerhafte Freigabe – nur Verwaltung.
  const target = await session.db.listedPerson.findFirst({
    where: { id: parsed.data.listedPersonId, accountId: accountId! },
    select: { triggerOnDetection: true, shellyDeviceId: true },
  });
  if (target && personHasOpener(target)) {
    const denied = adminRoleRequired(session.session.user.role);
    if (denied) return denied;
  }

  try {
    const result = await assignPersonToSighting({
      accountId: accountId!,
      sightingId: id,
      listedPersonId: parsed.data.listedPersonId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fehler" },
      { status: 400 }
    );
  }
}

/** DELETE (Session): Fehltreffer / unbrauchbare Sichtung entfernen. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const id = Number((await params).id);
  if (isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const res = await db.personSighting.deleteMany({
    where: { id, accountId: accountId! },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
