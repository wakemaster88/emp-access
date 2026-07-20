import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { vehicleSightingAssignSchema } from "@/lib/validators";
import { assignVehicleToSighting } from "@/lib/vehicles";

/** PATCH (Session): Sichtung zuordnen / Kennzeichen nachtragen. */
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
  const parsed = vehicleSightingAssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await assignVehicleToSighting({
      accountId: accountId!,
      sightingId: id,
      allowedVehicleId: parsed.data.allowedVehicleId,
      plate: parsed.data.plate,
      createVehicle: parsed.data.createVehicle ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fehler" },
      { status: 400 }
    );
  }
}

/** DELETE (Session): Fehltreffer entfernen. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const id = Number((await params).id);
  if (isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const res = await db.vehicleSighting.deleteMany({
    where: { id, accountId: accountId! },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
